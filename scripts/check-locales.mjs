import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import IntlMessageFormat from "intl-messageformat";

const rootDir = process.cwd();
const localesDir = path.join(rootDir, "src", "i18n", "locales");
const tempDir = path.join(rootDir, ".tmp", "i18n-check");

const localeFiles = [
  { code: "en", file: path.join(localesDir, "en.ts"), exportName: "en" },
  { code: "asterisk", formatterLocale: "en", file: path.join(localesDir, "asterisk.ts"), exportName: "asterisk" },
];

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compareLocaleShape(baseValue, localeValue, pathSegments, problems) {
  const pathLabel = pathSegments.join(".");

  if (typeof baseValue === "string") {
    if (typeof localeValue !== "string") {
      problems.push(`Expected string at "${pathLabel}" but found ${describeType(localeValue)}.`);
      return;
    }
    return;
  }

  if (!isPlainObject(baseValue)) {
    problems.push(`Unsupported base schema node at "${pathLabel}".`);
    return;
  }

  if (!isPlainObject(localeValue)) {
    problems.push(`Expected object at "${pathLabel}" but found ${describeType(localeValue)}.`);
    return;
  }

  for (const key of Object.keys(baseValue)) {
    if (!(key in localeValue)) {
      problems.push(`Missing key "${[...pathSegments, key].join(".")}".`);
      continue;
    }
    compareLocaleShape(baseValue[key], localeValue[key], [...pathSegments, key], problems);
  }

  for (const key of Object.keys(localeValue)) {
    if (!(key in baseValue)) {
      problems.push(`Unknown extra key "${[...pathSegments, key].join(".")}".`);
    }
  }
}

function collectMessages(value, pathSegments = [], messages = []) {
  if (typeof value === "string") {
    messages.push({ key: pathSegments.join("."), message: value });
    return messages;
  }
  if (!isPlainObject(value)) return messages;
  for (const [key, child] of Object.entries(value)) {
    collectMessages(child, [...pathSegments, key], messages);
  }
  return messages;
}

function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

async function main() {
  const loaded = await Promise.all(localeFiles.map(async (entry) => {
    const mod = await loadTsModule(entry.file);
    return {
      code: entry.code,
      dictionary: mod[entry.exportName],
    };
  }));

  const english = loaded.find((entry) => entry.code === "en")?.dictionary;
  if (!english) {
    throw new Error("English locale could not be loaded.");
  }

  const problems = [];

  for (const locale of loaded) {
    const messages = collectMessages(locale.dictionary);
    for (const { key, message } of messages) {
      try {
        new IntlMessageFormat(message, locale.formatterLocale ?? locale.code);
      } catch (error) {
        problems.push(`Invalid ICU message for ${locale.code}.${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (locale.code === "en") continue;
    compareLocaleShape(english, locale.dictionary, [], problems);
  }

  if (problems.length > 0) {
    console.error("Locale validation failed:");
    for (const problem of problems) {
      console.error(`- ${problem}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Locale validation passed for ${loaded.map((entry) => entry.code).join(", ")}.`);
}

await main();
