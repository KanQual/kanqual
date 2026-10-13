import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Compile the real exported functions, rather than parsing TypeScript with regex.
const root = fileURLToPath(new URL('../', import.meta.url));
const compiled = await build({
  stdin: {
    contents: 'export * from "./src/lib/permissions"; export * from "./src/lib/permissionMatrix";',
    resolveDir: root, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].contents).toString('base64'));

// Independent policy expectations. These are deliberately not derived from the
// implementation or UI matrix. Policy changes must update this reviewed fixture.
const policyGroups = [
  { roles: ['owner', 'editor', 'coder', 'viewer'], permissions: [
    'viewProject', 'viewProjectDashboard', 'viewProjectMetadata', 'viewProjectUsers',
    'viewDocuments', 'openDocumentDetails', 'viewDocumentAttributes',
    'viewCases', 'openCaseDetails', 'viewCaseAttributes',
    'viewCodebook', 'viewCodeDetails', 'viewAnnotations', 'viewUncodedText',
    'filterAnnotations', 'viewMemos', 'viewReports', 'viewAiAssistHome',
    'viewAiAssistTools', 'useAiChat', 'openAppSettings', 'viewLicensingInfo',
  ] },
  { roles: ['owner', 'editor', 'coder'], permissions: [
    'createCode', 'createAnnotations', 'editAnnotationNotes', 'deleteAnnotations', 'recodeAnnotations',
    'createMemo', 'editMemo', 'associateMemoObjects', 'createReports',
    'editReportConfiguration', 'exportReports', 'useAiCodingTools',
    'useAiAttributeTools', 'useAiAnalyzeTools', 'saveAiOutputs', 'editAiOutputs',
    'reviewProcessedDocuments', 'exportSensitiveContent',
  ] },
  { roles: ['owner', 'editor'], permissions: [
    'editProjectMetadata', 'exportProject', 'inviteProjectUsers', 'createDocument',
    'uploadDocument', 'batchUploadDocuments', 'importSpreadsheetDocuments',
    'editDocumentMetadata', 'editDocumentContent', 'deleteDocument',
    'manageProjectUploadedFiles', 'associateDocumentsWithCases', 'editDocumentAttributes',
    'createDocumentAttributes', 'deleteDocumentAttributes', 'createCase', 'editCase',
    'deleteCase', 'linkCaseDocuments', 'unlinkCaseDocuments', 'editCaseAttributes',
    'createCaseAttributes', 'deleteCaseAttributes', 'editCode', 'deleteCode',
    'reorganizeCodes', 'manageCodeAttributes', 'bulkCodeAnnotations', 'deleteMemo',
    'deleteReports', 'enableProjectAiAssist', 'buildEmbeddings', 'deleteEmbeddings',
    'useAiProcessDocuments', 'exportAiOutputsToProject', 'deleteAiOutputs',
    'approveProcessedDocuments', 'performPermanentDeleteActions',
  ] },
  { roles: ['owner'], permissions: [
    'deleteProject', 'restoreProjectBackup', 'removeProjectUsers', 'changeProjectRoles',
    'transferProjectOwnership', 'bypassReadOnlyProtections', 'manageBackupsAndRestores',
  ] },
  { roles: [], permissions: [
    'changeStartupSettings', 'manageLlmSettings', 'downloadEmbeddingModel',
    'deleteEmbeddingModel', 'viewLocalUsers', 'deleteLocalUsers', 'clearLocalAppData',
  ] },
];
const projectRoles = ['owner', 'editor', 'coder', 'viewer'];
const appRoles = ['administrator', 'standard'];
const standardPermissions = ['openAppSettings', 'viewLicensingInfo'];
const expected = new Map();
for (const group of policyGroups) for (const permission of group.permissions) {
  assert.ok(!expected.has(permission), 'Duplicate policy expectation: ' + permission);
  expected.set(permission, group.roles);
}
const keys = [...expected.keys()];
const sorted = values => [...values].sort();
assert.deepEqual(api.VALID_PROJECT_ROLES, projectRoles);
assert.deepEqual(api.VALID_APP_ROLES, appRoles);
assert.deepEqual(sorted(api.listAllPermissions()), sorted(keys), 'Every permission must have exactly one policy expectation');
assert.deepEqual(sorted(api.PERMISSIONS), sorted(keys));

let checks = 0;
function equal(actual, wanted, context) {
  assert.equal(actual, wanted, context);
  checks++;
}
for (const role of projectRoles) {
  const wanted = keys.filter(permission => expected.get(permission).includes(role));
  assert.deepEqual(sorted(api.getProjectRolePermissions(role)), sorted(wanted), role + ': exact grant list');
  equal(api.normalizeProjectRole('  ' + role.toUpperCase() + '  '), role, 'Project role normalization');
  for (const permission of keys) {
    equal(api.hasProjectPermission(role, permission), wanted.includes(permission), `${role}/${permission}`);
  }
}
for (const role of appRoles) {
  const wanted = role === 'administrator' ? keys : standardPermissions;
  assert.deepEqual(sorted(api.getAppRolePermissions(role)), sorted(wanted), role + ': exact grant list');
  equal(api.normalizeAppRole('  ' + role.toUpperCase() + '  '), role, 'App role normalization');
  for (const permission of keys) equal(api.hasAppPermission(role, permission), wanted.includes(permission), `${role}/${permission}`);
}
const invalidRoles = [undefined, null, '', 'unknown', 'admin', '__proto__', 'constructor', 42, {}];
for (const role of invalidRoles) {
  equal(api.normalizeProjectRole(role), null, 'Invalid project role');
  equal(api.normalizeAppRole(role), 'standard', 'Invalid app role falls back to ordinary account');
  assert.deepEqual(api.getProjectRolePermissions(role), []);
  assert.deepEqual(sorted(api.getAppRolePermissions(role)), sorted(standardPermissions));
  for (const permission of keys) {
    equal(api.hasProjectPermission(role, permission), false, 'Invalid role must not grant project access');
    equal(api.hasAppPermission(role, permission), standardPermissions.includes(permission), 'Invalid app role must not gain administrator access');
  }
}
// Test composition across all role combinations, including missing membership.
for (const appRole of [...appRoles, undefined, 'unknown']) {
  for (const projectRole of [...projectRoles, undefined, 'unknown']) {
    for (const permission of keys) {
      const wanted = appRole === 'administrator' || standardPermissions.includes(permission)
        || expected.get(permission).includes(projectRole);
      equal(api.hasPermission({ appRole, projectRole, permission }), wanted,
        `${String(appRole)}/${String(projectRole)}/${permission}`);
    }
  }
}
for (const permission of ['unknownPermission', '', '__proto__', undefined]) {
  for (const role of projectRoles) equal(api.hasProjectPermission(role, permission), false, 'Unknown permission');
  for (const appRole of appRoles) equal(api.hasPermission({ appRole, projectRole: 'owner', permission }), false, 'Unknown permission');
}

// Explicit display-key to policy-key mapping. Object/relationship rows use the
// legacy case permission vocabulary in this model; this does not test their
// inline screen checks or Rust command authorization.
const matrixMapping = {
  viewProject: 'viewProject', viewProjectDashboardHome: 'viewProjectDashboard',
  viewProjectMetadata: 'viewProjectMetadata', editProjectMetadata: 'editProjectMetadata',
  deleteProject: 'deleteProject', exportOrBackupProject: 'exportProject',
  restoreOrImportProjectBackup: 'restoreProjectBackup', viewProjectUsers: 'viewProjectUsers',
  inviteOrAddUsers: 'inviteProjectUsers', removeUsers: 'removeProjectUsers',
  changeUserRoles: 'changeProjectRoles', transferOwnership: 'transferProjectOwnership',
  viewSourcesList: 'viewDocuments', openSourceDetails: 'openDocumentDetails',
  createSourceManually: 'createDocument', uploadSingleSource: 'uploadDocument',
  batchUploadSources: 'batchUploadDocuments', spreadsheetImportSources: 'importSpreadsheetDocuments',
  editSourceMetadata: 'editDocumentMetadata', editSourceContent: 'editDocumentContent',
  deleteSource: 'deleteDocument', manageUploadedSourceFiles: 'manageProjectUploadedFiles',
  viewSourceAttributes: 'viewDocumentAttributes', editSourceAttributes: 'editDocumentAttributes',
  createSourceAttributes: 'createDocumentAttributes', deleteSourceAttributes: 'deleteDocumentAttributes',
  viewObjectsList: 'viewCases', openObjectDetails: 'openCaseDetails', createObject: 'createCase',
  editObject: 'editCase', deleteObject: 'deleteCase', manageObjectTypes: 'editCase',
  viewObjectAttributes: 'viewCaseAttributes', editObjectAttributes: 'editCaseAttributes',
  createObjectAttributes: 'createCaseAttributes', deleteObjectAttributes: 'deleteCaseAttributes',
  viewRelationshipsList: 'viewCases', openRelationshipDetails: 'openCaseDetails',
  createRelationship: 'createCase', editRelationship: 'editCase', deleteRelationship: 'deleteCase',
  manageRelationshipTypes: 'editCase', viewRelationshipAttributes: 'viewCaseAttributes',
  editRelationshipAttributes: 'editCaseAttributes', createRelationshipAttributes: 'createCaseAttributes',
  deleteRelationshipAttributes: 'deleteCaseAttributes', viewCodebook: 'viewCodebook',
  createCode: 'createCode', editCode: 'editCode', deleteCode: 'deleteCode',
  viewCodeDetails: 'viewCodeDetails', manageCodeAttributes: 'manageCodeAttributes',
  viewAnnotations: 'viewAnnotations', createAnnotations: 'createAnnotations',
  editAnnotationNotes: 'editAnnotationNotes', deleteAnnotations: 'deleteAnnotations',
  viewUncodedText: 'viewUncodedText', filterOrSearchAnnotations: 'filterAnnotations',
  viewMemos: 'viewMemos', createMemo: 'createMemo', editMemo: 'editMemo', deleteMemo: 'deleteMemo',
  associateMemoWithObjects: 'associateMemoObjects', viewReportsPages: 'viewReports',
  createReports: 'createReports', editReportConfiguration: 'editReportConfiguration',
  deleteReports: 'deleteReports', exportReports: 'exportReports', viewAiAssistHome: 'viewAiAssistHome',
  viewAiAssistTools: 'viewAiAssistTools', enableAiAssistForProject: 'enableProjectAiAssist',
  buildEmbeddings: 'buildEmbeddings', deleteEmbeddings: 'deleteEmbeddings', useAiChat: 'useAiChat',
  useAiCodingTools: 'useAiCodingTools', useAiAttributeTools: 'useAiAttributeTools',
  useAiAnalyzeTools: 'useAiAnalyzeTools', useAiProcessDocuments: 'useAiProcessDocuments',
  saveAiGeneratedOutputs: 'saveAiOutputs', editAiGeneratedOutputs: 'editAiOutputs',
  exportAiGeneratedOutputsToProject: 'exportAiOutputsToProject', deleteAiGeneratedOutputs: 'deleteAiOutputs',
  reviewProcessedDocuments: 'reviewProcessedDocuments', approveProcessedDocuments: 'approveProcessedDocuments',
  openAppSettings: 'openAppSettings', changeStartupOrSessionSettings: 'changeStartupSettings',
  manageLlmConnectionSettings: 'manageLlmSettings', downloadEmbeddingModel: 'downloadEmbeddingModel',
  deleteEmbeddingModel: 'deleteEmbeddingModel', viewLocalUsers: 'viewLocalUsers',
  deleteLocalUsers: 'deleteLocalUsers', clearLocalAppData: 'clearLocalAppData',
  viewLicensingAndAboutInfo: 'viewLicensingInfo', bypassReadOnlyProtections: 'bypassReadOnlyProtections',
  performPermanentDeleteActions: 'performPermanentDeleteActions', exportSensitiveContent: 'exportSensitiveContent',
  manageBackupsAndRestores: 'manageBackupsAndRestores',
};
const rows = api.buildPermissionMatrixRows(key => key);
const seenRows = [];
for (const row of rows) {
  const prefix = 'appSettings.permissions.matrix.rows.';
  assert.ok(row.permission.startsWith(prefix) && row.permission.endsWith('.permission'));
  const key = row.permission.slice(prefix.length, -'.permission'.length);
  seenRows.push(key);
  assert.ok(Object.hasOwn(matrixMapping, key), 'Unmapped matrix row: ' + key);
  const permission = matrixMapping[key];
  assert.ok(expected.has(permission), 'Unknown mapped permission: ' + permission);
  for (const role of ['administrator', ...projectRoles]) {
    equal(row[role], api.hasPermission({
      appRole: role === 'administrator' ? 'administrator' : 'standard',
      projectRole: role === 'administrator' ? undefined : role, permission,
    }), `Displayed matrix disagrees for ${key}/${role}`);
  }
}
assert.deepEqual(sorted(seenRows), sorted(Object.keys(matrixMapping)), 'Missing or duplicate matrix rows');
// These internal actions currently have no dedicated display row. Keep this
// explicit so newly added permissions cannot silently escape display review.
const undisplayed = [
  'associateDocumentsWithCases', 'linkCaseDocuments', 'unlinkCaseDocuments',
  'reorganizeCodes', 'recodeAnnotations', 'bulkCodeAnnotations',
];
assert.deepEqual(sorted(keys.filter(key => !Object.values(matrixMapping).includes(key))), sorted(undisplayed));
console.log(`Role validation passed: ${keys.length} permissions, ${rows.length} matrix rows, ${checks} behavior checks.`);
console.log('Scope: permission helpers and displayed matrix; inline screen checks and native authorization require separate coverage.');
