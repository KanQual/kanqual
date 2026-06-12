import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const rootDir = process.cwd();
const csvFile = path.join(rootDir, "docs", "locale-source-en.csv");
const localeFile = path.join(rootDir, "src", "i18n", "locales", "en.ts");

function parseArgs(argv) {
  const options = {
    check: false,
    write: false,
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--output") {
      options.output = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""])),
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function loadTsModule(filePath) {
  const source = await readFile(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });

  const encoded = encodeURIComponent(transpiled.outputText);
  return import(`data:text/javascript;charset=utf-8,${encoded}`);
}

function ensurePlainObject(node, pathLabel) {
  if (!isPlainObject(node)) {
    throw new Error(`Key path conflict at "${pathLabel}".`);
  }
}

function insertMessage(tree, dottedKey, value) {
  const parts = dottedKey.split(".");
  let current = tree;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isLeaf = index === parts.length - 1;
    const pathLabel = parts.slice(0, index + 1).join(".");

    if (isLeaf) {
      const existing = current[part];
      if (existing != null && typeof existing !== "string") {
        throw new Error(`Key path conflict at "${pathLabel}".`);
      }
      current[part] = value;
      return;
    }

    if (!(part in current)) {
      current[part] = {};
    }

    ensurePlainObject(current[part], pathLabel);
    current = current[part];
  }
}

function sortObjectKeys(value) {
  if (typeof value === "string") return value;
  if (!isPlainObject(value)) return value;

  const sorted = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    sorted[key] = sortObjectKeys(value[key]);
  }
  return sorted;
}

function formatPropertyKey(key) {
  return /^[$A-Z_][0-9A-Z_$]*$/i.test(key) ? key : JSON.stringify(key);
}

function formatValue(value, indentLevel = 0) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";

  const indent = "  ".repeat(indentLevel);
  const childIndent = "  ".repeat(indentLevel + 1);
  const lines = entries.map(([key, child]) =>
    `${childIndent}${formatPropertyKey(key)}: ${formatValue(child, indentLevel + 1)},`,
  );

  return `{\n${lines.join("\n")}\n${indent}}`;
}

function buildLocaleSource(dictionary) {
  return `export const en = ${formatValue(dictionary)} as const;\n`;
}

function deepEqual(left, right) {
  if (typeof left !== typeof right) return false;
  if (typeof left === "string") return left === right;
  if (!isPlainObject(left) || !isPlainObject(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  for (const key of leftKeys) {
    if (!(key in right)) return false;
    if (!deepEqual(left[key], right[key])) return false;
  }

  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const csvRows = parseCsv(await readFile(csvFile, "utf8"));
  const sourceRows = csvRows
    .filter((row) => row.key.trim())
    .sort((left, right) => left.key.localeCompare(right.key));

  const dictionary = {};
  for (const row of sourceRows) {
    insertMessage(dictionary, row.key.trim(), row.en ?? "");
  }

  const sortedDictionary = sortObjectKeys(dictionary);
  const generatedSource = buildLocaleSource(sortedDictionary);

  if (options.check) {
    const current = await loadTsModule(localeFile);
    if (!deepEqual(current.en, sortedDictionary)) {
      throw new Error("CSV does not round-trip to the current en locale object.");
    }
    console.log("Locale CSV matches the current en locale object.");
  }

  if (options.write || options.output) {
    const target = options.output
      ? path.resolve(rootDir, options.output)
      : localeFile;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, generatedSource, "utf8");
    console.log(`Wrote generated locale to ${path.relative(rootDir, target)}.`);
    return;
  }

  console.log(generatedSource);
}

await main();
