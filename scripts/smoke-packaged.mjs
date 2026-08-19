import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    platform: "",
    bundleRoot: path.resolve("src-tauri", "target", "release", "bundle"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--platform") {
      args.platform = String(argv[++i] ?? "").trim().toLowerCase();
    } else if (arg === "--bundle-root") {
      args.bundleRoot = path.resolve(String(argv[++i] ?? ""));
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
  node scripts/smoke-packaged.mjs --platform <windows|macos|linux> [--bundle-root <path>]
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

async function statSafe(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
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

function matchesExtension(filePath, extension) {
  return filePath.toLowerCase().endsWith(extension.toLowerCase());
}

function baseName(filePath) {
  return path.basename(filePath);
}

async function validatePostgresRuntime(runtimeRoot, platform) {
  const extension = platform === "windows" ? ".exe" : "";
  const required = ["postgres", "initdb", "pg_ctl", "psql", "pg_dump"];
  for (const executable of required) {
    const executablePath = path.join(runtimeRoot, "bin", `${executable}${extension}`);
    assert(await pathExists(executablePath), `Packaged smoke test failed: bundled PostgreSQL runtime is missing ${executablePath}.`);
  }
}

async function findPaths(bundleRoot, predicate) {
  const entries = await walk(bundleRoot);
  return entries
    .filter(({ fullPath, entry }) => predicate(fullPath, entry))
    .map(({ fullPath }) => fullPath);
}

async function validateWindowsBundle(bundleRoot) {
  const files = await findPaths(bundleRoot, (fullPath, entry) => entry.isFile() && (
    matchesExtension(fullPath, ".exe")
    || matchesExtension(fullPath, ".zip")
    || matchesExtension(fullPath, ".json")
  ));
  const dirs = await findPaths(bundleRoot, (_fullPath, entry) => entry.isDirectory());

  const installer = files.find((filePath) => baseName(filePath).endsWith("-setup.exe"));
  const portableZip = files.find((filePath) => baseName(filePath).includes("_portable") && matchesExtension(filePath, ".zip"));
  const portableDir = dirs.find((dirPath) => baseName(dirPath).includes("_portable"));

  assert(installer, "Windows smoke test failed: NSIS installer was not found.");
  assert(portableZip, "Windows smoke test failed: portable ZIP artifact was not found.");
  assert(portableDir, "Windows smoke test failed: unpacked portable directory was not found.");

  const requiredPortableEntries = [
    "kanqual.exe",
    "portable-mode.json",
    "runtime",
    "data",
    "licenses",
    "LICENSE",
    "LICENSES.md",
    "THIRD_PARTY_NOTICES.md",
  ];

  for (const name of requiredPortableEntries) {
    const targetPath = path.join(portableDir, name);
    assert(await pathExists(targetPath), `Windows smoke test failed: portable bundle is missing ${name}.`);
  }

  const portableMarker = path.join(portableDir, "portable-mode.json");
  const portableMarkerText = await fs.readFile(portableMarker, "utf8");
  assert(portableMarkerText.trim() === "{}", "Windows smoke test failed: portable-mode.json does not contain the expected marker payload.");
  await validatePostgresRuntime(path.join(portableDir, "runtime", "postgresql-17"), "windows");

  return [
    `Installer: ${baseName(installer)}`,
    `Portable ZIP: ${baseName(portableZip)}`,
    `Portable dir: ${baseName(portableDir)}`,
    "Runtime: PostgreSQL 17",
  ];
}

async function validateMacosBundle(bundleRoot) {
  const appDirs = await findPaths(bundleRoot, (fullPath, entry) => entry.isDirectory() && baseName(fullPath).endsWith(".app"));
  const dmgs = await findPaths(bundleRoot, (fullPath, entry) => entry.isFile() && matchesExtension(fullPath, ".dmg"));

  assert(appDirs.length > 0, "macOS smoke test failed: no .app bundle was found.");
  assert(dmgs.length > 0, "macOS smoke test failed: no .dmg artifact was found.");

  const appDir = appDirs[0];
  const infoPlist = path.join(appDir, "Contents", "Info.plist");
  const macOsDir = path.join(appDir, "Contents", "MacOS");
  const macOsEntries = await fs.readdir(macOsDir, { withFileTypes: true });

  assert(await pathExists(infoPlist), "macOS smoke test failed: Info.plist is missing from the app bundle.");
  assert(macOsEntries.some((entry) => entry.isFile() && entry.name.toLowerCase().includes("kanqual")), "macOS smoke test failed: app executable is missing from Contents/MacOS.");
  await validatePostgresRuntime(path.join(appDir, "Contents", "Resources", "runtime", "postgresql-17"), "macos");

  return [
    `App bundle: ${baseName(appDir)}`,
    `DMG: ${baseName(dmgs[0])}`,
    "Runtime: PostgreSQL 17",
  ];
}

async function validateLinuxBundle(bundleRoot) {
  const appImages = await findPaths(bundleRoot, (fullPath, entry) => entry.isFile() && matchesExtension(fullPath, ".appimage"));
  const debs = await findPaths(bundleRoot, (fullPath, entry) => entry.isFile() && matchesExtension(fullPath, ".deb"));

  assert(appImages.length > 0, "Linux smoke test failed: no AppImage artifact was found.");
  assert(debs.length > 0, "Linux smoke test failed: no .deb artifact was found.");

  const debStats = await Promise.all(debs.map((filePath) => statSafe(filePath)));
  assert(debStats.every((stat) => stat && stat.size > 0), "Linux smoke test failed: one or more .deb artifacts are empty.");

  const appImageStats = await Promise.all(appImages.map((filePath) => statSafe(filePath)));
  assert(appImageStats.every((stat) => stat && stat.size > 0), "Linux smoke test failed: one or more AppImage artifacts are empty.");

  return [
    `AppImage: ${baseName(appImages[0])}`,
    `DEB: ${baseName(debs[0])}`,
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.platform) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  assert(await pathExists(args.bundleRoot), `Bundle root does not exist: ${args.bundleRoot}`);

  let details = [];
  if (args.platform === "windows") {
    details = await validateWindowsBundle(args.bundleRoot);
  } else if (args.platform === "macos") {
    details = await validateMacosBundle(args.bundleRoot);
  } else if (args.platform === "linux") {
    details = await validateLinuxBundle(args.bundleRoot);
  } else {
    throw new Error(`Unsupported platform: ${args.platform}`);
  }

  console.log(`Packaged smoke test passed for ${args.platform}.`);
  for (const line of details) {
    console.log(`- ${line}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
