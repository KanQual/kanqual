import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const POSTGRES_VERSION = "17";
const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "src-tauri", "postgres-runtimes", `postgresql-${POSTGRES_VERSION}`);
const stagedRoot = path.join(repoRoot, "src-tauri", "resources", "runtime", `postgresql-${POSTGRES_VERSION}`);
const strict = process.argv.includes("--strict") || process.env.KANQUAL_REQUIRE_BUNDLED_POSTGRES === "1";

function targetTriple() {
  const platform = process.env.KANQUAL_POSTGRES_TARGET_PLATFORM || process.platform;
  const arch = process.env.KANQUAL_POSTGRES_TARGET_ARCH || process.arch;

  if (platform === "win32" && arch === "x64") return "windows-x86_64";
  if (platform === "darwin" && arch === "arm64") return "macos-aarch64";
  if (platform === "darwin" && arch === "x64") return "macos-x86_64";
  if (platform === "linux" && arch === "x64") return "linux-x86_64";

  throw new Error(`Unsupported bundled PostgreSQL target: platform=${platform}, arch=${arch}`);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writePlaceholder(target, reason) {
  await rm(stagedRoot, { recursive: true, force: true });
  await mkdir(path.join(stagedRoot, "bin"), { recursive: true });
  await mkdir(path.join(stagedRoot, "lib"), { recursive: true });
  await mkdir(path.join(stagedRoot, "share"), { recursive: true });
  await writeFile(
    path.join(stagedRoot, "README.md"),
    `# Bundled PostgreSQL Runtime\n\nNo PostgreSQL ${POSTGRES_VERSION} runtime has been staged for ${target}.\n\n${reason}\n\nExpected source layout:\n\n\`\`\`text\nsrc-tauri/postgres-runtimes/postgresql-${POSTGRES_VERSION}/${target}/\n  bin/\n  lib/\n  share/\n\`\`\`\n`,
  );
  await writeFile(path.join(stagedRoot, "bin", ".gitkeep"), "");
  await writeFile(path.join(stagedRoot, "lib", ".gitkeep"), "");
  await writeFile(path.join(stagedRoot, "share", ".gitkeep"), "");
}

async function main() {
  const target = targetTriple();
  const sourceDir = path.join(sourceRoot, target);
  const sourceBinDir = path.join(sourceDir, "bin");
  const sourceHasRuntime = await exists(sourceDir) && await exists(sourceBinDir);

  if (!sourceHasRuntime) {
    const message = `Missing bundled PostgreSQL ${POSTGRES_VERSION} runtime for ${target} at ${sourceDir}.`;
    if (strict) {
      throw new Error(message);
    }
    await writePlaceholder(target, message);
    console.warn(`[kanqual] ${message}`);
    console.warn("[kanqual] Wrote placeholder runtime; packaged builds should run this script with --strict.");
    return;
  }

  await rm(stagedRoot, { recursive: true, force: true });
  await mkdir(path.dirname(stagedRoot), { recursive: true });
  await cp(sourceDir, stagedRoot, { recursive: true });
  console.log(`[kanqual] Staged bundled PostgreSQL ${POSTGRES_VERSION} runtime for ${target}.`);
}

main().catch((error) => {
  console.error(`[kanqual] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
