import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const matrixPath = path.join(repoRoot, "role_permission_matrix_recommended.csv");
const permissionsPath = path.join(repoRoot, "src", "lib", "permissions.ts");
const outputPath = path.join(repoRoot, "role_permission_matrix_validation.csv");

const ROLE_COLUMNS = ["Administrator", "Owner", "Editor", "Coder", "Viewer"];
const PROJECT_ROLE_NAMES = {
  Owner: "owner",
  Editor: "editor",
  Coder: "coder",
  Viewer: "viewer",
};

const PERMISSION_KEY_BY_LABEL = {
  "View project": "viewProject",
  "View project dashboard/home": "viewProjectDashboard",
  "View project metadata": "viewProjectMetadata",
  "Edit project metadata": "editProjectMetadata",
  "Delete project": "deleteProject",
  "Export or backup project": "exportProject",
  "Restore or import project backup": "restoreProjectBackup",
  "View project users": "viewProjectUsers",
  "Invite or add users": "inviteProjectUsers",
  "Remove users": "removeProjectUsers",
  "Change user roles": "changeProjectRoles",
  "Transfer ownership": "transferProjectOwnership",
  "View documents list": "viewDocuments",
  "Open document details": "openDocumentDetails",
  "Create document manually": "createDocument",
  "Upload single document": "uploadDocument",
  "Batch upload documents": "batchUploadDocuments",
  "Spreadsheet import documents": "importSpreadsheetDocuments",
  "Edit document metadata": "editDocumentMetadata",
  "Edit document content": "editDocumentContent",
  "Delete document": "deleteDocument",
  "Manage uploaded source files": "manageProjectUploadedFiles",
  "Associate documents with cases": "associateDocumentsWithCases",
  "View document attributes": "viewDocumentAttributes",
  "Edit document attributes": "editDocumentAttributes",
  "Create document attributes": "createDocumentAttributes",
  "Delete document attributes": "deleteDocumentAttributes",
  "View cases list": "viewCases",
  "Open case details": "openCaseDetails",
  "Create case": "createCase",
  "Edit case": "editCase",
  "Delete case": "deleteCase",
  "Link documents to case": "linkCaseDocuments",
  "Unlink documents from case": "unlinkCaseDocuments",
  "View case attributes": "viewCaseAttributes",
  "Edit case attributes": "editCaseAttributes",
  "Create case attributes": "createCaseAttributes",
  "Delete case attributes": "deleteCaseAttributes",
  "View codebook": "viewCodebook",
  "Create code": "createCode",
  "Edit code": "editCode",
  "Delete code": "deleteCode",
  "View code details": "viewCodeDetails",
  "Manage code attributes": "manageCodeAttributes",
  "View annotations": "viewAnnotations",
  "Create annotations": "createAnnotations",
  "Edit annotation notes": "editAnnotationNotes",
  "Delete annotations": "deleteAnnotations",
  "View uncoded text": "viewUncodedText",
  "Filter or search annotations": "filterAnnotations",
  "View memos": "viewMemos",
  "Create memo": "createMemo",
  "Edit memo": "editMemo",
  "Delete memo": "deleteMemo",
  "Associate memo with objects": "associateMemoObjects",
  "View reports pages": "viewReports",
  "Create reports": "createReports",
  "Edit report configuration": "editReportConfiguration",
  "Delete reports": "deleteReports",
  "Export reports": "exportReports",
  "View AI Assist home": "viewAiAssistHome",
  "View AI Assist tools": "viewAiAssistTools",
  "Enable AI Assist for project": "enableProjectAiAssist",
  "Build embeddings": "buildEmbeddings",
  "Delete embeddings": "deleteEmbeddings",
  "Use AI chat": "useAiChat",
  "Use AI coding tools": "useAiCodingTools",
  "Use AI attribute tools": "useAiAttributeTools",
  "Use AI analyze tools": "useAiAnalyzeTools",
  "Use AI process documents": "useAiProcessDocuments",
  "Save AI generated outputs": "saveAiOutputs",
  "Edit AI generated outputs": "editAiOutputs",
  "Export AI generated outputs to project": "exportAiOutputsToProject",
  "Delete AI generated outputs": "deleteAiOutputs",
  "Review processed documents": "reviewProcessedDocuments",
  "Approve processed documents": "approveProcessedDocuments",
  "Open App Settings": "openAppSettings",
  "Change startup or session settings": "changeStartupSettings",
  "Manage LLM connection settings": "manageLlmSettings",
  "Download embedding model": "downloadEmbeddingModel",
  "Delete embedding model": "deleteEmbeddingModel",
  "View local users": "viewLocalUsers",
  "Delete local users": "deleteLocalUsers",
  "Clear local app data": "clearLocalAppData",
  "View licensing and about info": "viewLicensingInfo",
  "Bypass read only protections": "bypassReadOnlyProtections",
  "Perform permanent delete actions": "performPermanentDeleteActions",
  "Export sensitive content": "exportSensitiveContent",
  "Manage backups and restores": "manageBackupsAndRestores",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }

  const [header, ...dataRows] = rows;
  return dataRows.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])));
}

function extractRolePermissions(source, roleName) {
  const regex = new RegExp(`${roleName}:\\s*\\[([\\s\\S]*?)\\],`, "m");
  const match = source.match(regex);
  if (!match) return new Set();
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]));
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes("\"") || text.includes(",") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

const matrixRows = parseCsv(fs.readFileSync(matrixPath, "utf8"));
const permissionsSource = fs.readFileSync(permissionsPath, "utf8");

const actualPermissionsByRole = {
  Administrator: extractRolePermissions(permissionsSource, "administrator"),
  Owner: extractRolePermissions(permissionsSource, "owner"),
  Editor: extractRolePermissions(permissionsSource, "editor"),
  Coder: extractRolePermissions(permissionsSource, "coder"),
  Viewer: extractRolePermissions(permissionsSource, "viewer"),
};

const reportRows = [];
let mismatchCount = 0;
let unmappedCount = 0;

for (const row of matrixRows) {
  const permissionKey = PERMISSION_KEY_BY_LABEL[row.Permission];
  for (const roleColumn of ROLE_COLUMNS) {
    const expected = row[roleColumn];
    const actual = permissionKey
      ? actualPermissionsByRole[roleColumn].has(permissionKey) ? "Yes" : "No"
      : "Unmapped";
    let status = "Match";
    if (!permissionKey) {
      status = "Unmapped";
      unmappedCount += 1;
    } else if (expected !== actual) {
      status = "Mismatch";
      mismatchCount += 1;
    }

    reportRows.push({
      Category: row.Category,
      Permission: row.Permission,
      InternalKey: permissionKey ?? "",
      Role: roleColumn,
      Expected: expected,
      Actual: actual,
      Status: status,
      Notes: row.Notes ?? "",
    });
  }
}

const header = ["Category", "Permission", "InternalKey", "Role", "Expected", "Actual", "Status", "Notes"];
const csvText = [
  header.join(","),
  ...reportRows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
].join("\n");

fs.writeFileSync(outputPath, `${csvText}\n`, "utf8");

const totalChecks = reportRows.length;
const matchCount = totalChecks - mismatchCount - unmappedCount;
console.log(`Wrote ${path.basename(outputPath)}`);
console.log(`Total checks: ${totalChecks}`);
console.log(`Matches: ${matchCount}`);
console.log(`Mismatches: ${mismatchCount}`);
console.log(`Unmapped: ${unmappedCount}`);
if (mismatchCount > 0 || unmappedCount > 0) {
  process.exitCode = 1;
}
