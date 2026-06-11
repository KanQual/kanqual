export type PermissionMatrixRow = {
  category: string;
  permission: string;
  description: string;
  administrator: boolean;
  owner: boolean;
  editor: boolean;
  coder: boolean;
  viewer: boolean;
  notes: string;
};

type PermissionMatrixDefinitionRow = {
  category: string;
  key: string;
  administrator: boolean;
  owner: boolean;
  editor: boolean;
  coder: boolean;
  viewer: boolean;
};

const permissionMatrixDefinitions: PermissionMatrixDefinitionRow[] = [
  { category: "projectAccess", key: "viewProject", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "projectAccess", key: "viewProjectDashboardHome", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "projectAccess", key: "viewProjectMetadata", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "projectAccess", key: "editProjectMetadata", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "projectAccess", key: "deleteProject", administrator: true, owner: true, editor: false, coder: false, viewer: false },
  { category: "projectAccess", key: "exportOrBackupProject", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "projectAccess", key: "restoreOrImportProjectBackup", administrator: true, owner: true, editor: false, coder: false, viewer: false },
  { category: "projectMembership", key: "viewProjectUsers", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "projectMembership", key: "inviteOrAddUsers", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "projectMembership", key: "removeUsers", administrator: true, owner: true, editor: false, coder: false, viewer: false },
  { category: "projectMembership", key: "changeUserRoles", administrator: true, owner: true, editor: false, coder: false, viewer: false },
  { category: "projectMembership", key: "transferOwnership", administrator: true, owner: true, editor: false, coder: false, viewer: false },
  { category: "documents", key: "viewDocumentsList", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "documents", key: "openDocumentDetails", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "documents", key: "createDocumentManually", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "uploadSingleDocument", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "batchUploadDocuments", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "spreadsheetImportDocuments", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "editDocumentMetadata", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "editDocumentContent", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "deleteDocument", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "manageUploadedSourceFiles", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "associateDocumentsWithCases", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "viewDocumentAttributes", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "documents", key: "editDocumentAttributes", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "createDocumentAttributes", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "documents", key: "deleteDocumentAttributes", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "cases", key: "viewCasesList", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "cases", key: "openCaseDetails", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "cases", key: "createCase", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "cases", key: "editCase", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "cases", key: "deleteCase", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "cases", key: "linkDocumentsToCase", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "cases", key: "unlinkDocumentsFromCase", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "cases", key: "viewCaseAttributes", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "cases", key: "editCaseAttributes", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "cases", key: "createCaseAttributes", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "cases", key: "deleteCaseAttributes", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "codebookAndCodes", key: "viewCodebook", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "codebookAndCodes", key: "createCode", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "codebookAndCodes", key: "editCode", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "codebookAndCodes", key: "deleteCode", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "codebookAndCodes", key: "viewCodeDetails", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "codebookAndCodes", key: "manageCodeAttributes", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "annotationsAndCoding", key: "viewAnnotations", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "annotationsAndCoding", key: "createAnnotations", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "annotationsAndCoding", key: "editAnnotationNotes", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "annotationsAndCoding", key: "deleteAnnotations", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "annotationsAndCoding", key: "viewUncodedText", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "annotationsAndCoding", key: "filterOrSearchAnnotations", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "memos", key: "viewMemos", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "memos", key: "createMemo", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "memos", key: "editMemo", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "memos", key: "deleteMemo", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "memos", key: "associateMemoWithObjects", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "reports", key: "viewReportsPages", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "reports", key: "createReports", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "reports", key: "editReportConfiguration", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "reports", key: "deleteReports", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "reports", key: "exportReports", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "aiAssistGeneral", key: "viewAiAssistHome", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "aiAssistGeneral", key: "viewAiAssistTools", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "aiAssistGeneral", key: "enableAiAssistForProject", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "aiAssistGeneral", key: "buildEmbeddings", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "aiAssistGeneral", key: "deleteEmbeddings", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "aiAssistGeneral", key: "useAiChat", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "aiAssistGeneral", key: "useAiCodingTools", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "aiAssistGeneral", key: "useAiAttributeTools", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "aiAssistGeneral", key: "useAiAnalyzeTools", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "aiAssistGeneral", key: "useAiProcessDocuments", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "aiAssistOutputs", key: "saveAiGeneratedOutputs", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "aiAssistOutputs", key: "editAiGeneratedOutputs", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "aiAssistOutputs", key: "exportAiGeneratedOutputsToProject", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "aiAssistOutputs", key: "deleteAiGeneratedOutputs", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "aiAssistOutputs", key: "reviewProcessedDocuments", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "aiAssistOutputs", key: "approveProcessedDocuments", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "applicationAndDeviceAdministration", key: "openAppSettings", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "applicationAndDeviceAdministration", key: "changeStartupOrSessionSettings", administrator: true, owner: false, editor: false, coder: false, viewer: false },
  { category: "applicationAndDeviceAdministration", key: "manageLlmConnectionSettings", administrator: true, owner: false, editor: false, coder: false, viewer: false },
  { category: "applicationAndDeviceAdministration", key: "downloadEmbeddingModel", administrator: true, owner: false, editor: false, coder: false, viewer: false },
  { category: "applicationAndDeviceAdministration", key: "deleteEmbeddingModel", administrator: true, owner: false, editor: false, coder: false, viewer: false },
  { category: "applicationAndDeviceAdministration", key: "viewLocalUsers", administrator: true, owner: false, editor: false, coder: false, viewer: false },
  { category: "applicationAndDeviceAdministration", key: "deleteLocalUsers", administrator: true, owner: false, editor: false, coder: false, viewer: false },
  { category: "applicationAndDeviceAdministration", key: "clearLocalAppData", administrator: true, owner: false, editor: false, coder: false, viewer: false },
  { category: "applicationAndDeviceAdministration", key: "viewLicensingAndAboutInfo", administrator: true, owner: true, editor: true, coder: true, viewer: true },
  { category: "systemAndSafety", key: "bypassReadOnlyProtections", administrator: true, owner: true, editor: false, coder: false, viewer: false },
  { category: "systemAndSafety", key: "performPermanentDeleteActions", administrator: true, owner: true, editor: true, coder: false, viewer: false },
  { category: "systemAndSafety", key: "exportSensitiveContent", administrator: true, owner: true, editor: true, coder: true, viewer: false },
  { category: "systemAndSafety", key: "manageBackupsAndRestores", administrator: true, owner: true, editor: false, coder: false, viewer: false },
];

type Translator = (key: any) => string;

export function buildPermissionMatrixRows(t: Translator): PermissionMatrixRow[] {
  return permissionMatrixDefinitions.map((row) => ({
    category: t(`appSettings.permissions.matrix.categories.${row.category}`),
    permission: t(`appSettings.permissions.matrix.rows.${row.key}.permission`),
    description: t(`appSettings.permissions.matrix.rows.${row.key}.description`),
    administrator: row.administrator,
    owner: row.owner,
    editor: row.editor,
    coder: row.coder,
    viewer: row.viewer,
    notes: "",
  }));
}
