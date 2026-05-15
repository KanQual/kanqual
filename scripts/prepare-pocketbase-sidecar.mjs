import fs from "node:fs";
import path from "node:path";

function printUsage() {
  console.log(`Usage:
  node scripts/prepare-pocketbase-sidecar.mjs --source <path> --target <triple> [--dest-dir <path>]

Examples:
  node scripts/prepare-pocketbase-sidecar.mjs --source ~/Downloads/pocketbase --target x86_64-unknown-linux-gnu
  node scripts/prepare-pocketbase-sidecar.mjs --source ~/Downloads/pocketbase --target aarch64-apple-darwin
  node scripts/prepare-pocketbase-sidecar.mjs --source C:\\temp\\pocketbase.exe --target x86_64-pc-windows-msvc
`);
}

function parseArgs(argv) {
  const args = { destDir: path.resolve("src-tauri", "binaries", "local") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") {
      args.source = argv[++index];
    } else if (arg === "--target") {
      args.target = argv[++index];
    } else if (arg === "--dest-dir") {
      args.destDir = path.resolve(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function targetFilename(target) {
  return target.includes("windows")
    ? `pocketbase-${target}.exe`
    : `pocketbase-${target}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.source || !args.target) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const sourcePath = path.resolve(args.source);
  const destinationDir = args.destDir;
  const destinationPath = path.join(destinationDir, targetFilename(args.target));

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  fs.mkdirSync(destinationDir, { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);

  if (!args.target.includes("windows")) {
    fs.chmodSync(destinationPath, 0o755);
  }

  console.log(`PocketBase sidecar prepared:
  source:      ${sourcePath}
  target:      ${args.target}
  destination: ${destinationPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
