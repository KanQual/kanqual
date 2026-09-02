import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const packageLockPath = path.join(rootDir, "package-lock.json");
const cargoManifestPath = path.join(rootDir, "src-tauri", "Cargo.toml");
const outputPath = path.join(rootDir, "THIRD_PARTY_NOTICES.md");

const args = new Set(process.argv.slice(2));
const includeDevJs = args.has("--include-dev-js");
const includeBuildRust = args.has("--include-build-rust");

function normalizeLicense(value) {
  if (!value) return "UNKNOWN";
  if (typeof value === "string") return value.trim() || "UNKNOWN";
  return JSON.stringify(value);
}

function compareRows(a, b) {
  return (
    a.name.localeCompare(b.name) ||
    a.version.localeCompare(b.version) ||
    a.license.localeCompare(b.license)
  );
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

function toMarkdownTable(headers, rows) {
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map((row) => `| ${row.map((cell) => escapeCell(cell)).join(" | ")} |`);
  return [headerLine, separatorLine, ...bodyLines].join("\n");
}

function resolveNpmDependencyPath(packages, fromPath, dependencyName) {
  let scopePath = fromPath;

  while (true) {
    const candidate = scopePath
      ? `${scopePath}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;

    if (packages[candidate]) {
      return candidate;
    }

    if (!scopePath) {
      return null;
    }

    const previousNodeModulesIndex = scopePath.lastIndexOf("/node_modules/");
    if (previousNodeModulesIndex === -1) {
      scopePath = "";
    } else {
      scopePath = scopePath.slice(0, previousNodeModulesIndex);
    }
  }
}

async function collectJavascriptRows() {
  const packageLock = JSON.parse(await readFile(packageLockPath, "utf8"));
  const packages = packageLock.packages ?? {};
  const rootPackage = packages[""];

  if (!rootPackage) {
    throw new Error("package-lock.json does not contain a root package entry.");
  }

  const pending = [];
  const visitedPaths = new Set();
  const rowMap = new Map();

  for (const dependencyName of Object.keys(rootPackage.dependencies ?? {})) {
    const dependencyPath = resolveNpmDependencyPath(packages, "", dependencyName);
    if (dependencyPath) pending.push(dependencyPath);
  }

  if (includeDevJs) {
    for (const dependencyName of Object.keys(rootPackage.devDependencies ?? {})) {
      const dependencyPath = resolveNpmDependencyPath(packages, "", dependencyName);
      if (dependencyPath) pending.push(dependencyPath);
    }
  }

  while (pending.length > 0) {
    const packagePath = pending.pop();
    if (!packagePath || visitedPaths.has(packagePath)) continue;
    visitedPaths.add(packagePath);

    const packageInfo = packages[packagePath];
    if (!packageInfo?.version) continue;

    const packageName = packagePath.split("node_modules/").pop();
    const row = {
      name: packageName,
      version: String(packageInfo.version),
      license: normalizeLicense(packageInfo.license),
    };

    rowMap.set(`${row.name}@@${row.version}@@${row.license}`, row);

    const childNames = new Set([
      ...Object.keys(packageInfo.dependencies ?? {}),
      ...Object.keys(packageInfo.optionalDependencies ?? {}),
    ]);

    for (const childName of childNames) {
      const childPath = resolveNpmDependencyPath(packages, packagePath, childName);
      if (childPath && !visitedPaths.has(childPath)) {
        pending.push(childPath);
      }
    }
  }

  return [...rowMap.values()].sort(compareRows);
}

function shouldFollowRustEdge(depKinds) {
  if (!Array.isArray(depKinds) || depKinds.length === 0) {
    return true;
  }

  return depKinds.some((depKind) => {
    if (!depKind || depKind.kind == null) return true;
    return includeBuildRust && depKind.kind === "build";
  });
}

function collectRustRows() {
  const metadataRaw = execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--manifest-path", cargoManifestPath],
    {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  const metadata = JSON.parse(metadataRaw);
  const packageById = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodeById = new Map((metadata.resolve?.nodes ?? []).map((node) => [node.id, node]));
  const workspaceMembers = new Set(metadata.workspace_members ?? []);
  const pending = [...workspaceMembers];
  const visited = new Set();
  const rowMap = new Map();

  while (pending.length > 0) {
    const packageId = pending.pop();
    if (!packageId || visited.has(packageId)) continue;
    visited.add(packageId);

    const node = nodeById.get(packageId);
    if (!node) continue;

    for (const dependency of node.deps ?? []) {
      if (!shouldFollowRustEdge(dependency.dep_kinds)) {
        continue;
      }

      const childId = dependency.pkg;
      if (!childId || visited.has(childId)) continue;
      pending.push(childId);
    }

    if (workspaceMembers.has(packageId)) {
      continue;
    }

    const pkg = packageById.get(packageId);
    if (!pkg) continue;
    if (pkg.source == null && !String(pkg.manifest_path).includes(".cargo\\registry")) {
      continue;
    }

    const row = {
      name: pkg.name,
      version: String(pkg.version),
      license: normalizeLicense(pkg.license),
      licenseFile: pkg.license_file ? path.basename(pkg.license_file) : "",
    };

    rowMap.set(
      `${row.name}@@${row.version}@@${row.license}@@${row.licenseFile}`,
      row,
    );
  }

  return [...rowMap.values()].sort(compareRows);
}

function buildMarkdown(jsRows, rustRows) {
  const generatedAt = new Date().toISOString();

  return `# Third-Party Notices

This file inventories the third-party software dependencies and bundled third-party components currently used by KanQual.

KanQual itself is licensed under \`Apache-2.0\`. See [LICENSE](./LICENSE) and [LICENSES.md](./LICENSES.md).

This inventory is generated from:

- \`package-lock.json\` for resolved JavaScript / TypeScript dependencies
- \`cargo metadata --locked\` for resolved Rust crates

Generation details:

- Generated at: \`${generatedAt}\`
- JavaScript scope: \`${includeDevJs ? "runtime + dev dependencies" : "runtime dependencies only"}\`
- Rust scope: \`${includeBuildRust ? "runtime + build dependency graph" : "runtime dependency graph only"}\`

## Bundled Third-Party Components

PostgreSQL is redistributed as a bundled runtime. KanQual fetches the platform-specific PostgreSQL runtime archives from the \`theseus-rs/postgresql-binaries\` release artifacts during packaging.

The corresponding license text files included with KanQual releases are kept in the [licenses](./licenses/) folder.

${toMarkdownTable(
    ["Component", "Where Bundled", "Upstream", "License"],
    [
      [
        "`PostgreSQL runtime binaries`",
        "`src-tauri/resources/runtime/postgresql-17/`",
        "`https://github.com/theseus-rs/postgresql-binaries`",
        "`PostgreSQL License`",
      ],
    ],
  )}

## Resolved JavaScript / TypeScript Dependency Inventory

${toMarkdownTable(
    ["Package", "Version", "License"],
    jsRows.map((row) => [`\`${row.name}\``, `\`${row.version}\``, `\`${row.license}\``]),
  )}

## Resolved Rust Crate Inventory

${toMarkdownTable(
    ["Crate", "Version", "License", "License File"],
    rustRows.map((row) => [
      `\`${row.name}\``,
      `\`${row.version}\``,
      `\`${row.license}\``,
      `\`${row.licenseFile}\``,
    ]),
  )}

## Included License Texts

- Full license text files for the primary license families and bundled assets are included in [licenses](./licenses/).
- PostgreSQL runtime redistribution notice and license text are included in [licenses/POSTGRESQL.txt](./licenses/POSTGRESQL.txt).
`;
}

async function main() {
  const [jsRows, rustRows] = await Promise.all([collectJavascriptRows(), collectRustRows()]);
  const markdown = buildMarkdown(jsRows, rustRows);
  await writeFile(outputPath, markdown, "utf8");

  console.log(
    `Generated THIRD_PARTY_NOTICES.md with ${jsRows.length} JavaScript rows and ${rustRows.length} Rust rows.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
