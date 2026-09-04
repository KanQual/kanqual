import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const rootDir = process.cwd();
const localeFile = path.join(rootDir, "src", "i18n", "locales", "en.ts");
const hierarchyFile = path.join(rootDir, "docs", "app-structure-outline.csv");
const outputFile = path.join(rootDir, "docs", "locale-source-en.csv");

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
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

function collectMessages(value, pathSegments = [], messages = []) {
  if (typeof value === "string") {
    messages.push({ key: pathSegments.join("."), en: value });
    return messages;
  }
  if (!isPlainObject(value)) return messages;
  for (const [key, child] of Object.entries(value)) {
    collectMessages(child, [...pathSegments, key], messages);
  }
  return messages;
}

function extractInterpolationVars(message) {
  const vars = new Set();
  const pattern = /\{([a-zA-Z0-9_]+)(?:,|\})/g;
  let match = pattern.exec(message);
  while (match) {
    vars.add(match[1]);
    match = pattern.exec(message);
  }
  return [...vars];
}

function hasPluralIcu(message) {
  return /,\s*plural\s*,/.test(message);
}

function mapKeyToHierarchy(key) {
  const rules = [
    { prefix: "app.forcePassword.", screenId: "global-entry-flow.forced-password-change-screen", confidence: "exact" },
    { prefix: "app.errorBoundary.", screenId: "global-entry-flow.app-render-error-boundary", confidence: "exact" },
    { prefix: "app.updateBanner.", screenId: "global-app-shell.sidebar-driven-app-shell.update-available-banner", confidence: "exact" },
    { prefix: "app.backupBanner.", screenId: "global-app-shell.sidebar-driven-app-shell.project-backup-banner", confidence: "exact" },
    { prefix: "app.embeddingBuild.", screenId: "global-app-shell.sidebar-driven-app-shell.project-embedding-build-banner", confidence: "exact" },
    { prefix: "app.documentProcessing.", screenId: "global-app-shell.sidebar-driven-app-shell.document-processing-banner", confidence: "exact" },
    { prefix: "app.embeddingDownload.", screenId: "global-app-shell.sidebar-driven-app-shell.embedding-model-download-banner", confidence: "exact" },
    { prefix: "app.viewLoading.", screenId: "global-app-shell.sidebar-driven-app-shell", confidence: "best-effort" },
    { prefix: "auth.", screenId: "global-entry-flow.authentication-flow", confidence: "best-effort" },
    { prefix: "projectsView.help.", screenId: "top-level-screens.project-selection.help-modal", confidence: "exact" },
    { prefix: "projectsView.newProject.", screenId: "top-level-screens.project-selection.new-project-flow-modal", confidence: "exact" },
    { prefix: "projectsView.card.", screenId: "top-level-screens.project-selection.main-workspace", confidence: "best-effort" },
    { prefix: "projectsView.actions.", screenId: "top-level-screens.project-selection.main-workspace", confidence: "best-effort" },
    { prefix: "projectsView.errors.", screenId: "top-level-screens.project-selection", confidence: "best-effort" },
    { prefix: "projectsView.", screenId: "top-level-screens.project-selection", confidence: "best-effort" },
    { prefix: "projectHome.help.", screenId: "top-level-screens.project-home.help-modal", confidence: "exact" },
    { prefix: "projectHome.deleteModal.", screenId: "top-level-screens.project-home.delete-project-confirmation-modal", confidence: "exact" },
    { prefix: "projectHome.editModal.", screenId: "top-level-screens.project-home.edit-project-modal", confidence: "exact" },
    { prefix: "projectHome.", screenId: "top-level-screens.project-home", confidence: "best-effort" },
    { prefix: "projectUsers.help.", screenId: "top-level-screens.project-users.help-modal", confidence: "exact" },
    { prefix: "projectUsers.tabs.", screenId: "top-level-screens.project-users.workspace-tabs", confidence: "exact" },
    { prefix: "projectUsers.addMember.", screenId: "top-level-screens.project-users.add-member-modal", confidence: "best-effort" },
    { prefix: "projectUsers.editMember.", screenId: "top-level-screens.project-users.edit-member-modal", confidence: "best-effort" },
    { prefix: "projectUsers.removeModal.", screenId: "top-level-screens.project-users.remove-member-confirmation-modal", confidence: "best-effort" },
    { prefix: "projectUsers.importedUsers.", screenId: "top-level-screens.project-users.imported-user-resolution-dialogs", confidence: "best-effort" },
    { prefix: "projectUsers.userDetail.", screenId: "top-level-screens.project-users.main-workspace", confidence: "best-effort" },
    { prefix: "projectUsers.", screenId: "top-level-screens.project-users", confidence: "best-effort" },
    { prefix: "projectDocuments.help.", screenId: "top-level-screens.project-documents.help-modal", confidence: "exact" },
    { prefix: "projectDocuments.deleteModal.", screenId: "top-level-screens.project-documents.delete-document-confirmation-modal", confidence: "exact" },
    { prefix: "projectDocuments.lockModal.", screenId: "top-level-screens.project-documents.document-lock-kicked-out-modal", confidence: "exact" },
    { prefix: "projectDocuments.createModal.", screenId: "top-level-screens.project-documents.document-editor-import-modal", confidence: "exact" },
    { prefix: "projectDocuments.editMetadataModal.", screenId: "top-level-screens.project-documents.edit-metadata-modal", confidence: "best-effort" },
    { prefix: "projectDocuments.editContentModal.", screenId: "top-level-screens.project-documents.edit-document-content-modal", confidence: "best-effort" },
    { prefix: "projectDocuments.", screenId: "top-level-screens.project-documents", confidence: "best-effort" },
    { prefix: "projectCodebook.deleteModal.", screenId: "top-level-screens.project-codebook.delete-code-confirmation-modal", confidence: "exact" },
    { prefix: "projectCodebook.modal.", screenId: "top-level-screens.project-codebook.new-code-modal", confidence: "best-effort" },
    { prefix: "projectCodebook.", screenId: "top-level-screens.project-codebook", confidence: "best-effort" },
    { prefix: "projectAnnotations.", screenId: "top-level-screens.project-annotations", confidence: "best-effort" },
    { prefix: "analysisCodeAnnotate.", screenId: "top-level-screens.analysis-code-text", confidence: "best-effort" },
    { prefix: "analysisCode.kickModal.", screenId: "top-level-screens.analysis-code-text.kick-user-from-locked-document-modal", confidence: "exact" },
    { prefix: "analysisCode.", screenId: "top-level-screens.analysis-code-text", confidence: "best-effort" },
    { prefix: "analysisMemos.deleteModal.", screenId: "top-level-screens.analysis-memos.delete-memo-confirmation-modal", confidence: "exact" },
    { prefix: "analysisMemos.editor.", screenId: "top-level-screens.analysis-memos.memo-editor-workspace", confidence: "best-effort" },
    { prefix: "analysisMemos.export.", screenId: "top-level-screens.analysis-memos.export-memos-modal", confidence: "best-effort" },
    { prefix: "analysisMemos.help.", screenId: "top-level-screens.analysis-memos.help-modal", confidence: "exact" },
    { prefix: "analysisMemos.", screenId: "top-level-screens.analysis-memos", confidence: "best-effort" },
    { prefix: "userSettings.help.", screenId: "top-level-screens.user-settings.help-modal", confidence: "exact" },
    { prefix: "userSettings.modal.profile", screenId: "top-level-screens.user-settings.account-section.profile-modal", confidence: "exact" },
    { prefix: "userSettings.modal.password", screenId: "top-level-screens.user-settings.account-section.password-modal", confidence: "exact" },
    { prefix: "userSettings.modal.appearance", screenId: "top-level-screens.user-settings.preferences-section.appearance-modal", confidence: "exact" },
    { prefix: "userSettings.modal.recent", screenId: "top-level-screens.user-settings.preferences-section.recent-projects-modal", confidence: "exact" },
    { prefix: "userSettings.cards.", screenId: "top-level-screens.user-settings.overview-workspace", confidence: "best-effort" },
    { prefix: "userSettings.sections.", screenId: "top-level-screens.user-settings.overview-workspace", confidence: "best-effort" },
    { prefix: "userSettings.", screenId: "top-level-screens.user-settings", confidence: "best-effort" },
    { prefix: "attributeModal.", screenId: "", confidence: "shared" },
    { prefix: "appSettings.permissions.", screenId: "top-level-screens.app-settings.advanced-section.permissions-matrix-modal", confidence: "exact" },
    { prefix: "appSettings.network.enable", screenId: "top-level-screens.app-settings.confirm-enable-network-mode-modal", confidence: "exact" },
    { prefix: "appSettings.network.", screenId: "top-level-screens.app-settings.advanced-section.network-and-collaboration-modal", confidence: "exact" },
    { prefix: "appSettings.storage.", screenId: "top-level-screens.app-settings.privacy-and-data-section.storage-modal", confidence: "exact" },
    { prefix: "appSettings.startup.", screenId: "top-level-screens.app-settings.everyday-settings-section.startup-and-session-modal", confidence: "exact" },
    { prefix: "appSettings.language.", screenId: "top-level-screens.app-settings.everyday-settings-section.language-modal", confidence: "exact" },
    { prefix: "appSettings.documentImport.", screenId: "top-level-screens.app-settings.everyday-settings-section.document-import-modal", confidence: "exact" },
    { prefix: "appSettings.privacy.", screenId: "top-level-screens.app-settings.privacy-and-data-section.privacy-modal", confidence: "exact" },
    { prefix: "appSettings.diagnostics.", screenId: "top-level-screens.app-settings.maintenance-section.diagnostics-modal", confidence: "exact" },
    { prefix: "appSettings.updates.", screenId: "top-level-screens.app-settings.maintenance-section.updates-modal", confidence: "exact" },
    { prefix: "appSettings.overview", screenId: "top-level-screens.app-settings.overview-workspace", confidence: "best-effort" },
    { prefix: "appSettings.sectionTitles.", screenId: "top-level-screens.app-settings.overview-workspace", confidence: "best-effort" },
    { prefix: "appSettings.shell.", screenId: "top-level-screens.app-settings.overview-workspace", confidence: "best-effort" },
    { prefix: "appSettings.about.", screenId: "top-level-screens.app-settings.overview-workspace", confidence: "best-effort" },
    { prefix: "appSettings.", screenId: "top-level-screens.app-settings", confidence: "best-effort" },
    { prefix: "projectLog.", screenId: "top-level-screens.project-log", confidence: "best-effort" },
    { prefix: "reportsAnnotations.", screenId: "top-level-screens.reports-annotations", confidence: "best-effort" },
    { prefix: "reportsCodes.", screenId: "top-level-screens.reports-codes", confidence: "best-effort" },
    { prefix: "reportsUsers.", screenId: "top-level-screens.reports-users", confidence: "best-effort" },
    { prefix: "aiAssist.home.", screenId: "top-level-screens.ai-assist-home", confidence: "best-effort" },
    { prefix: "aiAssist.chat.", screenId: "top-level-screens.ai-assist-chat", confidence: "best-effort" },
    { prefix: "aiAssist.code.", screenId: "top-level-screens.ai-assist-code", confidence: "best-effort" },
    { prefix: "aiAssist.attributes.", screenId: "top-level-screens.ai-assist-attributes", confidence: "best-effort" },
    { prefix: "aiAssist.analyze.", screenId: "top-level-screens.ai-assist-analyze", confidence: "best-effort" },
    { prefix: "aiAssist.processDocuments.review.", screenId: "top-level-screens.ai-assist-process-documents-review", confidence: "best-effort" },
    { prefix: "aiAssist.processDocuments.", screenId: "top-level-screens.ai-assist-process-documents", confidence: "best-effort" },
    { prefix: "aiAssist.annotate.", screenId: "top-level-screens.ai-assist-code", confidence: "best-effort" },
    { prefix: "aiAssist.", screenId: "top-level-screens.ai-assist-home", confidence: "best-effort" },
    { prefix: "sidebar.", screenId: "global-app-shell.sidebar-driven-app-shell", confidence: "best-effort" },
    { prefix: "common.", screenId: "", confidence: "shared" },
  ];

  for (const rule of rules) {
    if (key.startsWith(rule.prefix)) {
      return rule;
    }
  }

  return { screenId: "", confidence: "unmapped" };
}

function namespaceForKey(key) {
  const parts = key.split(".");
  return parts.slice(0, -1).join(".");
}

function leafKey(key) {
  const parts = key.split(".");
  return parts[parts.length - 1];
}

async function main() {
  const mod = await loadTsModule(localeFile);
  const messages = collectMessages(mod.en).sort((left, right) => left.key.localeCompare(right.key));
  const hierarchyRows = parseCsv(await readFile(hierarchyFile, "utf8"));
  const hierarchyById = new Map(hierarchyRows.map((row) => [row.id, row]));

  const header = [
    "key",
    "namespace",
    "leaf_key",
    "en",
    "screen_id",
    "screen_parent_path",
    "section",
    "level1",
    "level2",
    "level3",
    "level4",
    "screen_type",
    "mapping_confidence",
    "interpolation_vars",
    "has_plural_icu",
    "source_file",
    "status",
    "notes",
  ];

  const rows = messages.map(({ key, en }) => {
    const mapping = mapKeyToHierarchy(key);
    const hierarchy = mapping.screenId ? hierarchyById.get(mapping.screenId) : null;
    const interpolationVars = extractInterpolationVars(en);
    const notes =
      mapping.confidence === "shared"
        ? "Shared string or reusable component text; not tied to a single screen."
        : mapping.confidence === "unmapped"
          ? "No hierarchy mapping rule yet."
          : "";

    return [
      key,
      namespaceForKey(key),
      leafKey(key),
      en,
      mapping.screenId,
      hierarchy?.parent_path ?? "",
      hierarchy?.section ?? "",
      hierarchy?.level1 ?? "",
      hierarchy?.level2 ?? "",
      hierarchy?.level3 ?? "",
      hierarchy?.level4 ?? "",
      hierarchy?.type ?? "",
      mapping.confidence,
      interpolationVars.join("|"),
      hasPluralIcu(en) ? "yes" : "no",
      "src/i18n/locales/en.ts",
      "source",
      notes,
    ];
  });

  const csv = [header, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${csv}\n`, "utf8");

  const unmappedCount = rows.filter((row) => row[12] === "unmapped").length;
  console.log(`Wrote ${rows.length} locale rows to ${path.relative(rootDir, outputFile)}.`);
  console.log(`Unmapped rows: ${unmappedCount}.`);
}

await main();
