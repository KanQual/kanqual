import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const summaryOnly = process.argv.includes("--summary");
const includeRoots = ["src/App.tsx", "src/components", "src/views"];
const exclude = new Set([path.normalize("src/i18n/locales/en.ts")]);

function walk(entry, files = []) {
  const full = path.join(root, entry);
  if (!fs.existsSync(full)) return files;
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(full)) walk(path.join(entry, child), files);
    return files;
  }
  if ((entry.endsWith(".tsx") || entry.endsWith(".ts")) && !exclude.has(path.normalize(entry))) files.push(entry);
  return files;
}

function hasLetters(text) {
  return /[A-Za-z]/.test(text);
}

function clean(text) {
  return text.replace(/\s+/g, " ").trim();
}

function shouldIgnoreString(text) {
  const value = clean(text);
  if (!value || !hasLetters(value)) return true;
  if (value.length < 2) return true;
  if (/^[a-z0-9_-]+$/.test(value)) return true;
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return true;
  if (/^(GET|POST|PUT|PATCH|DELETE|ASC|DESC|UTC|ID)$/.test(value)) return true;
  if (/^[./\\~@?=&:%#\w-]+\.(tsx?|jsx?|css|svg|png|jpe?g|woff2?|mjs|json|db|sql)$/i.test(value)) return true;
  if (/^(div|span|button|input|label|option|select|textarea|svg|path|g|line|rect|circle|text)$/i.test(value)) return true;
  if (/^(button|submit|reset|checkbox|radio|text|password|number|file|range|color|search|email)$/i.test(value)) return true;
  if (/^(true|false|null|undefined)$/i.test(value)) return true;
  if (/^(className|aria-|data-|role)/.test(value)) return true;
  if (/^(postgres-|project-|users-|case-|auth-|btn|form-|modal|settings-|timeline-|graph-|source-|object-|relationship-|code-|ai-|report-|backup-|loading-|empty-|help-)/.test(value)) return true;
  if (/^[a-z]+\/[a-z0-9.+-]+$/i.test(value)) return true;
  return false;
}

const files = includeRoots.flatMap((entry) => walk(entry));
const findings = [];

for (const relative of files) {
  const sourceText = fs.readFileSync(path.join(root, relative), "utf8");
  const sf = ts.createSourceFile(relative, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function lineOf(node) {
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      const value = clean(node.getText(sf));
      if (!shouldIgnoreString(value)) findings.push({ file: relative, line: lineOf(node), kind: "jsx-text", value });
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const attr = node.name.getText(sf);
      const value = clean(node.initializer.text);
      if (["aria-label", "title", "placeholder", "alt", "label"].includes(attr) && !shouldIgnoreString(value)) {
        findings.push({ file: relative, line: lineOf(node), kind: `attr:${attr}`, value });
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const value = clean(node.text);
      const inJsxAttr = ts.isJsxAttribute(parent);
      const likelyMessage =
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        /^(alert|confirm)$/.test(parent.expression.text);
      const errorSetter =
        ts.isCallExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        /^set[A-Z].*Error$/.test(parent.expression.text);
      const thrown =
        ts.isNewExpression(parent) &&
        parent.expression.getText(sf) === "Error";
      if (!inJsxAttr && (likelyMessage || errorSetter || thrown) && !shouldIgnoreString(value)) {
        findings.push({ file: relative, line: lineOf(node), kind: likelyMessage ? "dialog" : errorSetter ? "error-state" : "throw", value });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
if (!summaryOnly) {
  for (const item of findings) {
    console.log(`${item.file}:${item.line}: ${item.kind}: ${item.value}`);
  }
}
console.error(`\nTotal likely user-facing literals: ${findings.length}`);
