import { invoke } from "@tauri-apps/api/core";

export const POSTGRES_PROJECT_CHANGED_EVENT = "postgres-project-changed";

export type PostgresExperimentStatus = {
  host: string;
  port: number;
  psqlPath: string;
  postgresqlConfPath: string;
  psqlExists: boolean;
  postgresqlConfExists: boolean;
  bootstrapIdentityPath: string;
  bootstrapIdentityExists: boolean;
  serviceReachable: boolean;
  superuserName: string;
  appDatabase: string;
  appRoleName: string;
  bootstrapApplied: boolean;
  adminHandoffCompleted: boolean;
};

export async function getPostgresExperimentStatus(): Promise<PostgresExperimentStatus> {
  return invoke<PostgresExperimentStatus>("get_postgres_experiment_status_command");
}

export type BootstrapPostgresExperimentResult = {
  appDatabase: string;
  appRoleName: string;
  bootstrapIdentityPath: string;
  appRoleReady: boolean;
};

export async function bootstrapPostgresExperiment(superuserPassword: string): Promise<BootstrapPostgresExperimentResult> {
  return invoke<BootstrapPostgresExperimentResult>("bootstrap_postgres_experiment_command", {
    request: {
      superuserPassword,
    },
  });
}

export async function completePostgresAdminHandoff(data: {
  newSuperuserName: string;
  newSuperuserPassword: string;
}): Promise<PostgresExperimentStatus> {
  return invoke<PostgresExperimentStatus>("complete_postgres_admin_handoff_command", {
    request: data,
  });
}

export type PostgresSchemaMigrationResult = {
  ready: boolean;
  appliedVersions: number[];
};

export type PostgresExperimentAppUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentAuthSession = {
  authKind: string;
  user: PostgresExperimentAppUser;
  startedAtMs: number;
};

export type PostgresExperimentAuthStatus = {
  bootstrapApplied: boolean;
  adminHandoffCompleted: boolean;
  ready: boolean;
  registeredUserCount: number;
  requiresAccountSetup: boolean;
  localAdminName: string;
  currentSession: PostgresExperimentAuthSession | null;
};

export type PostgresExperimentInstallationSettings = {
  startupReopenLastProject: boolean;
  documentImportDefaultMode: "upload" | "paste";
  documentImportAutoNameFromFile: boolean;
  documentImportTrimImportedText: boolean;
  documentImportWarnBeforeEmptyImport: boolean;
  privacyMaskFilePaths: boolean;
  privacyClearRecentProjectsOnSignOut: boolean;
  privacyForgetLoginIdentitiesOnLogout: boolean;
  updatesAutoCheck: boolean;
  llm: {
    chunkSize: number;
    overlapSize: number;
    batchSize: number;
    prefixPassages: boolean;
    prefixQueries: boolean;
    normalizeWhitespace: boolean;
    connectionMode: "none" | "local" | "cloud";
    cloudProvider: "openai" | "anthropic" | "copilot" | "blablador" | "ollama";
    cloudApiSecret: string;
    cloudSelectedModel: string;
    ollamaEnabled: boolean;
    ollamaProtocol: "http" | "https";
    ollamaHost: string;
    ollamaPort: number;
    ollamaSelectedModel: string;
    ollamaRequestTimeoutSeconds: number;
    ollamaDocumentProcessingTimeoutSeconds: number;
    ollamaTemperature: number;
    ollamaNumCtx: number;
    ollamaKeepAliveMinutes: number;
    ollamaRelevantSegmentsCandidateLimit: number;
    ollamaRelevantSegmentsMaxResults: number;
  };
};

export type PostgresExperimentUserPreferences = {
  theme: "light" | "dark";
  density: "comfortable" | "compact";
  fontSize: "small" | "normal" | "large";
  locale: "en";
  recentProjectLimit: number;
  themeState: {
    lightOverrides: Record<string, string>;
    darkOverrides: Record<string, string>;
    borderRadius: number;
    borderWidth: number;
    presets: Array<{
      id: string;
      name: string;
      base: "light" | "dark";
      colors: Record<string, string>;
      borderRadius: number;
      borderWidth: number;
    }>;
    activePresetId: string | null;
  };
};

export type PostgresExperimentDeviceState = {
  dismissedUpdateVersion: string | null;
};

export type PostgresExperimentRememberedAccount = {
  email: string;
  name: string;
  lastLogin: string;
};

export type PostgresExperimentRecentProject = {
  id: string;
  name: string;
  description: string;
  openedAt: string;
};

export type PostgresExperimentUserProjectState = {
  lastOpenedProjectId: string | null;
  recentProjects: PostgresExperimentRecentProject[];
};

export type PostgresExperimentProject = {
  id: string;
  name: string;
  description: string;
  databaseName: string;
  storagePath: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentProjectUser = {
  id: string;
  projectId: string;
  appUserId: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentProjectAiAssistSettings = {
  enabled: boolean;
  allowSemanticSearch: boolean;
  allowQuestionAnswering: boolean;
  allowSummaries: boolean;
  allowCodeSuggestions: boolean;
  allowDraftReports: boolean;
};

export type PostgresExperimentProjectDocumentImportSettings = {
  storeOriginalFileName: boolean;
};

export type PostgresExperimentCanvasPoint = {
  x: number;
  y: number;
};

export type PostgresExperimentCanvasNodeState = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PostgresExperimentCanvasStroke = {
  id: string;
  kind: "pen";
  points: PostgresExperimentCanvasPoint[];
  color: string;
  lineStyle: "solid" | "dashed" | "dotted";
  strokeWidth: number;
};

export type PostgresExperimentCanvasRect = {
  id: string;
  kind: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fill: "filled" | "outline";
  lineStyle: "solid" | "dashed" | "dotted";
  strokeWidth: number;
};

export type PostgresExperimentCanvasDisplayShape =
  | "rounded"
  | "rectangle"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "octagon"
  | "parallelogram"
  | "trapezoid"
  | "tag"
  | "star";

export type PostgresExperimentCanvasPlacedShape = {
  id: string;
  kind: "shape";
  shape: PostgresExperimentCanvasDisplayShape;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fill: "filled" | "outline";
  lineStyle: "solid" | "dashed" | "dotted";
  strokeWidth: number;
};

export type PostgresExperimentCanvasText = {
  id: string;
  kind: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  html: string;
  fontSize: number;
  textAlign: "left" | "center" | "right";
};

export type PostgresExperimentCanvasShape =
  | PostgresExperimentCanvasStroke
  | PostgresExperimentCanvasRect
  | PostgresExperimentCanvasPlacedShape
  | PostgresExperimentCanvasText;

export type PostgresExperimentProjectCanvasState = {
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  nodes: PostgresExperimentCanvasNodeState[];
  shapes: PostgresExperimentCanvasShape[];
  hiddenRelationshipIds: string[];
};

export type PostgresExperimentSavedDrawing = {
  id: string;
  projectId: string;
  name: string;
  canvasKind: string;
  state: PostgresExperimentProjectCanvasState;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentSavedDrawingSummary = {
  id: string;
  projectId: string;
  name: string;
  canvasKind: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentSource = {
  id: string;
  projectId: string;
  sourceKind: string;
  title: string;
  originalFileName: string;
  storagePath: string;
  textContent: string;
  structuredContentJson: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentSourceObjectLink = {
  sourceId: string;
  objectId: string;
  createdAt: string;
};

export type PostgresExperimentSourceLock = {
  id: string;
  sourceId: string;
  userId: string;
  userName: string;
  expiresAtMs: number;
  createdAt: string;
  updatedAt: string;
  reason?: "locked" | "kicked";
};

export type AcquirePostgresExperimentSourceLockResult = {
  ok: boolean;
  lock: PostgresExperimentSourceLock | null;
  conflict: PostgresExperimentSourceLock | null;
};

export type PostgresExperimentSourceAttributeDefinition = {
  id: string;
  projectId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentSourceAttributeValue = {
  id: string;
  sourceId: string;
  attributeDefinitionId: string;
  attributeName: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  value: string;
  sortOrder: number;
};

export type SavePostgresExperimentSourceAttributeResult = {
  attributeDefinition: PostgresExperimentSourceAttributeDefinition;
  values: PostgresExperimentSourceAttributeValue[];
};

export type PostgresExperimentCode = {
  id: string;
  projectId: string;
  label: string;
  color: string;
  description: string;
  shortcut: string;
  parentCodeId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentAnnotationSummary = {
  id: string;
  projectId: string;
  sourceId: string;
  codeIds: string[];
  primaryCodeId: string;
  primaryCodeLabel: string;
  startOffset: number | null;
  endOffset: number | null;
  quote: string;
  note: string;
  anchorKind: string;
  imageRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  } | null;
  createdByProjectUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentMemo = {
  id: string;
  projectId: string;
  title: string;
  body: string;
  createdByProjectUserId: string;
  createdByName: string;
  sourceIds: string[];
  annotationIds: string[];
  codeIds: string[];
  objectIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentObjectType = {
  id: string;
  projectId: string;
  systemKey: string | null;
  name: string;
  description: string;
  shape: string;
  color: string;
  fill: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentObject = {
  id: string;
  projectId: string;
  objectTypeId: string;
  objectType: string;
  objectTypeSystemKey: string | null;
  sourceId: string | null;
  sourceKind: string | null;
  title: string;
  description: string;
  shapeOverride: string;
  colorOverride: string;
  fillOverride: string;
  eventStartAt: string | null;
  eventEndAt: string | null;
  eventTimePrecision: string | null;
  eventTimezone: string | null;
  eventIsInstant: boolean | null;
  attributeValues: PostgresExperimentObjectAttributeValue[];
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentObjectAttributeDefinition = {
  id: string;
  projectId: string;
  objectTypeId: string;
  objectType: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentObjectAttributeValue = {
  id: string;
  objectId: string;
  attributeDefinitionId: string;
  attributeName: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  value: string;
  sortOrder: number;
};

export type PostgresExperimentObjectTypeSaveResult = {
  objectType: PostgresExperimentObjectType;
  attributeDefinitions: PostgresExperimentObjectAttributeDefinition[];
  created: boolean;
};

export type PostgresExperimentRelationshipType = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  lineShape: string;
  lineWeight: number;
  arrowhead: string;
  color: string;
  fromObjectTypeIds: string[];
  fromObjectTypes: string[];
  toObjectTypeIds: string[];
  toObjectTypes: string[];
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentRelationship = {
  id: string;
  projectId: string;
  fromObjectId: string;
  toObjectId: string;
  relationshipTypeId: string;
  relationshipType: string;
  description: string;
  lineShapeOverride: string;
  lineWeightOverride: number | null;
  arrowheadOverride: string;
  colorOverride: string;
  attributeValues: PostgresExperimentRelationshipAttributeValue[];
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentRelationshipAttributeDefinition = {
  id: string;
  projectId: string;
  relationshipTypeId: string;
  relationshipType: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresExperimentRelationshipAttributeValue = {
  id: string;
  relationshipId: string;
  attributeDefinitionId: string;
  attributeName: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  value: string;
  sortOrder: number;
};

export type PostgresExperimentRelationshipTypeSaveResult = {
  relationshipType: PostgresExperimentRelationshipType;
  attributeDefinitions: PostgresExperimentRelationshipAttributeDefinition[];
  created: boolean;
};

export type PostgresExperimentProjectChangeEvent = {
  projectId: string;
  entityType: string;
  entityId: string;
  changeKind: string;
};

export type PostgresExperimentProjectLogEntry = {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  accessMode?: "local" | "remote";
  action: string;
  label: string;
  recordId?: string;
  detailsJson?: string;
  occurredAt: string;
  restoredAt?: string;
};

export async function ensurePostgresExperimentSchema(): Promise<PostgresSchemaMigrationResult> {
  return invoke<PostgresSchemaMigrationResult>("ensure_postgres_experiment_schema_command");
}

export async function getPostgresExperimentAuthStatus(): Promise<PostgresExperimentAuthStatus> {
  return invoke<PostgresExperimentAuthStatus>("get_postgres_experiment_auth_status_command");
}

export async function getPostgresExperimentInstallationSettings(): Promise<PostgresExperimentInstallationSettings> {
  return invoke<PostgresExperimentInstallationSettings>("get_postgres_experiment_installation_settings_command");
}

export async function savePostgresExperimentInstallationSettings(
  settings: PostgresExperimentInstallationSettings,
): Promise<PostgresExperimentInstallationSettings> {
  return invoke<PostgresExperimentInstallationSettings>("save_postgres_experiment_installation_settings_command", {
    settings,
  });
}

export async function getPostgresExperimentUserPreferences(): Promise<PostgresExperimentUserPreferences> {
  return invoke<PostgresExperimentUserPreferences>("get_postgres_experiment_user_preferences_command");
}

export async function savePostgresExperimentUserPreferences(
  preferences: PostgresExperimentUserPreferences,
): Promise<PostgresExperimentUserPreferences> {
  return invoke<PostgresExperimentUserPreferences>("save_postgres_experiment_user_preferences_command", {
    preferences,
  });
}

export async function getPostgresExperimentDeviceState(): Promise<PostgresExperimentDeviceState> {
  return invoke<PostgresExperimentDeviceState>("get_postgres_experiment_device_state_command");
}

export async function savePostgresExperimentDeviceState(
  state: PostgresExperimentDeviceState,
): Promise<PostgresExperimentDeviceState> {
  return invoke<PostgresExperimentDeviceState>("save_postgres_experiment_device_state_command", {
    state,
  });
}

export async function listPostgresExperimentRememberedAccounts(): Promise<PostgresExperimentRememberedAccount[]> {
  return invoke<PostgresExperimentRememberedAccount[]>("list_postgres_experiment_remembered_accounts_command");
}

export async function rememberPostgresExperimentAccount(email: string, name: string): Promise<void> {
  await invoke("remember_postgres_experiment_account_command", {
    email,
    name,
  });
}

export async function renamePostgresExperimentRememberedAccount(
  previousEmail: string,
  nextEmail: string,
  nextName: string,
): Promise<void> {
  await invoke("rename_postgres_experiment_remembered_account_command", {
    previousEmail,
    nextEmail,
    nextName,
  });
}

export async function clearPostgresExperimentRememberedAccounts(): Promise<void> {
  await invoke("clear_postgres_experiment_remembered_accounts_command");
}

export async function getPostgresExperimentUserProjectState(): Promise<PostgresExperimentUserProjectState> {
  return invoke<PostgresExperimentUserProjectState>("get_postgres_experiment_user_project_state_command");
}

export async function rememberPostgresExperimentProjectOpened(
  project: PostgresExperimentRecentProject,
): Promise<PostgresExperimentUserProjectState> {
  return invoke<PostgresExperimentUserProjectState>("remember_postgres_experiment_project_opened_command", {
    project,
  });
}

export async function removePostgresExperimentProjectFromState(
  projectId: string,
): Promise<PostgresExperimentUserProjectState> {
  return invoke<PostgresExperimentUserProjectState>("remove_postgres_experiment_project_from_state_command", {
    projectId,
  });
}

export async function clearPostgresExperimentUserProjectState(): Promise<void> {
  await invoke("clear_postgres_experiment_user_project_state_command");
}

export async function registerPostgresExperimentAppUser(data: {
  name: string;
  email: string;
  password: string;
  rememberSession: boolean;
}): Promise<PostgresExperimentAuthSession> {
  return invoke<PostgresExperimentAuthSession>("register_postgres_experiment_app_user_command", {
    request: data,
  });
}

export async function loginPostgresExperimentAppUser(data: {
  email: string;
  password: string;
  rememberSession: boolean;
}): Promise<PostgresExperimentAuthSession> {
  return invoke<PostgresExperimentAuthSession>("login_postgres_experiment_app_user_command", {
    request: data,
  });
}

export async function loginPostgresExperimentAdmin(data: {
  username: string;
  password: string;
  rememberSession: boolean;
}): Promise<PostgresExperimentAuthSession> {
  return invoke<PostgresExperimentAuthSession>("login_postgres_experiment_admin_command", {
    request: data,
  });
}

export async function logoutPostgresExperimentAppUser(): Promise<PostgresExperimentAuthStatus> {
  return invoke<PostgresExperimentAuthStatus>("logout_postgres_experiment_app_user_command");
}

export async function updatePostgresExperimentAppUserProfile(data: {
  name: string;
  email: string;
}): Promise<PostgresExperimentAppUser> {
  return invoke<PostgresExperimentAppUser>("update_postgres_experiment_app_user_profile_command", {
    request: data,
  });
}

export async function changePostgresExperimentAppUserPassword(data: {
  currentPassword: string;
  newPassword: string;
}): Promise<PostgresExperimentAuthStatus> {
  return invoke<PostgresExperimentAuthStatus>("change_postgres_experiment_app_user_password_command", {
    request: data,
  });
}

export async function listPostgresExperimentAppUsers(): Promise<PostgresExperimentAppUser[]> {
  return invoke<PostgresExperimentAppUser[]>("list_postgres_experiment_app_users_command");
}

export async function listPostgresExperimentProjects(): Promise<PostgresExperimentProject[]> {
  return invoke<PostgresExperimentProject[]>("list_postgres_experiment_projects_command");
}

export async function createPostgresExperimentProject(data: {
  name: string;
  description: string;
}): Promise<PostgresExperimentProject> {
  return invoke<PostgresExperimentProject>("create_postgres_experiment_project_command", {
    request: data,
  });
}

export async function updatePostgresExperimentProject(data: {
  projectId: string;
  name: string;
  description: string;
}): Promise<PostgresExperimentProject> {
  return invoke<PostgresExperimentProject>("update_postgres_experiment_project_command", {
    request: data,
  });
}

export async function deletePostgresExperimentProject(projectId: string): Promise<void> {
  await invoke("delete_postgres_experiment_project_command", {
    projectId,
  });
}

export async function listPostgresExperimentProjectUsers(projectId: string): Promise<PostgresExperimentProjectUser[]> {
  return invoke<PostgresExperimentProjectUser[]>("list_postgres_experiment_project_users_command", {
    projectId,
  });
}

export async function createPostgresExperimentProjectUser(data: {
  projectId: string;
  appUserId: string;
  role: string;
}): Promise<PostgresExperimentProjectUser> {
  return invoke<PostgresExperimentProjectUser>("create_postgres_experiment_project_user_command", {
    request: data,
  });
}

export async function updatePostgresExperimentProjectUser(data: {
  projectId: string;
  projectUserId: string;
  role: string;
}): Promise<PostgresExperimentProjectUser> {
  return invoke<PostgresExperimentProjectUser>("update_postgres_experiment_project_user_command", {
    request: data,
  });
}

export async function deletePostgresExperimentProjectUser(projectId: string, projectUserId: string): Promise<void> {
  await invoke("delete_postgres_experiment_project_user_command", {
    projectId,
    projectUserId,
  });
}

export async function getPostgresExperimentProjectAiAssistSettings(
  projectId: string,
): Promise<PostgresExperimentProjectAiAssistSettings> {
  return invoke<PostgresExperimentProjectAiAssistSettings>(
    "get_postgres_experiment_project_ai_assist_settings_command",
    {
      projectId,
    },
  );
}

export async function savePostgresExperimentProjectAiAssistSettings(data: {
  projectId: string;
  settings: PostgresExperimentProjectAiAssistSettings;
}): Promise<PostgresExperimentProjectAiAssistSettings> {
  return invoke<PostgresExperimentProjectAiAssistSettings>(
    "save_postgres_experiment_project_ai_assist_settings_command",
    {
      request: data,
    },
  );
}

export async function getPostgresExperimentProjectDocumentImportSettings(
  projectId: string,
): Promise<PostgresExperimentProjectDocumentImportSettings> {
  return invoke<PostgresExperimentProjectDocumentImportSettings>(
    "get_postgres_experiment_project_document_import_settings_command",
    {
      projectId,
    },
  );
}

export async function savePostgresExperimentProjectDocumentImportSettings(data: {
  projectId: string;
  settings: PostgresExperimentProjectDocumentImportSettings;
}): Promise<PostgresExperimentProjectDocumentImportSettings> {
  return invoke<PostgresExperimentProjectDocumentImportSettings>(
    "save_postgres_experiment_project_document_import_settings_command",
    {
      request: data,
    },
  );
}

export async function getPostgresExperimentProjectCanvasState(
  projectId: string,
): Promise<PostgresExperimentProjectCanvasState> {
  return invoke<PostgresExperimentProjectCanvasState>(
    "get_postgres_experiment_project_canvas_state_command",
    {
      projectId,
    },
  );
}

export async function savePostgresExperimentProjectCanvasState(data: {
  projectId: string;
  state: PostgresExperimentProjectCanvasState;
}): Promise<PostgresExperimentProjectCanvasState> {
  return invoke<PostgresExperimentProjectCanvasState>(
    "save_postgres_experiment_project_canvas_state_command",
    {
      request: data,
    },
  );
}

export async function savePostgresExperimentSavedDrawing(data: {
  projectId: string;
  drawingId?: string | null;
  name?: string | null;
  canvasKind?: string | null;
  state: PostgresExperimentProjectCanvasState;
}): Promise<PostgresExperimentSavedDrawing> {
  return invoke<PostgresExperimentSavedDrawing>("save_postgres_experiment_saved_drawing_command", {
    request: data,
  });
}

export async function listPostgresExperimentSavedDrawings(
  projectId: string,
): Promise<PostgresExperimentSavedDrawing[]> {
  return invoke<PostgresExperimentSavedDrawing[]>("list_postgres_experiment_saved_drawings_command", {
    projectId,
  });
}

export async function listPostgresExperimentSavedDrawingSummaries(
  projectId: string,
): Promise<PostgresExperimentSavedDrawingSummary[]> {
  return invoke<PostgresExperimentSavedDrawingSummary[]>(
    "list_postgres_experiment_saved_drawing_summaries_command",
    {
      projectId,
    },
  );
}

export async function getPostgresExperimentSavedDrawing(
  projectId: string,
  drawingId: string,
): Promise<PostgresExperimentSavedDrawing> {
  return invoke<PostgresExperimentSavedDrawing>("get_postgres_experiment_saved_drawing_command", {
    projectId,
    drawingId,
  });
}

export async function deletePostgresExperimentSavedDrawing(
  projectId: string,
  drawingId: string,
): Promise<void> {
  await invoke("delete_postgres_experiment_saved_drawing_command", {
    projectId,
    drawingId,
  });
}

export async function listPostgresExperimentSources(projectId: string): Promise<PostgresExperimentSource[]> {
  return invoke<PostgresExperimentSource[]>("list_postgres_experiment_sources_command", {
    projectId,
  });
}

export async function createPostgresExperimentSource(data: {
  projectId: string;
  sourceKind: string;
  title: string;
  originalFileName?: string | null;
  storagePath?: string | null;
  textContent: string;
  structuredContentJson?: string | null;
  notes?: string | null;
}): Promise<PostgresExperimentSource> {
  return invoke<PostgresExperimentSource>("create_postgres_experiment_source_command", {
    request: data,
  });
}

export async function importPostgresExperimentSourceFile(data: {
  projectId: string;
  sourceKind: string;
  title: string;
  originalFileName: string;
  mediaType?: string | null;
  fileBytesBase64: string;
  textContent: string;
  structuredContentJson?: string | null;
  notes?: string | null;
}): Promise<PostgresExperimentSource> {
  return invoke<PostgresExperimentSource>("import_postgres_experiment_source_file_command", {
    request: data,
  });
}

export async function updatePostgresExperimentSource(data: {
  projectId: string;
  sourceId: string;
  sourceKind: string;
  title: string;
  originalFileName?: string | null;
  storagePath?: string | null;
  textContent: string;
  structuredContentJson?: string | null;
  notes?: string | null;
}): Promise<PostgresExperimentSource> {
  return invoke<PostgresExperimentSource>("update_postgres_experiment_source_command", {
    request: data,
  });
}

export async function deletePostgresExperimentSource(projectId: string, sourceId: string): Promise<void> {
  await invoke("delete_postgres_experiment_source_command", {
    projectId,
    sourceId,
  });
}

export async function listPostgresExperimentSourceLocks(
  projectId: string,
): Promise<PostgresExperimentSourceLock[]> {
  return invoke<PostgresExperimentSourceLock[]>("list_postgres_experiment_source_locks_command", {
    projectId,
  });
}

export async function acquirePostgresExperimentSourceLock(data: {
  projectId: string;
  sourceId: string;
}): Promise<AcquirePostgresExperimentSourceLockResult> {
  return invoke<AcquirePostgresExperimentSourceLockResult>("acquire_postgres_experiment_source_lock_command", {
    request: data,
  });
}

export async function releasePostgresExperimentSourceLock(
  projectId: string,
  lockId: string,
): Promise<void> {
  await invoke("release_postgres_experiment_source_lock_command", {
    projectId,
    lockId,
  });
}

export async function kickPostgresExperimentSourceLock(data: {
  projectId: string;
  sourceId: string;
  lockId: string;
}): Promise<void> {
  await invoke("kick_postgres_experiment_source_lock_command", {
    request: data,
  });
}

export async function listPostgresExperimentSourceObjectLinks(
  projectId: string,
): Promise<PostgresExperimentSourceObjectLink[]> {
  return invoke<PostgresExperimentSourceObjectLink[]>("list_postgres_experiment_source_object_links_command", {
    projectId,
  });
}

export async function setPostgresExperimentSourceObjects(data: {
  projectId: string;
  sourceId: string;
  objectIds: string[];
}): Promise<PostgresExperimentSourceObjectLink[]> {
  return invoke<PostgresExperimentSourceObjectLink[]>("set_postgres_experiment_source_objects_command", {
    request: data,
  });
}

export async function listPostgresExperimentSourceAttributeDefinitions(
  projectId: string,
): Promise<PostgresExperimentSourceAttributeDefinition[]> {
  return invoke<PostgresExperimentSourceAttributeDefinition[]>("list_postgres_experiment_source_attribute_definitions_command", {
    projectId,
  });
}

export async function listPostgresExperimentSourceAttributeValues(
  projectId: string,
): Promise<PostgresExperimentSourceAttributeValue[]> {
  return invoke<PostgresExperimentSourceAttributeValue[]>("list_postgres_experiment_source_attribute_values_command", {
    projectId,
  });
}

export async function savePostgresExperimentSourceAttribute(data: {
  projectId: string;
  attributeDefinitionId?: string | null;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  values: Array<{
    sourceId: string;
    value: string;
  }>;
}): Promise<SavePostgresExperimentSourceAttributeResult> {
  return invoke<SavePostgresExperimentSourceAttributeResult>("save_postgres_experiment_source_attribute_command", {
    request: data,
  });
}

export async function deletePostgresExperimentSourceAttributeDefinition(
  projectId: string,
  attributeDefinitionId: string,
): Promise<void> {
  await invoke("delete_postgres_experiment_source_attribute_definition_command", {
    projectId,
    attributeDefinitionId,
  });
}

export async function listPostgresExperimentCodes(projectId: string): Promise<PostgresExperimentCode[]> {
  return invoke<PostgresExperimentCode[]>("list_postgres_experiment_codes_command", {
    projectId,
  });
}

export async function createPostgresExperimentCode(data: {
  projectId: string;
  label: string;
  color?: string | null;
  description?: string | null;
  shortcut?: string | null;
  parentCodeId?: string | null;
}): Promise<PostgresExperimentCode> {
  return invoke<PostgresExperimentCode>("create_postgres_experiment_code_command", {
    request: data,
  });
}

export async function updatePostgresExperimentCode(data: {
  projectId: string;
  codeId: string;
  label: string;
  color?: string | null;
  description?: string | null;
  shortcut?: string | null;
  parentCodeId?: string | null;
}): Promise<PostgresExperimentCode> {
  return invoke<PostgresExperimentCode>("update_postgres_experiment_code_command", {
    request: data,
  });
}

export async function deletePostgresExperimentCode(projectId: string, codeId: string): Promise<void> {
  await invoke("delete_postgres_experiment_code_command", {
    projectId,
    codeId,
  });
}

export async function listPostgresExperimentAnnotationSummaries(
  projectId: string,
): Promise<PostgresExperimentAnnotationSummary[]> {
  return invoke<PostgresExperimentAnnotationSummary[]>("list_postgres_experiment_annotation_summaries_command", {
    projectId,
  });
}

export async function createPostgresExperimentAnnotation(data: {
  projectId: string;
  sourceId: string;
  codeIds: string[];
  startOffset?: number | null;
  endOffset?: number | null;
  quote?: string | null;
  note?: string | null;
  anchorKind?: string | null;
  imageRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  } | null;
}): Promise<PostgresExperimentAnnotationSummary> {
  return invoke<PostgresExperimentAnnotationSummary>("create_postgres_experiment_annotation_command", {
    request: data,
  });
}

export async function updatePostgresExperimentAnnotation(data: {
  projectId: string;
  annotationId: string;
  codeIds: string[];
  startOffset?: number | null;
  endOffset?: number | null;
  quote?: string | null;
  note?: string | null;
  anchorKind?: string | null;
  imageRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  } | null;
}): Promise<PostgresExperimentAnnotationSummary> {
  return invoke<PostgresExperimentAnnotationSummary>("update_postgres_experiment_annotation_command", {
    request: data,
  });
}

export async function deletePostgresExperimentAnnotation(projectId: string, annotationId: string): Promise<void> {
  await invoke("delete_postgres_experiment_annotation_command", {
    projectId,
    annotationId,
  });
}

export async function listPostgresExperimentProjectLog(
  projectId: string,
): Promise<PostgresExperimentProjectLogEntry[]> {
  return invoke<PostgresExperimentProjectLogEntry[]>("list_postgres_experiment_project_log_command", {
    projectId,
  });
}

export async function listPostgresExperimentMemos(projectId: string): Promise<PostgresExperimentMemo[]> {
  return invoke<PostgresExperimentMemo[]>("list_postgres_experiment_memos_command", {
    projectId,
  });
}

export async function createPostgresExperimentMemo(data: {
  projectId: string;
  title: string;
  body?: string | null;
  sourceIds?: string[];
  annotationIds?: string[];
  codeIds?: string[];
  objectIds?: string[];
}): Promise<PostgresExperimentMemo> {
  return invoke<PostgresExperimentMemo>("create_postgres_experiment_memo_command", {
    request: data,
  });
}

export async function updatePostgresExperimentMemo(data: {
  projectId: string;
  memoId: string;
  title: string;
  body?: string | null;
  sourceIds?: string[];
  annotationIds?: string[];
  codeIds?: string[];
  objectIds?: string[];
}): Promise<PostgresExperimentMemo> {
  return invoke<PostgresExperimentMemo>("update_postgres_experiment_memo_command", {
    request: data,
  });
}

export async function deletePostgresExperimentMemo(projectId: string, memoId: string): Promise<void> {
  await invoke("delete_postgres_experiment_memo_command", {
    projectId,
    memoId,
  });
}

export async function listPostgresExperimentObjects(projectId: string): Promise<PostgresExperimentObject[]> {
  return invoke<PostgresExperimentObject[]>("list_postgres_experiment_objects_command", {
    projectId,
  });
}

export async function listPostgresExperimentObjectTypes(
  projectId: string,
): Promise<PostgresExperimentObjectType[]> {
  return invoke<PostgresExperimentObjectType[]>("list_postgres_experiment_object_types_command", {
    projectId,
  });
}

export async function createPostgresExperimentObjectType(data: {
  projectId: string;
  name: string;
  description: string;
  shape: string;
  color: string;
  fill: string;
}): Promise<PostgresExperimentObjectType> {
  return invoke<PostgresExperimentObjectType>("create_postgres_experiment_object_type_command", {
    request: data,
  });
}

export async function updatePostgresExperimentObjectType(data: {
  projectId: string;
  objectTypeId: string;
  name: string;
  description: string;
  shape: string;
  color: string;
  fill: string;
}): Promise<PostgresExperimentObjectType> {
  return invoke<PostgresExperimentObjectType>("update_postgres_experiment_object_type_command", {
    request: data,
  });
}

export async function savePostgresExperimentObjectType(data: {
  projectId: string;
  objectTypeId?: string | null;
  name: string;
  description: string;
  shape: string;
  color: string;
  fill: string;
  attributes: Array<{
    id?: string | null;
    name: string;
    dataType: "text" | "number" | "datetime" | "categorical";
    description: string;
    options: string[];
  }>;
}): Promise<PostgresExperimentObjectTypeSaveResult> {
  return invoke<PostgresExperimentObjectTypeSaveResult>("save_postgres_experiment_object_type_command", {
    request: data,
  });
}

export async function deletePostgresExperimentObjectType(projectId: string, objectTypeId: string): Promise<void> {
  await invoke("delete_postgres_experiment_object_type_command", {
    projectId,
    objectTypeId,
  });
}

export async function listPostgresExperimentRelationshipTypes(
  projectId: string,
): Promise<PostgresExperimentRelationshipType[]> {
  return invoke<PostgresExperimentRelationshipType[]>("list_postgres_experiment_relationship_types_command", {
    projectId,
  });
}

export async function createPostgresExperimentRelationshipType(data: {
  projectId: string;
  name: string;
  description: string;
  lineShape: string;
  lineWeight: number;
  arrowhead: string;
  color: string;
  fromObjectTypeIds?: string[];
  toObjectTypeIds?: string[];
}): Promise<PostgresExperimentRelationshipType> {
  return invoke<PostgresExperimentRelationshipType>("create_postgres_experiment_relationship_type_command", {
    request: data,
  });
}

export async function updatePostgresExperimentRelationshipType(data: {
  projectId: string;
  relationshipTypeId: string;
  name: string;
  description: string;
  lineShape: string;
  lineWeight: number;
  arrowhead: string;
  color: string;
  fromObjectTypeIds?: string[];
  toObjectTypeIds?: string[];
}): Promise<PostgresExperimentRelationshipType> {
  return invoke<PostgresExperimentRelationshipType>("update_postgres_experiment_relationship_type_command", {
    request: data,
  });
}

export async function savePostgresExperimentRelationshipType(data: {
  projectId: string;
  relationshipTypeId?: string | null;
  name: string;
  description: string;
  lineShape: string;
  lineWeight: number;
  arrowhead: string;
  color: string;
  fromObjectTypeIds?: string[];
  toObjectTypeIds?: string[];
  attributes: Array<{
    id?: string | null;
    name: string;
    dataType: "text" | "number" | "datetime" | "categorical";
    description: string;
    options: string[];
  }>;
}): Promise<PostgresExperimentRelationshipTypeSaveResult> {
  return invoke<PostgresExperimentRelationshipTypeSaveResult>("save_postgres_experiment_relationship_type_command", {
    request: data,
  });
}

export async function deletePostgresExperimentRelationshipType(projectId: string, relationshipTypeId: string): Promise<void> {
  await invoke("delete_postgres_experiment_relationship_type_command", {
    projectId,
    relationshipTypeId,
  });
}

export async function listPostgresExperimentObjectAttributeDefinitions(
  projectId: string,
): Promise<PostgresExperimentObjectAttributeDefinition[]> {
  return invoke<PostgresExperimentObjectAttributeDefinition[]>(
    "list_postgres_experiment_object_attribute_definitions_command",
    {
      projectId,
    },
  );
}

export async function createPostgresExperimentObjectAttributeDefinition(data: {
  projectId: string;
  objectTypeId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
}): Promise<PostgresExperimentObjectAttributeDefinition> {
  return invoke<PostgresExperimentObjectAttributeDefinition>(
    "create_postgres_experiment_object_attribute_definition_command",
    {
      request: data,
    },
  );
}

export async function updatePostgresExperimentObjectAttributeDefinition(data: {
  projectId: string;
  attributeDefinitionId: string;
  objectTypeId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
}): Promise<PostgresExperimentObjectAttributeDefinition> {
  return invoke<PostgresExperimentObjectAttributeDefinition>(
    "update_postgres_experiment_object_attribute_definition_command",
    {
      request: data,
    },
  );
}

export async function deletePostgresExperimentObjectAttributeDefinition(
  projectId: string,
  attributeDefinitionId: string,
): Promise<void> {
  await invoke("delete_postgres_experiment_object_attribute_definition_command", {
    projectId,
    attributeDefinitionId,
  });
}

export async function createPostgresExperimentObject(data: {
  projectId: string;
  objectTypeId: string;
  title: string;
  description: string;
  shapeOverride?: string | null;
  colorOverride?: string | null;
  fillOverride?: string | null;
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  eventTimePrecision?: string | null;
  eventTimezone?: string | null;
  eventIsInstant?: boolean | null;
  attributeValues: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
}): Promise<PostgresExperimentObject> {
  return invoke<PostgresExperimentObject>("create_postgres_experiment_object_command", {
    request: data,
  });
}

export async function updatePostgresExperimentObject(data: {
  projectId: string;
  objectId: string;
  objectTypeId: string;
  title: string;
  description: string;
  shapeOverride?: string | null;
  colorOverride?: string | null;
  fillOverride?: string | null;
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  eventTimePrecision?: string | null;
  eventTimezone?: string | null;
  eventIsInstant?: boolean | null;
  attributeValues: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
}): Promise<PostgresExperimentObject> {
  return invoke<PostgresExperimentObject>("update_postgres_experiment_object_command", {
    request: data,
  });
}

export async function savePostgresExperimentObject(data: {
  projectId: string;
  objectId?: string | null;
  objectTypeId: string;
  title: string;
  description: string;
  shapeOverride?: string | null;
  colorOverride?: string | null;
  fillOverride?: string | null;
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  eventTimePrecision?: string | null;
  eventTimezone?: string | null;
  eventIsInstant?: boolean | null;
  attributeValues: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
}): Promise<PostgresExperimentObject> {
  return invoke<PostgresExperimentObject>("save_postgres_experiment_object_command", {
    request: data,
  });
}

export async function deletePostgresExperimentObject(projectId: string, objectId: string): Promise<void> {
  await invoke("delete_postgres_experiment_object_command", {
    projectId,
    objectId,
  });
}

export async function listPostgresExperimentRelationships(projectId: string): Promise<PostgresExperimentRelationship[]> {
  return invoke<PostgresExperimentRelationship[]>("list_postgres_experiment_relationships_command", {
    projectId,
  });
}

export async function listPostgresExperimentRelationshipAttributeDefinitions(
  projectId: string,
): Promise<PostgresExperimentRelationshipAttributeDefinition[]> {
  return invoke<PostgresExperimentRelationshipAttributeDefinition[]>(
    "list_postgres_experiment_relationship_attribute_definitions_command",
    {
      projectId,
    },
  );
}

export async function createPostgresExperimentRelationshipAttributeDefinition(data: {
  projectId: string;
  relationshipTypeId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
}): Promise<PostgresExperimentRelationshipAttributeDefinition> {
  return invoke<PostgresExperimentRelationshipAttributeDefinition>(
    "create_postgres_experiment_relationship_attribute_definition_command",
    {
      request: data,
    },
  );
}

export async function updatePostgresExperimentRelationshipAttributeDefinition(data: {
  projectId: string;
  attributeDefinitionId: string;
  relationshipTypeId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
}): Promise<PostgresExperimentRelationshipAttributeDefinition> {
  return invoke<PostgresExperimentRelationshipAttributeDefinition>(
    "update_postgres_experiment_relationship_attribute_definition_command",
    {
      request: data,
    },
  );
}

export async function deletePostgresExperimentRelationshipAttributeDefinition(
  projectId: string,
  attributeDefinitionId: string,
): Promise<void> {
  await invoke("delete_postgres_experiment_relationship_attribute_definition_command", {
    projectId,
    attributeDefinitionId,
  });
}

export async function createPostgresExperimentRelationship(data: {
  projectId: string;
  fromObjectId: string;
  toObjectId: string;
  relationshipTypeId: string;
  description: string;
  lineShapeOverride?: string | null;
  lineWeightOverride?: number | null;
  arrowheadOverride?: string | null;
  colorOverride?: string | null;
  attributeValues: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
}): Promise<PostgresExperimentRelationship> {
  return invoke<PostgresExperimentRelationship>("create_postgres_experiment_relationship_command", {
    request: data,
  });
}

export async function updatePostgresExperimentRelationship(data: {
  projectId: string;
  relationshipId: string;
  fromObjectId: string;
  toObjectId: string;
  relationshipTypeId: string;
  description: string;
  lineShapeOverride?: string | null;
  lineWeightOverride?: number | null;
  arrowheadOverride?: string | null;
  colorOverride?: string | null;
  attributeValues: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
}): Promise<PostgresExperimentRelationship> {
  return invoke<PostgresExperimentRelationship>("update_postgres_experiment_relationship_command", {
    request: data,
  });
}

export async function savePostgresExperimentRelationship(data: {
  projectId: string;
  relationshipId?: string | null;
  fromObjectId: string;
  toObjectId: string;
  relationshipTypeId: string;
  description: string;
  lineShapeOverride?: string | null;
  lineWeightOverride?: number | null;
  arrowheadOverride?: string | null;
  colorOverride?: string | null;
  attributeValues: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
}): Promise<PostgresExperimentRelationship> {
  return invoke<PostgresExperimentRelationship>("save_postgres_experiment_relationship_command", {
    request: data,
  });
}

export async function deletePostgresExperimentRelationship(projectId: string, relationshipId: string): Promise<void> {
  await invoke("delete_postgres_experiment_relationship_command", {
    projectId,
    relationshipId,
  });
}
