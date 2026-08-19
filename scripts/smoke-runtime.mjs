import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function parseArgs(argv) {
  const args = {
    platform: "",
    bundleRoot: path.resolve("src-tauri", "target", "release", "bundle"),
    releaseRoot: path.resolve("src-tauri", "target", "release"),
    holdMs: 8000,
    timeoutMs: 90000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--platform") {
      args.platform = String(argv[++i] ?? "").trim().toLowerCase();
    } else if (arg === "--bundle-root") {
      args.bundleRoot = path.resolve(String(argv[++i] ?? ""));
    } else if (arg === "--release-root") {
      args.releaseRoot = path.resolve(String(argv[++i] ?? ""));
    } else if (arg === "--hold-ms") {
      args.holdMs = Number(argv[++i] ?? args.holdMs);
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i] ?? args.timeoutMs);
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
  node scripts/smoke-runtime.mjs --platform <windows|macos|linux> [--bundle-root <path>] [--release-root <path>] [--hold-ms <ms>] [--timeout-ms <ms>]
`);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(targetPath) {
  if (!await pathExists(targetPath)) return null;
  const raw = await fs.readFile(targetPath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function walk(rootDir) {
  const results = [];

  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      results.push({ fullPath, entry });
      if (entry.isDirectory()) {
        await visit(fullPath);
      }
    }
  }

  await visit(rootDir);
  return results;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesExtension(filePath, extension) {
  return filePath.toLowerCase().endsWith(extension.toLowerCase());
}

function baseName(filePath) {
  return path.basename(filePath);
}

async function findPaths(rootDir, predicate) {
  const entries = await walk(rootDir);
  return entries
    .filter(({ fullPath, entry }) => predicate(fullPath, entry))
    .map(({ fullPath }) => fullPath);
}

async function resolveWindowsLaunchTarget(bundleRoot, releaseRoot) {
  const releaseExe = path.join(releaseRoot, "kanqual.exe");
  const releaseExeStat = await fs.stat(releaseExe).catch(() => null);
  const portableDirs = await findPaths(bundleRoot, (fullPath, entry) => (
    entry.isDirectory() && baseName(fullPath).includes("_portable")
  ));

  for (const dirPath of portableDirs) {
    const exePath = path.join(dirPath, "kanqual.exe");
    const postgresPath = path.join(dirPath, "runtime", "postgresql-17", "bin", "postgres.exe");
    const exeStat = await fs.stat(exePath).catch(() => null);
    if (
      exeStat
      && await pathExists(postgresPath)
      && (!releaseExeStat || exeStat.mtimeMs >= releaseExeStat.mtimeMs)
    ) {
      return { launchPath: exePath, mode: "portable" };
    }
  }

  assert(await pathExists(releaseExe), `Windows runtime smoke test failed: no launchable executable found in ${bundleRoot} or ${releaseRoot}.`);
  return { launchPath: releaseExe, mode: "release-exe" };
}

async function resolveMacosLaunchTarget(bundleRoot) {
  const appDirs = await findPaths(bundleRoot, (fullPath, entry) => entry.isDirectory() && baseName(fullPath).endsWith(".app"));
  assert(appDirs.length > 0, "macOS runtime smoke test failed: no .app bundle was found.");

  for (const appDir of appDirs) {
    const macOsDir = path.join(appDir, "Contents", "MacOS");
    if (!await pathExists(macOsDir)) continue;
    const entries = await fs.readdir(macOsDir, { withFileTypes: true });
    const executable = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().includes("kanqual"))
      ?? entries.find((entry) => entry.isFile());
    if (executable) {
      return { launchPath: path.join(macOsDir, executable.name), mode: "app-bundle" };
    }
  }

  throw new Error("macOS runtime smoke test failed: no executable was found inside Contents/MacOS.");
}

async function resolveLinuxLaunchTarget(bundleRoot) {
  const appImages = await findPaths(bundleRoot, (fullPath, entry) => entry.isFile() && matchesExtension(fullPath, ".appimage"));
  assert(appImages.length > 0, "Linux runtime smoke test failed: no AppImage artifact was found.");
  return { launchPath: appImages[0], mode: "appimage" };
}

async function terminateChild(child, platform) {
  if (child.exitCode != null) return child.exitCode;

  if (platform === "windows") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 2000);
    });
    return null;
  }

  child.kill("SIGTERM");
  for (let i = 0; i < 10; i += 1) {
    if (child.exitCode != null) return child.exitCode;
    await delay(300);
  }
  child.kill("SIGKILL");
  return child.exitCode;
}

async function launchAndVerify({ command, args, env, holdMs }) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: "ignore",
    windowsHide: true,
  });

  let spawnError = null;
  child.on("error", (error) => {
    spawnError = error;
  });

  await delay(holdMs);

  if (spawnError) {
    throw spawnError;
  }

  if (child.exitCode != null) {
    throw new Error(`Application exited too early with code ${child.exitCode}.`);
  }

  return child;
}

async function waitForSmokeCompletion({ child, statePath, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;

  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Application exited before completing the smoke flow with code ${child.exitCode}.`);
    }

    const state = await readJsonIfExists(statePath);
    if (state) {
      lastState = state;
      if (state.failure) {
        throw new Error(`Packaged runtime smoke flow failed during "${state.phase ?? "unknown"}": ${state.failure}`);
      }
      if (state.success === true && state.phase === "completed") {
        return state;
      }
    }

    await delay(500);
  }

  const lastPhase = lastState?.phase ? ` Last phase: ${lastState.phase}.` : "";
  const lastMessage = lastState?.message ? ` Last message: ${lastState.message}` : "";
  throw new Error(`Timed out waiting for packaged smoke flow to complete within ${timeoutMs} ms.${lastPhase}${lastMessage}`);
}

async function prepareSmokeWorkspace(platform) {
  const runId = `${platform}-${Date.now()}`;
  const rootDir = path.join(os.tmpdir(), `kanqual-smoke-${runId}`);
  const dataDir = path.join(rootDir, "data");
  const statePath = path.join(rootDir, "smoke-state.json");
  await fs.rm(rootDir, { recursive: true, force: true });
  await fs.mkdir(dataDir, { recursive: true });

  return {
    runId,
    rootDir,
    dataDir,
    statePath,
    userName: "Kanqual Smoke Test",
    userEmail: "smoke-test@kanqual.local",
    userPassword: "KanqualSmokePass123!",
    projectName: "Packaged Smoke Project",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.platform) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  let target;
  if (args.platform === "windows") {
    target = await resolveWindowsLaunchTarget(args.bundleRoot, args.releaseRoot);
  } else if (args.platform === "macos") {
    target = await resolveMacosLaunchTarget(args.bundleRoot);
  } else if (args.platform === "linux") {
    target = await resolveLinuxLaunchTarget(args.bundleRoot);
  } else {
    throw new Error(`Unsupported platform: ${args.platform}`);
  }

  const smoke = await prepareSmokeWorkspace(args.platform);
  const env = {
    KANQUAL_SMOKE_TEST: "1",
    KANQUAL_SMOKE_RUN_ID: smoke.runId,
    KANQUAL_SMOKE_DATA_DIR: smoke.dataDir,
    KANQUAL_SMOKE_STATE_PATH: smoke.statePath,
    KANQUAL_SMOKE_USER_NAME: smoke.userName,
    KANQUAL_SMOKE_USER_EMAIL: smoke.userEmail,
    KANQUAL_SMOKE_USER_PASSWORD: smoke.userPassword,
    KANQUAL_SMOKE_PROJECT_NAME: smoke.projectName,
  };

  if (args.platform === "linux") {
    env.APPIMAGE_EXTRACT_AND_RUN = "1";
  }

  const child = await launchAndVerify({
    command: target.launchPath,
    args: [],
    env,
    holdMs: args.holdMs,
  });

  let smokeState;
  try {
    smokeState = await waitForSmokeCompletion({
      child,
      statePath: smoke.statePath,
      timeoutMs: args.timeoutMs,
    });
  } finally {
    await terminateChild(child, args.platform);
    await delay(1500);
  }

  assert(await pathExists(path.join(smoke.dataDir, "postgres", "data", "PG_VERSION")), `Smoke runtime test failed: expected bundled PostgreSQL data directory in ${smoke.dataDir}.`);

  console.log(`Runtime smoke test passed for ${args.platform}.`);
  console.log(`- Mode: ${target.mode}`);
  console.log(`- Launch target: ${target.launchPath}`);
  console.log(`- Smoke data dir: ${smoke.dataDir}`);
  console.log(`- State file: ${smoke.statePath}`);
  console.log(`- Verified app stayed alive for ${args.holdMs} ms and completed the local setup flow`);
  if (smokeState?.projectId) {
    console.log(`- Created project: ${smoke.projectName} (${smokeState.projectId})`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
