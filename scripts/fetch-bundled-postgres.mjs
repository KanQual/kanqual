import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { get } from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "scripts", "bundled-postgres-runtimes.json");
const runtimeRoot = path.join(repoRoot, "src-tauri", "postgres-runtimes");
const requiredExecutables = ["postgres", "initdb", "pg_ctl", "psql", "pg_dump"];
const unwantedDirectoryNames = new Set(["doc", "docs", "include", "pgxs", "pkgconfig"]);
const unwantedFileExtensions = new Set([".a", ".la", ".lib", ".pdb"]);

function parseArgs(argv) {
  const args = {
    target: "",
    clean: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      args.target = String(argv[++i] ?? "").trim();
    } else if (arg === "--no-clean") {
      args.clean = false;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/fetch-bundled-postgres.mjs [--target <windows-x86_64|macos-aarch64|macos-x86_64|linux-x86_64>] [--no-clean]
`);
}

function hostTarget() {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x86_64";
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-aarch64";
  if (process.platform === "darwin" && process.arch === "x64") return "macos-x86_64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x86_64";
  throw new Error(`Unsupported PostgreSQL runtime host: platform=${process.platform}, arch=${process.arch}`);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "kanqual-build-script" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
        return;
      }
      pipeline(response, createWriteStream(destination)).then(resolve, reject);
    }).on("error", reject);
  });
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  const data = await readFile(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function walk(rootDir) {
  const entries = [];
  async function visit(currentDir) {
    const children = await readdir(currentDir, { withFileTypes: true });
    for (const child of children) {
      const fullPath = path.join(currentDir, child.name);
      entries.push({ fullPath, child });
      if (child.isDirectory()) {
        await visit(fullPath);
      }
    }
  }
  await visit(rootDir);
  return entries;
}

async function findRuntimeRoot(extractDir) {
  const candidates = [{ fullPath: extractDir, child: { isDirectory: () => true } }, ...(await walk(extractDir))];
  for (const candidate of candidates) {
    if (!candidate.child.isDirectory()) continue;
    const binDir = path.join(candidate.fullPath, "bin");
    const libDir = path.join(candidate.fullPath, "lib");
    const shareDir = path.join(candidate.fullPath, "share");
    if (
      await pathExists(binDir)
      && await pathExists(libDir)
      && await pathExists(shareDir)
      && (await pathExists(path.join(binDir, executableName("postgres"))))
    ) {
      return candidate.fullPath;
    }
  }
  throw new Error(`Could not identify PostgreSQL runtime root in ${extractDir}`);
}

function executableName(base) {
  return process.platform === "win32" ? `${base}.exe` : base;
}

async function trimRuntime(destination) {
  const entries = await walk(destination);
  for (const { fullPath, child } of entries.sort((a, b) => b.fullPath.length - a.fullPath.length)) {
    const lowerName = child.name.toLowerCase();
    if (child.isDirectory()) {
      if (
        unwantedDirectoryNames.has(lowerName)
        || lowerName === "pgadmin"
        || lowerName === "stackbuilder"
        || lowerName === "debug"
        || lowerName === "symbols"
      ) {
        await rm(fullPath, { recursive: true, force: true });
      }
      continue;
    }
    if (
      unwantedFileExtensions.has(path.extname(lowerName))
      || lowerName.includes("pgadmin")
      || lowerName.includes("stackbuilder")
    ) {
      await rm(fullPath, { force: true });
    }
  }
}

async function chmodExecutables(destination) {
  if (process.platform === "win32") return;
  const entries = await readdir(path.join(destination, "bin"), { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() || entry.isSymbolicLink()) {
      await chmod(path.join(destination, "bin", entry.name), 0o755).catch(() => {});
    }
  }
}

async function validateRuntime(destination, target) {
  const extension = target.startsWith("windows") ? ".exe" : "";
  for (const executable of requiredExecutables) {
    const executablePath = path.join(destination, "bin", `${executable}${extension}`);
    if (!await pathExists(executablePath)) {
      throw new Error(`Fetched PostgreSQL runtime for ${target} is missing ${executablePath}`);
    }
  }

  const unwanted = (await walk(destination)).filter(({ fullPath, child }) => {
    const lowerName = child.name.toLowerCase();
    return (
      lowerName.includes("pgadmin")
      || lowerName.includes("stackbuilder")
      || unwantedDirectoryNames.has(lowerName)
      || unwantedFileExtensions.has(path.extname(lowerName))
      || fullPath.toLowerCase().includes(`${path.sep}share${path.sep}doc${path.sep}`)
    );
  });
  if (unwanted.length > 0) {
    throw new Error(`Fetched PostgreSQL runtime for ${target} still contains non-runtime content:\n${unwanted.slice(0, 20).map((entry) => entry.fullPath).join("\n")}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const target = args.target || process.env.KANQUAL_POSTGRES_RUNTIME_TARGET || hostTarget();
  const targetConfig = manifest.targets?.[target];
  if (!targetConfig) {
    throw new Error(`No bundled PostgreSQL runtime manifest entry exists for ${target}`);
  }

  const tempDir = path.join(os.tmpdir(), "kanqual-bundled-postgres", target);
  const archivePath = path.join(tempDir, targetConfig.archive);
  const extractDir = path.join(tempDir, "extract");
  const destination = path.join(runtimeRoot, `postgresql-${manifest.postgresMajor}`, target);

  await rm(extractDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  console.log(`[kanqual] Downloading PostgreSQL ${manifest.version} runtime for ${target}`);
  await download(targetConfig.url, archivePath);

  const actualHash = await sha256(archivePath);
  if (actualHash !== targetConfig.sha256) {
    throw new Error(`SHA256 mismatch for ${targetConfig.archive}: expected ${targetConfig.sha256}, got ${actualHash}`);
  }

  await mkdir(extractDir, { recursive: true });
  await run("tar", ["-xzf", archivePath, "-C", extractDir]);

  const sourceRoot = await findRuntimeRoot(extractDir);
  if (args.clean) {
    await rm(destination, { recursive: true, force: true });
  }
  await mkdir(destination, { recursive: true });
  for (const dir of ["bin", "lib", "share"]) {
    await cp(path.join(sourceRoot, dir), path.join(destination, dir), { recursive: true });
  }
  await trimRuntime(destination);
  await chmodExecutables(destination);
  await validateRuntime(destination, target);

  console.log(`[kanqual] Fetched and validated bundled PostgreSQL runtime for ${target}.`);
}

main().catch((error) => {
  console.error(`[kanqual] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
