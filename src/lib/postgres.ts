import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectEmbeddingBuildSource,
  ProjectEmbeddingBuildStatus,
  ProjectEmbeddingStoreStatus,
} from "./projectEmbeddings";
import type { LocaleCode } from "../i18n/types";

export const POSTGRES_PROJECT_CHANGED_EVENT = "postgres-project-changed";

export type PostgresStatus = {
  host: string;
  port: number;
  networkMode: "device" | "network" | "internet";
  localIp: string | null;
  localReachable: boolean;
  lanReachable: boolean;
  psqlPath: string;
  postgresqlConfPath: string;
  psqlExists: boolean;
  postgresqlConfExists: boolean;
  bootstrapIdentityPath: string;
  bootstrapIdentityExists: boolean;
  serviceReachable: boolean;
  superuserName: string;
  appDatabase: string;
  bootstrapApplied: boolean;
  adminHandoffCompleted: boolean;
};

export type BundledPostgresPaths = {
  distribution: "installed" | "portable";
  expectedVersion: string;
  appResourceDir: string | null;
  executableDir: string;
  runtimeRoot: string;
  binDir: string;
  postgresBinary: string;
  initdbBinary: string;
  pgCtlBinary: string;
  psqlBinary: string;
  pgDumpBinary: string;
  dataRoot: string;
  appLogsDir: string;
  runtimeDiagnosticsLog: string;
  postgresRoot: string;
  dataDir: string;
  logsDir: string;
  runDir: string;
  configDir: string;
  backupsRoot: string;
  automaticBackupsDir: string;
  manualBackupsDir: string;
  upgradeBackupsDir: string;
  exportsRoot: string;
};

export type BundledPostgresStatus = {
  paths: BundledPostgresPaths;
  runtimeRootExists: boolean;
  binDirExists: boolean;
  postgresBinaryExists: boolean;
  initdbBinaryExists: boolean;
  pgCtlBinaryExists: boolean;
  psqlBinaryExists: boolean;
  pgDumpBinaryExists: boolean;
  dataRootExists: boolean;
  postgresRootExists: boolean;
  dataDirExists: boolean;
  initialized: boolean;
  initializedVersion: string | null;
  expectedVersionMatches: boolean | null;
  reachable: boolean;
  probeHost: string;
  probePort: number;
  postmasterPidExists: boolean;
  postmasterPid: number | null;
  postmasterPidRunning: boolean | null;
  latestLogPath: string | null;
};

export type PostgresUpgradeBackupResult = {
  path: string;
  createdAtMs: number;
  kanqualVersion: string;
  postgresVersion: string;
  controlDatabase: string;
  projectCount: number;
  storageFileCount: number;
  bytes: number;
};

export type PostgresUpgradeBackupDiagnosticsEntry = {
  path: string;
  fileName: string;
  createdAtMs: number;
  modifiedAtMs: number;
  kanqualVersion: string;
  postgresVersion: string;
  projectCount: number;
  storageFileCount: number;
  bytes: number;
  source: string;
  exists: boolean;
};

export type PostgresUpgradeBackupDiagnostics = {
  folderPath: string;
  folderExists: boolean;
  lastSuccessfulBackup: PostgresUpgradeBackupDiagnosticsEntry | null;
  backups: PostgresUpgradeBackupDiagnosticsEntry[];
};

export type RestorePostgresUpgradeBackupResult = {
  restoredAtMs: number;
  kanqualVersion: string;
  backupKanqualVersion: string;
  backupPostgresVersion: string;
  projectCount: number;
  storageFileCount: number;
  userCount: number;
};

export type PostgresProjectExportTable = {
  name: string;
  rowsJson: string;
};

export type PostgresProjectExportAsset = {
  collection: string;
  recordId: string;
  field: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

export type PostgresProjectExportBundle = {
  tables: PostgresProjectExportTable[];
  assets: PostgresProjectExportAsset[];
};

export type BundledPostgresInitPreflight = {
  status: BundledPostgresStatus;
  dataRootWritable: boolean;
  dataDirEmptyOrMissing: boolean;
  requiredBinariesAvailable: boolean;
  defaultPortAvailable: boolean;
  canInitialize: boolean;
  issues: string[];
};

export type BundledPostgresInitializeResult = {
  status: BundledPostgresStatus;
  postgresqlConfPath: string;
  pgHbaConfPath: string;
  initdbStdout: string;
  initdbStderr: string;
};

export type BundledPostgresRuntimeResult = {
  status: BundledPostgresStatus;
  processManaged: boolean;
  processId: number | null;
  started: boolean;
  stopped: boolean;
  recoveredStalePid: boolean;
  message: string;
};

export async function getBundledPostgresPaths(): Promise<BundledPostgresPaths> {
  return invoke<BundledPostgresPaths>("get_bundled_postgres_paths_command");
}

export async function getBundledPostgresStatus(): Promise<BundledPostgresStatus> {
  return invoke<BundledPostgresStatus>("get_bundled_postgres_status_command");
}

export async function getBundledPostgresInitPreflight(): Promise<BundledPostgresInitPreflight> {
  return invoke<BundledPostgresInitPreflight>("get_bundled_postgres_init_preflight_command");
}

export async function prepareBundledPostgresRuntimeDirs(): Promise<BundledPostgresPaths> {
  return invoke<BundledPostgresPaths>("prepare_bundled_postgres_runtime_dirs_command");
}

export async function startBundledPostgresRuntime(): Promise<BundledPostgresRuntimeResult> {
  return invoke<BundledPostgresRuntimeResult>("start_bundled_postgres_runtime_command");
}

export async function stopBundledPostgresRuntime(): Promise<BundledPostgresRuntimeResult> {
  return invoke<BundledPostgresRuntimeResult>("stop_bundled_postgres_runtime_command");
}

export async function initializeBundledPostgresCluster(
  superuserPassword: string,
): Promise<BundledPostgresInitializeResult> {
  return invoke<BundledPostgresInitializeResult>("initialize_bundled_postgres_cluster_command", {
    request: {
      superuserPassword,
    },
  });
}

export async function getPostgresStatus(): Promise<PostgresStatus> {
  return invoke<PostgresStatus>("get_postgres_experiment_status_command");
}

export async function setPostgresNetworkMode(mode: "device" | "network" | "internet"): Promise<PostgresStatus> {
  return invoke<PostgresStatus>("set_postgres_experiment_network_mode_command", {
    request: { mode },
  });
}

export type BootstrapPostgresResult = {
  appDatabase: string;
  bootstrapIdentityPath: string;
  databaseReady: boolean;
};

export async function bootstrapPostgres(
  superuserPassword: string,
): Promise<BootstrapPostgresResult> {
  return invoke<BootstrapPostgresResult>("bootstrap_postgres_experiment_command", {
    request: {
      superuserPassword,
    },
  });
}

export type PostgresSchemaMigrationResult = {
  ready: boolean;
  appliedVersions: number[];
};

export type PostgresAppUser = {
  id: string;
  name: string;
  username: string;
  role: string;
  active: boolean;
  disabledAt: string | null;
  mustChangePassword: boolean;
  loginBlockedUntilMs: number | null;
  loginPermanentlyBlocked: boolean;
  loginFailedAttemptsLastHour: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type PostgresAuthSession = {
  authKind: string;
  user: PostgresAppUser;
  startedAtMs: number;
};

export type PostgresAuthStatus = {
  bootstrapApplied: boolean;
  adminHandoffCompleted: boolean;
  ready: boolean;
  registeredUserCount: number;
  requiresAccountSetup: boolean;
  localAdminName: string;
  currentSession: PostgresAuthSession | null;
};

export type PostgresInstallationSettings = {
  startupReopenLastProject: boolean;
  documentImportDefaultMode: "upload" | "paste";
  documentImportAutoNameFromFile: boolean;
  documentImportTrimImportedText: boolean;
  documentImportWarnBeforeEmptyImport: boolean;
  privacyMaskFilePaths: boolean;
  privacyClearRecentProjectsOnSignOut: boolean;
  updatesAutoCheck: boolean;
  updatesBannerEnabled: boolean;
  aiAssistPolicy: {
    mode: "disabled" | "project" | "enabled";
    serverEnabled: boolean;
    projectOverrides: Record<string, boolean>;
  };
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
    cloudSelectedModelsByProvider: Partial<Record<"openai" | "anthropic" | "copilot" | "blablador" | "ollama", string>>;
    cloudEnabledModelsByProvider: Partial<Record<"openai" | "anthropic" | "copilot" | "blablador" | "ollama", string[]>>;
    localProvider: "ollama" | "llamacpp" | "custom";
    ollamaEnabled: boolean;
    ollamaProtocol: "http" | "https";
    ollamaHost: string;
    ollamaPort: number;
    ollamaSelectedModel: string;
    localSelectedModelsByProvider: Partial<Record<"ollama" | "llamacpp" | "custom", string>>;
    localEnabledModelsByProvider: Partial<Record<"ollama" | "llamacpp" | "custom", string[]>>;
    ollamaRequestTimeoutSeconds: number;
    ollamaDocumentProcessingTimeoutSeconds: number;
    ollamaTemperature: number;
    ollamaNumCtx: number;
    ollamaKeepAliveMinutes: number;
    ollamaRelevantSegmentsCandidateLimit: number;
    ollamaRelevantSegmentsMaxResults: number;
  };
};

export type PostgresAiLlmCatalogEntry = {
  scope: "local" | "cloud";
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  modelPublisher?: string | null;
  endpoint?: string | null;
  protocol?: string | null;
  host?: string | null;
  port?: number | null;
};

export type PostgresUserPreferences = {
  theme: "light" | "dark";
  density: "comfortable" | "compact";
  fontSize: "small" | "normal" | "large";
  sourceTextSizePx: number;
  locale: LocaleCode;
  recentProjectLimit: number;
  gettingStartedState: {
    dismissed: boolean;
    completed: boolean;
    step: string;
    projectId: string;
    userId: string;
    sourceId: string;
    codeId: string;
    adminUserId: string;
    currentActor: string;
    temporaryUsername: string;
  };
  themeState: {
    lightOverrides: Record<string, string>;
    darkOverrides: Record<string, string>;
    borderRadius: number;
    borderWidth: number;
    canvasGridEnabled: boolean;
    canvasGridDensity: number;
    presets: Array<{
      id: string;
      name: string;
      base: "light" | "dark";
      colors: Record<string, string>;
      borderRadius: number;
      borderWidth: number;
      canvasGridEnabled: boolean;
      canvasGridDensity: number;
    }>;
    activePresetId: string | null;
  };
};

export type PostgresDeviceState = {
  dismissedUpdateVersion: string | null;
};

export type PostgresRememberedAccount = {
  email: string;
  name: string;
  lastLogin: string;
};

export type PostgresRecentProject = {
  id: string;
  name: string;
  description: string;
  openedAt: string;
};

export type PostgresUserProjectState = {
  lastOpenedProjectId: string | null;
  recentProjects: PostgresRecentProject[];
};

export type PostgresProject = {
  id: string;
  name: string;
  description: string;
  databaseName: string;
  storagePath: string;
  creationSource: "manual" | "snapshot" | "kanqual_export" | "refi_qda" | string;
  createdByUsername: string;
  accessMode: "local" | "remote";
  active: boolean;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostgresProjectUser = {
  id: string;
  projectId: string;
  appUserId: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
};

export type PostgresProjectAiAssistSettings = {
  enabled: boolean;
  allowSemanticSearch: boolean;
  allowQuestionAnswering: boolean;
  allowSummaries: boolean;
  allowCodeSuggestions: boolean;
  allowDraftReports: boolean;
  embeddingChunkSize: number;
  embeddingOverlapSize: number;
  embeddingBatchSize: number;
  embeddingPrefixPassages: boolean;
  embeddingNormalizeWhitespace: boolean;
};

export type PostgresProjectAiAssistRuntimeStatus = {
  hostEmbeddingModelInstalled: boolean | null;
  hostLlmEnabled: boolean | null;
  hostLlmModelSelected: boolean | null;
  hostLlmConnectionLive: boolean | null;
  hostProjectEmbeddingsReady: boolean | null;
  hostCheckedAt: string;
};

export type PostgresEmbeddingModelStatus = {
  installed: boolean;
  repoId: string;
  displayName: string;
  modelDir: string;
  files: number;
  bytes: number;
  downloadedAtMs: number | null;
};

export type PostgresEmbeddingModelDownloadPreflight = {
  installed: boolean;
  modelDir: string;
  totalBytes: number;
  existingBytes: number;
  remainingBytes: number;
  totalFiles: number | null;
  existingFiles: number;
  remainingFiles: number | null;
  manifestAvailable: boolean;
  message: string | null;
};

export type PostgresEmbeddingModelDownloadStatus = {
  phase: "idle" | "downloading" | "cancelling" | "cancelled" | "completed" | "error";
  downloadedBytes: number;
  totalBytes: number | null;
  downloadedFiles: number;
  totalFiles: number;
  currentFile: string | null;
  progressPercent: number | null;
  message: string | null;
};

export type PostgresProjectDocumentImportSettings = {
  storeOriginalFileName: boolean;
};

export type PostgresCanvasPoint = {
  x: number;
  y: number;
};

export type PostgresCanvasNodeState = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PostgresCanvasStroke = {
  id: string;
  kind: "pen";
  points: PostgresCanvasPoint[];
  color: string;
  lineStyle: "solid" | "dashed" | "long_dashed" | "short_dashed" | "dotted" | "loose_dotted" | "dash_dot" | "dash_dot_dot";
  strokeWidth: number;
};

export type PostgresCanvasRect = {
  id: string;
  kind: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fillColor?: string;
  fillOpacity?: number;
  fill: "filled" | "outline";
  lineStyle: "solid" | "dashed" | "long_dashed" | "short_dashed" | "dotted" | "loose_dotted" | "dash_dot" | "dash_dot_dot";
  strokeWidth: number;
};

export type PostgresCanvasDisplayShape =
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

export type PostgresCanvasPlacedShape = {
  id: string;
  kind: "shape";
  shape: PostgresCanvasDisplayShape;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  fillColor?: string;
  fillOpacity?: number;
  fill: "filled" | "outline";
  lineStyle: "solid" | "dashed" | "long_dashed" | "short_dashed" | "dotted" | "loose_dotted" | "dash_dot" | "dash_dot_dot";
  strokeWidth: number;
};

export type PostgresCanvasText = {
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

export type PostgresCanvasShape =
  | PostgresCanvasStroke
  | PostgresCanvasRect
  | PostgresCanvasPlacedShape
  | PostgresCanvasText;

export type PostgresProjectCanvasState = {
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  nodes: PostgresCanvasNodeState[];
  shapes: PostgresCanvasShape[];
  hiddenRelationshipIds: string[];
};

export type PostgresSavedDrawing = {
  id: string;
  projectId: string;
  name: string;
  canvasKind: string;
  state: PostgresProjectCanvasState;
  createdAt: string;
  updatedAt: string;
};

export type PostgresSavedDrawingSummary = {
  id: string;
  projectId: string;
  name: string;
  canvasKind: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresSource = {
  id: string;
  projectId: string;
  sourceKind: string;
  title: string;
  originalFileName: string;
  storagePath: string;
  textContent: string;
  structuredContentJson: string;
  waveformPeaksJson: string;
  videoFrameIndexJson: string;
  extractedFromVideoSourceId: string;
  extractedFromVideoTimeMs: number | null;
  notes: string;
  shapeOverride: string;
  colorOverride: string;
  outlineColorOverride: string;
  fillOverride: string;
  fillTransparencyOverride: number | null;
  outlineWidthOverride: number | null;
  imageStoragePath: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresSourceTypeSetting = {
  projectId: string;
  sourceKind: string;
  name: string;
  description: string;
  shape: string;
  color: string;
  outlineColor: string;
  fill: string;
  fillTransparency: number;
  outlineWidth: number;
  imageStoragePath: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresSourceObjectLink = {
  sourceId: string;
  objectId: string;
  createdAt: string;
};

export type PostgresSourceLock = {
  id: string;
  sourceId: string;
  userId: string;
  userName: string;
  expiresAtMs: number;
  createdAt: string;
  updatedAt: string;
  reason?: "locked" | "kicked";
};

export type AcquirePostgresSourceLockResult = {
  ok: boolean;
  lock: PostgresSourceLock | null;
  conflict: PostgresSourceLock | null;
};

export type PostgresTimelineAttributeRole =
  | ""
  | "timeline_start"
  | "timeline_end"
  | "timeline_label"
  | "timeline_item_type"
  | "timeline_group";

export type PostgresSourceAttributeDefinition = {
  id: string;
  projectId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  sourceKinds: string[];
  timelineRole: PostgresTimelineAttributeRole;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresSourceAttributeValue = {
  id: string;
  sourceId: string;
  attributeDefinitionId: string;
  attributeName: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  value: string;
  sortOrder: number;
};

export type PostgresTimelineGroup = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  outlineColor: string;
  backgroundColor: string;
  shape: string;
  itemFill: string;
  itemFillTransparency: number;
  backgroundFill: string;
  itemTextColor: string;
  textSize: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresTimelineItemGroupAssignment = {
  itemKind: "source" | "object" | "relationship";
  itemId: string;
  groupId: string;
  updatedAt: string;
};

export type PostgresTimelineGroupRowOrder = {
  groupKey: string;
  sortOrder: number;
  updatedAt: string;
};

export type SavePostgresSourceAttributeResult = {
  attributeDefinition: PostgresSourceAttributeDefinition;
  values: PostgresSourceAttributeValue[];
};

export type PostgresCode = {
  id: string;
  projectId: string;
  label: string;
  color: string;
  description: string;
  shortcut: string;
  parentCodeId: string;
  sortOrder: number;
  createdByProjectUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresAnnotationSummary = {
  id: string;
  displayId: number;
  projectId: string;
  sourceId: string;
  sourceKind: string;
  codeIds: string[];
  primaryCodeId: string;
  primaryCodeLabel: string;
  startOffset: number | null;
  endOffset: number | null;
  timeStartMs: number | null;
  timeEndMs: number | null;
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
    pageNumber?: number | null;
  } | null;
  createdByProjectUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresMemo = {
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

export type PostgresReport = {
  id: string;
  projectId: string;
  title: string;
  reportType: string;
  settingsJson: string;
  contentJson: string;
  contentText: string;
  createdByProjectUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresAiAnalysis = {
  id: string;
  projectId: string;
  analysisType: string;
  targetCodeId: string;
  title: string;
  snapshotJson: string;
  resultJson: string;
  contentText: string;
  model: string;
  baseUrl: string;
  createdByProjectUserId: string;
  createdByName: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostgresAiJobType =
  | "project_chat"
  | "document_processing"
  | "attribute_suggestions"
  | "embedding_build"
  | "relevant_segments_search"
  | "code_conceptual_summary"
  | "most_typical_annotation"
  | "code_decomposition"
  | "code_position"
  | "code_unique_annotations";

export type PostgresAiJobStatus = "queued" | "running" | "completed" | "error";

export type PostgresAiJob = {
  id: string;
  projectId: string;
  jobType: PostgresAiJobType;
  status: PostgresAiJobStatus;
  requestJson: string;
  resultJson: string;
  errorMessage: string;
  hostMessage: string;
  createdByProjectUserId: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresProcessedDocumentReview = {
  id: string;
  projectId: string;
  sourceId: string;
  sourceTitle: string;
  storagePath: string;
  status: "pending_review" | "reviewed";
  processingStatus: "idle" | "running" | "partial" | "completed" | "error";
  processingError: string;
  processedChunkCount: number;
  processedContent: string;
  segmentsJson: string;
  properNameCandidatesJson: string;
  enabledReviewLensesJson: string;
  model: string;
  baseUrl: string;
  chunkCount: number;
  sourceContentHash: string;
  exportedToProject: boolean;
  createdByProjectUserId: string;
  createdByName: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostgresProjectAiChat = {
  id: string;
  projectId: string;
  title: string;
  createdByProjectUserId: string;
  createdByName: string;
  participantProjectUserIdsJson: string;
  lastMessageAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostgresProjectAiChatMessage = {
  id: string;
  projectId: string;
  chatId: string;
  role: string;
  text: string;
  metadataJson: string;
  createdByProjectUserId: string;
  createdByName: string;
  deletedAt: string | null;
  createdAt: string;
};

export type PostgresObjectType = {
  id: string;
  projectId: string;
  systemKey: string | null;
  name: string;
  description: string;
  shape: string;
  color: string;
  outlineColor: string;
  fill: string;
  fillTransparency: number;
  outlineWidth: number;
  imageStoragePath: string;
  createdAt: string;
  updatedAt: string;
};

export type PostgresObject = {
  id: string;
  projectId: string;
  objectTypeId: string;
  objectType: string;
  objectTypeSystemKey: string | null;
  title: string;
  description: string;
  shapeOverride: string;
  colorOverride: string;
  outlineColorOverride: string;
  fillOverride: string;
  fillTransparencyOverride: number | null;
  outlineWidthOverride: number | null;
  imageStoragePath: string;
  eventStartAt: string | null;
  eventEndAt: string | null;
  eventTimePrecision: string | null;
  eventTimezone: string | null;
  eventIsInstant: boolean | null;
  attributeValues: PostgresObjectAttributeValue[];
  createdAt: string;
  updatedAt: string;
};

export type PostgresObjectAttributeDefinition = {
  id: string;
  projectId: string;
  objectTypeId: string;
  objectType: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  timelineRole: PostgresTimelineAttributeRole;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresObjectAttributeValue = {
  id: string;
  objectId: string;
  attributeDefinitionId: string;
  attributeName: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  value: string;
  sortOrder: number;
};

export type PostgresAttributeValueChangeMetadata = {
  aiAssistRelated?: boolean;
  aiAssistAction?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type PostgresAttributeValueHistoryOwnerKind = "source" | "object" | "relationship";

export type PostgresAttributeValueHistoryEntry = {
  id: string;
  ownerKind: PostgresAttributeValueHistoryOwnerKind;
  ownerId: string;
  attributeDefinitionId: string;
  attributeValueId: string | null;
  previousValue: string;
  newValue: string;
  changeAction: string;
  aiAssistRelated: boolean;
  aiAssistAction: string;
  changedByUserId: string;
  changedByName: string;
  metadataJson: string;
  changedAt: string;
};

export type PostgresObjectTypeSaveResult = {
  objectType: PostgresObjectType;
  attributeDefinitions: PostgresObjectAttributeDefinition[];
  created: boolean;
};

export type PostgresRelationshipType = {
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
  fromSourceKinds: string[];
  toSourceKinds: string[];
  createdAt: string;
  updatedAt: string;
};

export type PostgresRelationshipEndpointType = "object" | "source";

export type PostgresRelationship = {
  id: string;
  projectId: string;
  fromObjectId: string;
  toObjectId: string;
  fromEntityType: PostgresRelationshipEndpointType;
  fromEntityId: string;
  toEntityType: PostgresRelationshipEndpointType;
  toEntityId: string;
  fromEntityName: string;
  toEntityName: string;
  relationshipTypeId: string;
  relationshipType: string;
  description: string;
  lineShapeOverride: string;
  lineWeightOverride: number | null;
  arrowheadOverride: string;
  colorOverride: string;
  attributeValues: PostgresRelationshipAttributeValue[];
  createdAt: string;
  updatedAt: string;
};

export type PostgresRelationshipAttributeDefinition = {
  id: string;
  projectId: string;
  relationshipTypeId: string;
  relationshipType: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  timelineRole: PostgresTimelineAttributeRole;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresRelationshipAttributeValue = {
  id: string;
  relationshipId: string;
  attributeDefinitionId: string;
  attributeName: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  value: string;
  sortOrder: number;
};

export type PostgresRelationshipTypeSaveResult = {
  relationshipType: PostgresRelationshipType;
  attributeDefinitions: PostgresRelationshipAttributeDefinition[];
  created: boolean;
};

export type PostgresProjectChangeEvent = {
  projectId: string;
  entityType: string;
  entityId: string;
  changeKind: string;
};

export type PostgresProjectLogEntry = {
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

export type PostgresAdminProjectLogEntry = PostgresProjectLogEntry & {
  projectName: string;
};

export type PostgresAuthAuditEntry = {
  id: string;
  timestampMs: number;
  event: string;
  outcome: string;
  message: string;
  authKind?: string;
  userId?: string;
  username?: string;
  clientIp?: string;
  role?: string;
  reason?: string;
  detailsJson?: string;
};

export async function ensurePostgresSchema(): Promise<PostgresSchemaMigrationResult> {
  return invoke<PostgresSchemaMigrationResult>("ensure_postgres_experiment_schema_command");
}

export async function getPostgresAuthStatus(): Promise<PostgresAuthStatus> {
  return invoke<PostgresAuthStatus>("get_postgres_experiment_auth_status_command");
}

export async function getPostgresInstallationSettings(): Promise<PostgresInstallationSettings> {
  return invoke<PostgresInstallationSettings>("get_postgres_experiment_installation_settings_command");
}

export async function listPostgresEnabledAiLlmCatalog(): Promise<PostgresAiLlmCatalogEntry[]> {
  return invoke<PostgresAiLlmCatalogEntry[]>("list_postgres_experiment_enabled_ai_llm_catalog_command");
}

export async function savePostgresInstallationSettings(
  settings: PostgresInstallationSettings,
  projectId?: string,
): Promise<PostgresInstallationSettings> {
  return invoke<PostgresInstallationSettings>("save_postgres_experiment_installation_settings_command", {
    settings,
    projectId,
  });
}

export async function createPostgresUpgradeBackup(
  adminPassword: string,
  outputPath?: string,
): Promise<PostgresUpgradeBackupResult> {
  return invoke<PostgresUpgradeBackupResult>("create_postgres_experiment_upgrade_backup_command", {
    request: {
      adminPassword,
      outputPath,
    },
  });
}

export async function listPostgresUpgradeBackupDiagnostics(): Promise<PostgresUpgradeBackupDiagnostics> {
  return invoke<PostgresUpgradeBackupDiagnostics>("list_postgres_experiment_upgrade_backup_diagnostics_command");
}

export async function restorePostgresUpgradeBackup(data: {
  backupPath: string;
  backupPassword: string;
  newAdminPassword: string;
}): Promise<RestorePostgresUpgradeBackupResult> {
  return invoke<RestorePostgresUpgradeBackupResult>("restore_postgres_experiment_upgrade_backup_command", {
    request: data,
  });
}

export async function exportPostgresProjectLosslessBundle(projectId: string): Promise<PostgresProjectExportBundle> {
  return invoke<PostgresProjectExportBundle>("export_postgres_experiment_project_lossless_bundle_command", {
    projectId,
  });
}

export async function getPostgresUserPreferences(): Promise<PostgresUserPreferences> {
  return invoke<PostgresUserPreferences>("get_postgres_experiment_user_preferences_command");
}

export async function savePostgresUserPreferences(
  preferences: PostgresUserPreferences,
): Promise<PostgresUserPreferences> {
  return invoke<PostgresUserPreferences>("save_postgres_experiment_user_preferences_command", {
    preferences,
  });
}

export async function getPostgresDeviceState(): Promise<PostgresDeviceState> {
  return invoke<PostgresDeviceState>("get_postgres_experiment_device_state_command");
}

export async function savePostgresDeviceState(
  state: PostgresDeviceState,
): Promise<PostgresDeviceState> {
  return invoke<PostgresDeviceState>("save_postgres_experiment_device_state_command", {
    state,
  });
}

export async function listPostgresRememberedAccounts(): Promise<PostgresRememberedAccount[]> {
  return invoke<PostgresRememberedAccount[]>("list_postgres_experiment_remembered_accounts_command");
}

export async function rememberPostgresAccount(email: string, name: string): Promise<void> {
  await invoke("remember_postgres_experiment_account_command", {
    email,
    name,
  });
}

export async function renamePostgresRememberedAccount(
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

export async function clearPostgresRememberedAccounts(): Promise<void> {
  await invoke("clear_postgres_experiment_remembered_accounts_command");
}

export async function getPostgresUserProjectState(): Promise<PostgresUserProjectState> {
  return invoke<PostgresUserProjectState>("get_postgres_experiment_user_project_state_command");
}

export async function rememberPostgresProjectOpened(
  project: PostgresRecentProject,
): Promise<PostgresUserProjectState> {
  return invoke<PostgresUserProjectState>("remember_postgres_experiment_project_opened_command", {
    project,
  });
}

export async function rememberPostgresProjectClosed(
  projectId: string,
): Promise<void> {
  await invoke("remember_postgres_experiment_project_closed_command", {
    projectId,
  });
}

export async function removePostgresProjectFromState(
  projectId: string,
): Promise<PostgresUserProjectState> {
  return invoke<PostgresUserProjectState>("remove_postgres_experiment_project_from_state_command", {
    projectId,
  });
}

export async function clearPostgresUserProjectState(): Promise<void> {
  await invoke("clear_postgres_experiment_user_project_state_command");
}

export async function createPostgresAppUser(data: {
  name: string;
  username: string;
  password: string;
  mustChangePassword?: boolean;
}): Promise<PostgresAppUser> {
  return invoke<PostgresAppUser>("create_postgres_experiment_app_user_command", {
    request: data,
  });
}

export async function loginPostgresAppUser(data: {
  username: string;
  password: string;
  rememberSession: boolean;
}): Promise<PostgresAuthSession> {
  return invoke<PostgresAuthSession>("login_postgres_experiment_app_user_command", {
    request: data,
  });
}

export async function loginPostgresAdmin(data: {
  password: string;
  rememberSession: boolean;
}): Promise<PostgresAuthSession> {
  return invoke<PostgresAuthSession>("login_postgres_experiment_admin_command", {
    request: data,
  });
}

export async function logoutPostgresAppUser(): Promise<PostgresAuthStatus> {
  return invoke<PostgresAuthStatus>("logout_postgres_experiment_app_user_command");
}

export async function updatePostgresAppUserProfile(data: {
  name: string;
  username: string;
}): Promise<PostgresAppUser> {
  return invoke<PostgresAppUser>("update_postgres_experiment_app_user_profile_command", {
    request: data,
  });
}

export async function changePostgresAppUserPassword(data: {
  currentPassword: string;
  newPassword: string;
}): Promise<PostgresAuthStatus> {
  return invoke<PostgresAuthStatus>("change_postgres_experiment_app_user_password_command", {
    request: data,
  });
}

export async function deactivatePostgresAppUser(userId: string): Promise<PostgresAppUser> {
  return invoke<PostgresAppUser>("deactivate_postgres_experiment_app_user_command", {
    request: { userId },
  });
}

export async function reactivatePostgresAppUser(userId: string): Promise<PostgresAppUser> {
  return invoke<PostgresAppUser>("reactivate_postgres_experiment_app_user_command", {
    request: { userId },
  });
}

export async function resetPostgresAppUserPassword(data: {
  userId: string;
  newPassword: string;
}): Promise<PostgresAppUser> {
  return invoke<PostgresAppUser>("reset_postgres_experiment_app_user_password_command", {
    request: data,
  });
}

export async function listPostgresAppUsers(): Promise<PostgresAppUser[]> {
  return invoke<PostgresAppUser[]>("list_postgres_experiment_app_users_command");
}

export async function listPostgresProjects(): Promise<PostgresProject[]> {
  return invoke<PostgresProject[]>("list_postgres_experiment_projects_command");
}

export async function createPostgresProject(data: {
  name: string;
  description: string;
}): Promise<PostgresProject> {
  return invoke<PostgresProject>("create_postgres_experiment_project_command", {
    request: data,
  });
}

export async function updatePostgresProject(data: {
  projectId: string;
  name: string;
  description: string;
}): Promise<PostgresProject> {
  return invoke<PostgresProject>("update_postgres_experiment_project_command", {
    request: data,
  });
}

export async function setPostgresProjectActive(
  projectId: string,
  active: boolean,
): Promise<PostgresProject> {
  return invoke<PostgresProject>("set_postgres_experiment_project_active_command", {
    projectId,
    active,
  });
}

export async function deletePostgresProject(projectId: string): Promise<void> {
  await invoke("delete_postgres_experiment_project_command", {
    projectId,
  });
}

export async function listPostgresProjectUsers(projectId: string): Promise<PostgresProjectUser[]> {
  return invoke<PostgresProjectUser[]>("list_postgres_experiment_project_users_command", {
    projectId,
  });
}

export async function createPostgresProjectUser(data: {
  projectId: string;
  appUserId: string;
  role: string;
}): Promise<PostgresProjectUser> {
  return invoke<PostgresProjectUser>("create_postgres_experiment_project_user_command", {
    request: data,
  });
}

export async function updatePostgresProjectUser(data: {
  projectId: string;
  projectUserId: string;
  role: string;
}): Promise<PostgresProjectUser> {
  return invoke<PostgresProjectUser>("update_postgres_experiment_project_user_command", {
    request: data,
  });
}

export async function deletePostgresProjectUser(projectId: string, projectUserId: string): Promise<void> {
  await invoke("delete_postgres_experiment_project_user_command", {
    projectId,
    projectUserId,
  });
}

export async function getPostgresProjectAiAssistSettings(
  projectId: string,
): Promise<PostgresProjectAiAssistSettings> {
  return invoke<PostgresProjectAiAssistSettings>(
    "get_postgres_experiment_project_ai_assist_settings_command",
    {
      projectId,
    },
  );
}

export async function getPostgresProjectAiAssistRuntimeStatus(
  projectId: string,
): Promise<PostgresProjectAiAssistRuntimeStatus> {
  return invoke<PostgresProjectAiAssistRuntimeStatus>(
    "get_postgres_experiment_project_ai_assist_runtime_status_command",
    {
      projectId,
    },
  );
}

export async function savePostgresProjectAiAssistSettings(data: {
  projectId: string;
  settings: PostgresProjectAiAssistSettings;
}): Promise<PostgresProjectAiAssistSettings> {
  return invoke<PostgresProjectAiAssistSettings>(
    "save_postgres_experiment_project_ai_assist_settings_command",
    {
      request: data,
    },
  );
}

export async function getPostgresEmbeddingModelStatus(): Promise<PostgresEmbeddingModelStatus> {
  return invoke<PostgresEmbeddingModelStatus>("get_multilingual_e5_status");
}

export async function getPostgresEmbeddingModelDownloadPreflight(): Promise<PostgresEmbeddingModelDownloadPreflight> {
  return invoke<PostgresEmbeddingModelDownloadPreflight>("get_multilingual_e5_download_preflight");
}

export async function getPostgresEmbeddingModelDownloadStatus(): Promise<PostgresEmbeddingModelDownloadStatus> {
  return invoke<PostgresEmbeddingModelDownloadStatus>("get_multilingual_e5_download_status");
}

export async function downloadPostgresEmbeddingModel(): Promise<PostgresEmbeddingModelStatus> {
  return invoke<PostgresEmbeddingModelStatus>(
    "download_postgres_experiment_multilingual_e5_model_command",
  );
}

export async function downloadPostgresCustomEmbeddingModel(modelUrl: string): Promise<PostgresEmbeddingModelStatus> {
  return invoke<PostgresEmbeddingModelStatus>(
    "download_postgres_experiment_custom_embedding_model_command",
    {
      request: { modelUrl },
    },
  );
}

export async function importPostgresEmbeddingModelFolder(sourceDir: string): Promise<PostgresEmbeddingModelStatus> {
  return invoke<PostgresEmbeddingModelStatus>(
    "import_postgres_experiment_embedding_model_folder_command",
    {
      request: { sourceDir },
    },
  );
}

export async function cancelPostgresEmbeddingModelDownload(): Promise<PostgresEmbeddingModelDownloadStatus> {
  return invoke<PostgresEmbeddingModelDownloadStatus>(
    "cancel_postgres_experiment_multilingual_e5_download_command",
  );
}

export async function clearPostgresEmbeddingModel(): Promise<PostgresEmbeddingModelStatus> {
  return invoke<PostgresEmbeddingModelStatus>(
    "clear_postgres_experiment_multilingual_e5_model_command",
  );
}

export async function buildPostgresProjectEmbeddingStore(data: {
  projectId: string;
  batchSize: number;
  chunkSize: number;
  overlapSize: number;
  prefixPassages: boolean;
  normalizeWhitespace: boolean;
  sources: ProjectEmbeddingBuildSource[];
}): Promise<ProjectEmbeddingBuildStatus> {
  return invoke<ProjectEmbeddingBuildStatus>(
    "build_postgres_experiment_project_embedding_store_command",
    {
      request: data,
    },
  );
}

export async function cancelPostgresProjectEmbeddingStoreBuild(): Promise<ProjectEmbeddingBuildStatus> {
  return invoke<ProjectEmbeddingBuildStatus>(
    "cancel_postgres_experiment_project_embedding_store_build_command",
  );
}

export async function deletePostgresProjectEmbeddingStore(
  projectId: string,
): Promise<ProjectEmbeddingStoreStatus> {
  return invoke<ProjectEmbeddingStoreStatus>(
    "delete_postgres_experiment_project_embedding_store_command",
    {
      projectId,
    },
  );
}

export async function getPostgresProjectDocumentImportSettings(
  projectId: string,
): Promise<PostgresProjectDocumentImportSettings> {
  return invoke<PostgresProjectDocumentImportSettings>(
    "get_postgres_experiment_project_document_import_settings_command",
    {
      projectId,
    },
  );
}

export async function savePostgresProjectDocumentImportSettings(data: {
  projectId: string;
  settings: PostgresProjectDocumentImportSettings;
}): Promise<PostgresProjectDocumentImportSettings> {
  return invoke<PostgresProjectDocumentImportSettings>(
    "save_postgres_experiment_project_document_import_settings_command",
    {
      request: data,
    },
  );
}

export async function getPostgresProjectCanvasState(
  projectId: string,
): Promise<PostgresProjectCanvasState> {
  return invoke<PostgresProjectCanvasState>(
    "get_postgres_experiment_project_canvas_state_command",
    {
      projectId,
    },
  );
}

export async function savePostgresProjectCanvasState(data: {
  projectId: string;
  state: PostgresProjectCanvasState;
}): Promise<PostgresProjectCanvasState> {
  return invoke<PostgresProjectCanvasState>(
    "save_postgres_experiment_project_canvas_state_command",
    {
      request: data,
    },
  );
}

export async function savePostgresSavedDrawing(data: {
  projectId: string;
  drawingId?: string | null;
  name?: string | null;
  canvasKind?: string | null;
  state: PostgresProjectCanvasState;
}): Promise<PostgresSavedDrawing> {
  return invoke<PostgresSavedDrawing>("save_postgres_experiment_saved_drawing_command", {
    request: data,
  });
}

export async function listPostgresSavedDrawings(
  projectId: string,
): Promise<PostgresSavedDrawing[]> {
  return invoke<PostgresSavedDrawing[]>("list_postgres_experiment_saved_drawings_command", {
    projectId,
  });
}

export async function listPostgresSavedDrawingSummaries(
  projectId: string,
): Promise<PostgresSavedDrawingSummary[]> {
  return invoke<PostgresSavedDrawingSummary[]>(
    "list_postgres_experiment_saved_drawing_summaries_command",
    {
      projectId,
    },
  );
}

export async function getPostgresSavedDrawing(
  projectId: string,
  drawingId: string,
): Promise<PostgresSavedDrawing> {
  return invoke<PostgresSavedDrawing>("get_postgres_experiment_saved_drawing_command", {
    projectId,
    drawingId,
  });
}

export async function deletePostgresSavedDrawing(
  projectId: string,
  drawingId: string,
): Promise<void> {
  await invoke("delete_postgres_experiment_saved_drawing_command", {
    projectId,
    drawingId,
  });
}

export async function listPostgresSources(projectId: string): Promise<PostgresSource[]> {
  return invoke<PostgresSource[]>("list_postgres_experiment_sources_command", {
    projectId,
  });
}

export async function createPostgresSource(data: {
  projectId: string;
  sourceKind: string;
  title: string;
  originalFileName?: string | null;
  storagePath?: string | null;
  textContent: string;
  structuredContentJson?: string | null;
  waveformPeaksJson?: string | null;
  videoFrameIndexJson?: string | null;
  extractedFromVideoSourceId?: string | null;
  extractedFromVideoTimeMs?: number | null;
  notes?: string | null;
  shapeOverride?: string | null;
  colorOverride?: string | null;
  outlineColorOverride?: string | null;
  fillOverride?: string | null;
  fillTransparencyOverride?: number | null;
  outlineWidthOverride?: number | null;
  imageStoragePath?: string | null;
}): Promise<PostgresSource> {
  return invoke<PostgresSource>("create_postgres_experiment_source_command", {
    request: data,
  });
}

export async function importPostgresSourceFile(data: {
  projectId: string;
  sourceKind: string;
  title: string;
  originalFileName: string;
  mediaType?: string | null;
  fileBytesBase64: string;
  textContent: string;
  structuredContentJson?: string | null;
  waveformPeaksJson?: string | null;
  videoFrameIndexJson?: string | null;
  extractedFromVideoSourceId?: string | null;
  extractedFromVideoTimeMs?: number | null;
  notes?: string | null;
  shapeOverride?: string | null;
  colorOverride?: string | null;
  outlineColorOverride?: string | null;
  fillOverride?: string | null;
  fillTransparencyOverride?: number | null;
  outlineWidthOverride?: number | null;
  imageStoragePath?: string | null;
}): Promise<PostgresSource> {
  return invoke<PostgresSource>("import_postgres_experiment_source_file_command", {
    request: data,
  });
}

export async function updatePostgresSource(data: {
  projectId: string;
  sourceId: string;
  sourceKind: string;
  title: string;
  originalFileName?: string | null;
  storagePath?: string | null;
  textContent: string;
  structuredContentJson?: string | null;
  waveformPeaksJson?: string | null;
  videoFrameIndexJson?: string | null;
  extractedFromVideoSourceId?: string | null;
  extractedFromVideoTimeMs?: number | null;
  notes?: string | null;
  shapeOverride?: string | null;
  colorOverride?: string | null;
  outlineColorOverride?: string | null;
  fillOverride?: string | null;
  fillTransparencyOverride?: number | null;
  outlineWidthOverride?: number | null;
  imageStoragePath?: string | null;
}): Promise<PostgresSource> {
  return invoke<PostgresSource>("update_postgres_experiment_source_command", {
    request: data,
  });
}

export async function deletePostgresSource(projectId: string, sourceId: string): Promise<void> {
  await invoke("delete_postgres_experiment_source_command", {
    projectId,
    sourceId,
  });
}

export async function listPostgresSourceTypeSettings(
  projectId: string,
): Promise<PostgresSourceTypeSetting[]> {
  return invoke<PostgresSourceTypeSetting[]>("list_postgres_experiment_source_type_settings_command", {
    projectId,
  });
}

export async function savePostgresSourceTypeSetting(data: {
  projectId: string;
  sourceKind: string;
  name: string;
  description?: string | null;
  shape: string;
  color: string;
  outlineColor?: string | null;
  fill: string;
  fillTransparency?: number | null;
  outlineWidth?: number | null;
  imageStoragePath?: string | null;
}): Promise<PostgresSourceTypeSetting> {
  return invoke<PostgresSourceTypeSetting>("save_postgres_experiment_source_type_setting_command", {
    request: data,
  });
}

export async function importPostgresSourceTypeImage(data: {
  projectId: string;
  sourceKind: string;
  originalFileName: string;
  fileBytesBase64: string;
}): Promise<PostgresSourceTypeSetting> {
  return invoke<PostgresSourceTypeSetting>("import_postgres_experiment_source_type_image_command", {
    request: data,
  });
}

export async function removePostgresSourceTypeImage(
  projectId: string,
  sourceKind: string,
): Promise<PostgresSourceTypeSetting> {
  return invoke<PostgresSourceTypeSetting>("remove_postgres_experiment_source_type_image_command", {
    projectId,
    sourceKind,
  });
}

export async function listPostgresSourceLocks(
  projectId: string,
): Promise<PostgresSourceLock[]> {
  return invoke<PostgresSourceLock[]>("list_postgres_experiment_source_locks_command", {
    projectId,
  });
}

export async function acquirePostgresSourceLock(data: {
  projectId: string;
  sourceId: string;
}): Promise<AcquirePostgresSourceLockResult> {
  return invoke<AcquirePostgresSourceLockResult>("acquire_postgres_experiment_source_lock_command", {
    request: data,
  });
}

export async function releasePostgresSourceLock(
  projectId: string,
  lockId: string,
): Promise<void> {
  await invoke("release_postgres_experiment_source_lock_command", {
    projectId,
    lockId,
  });
}

export async function kickPostgresSourceLock(data: {
  projectId: string;
  sourceId: string;
  lockId: string;
}): Promise<void> {
  await invoke("kick_postgres_experiment_source_lock_command", {
    request: data,
  });
}

export async function listPostgresSourceObjectLinks(
  projectId: string,
): Promise<PostgresSourceObjectLink[]> {
  return invoke<PostgresSourceObjectLink[]>("list_postgres_experiment_source_object_links_command", {
    projectId,
  });
}

export async function listPostgresSourceAttributeDefinitions(
  projectId: string,
): Promise<PostgresSourceAttributeDefinition[]> {
  return invoke<PostgresSourceAttributeDefinition[]>("list_postgres_experiment_source_attribute_definitions_command", {
    projectId,
  });
}

export async function listPostgresSourceAttributeValues(
  projectId: string,
): Promise<PostgresSourceAttributeValue[]> {
  return invoke<PostgresSourceAttributeValue[]>("list_postgres_experiment_source_attribute_values_command", {
    projectId,
  });
}

export async function listPostgresAttributeValueHistory(data: {
  projectId: string;
  ownerKind: PostgresAttributeValueHistoryOwnerKind;
  ownerId: string;
  attributeDefinitionId: string;
}): Promise<PostgresAttributeValueHistoryEntry[]> {
  return invoke<PostgresAttributeValueHistoryEntry[]>("list_postgres_experiment_attribute_value_history_command", {
    request: data,
  });
}

export async function listPostgresTimelineGroups(projectId: string): Promise<PostgresTimelineGroup[]> {
  return invoke<PostgresTimelineGroup[]>("list_postgres_experiment_timeline_groups_command", {
    projectId,
  });
}

export async function listPostgresTimelineItemGroupAssignments(
  projectId: string,
): Promise<PostgresTimelineItemGroupAssignment[]> {
  return invoke<PostgresTimelineItemGroupAssignment[]>("list_postgres_experiment_timeline_item_group_assignments_command", {
    projectId,
  });
}

export async function listPostgresTimelineGroupRowOrders(
  projectId: string,
): Promise<PostgresTimelineGroupRowOrder[]> {
  return invoke<PostgresTimelineGroupRowOrder[]>("list_postgres_experiment_timeline_group_row_orders_command", {
    projectId,
  });
}

export async function savePostgresTimelineGroup(data: {
  projectId: string;
  groupId?: string | null;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  outlineColor?: string | null;
  backgroundColor?: string | null;
  itemFill?: string | null;
  itemFillTransparency?: number | null;
  backgroundFill?: string | null;
  itemTextColor?: string | null;
  textSize?: string | null;
}): Promise<PostgresTimelineGroup> {
  return invoke<PostgresTimelineGroup>("save_postgres_experiment_timeline_group_command", {
    request: data,
  });
}

export async function deletePostgresTimelineGroup(projectId: string, groupId: string): Promise<void> {
  await invoke("delete_postgres_experiment_timeline_group_command", {
    projectId,
    groupId,
  });
}

export async function reorderPostgresTimelineGroups(projectId: string, groupIds: string[]): Promise<PostgresTimelineGroup[]> {
  return invoke<PostgresTimelineGroup[]>("reorder_postgres_experiment_timeline_groups_command", {
    request: {
      projectId,
      groupIds,
    },
  });
}

export async function reorderPostgresTimelineGroupRows(
  projectId: string,
  groupKeys: string[],
): Promise<PostgresTimelineGroupRowOrder[]> {
  return invoke<PostgresTimelineGroupRowOrder[]>("reorder_postgres_experiment_timeline_group_rows_command", {
    request: {
      projectId,
      groupKeys,
    },
  });
}

export async function setPostgresTimelineItemGroup(data: {
  projectId: string;
  itemKind: "source" | "object" | "relationship";
  itemId: string;
  groupId?: string | null;
}): Promise<void> {
  await invoke("set_postgres_experiment_timeline_item_group_command", {
    request: data,
  });
}

export async function savePostgresSourceAttribute(data: {
  projectId: string;
  attributeDefinitionId?: string | null;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  timelineRole?: PostgresTimelineAttributeRole | null;
  sourceKinds?: string[];
  values: Array<{
    sourceId: string;
    value: string;
  }>;
  attributeValueChange?: PostgresAttributeValueChangeMetadata | null;
}): Promise<SavePostgresSourceAttributeResult> {
  return invoke<SavePostgresSourceAttributeResult>("save_postgres_experiment_source_attribute_command", {
    request: data,
  });
}

export async function deletePostgresSourceAttributeDefinition(
  projectId: string,
  attributeDefinitionId: string,
): Promise<void> {
  await invoke("delete_postgres_experiment_source_attribute_definition_command", {
    projectId,
    attributeDefinitionId,
  });
}

export async function listPostgresCodes(projectId: string): Promise<PostgresCode[]> {
  return invoke<PostgresCode[]>("list_postgres_experiment_codes_command", {
    projectId,
  });
}

export async function createPostgresCode(data: {
  projectId: string;
  label: string;
  color?: string | null;
  description?: string | null;
  shortcut?: string | null;
  parentCodeId?: string | null;
}): Promise<PostgresCode> {
  return invoke<PostgresCode>("create_postgres_experiment_code_command", {
    request: data,
  });
}

export async function updatePostgresCode(data: {
  projectId: string;
  codeId: string;
  label: string;
  color?: string | null;
  description?: string | null;
  shortcut?: string | null;
  parentCodeId?: string | null;
}): Promise<PostgresCode> {
  return invoke<PostgresCode>("update_postgres_experiment_code_command", {
    request: data,
  });
}

export async function deletePostgresCode(projectId: string, codeId: string): Promise<void> {
  await invoke("delete_postgres_experiment_code_command", {
    projectId,
    codeId,
  });
}

export async function listPostgresAnnotationSummaries(
  projectId: string,
): Promise<PostgresAnnotationSummary[]> {
  return invoke<PostgresAnnotationSummary[]>("list_postgres_experiment_annotation_summaries_command", {
    projectId,
  });
}

export async function createPostgresAnnotation(data: {
  projectId: string;
  sourceId: string;
  codeIds: string[];
  startOffset?: number | null;
  endOffset?: number | null;
  timeStartMs?: number | null;
  timeEndMs?: number | null;
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
    pageNumber?: number | null;
  } | null;
}): Promise<PostgresAnnotationSummary> {
  return invoke<PostgresAnnotationSummary>("create_postgres_experiment_annotation_command", {
    request: data,
  });
}

export async function updatePostgresAnnotation(data: {
  projectId: string;
  annotationId: string;
  codeIds: string[];
  startOffset?: number | null;
  endOffset?: number | null;
  timeStartMs?: number | null;
  timeEndMs?: number | null;
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
    pageNumber?: number | null;
  } | null;
}): Promise<PostgresAnnotationSummary> {
  return invoke<PostgresAnnotationSummary>("update_postgres_experiment_annotation_command", {
    request: data,
  });
}

export async function deletePostgresAnnotation(projectId: string, annotationId: string): Promise<void> {
  await invoke("delete_postgres_experiment_annotation_command", {
    projectId,
    annotationId,
  });
}

export async function listPostgresProjectLog(
  projectId: string,
): Promise<PostgresProjectLogEntry[]> {
  return invoke<PostgresProjectLogEntry[]>("list_postgres_experiment_project_log_command", {
    projectId,
  });
}

export async function listPostgresAdminProjectAuditLog(): Promise<PostgresAdminProjectLogEntry[]> {
  return invoke<PostgresAdminProjectLogEntry[]>("list_postgres_experiment_admin_project_audit_log_command");
}

export async function listPostgresAdminAuthAuditLog(): Promise<PostgresAuthAuditEntry[]> {
  return invoke<PostgresAuthAuditEntry[]>("list_postgres_experiment_admin_auth_audit_log_command");
}

export async function listPostgresMemos(projectId: string): Promise<PostgresMemo[]> {
  return invoke<PostgresMemo[]>("list_postgres_experiment_memos_command", {
    projectId,
  });
}

export async function createPostgresMemo(data: {
  projectId: string;
  title: string;
  body?: string | null;
  sourceIds?: string[];
  annotationIds?: string[];
  codeIds?: string[];
  objectIds?: string[];
}): Promise<PostgresMemo> {
  return invoke<PostgresMemo>("create_postgres_experiment_memo_command", {
    request: data,
  });
}

export async function updatePostgresMemo(data: {
  projectId: string;
  memoId: string;
  title: string;
  body?: string | null;
  sourceIds?: string[];
  annotationIds?: string[];
  codeIds?: string[];
  objectIds?: string[];
}): Promise<PostgresMemo> {
  return invoke<PostgresMemo>("update_postgres_experiment_memo_command", {
    request: data,
  });
}

export async function deletePostgresMemo(projectId: string, memoId: string): Promise<void> {
  await invoke("delete_postgres_experiment_memo_command", {
    projectId,
    memoId,
  });
}

export async function listPostgresReports(projectId: string): Promise<PostgresReport[]> {
  return invoke<PostgresReport[]>("list_postgres_experiment_reports_command", {
    projectId,
  });
}

export async function createPostgresReport(data: {
  projectId: string;
  title: string;
  reportType: string;
  settingsJson?: string | null;
  contentJson?: string | null;
  contentText?: string | null;
}): Promise<PostgresReport> {
  return invoke<PostgresReport>("create_postgres_experiment_report_command", {
    request: data,
  });
}

export async function updatePostgresReport(data: {
  projectId: string;
  reportId: string;
  title: string;
  reportType: string;
  settingsJson?: string | null;
  contentJson?: string | null;
  contentText?: string | null;
}): Promise<PostgresReport> {
  return invoke<PostgresReport>("update_postgres_experiment_report_command", {
    request: data,
  });
}

export async function deletePostgresReport(projectId: string, reportId: string): Promise<void> {
  await invoke("delete_postgres_experiment_report_command", {
    projectId,
    reportId,
  });
}

export async function logPostgresReportExport(data: {
  projectId: string;
  reportId?: string | null;
  title: string;
  reportType: string;
  format: string;
  filePath?: string | null;
}): Promise<void> {
  await invoke("log_postgres_experiment_report_export_command", {
    request: data,
  });
}

export async function listPostgresAiAnalyses(projectId: string): Promise<PostgresAiAnalysis[]> {
  return invoke<PostgresAiAnalysis[]>("list_postgres_experiment_ai_analyses_command", {
    projectId,
  });
}

export async function createPostgresAiAnalysis(data: {
  projectId: string;
  analysisType?: string | null;
  targetCodeId?: string | null;
  title: string;
  snapshotJson?: string | null;
  resultJson?: string | null;
  contentText?: string | null;
  model?: string | null;
  baseUrl?: string | null;
}): Promise<PostgresAiAnalysis> {
  return invoke<PostgresAiAnalysis>("create_postgres_experiment_ai_analysis_command", {
    request: data,
  });
}

export async function updatePostgresAiAnalysis(data: {
  projectId: string;
  analysisId: string;
  analysisType?: string | null;
  targetCodeId?: string | null;
  title: string;
  snapshotJson?: string | null;
  resultJson?: string | null;
  contentText?: string | null;
  model?: string | null;
  baseUrl?: string | null;
}): Promise<PostgresAiAnalysis> {
  return invoke<PostgresAiAnalysis>("update_postgres_experiment_ai_analysis_command", {
    request: data,
  });
}

export async function deletePostgresAiAnalysis(projectId: string, analysisId: string): Promise<void> {
  await invoke("delete_postgres_experiment_ai_analysis_command", {
    projectId,
    analysisId,
  });
}

export async function listPostgresAiJobs(
  projectId: string,
  jobType?: PostgresAiJobType | null,
): Promise<PostgresAiJob[]> {
  return invoke<PostgresAiJob[]>("list_postgres_experiment_ai_jobs_command", {
    projectId,
    jobType,
  });
}

export async function getPostgresAiJob(projectId: string, jobId: string): Promise<PostgresAiJob> {
  return invoke<PostgresAiJob>("get_postgres_experiment_ai_job_command", {
    projectId,
    jobId,
  });
}

export async function createPostgresAiJob(data: {
  projectId: string;
  jobType: PostgresAiJobType;
  requestJson?: string | null;
}): Promise<PostgresAiJob> {
  return invoke<PostgresAiJob>("create_postgres_experiment_ai_job_command", {
    request: data,
  });
}

export async function updatePostgresAiJob(data: {
  projectId: string;
  jobId: string;
  status: PostgresAiJobStatus;
  resultJson?: string | null;
  errorMessage?: string | null;
  hostMessage?: string | null;
}): Promise<PostgresAiJob> {
  return invoke<PostgresAiJob>("update_postgres_experiment_ai_job_command", {
    request: data,
  });
}

export async function cancelPostgresAiJob(
  projectId: string,
  jobId: string,
  message: string,
): Promise<PostgresAiJob> {
  return invoke<PostgresAiJob>("cancel_postgres_experiment_ai_job_command", {
    projectId,
    jobId,
    message,
  });
}

export async function listPostgresProcessedDocumentReviews(
  projectId: string,
): Promise<PostgresProcessedDocumentReview[]> {
  return invoke<PostgresProcessedDocumentReview[]>("list_postgres_experiment_processed_document_reviews_command", {
    projectId,
  });
}

export async function upsertPostgresProcessedDocumentReview(data: {
  projectId: string;
  sourceId: string;
  sourceTitle?: string | null;
  storagePath?: string | null;
  status?: "pending_review" | "reviewed" | null;
  processingStatus?: "idle" | "running" | "partial" | "completed" | "error" | null;
  processingError?: string | null;
  processedChunkCount?: number | null;
  processedContent?: string | null;
  segmentsJson?: string | null;
  properNameCandidatesJson?: string | null;
  enabledReviewLensesJson?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  chunkCount?: number | null;
  sourceContentHash?: string | null;
  exportedToProject?: boolean | null;
}): Promise<PostgresProcessedDocumentReview> {
  return invoke<PostgresProcessedDocumentReview>("upsert_postgres_experiment_processed_document_review_command", {
    request: data,
  });
}

export async function listPostgresProjectAiChats(
  projectId: string,
): Promise<PostgresProjectAiChat[]> {
  return invoke<PostgresProjectAiChat[]>("list_postgres_experiment_project_ai_chats_command", {
    projectId,
  });
}

export async function listPostgresProjectAiChatMessages(
  projectId: string,
): Promise<PostgresProjectAiChatMessage[]> {
  return invoke<PostgresProjectAiChatMessage[]>("list_postgres_experiment_project_ai_chat_messages_command", {
    projectId,
  });
}

export async function createPostgresProjectAiChat(data: {
  projectId: string;
  title: string;
  participantProjectUserIds?: string[];
}): Promise<PostgresProjectAiChat> {
  return invoke<PostgresProjectAiChat>("create_postgres_experiment_project_ai_chat_command", {
    request: data,
  });
}

export async function createPostgresProjectAiChatMessage(data: {
  projectId: string;
  chatId: string;
  role: "user" | "assistant";
  text: string;
  metadataJson?: string | null;
}): Promise<PostgresProjectAiChatMessage> {
  return invoke<PostgresProjectAiChatMessage>("create_postgres_experiment_project_ai_chat_message_command", {
    request: data,
  });
}

export async function touchPostgresProjectAiChat(data: {
  projectId: string;
  chatId: string;
  lastMessageAt: string;
  title?: string | null;
}): Promise<PostgresProjectAiChat> {
  return invoke<PostgresProjectAiChat>("touch_postgres_experiment_project_ai_chat_command", {
    request: data,
  });
}

export async function deletePostgresProjectAiChat(
  projectId: string,
  chatId: string,
): Promise<void> {
  await invoke("delete_postgres_experiment_project_ai_chat_command", {
    projectId,
    chatId,
  });
}

export async function waitForPostgresAiJobTerminalState(
  projectId: string,
  jobId: string,
  options?: {
    timeoutMs?: number;
    pollMs?: number;
    onProgress?: (job: PostgresAiJob) => void;
  },
): Promise<PostgresAiJob> {
  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
  const pollMs = options?.pollMs ?? 1500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = await getPostgresAiJob(projectId, jobId);
    options?.onProgress?.(job);
    if (job.status === "completed" || job.status === "error") {
      return job;
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }

  throw new Error("Timed out waiting for AI processing.");
}

export async function listPostgresObjects(projectId: string): Promise<PostgresObject[]> {
  return invoke<PostgresObject[]>("list_postgres_experiment_objects_command", {
    projectId,
  });
}

export async function listPostgresObjectTypes(
  projectId: string,
): Promise<PostgresObjectType[]> {
  return invoke<PostgresObjectType[]>("list_postgres_experiment_object_types_command", {
    projectId,
  });
}

export async function createPostgresObjectType(data: {
  projectId: string;
  name: string;
  description: string;
  shape: string;
  color: string;
  outlineColor?: string | null;
  fill: string;
  fillTransparency?: number | null;
  outlineWidth?: number | null;
  imageStoragePath?: string | null;
}): Promise<PostgresObjectType> {
  return invoke<PostgresObjectType>("create_postgres_experiment_object_type_command", {
    request: data,
  });
}

export async function updatePostgresObjectType(data: {
  projectId: string;
  objectTypeId: string;
  name: string;
  description: string;
  shape: string;
  color: string;
  outlineColor?: string | null;
  fill: string;
  fillTransparency?: number | null;
  outlineWidth?: number | null;
  imageStoragePath?: string | null;
}): Promise<PostgresObjectType> {
  return invoke<PostgresObjectType>("update_postgres_experiment_object_type_command", {
    request: data,
  });
}

export async function savePostgresObjectType(data: {
  projectId: string;
  objectTypeId?: string | null;
  name: string;
  description: string;
  shape: string;
  color: string;
  outlineColor?: string | null;
  fill: string;
  fillTransparency?: number | null;
  outlineWidth?: number | null;
  imageStoragePath?: string | null;
  attributes: Array<{
    id?: string | null;
    name: string;
    dataType: "text" | "number" | "datetime" | "categorical";
    description: string;
    options: string[];
    timelineRole?: PostgresTimelineAttributeRole | null;
  }>;
}): Promise<PostgresObjectTypeSaveResult> {
  return invoke<PostgresObjectTypeSaveResult>("save_postgres_experiment_object_type_command", {
    request: data,
  });
}

export async function deletePostgresObjectType(projectId: string, objectTypeId: string): Promise<void> {
  await invoke("delete_postgres_experiment_object_type_command", {
    projectId,
    objectTypeId,
  });
}

export async function importPostgresObjectTypeImage(data: {
  projectId: string;
  objectTypeId: string;
  originalFileName: string;
  fileBytesBase64: string;
}): Promise<PostgresObjectType> {
  return invoke<PostgresObjectType>("import_postgres_experiment_object_type_image_command", {
    request: data,
  });
}

export async function removePostgresObjectTypeImage(
  projectId: string,
  objectTypeId: string,
): Promise<PostgresObjectType> {
  return invoke<PostgresObjectType>("remove_postgres_experiment_object_type_image_command", {
    projectId,
    objectTypeId,
  });
}

export async function listPostgresRelationshipTypes(
  projectId: string,
): Promise<PostgresRelationshipType[]> {
  return invoke<PostgresRelationshipType[]>("list_postgres_experiment_relationship_types_command", {
    projectId,
  });
}

export async function createPostgresRelationshipType(data: {
  projectId: string;
  name: string;
  description: string;
  lineShape: string;
  lineWeight: number;
  arrowhead: string;
  color: string;
  fromObjectTypeIds?: string[];
  toObjectTypeIds?: string[];
  fromSourceKinds?: string[];
  toSourceKinds?: string[];
}): Promise<PostgresRelationshipType> {
  return invoke<PostgresRelationshipType>("create_postgres_experiment_relationship_type_command", {
    request: data,
  });
}

export async function updatePostgresRelationshipType(data: {
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
  fromSourceKinds?: string[];
  toSourceKinds?: string[];
}): Promise<PostgresRelationshipType> {
  return invoke<PostgresRelationshipType>("update_postgres_experiment_relationship_type_command", {
    request: data,
  });
}

export async function savePostgresRelationshipType(data: {
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
  fromSourceKinds?: string[];
  toSourceKinds?: string[];
  attributes: Array<{
    id?: string | null;
    name: string;
    dataType: "text" | "number" | "datetime" | "categorical";
    description: string;
    options: string[];
    timelineRole?: PostgresTimelineAttributeRole | null;
  }>;
}): Promise<PostgresRelationshipTypeSaveResult> {
  return invoke<PostgresRelationshipTypeSaveResult>("save_postgres_experiment_relationship_type_command", {
    request: data,
  });
}

export async function deletePostgresRelationshipType(projectId: string, relationshipTypeId: string): Promise<void> {
  await invoke("delete_postgres_experiment_relationship_type_command", {
    projectId,
    relationshipTypeId,
  });
}

export async function listPostgresObjectAttributeDefinitions(
  projectId: string,
): Promise<PostgresObjectAttributeDefinition[]> {
  return invoke<PostgresObjectAttributeDefinition[]>(
    "list_postgres_experiment_object_attribute_definitions_command",
    {
      projectId,
    },
  );
}

export async function createPostgresObjectAttributeDefinition(data: {
  projectId: string;
  objectTypeId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  timelineRole?: PostgresTimelineAttributeRole | null;
}): Promise<PostgresObjectAttributeDefinition> {
  return invoke<PostgresObjectAttributeDefinition>(
    "create_postgres_experiment_object_attribute_definition_command",
    {
      request: data,
    },
  );
}

export async function updatePostgresObjectAttributeDefinition(data: {
  projectId: string;
  attributeDefinitionId: string;
  objectTypeId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  timelineRole?: PostgresTimelineAttributeRole | null;
}): Promise<PostgresObjectAttributeDefinition> {
  return invoke<PostgresObjectAttributeDefinition>(
    "update_postgres_experiment_object_attribute_definition_command",
    {
      request: data,
    },
  );
}

export async function deletePostgresObjectAttributeDefinition(
  projectId: string,
  attributeDefinitionId: string,
): Promise<void> {
  await invoke("delete_postgres_experiment_object_attribute_definition_command", {
    projectId,
    attributeDefinitionId,
  });
}

export async function createPostgresObject(data: {
  projectId: string;
  objectTypeId: string;
  title: string;
  description: string;
  shapeOverride?: string | null;
  colorOverride?: string | null;
  outlineColorOverride?: string | null;
  fillOverride?: string | null;
  fillTransparencyOverride?: number | null;
  outlineWidthOverride?: number | null;
  imageStoragePath?: string | null;
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  eventTimePrecision?: string | null;
  eventTimezone?: string | null;
  eventIsInstant?: boolean | null;
  attributeValues: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
  attributeValueChange?: PostgresAttributeValueChangeMetadata | null;
}): Promise<PostgresObject> {
  return invoke<PostgresObject>("create_postgres_experiment_object_command", {
    request: data,
  });
}

export async function updatePostgresObject(data: {
  projectId: string;
  objectId: string;
  objectTypeId: string;
  title: string;
  description: string;
  shapeOverride?: string | null;
  colorOverride?: string | null;
  outlineColorOverride?: string | null;
  fillOverride?: string | null;
  fillTransparencyOverride?: number | null;
  outlineWidthOverride?: number | null;
  imageStoragePath?: string | null;
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  eventTimePrecision?: string | null;
  eventTimezone?: string | null;
  eventIsInstant?: boolean | null;
  attributeValues: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
  attributeValueChange?: PostgresAttributeValueChangeMetadata | null;
}): Promise<PostgresObject> {
  return invoke<PostgresObject>("update_postgres_experiment_object_command", {
    request: data,
  });
}

export async function savePostgresObject(data: {
  projectId: string;
  objectId?: string | null;
  objectTypeId: string;
  title: string;
  description: string;
  shapeOverride?: string | null;
  colorOverride?: string | null;
  outlineColorOverride?: string | null;
  fillOverride?: string | null;
  fillTransparencyOverride?: number | null;
  outlineWidthOverride?: number | null;
  imageStoragePath?: string | null;
  eventStartAt?: string | null;
  eventEndAt?: string | null;
  eventTimePrecision?: string | null;
  eventTimezone?: string | null;
  eventIsInstant?: boolean | null;
  attributeValues: Array<{
    attributeDefinitionId: string;
    value: string;
  }>;
  attributeValueChange?: PostgresAttributeValueChangeMetadata | null;
}): Promise<PostgresObject> {
  return invoke<PostgresObject>("save_postgres_experiment_object_command", {
    request: data,
  });
}

export async function deletePostgresObject(projectId: string, objectId: string): Promise<void> {
  await invoke("delete_postgres_experiment_object_command", {
    projectId,
    objectId,
  });
}

export async function importPostgresObjectImage(data: {
  projectId: string;
  objectId: string;
  originalFileName: string;
  fileBytesBase64: string;
}): Promise<PostgresObject> {
  return invoke<PostgresObject>("import_postgres_experiment_object_image_command", {
    request: data,
  });
}

export async function removePostgresObjectImage(
  projectId: string,
  objectId: string,
): Promise<PostgresObject> {
  return invoke<PostgresObject>("remove_postgres_experiment_object_image_command", {
    projectId,
    objectId,
  });
}

export async function importPostgresSourceImage(data: {
  projectId: string;
  sourceId: string;
  originalFileName: string;
  fileBytesBase64: string;
}): Promise<PostgresSource> {
  return invoke<PostgresSource>("import_postgres_experiment_source_image_command", {
    request: data,
  });
}

export async function removePostgresSourceImage(
  projectId: string,
  sourceId: string,
): Promise<PostgresSource> {
  return invoke<PostgresSource>("remove_postgres_experiment_source_image_command", {
    projectId,
    sourceId,
  });
}

export async function listPostgresRelationships(projectId: string): Promise<PostgresRelationship[]> {
  return invoke<PostgresRelationship[]>("list_postgres_experiment_relationships_command", {
    projectId,
  });
}

export async function listPostgresRelationshipAttributeDefinitions(
  projectId: string,
): Promise<PostgresRelationshipAttributeDefinition[]> {
  return invoke<PostgresRelationshipAttributeDefinition[]>(
    "list_postgres_experiment_relationship_attribute_definitions_command",
    {
      projectId,
    },
  );
}

export async function createPostgresRelationshipAttributeDefinition(data: {
  projectId: string;
  relationshipTypeId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  timelineRole?: PostgresTimelineAttributeRole | null;
}): Promise<PostgresRelationshipAttributeDefinition> {
  return invoke<PostgresRelationshipAttributeDefinition>(
    "create_postgres_experiment_relationship_attribute_definition_command",
    {
      request: data,
    },
  );
}

export async function updatePostgresRelationshipAttributeDefinition(data: {
  projectId: string;
  attributeDefinitionId: string;
  relationshipTypeId: string;
  name: string;
  dataType: "text" | "number" | "datetime" | "categorical";
  description: string;
  options: string[];
  timelineRole?: PostgresTimelineAttributeRole | null;
}): Promise<PostgresRelationshipAttributeDefinition> {
  return invoke<PostgresRelationshipAttributeDefinition>(
    "update_postgres_experiment_relationship_attribute_definition_command",
    {
      request: data,
    },
  );
}

export async function deletePostgresRelationshipAttributeDefinition(
  projectId: string,
  attributeDefinitionId: string,
): Promise<void> {
  await invoke("delete_postgres_experiment_relationship_attribute_definition_command", {
    projectId,
    attributeDefinitionId,
  });
}

export async function createPostgresRelationship(data: {
  projectId: string;
  fromObjectId?: string;
  toObjectId?: string;
  fromEntityType?: PostgresRelationshipEndpointType;
  fromEntityId?: string;
  toEntityType?: PostgresRelationshipEndpointType;
  toEntityId?: string;
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
  attributeValueChange?: PostgresAttributeValueChangeMetadata | null;
}): Promise<PostgresRelationship> {
  return invoke<PostgresRelationship>("create_postgres_experiment_relationship_command", {
    request: data,
  });
}

export async function updatePostgresRelationship(data: {
  projectId: string;
  relationshipId: string;
  fromObjectId?: string;
  toObjectId?: string;
  fromEntityType?: PostgresRelationshipEndpointType;
  fromEntityId?: string;
  toEntityType?: PostgresRelationshipEndpointType;
  toEntityId?: string;
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
  attributeValueChange?: PostgresAttributeValueChangeMetadata | null;
}): Promise<PostgresRelationship> {
  return invoke<PostgresRelationship>("update_postgres_experiment_relationship_command", {
    request: data,
  });
}

export async function savePostgresRelationship(data: {
  projectId: string;
  relationshipId?: string | null;
  fromObjectId?: string;
  toObjectId?: string;
  fromEntityType?: PostgresRelationshipEndpointType;
  fromEntityId?: string;
  toEntityType?: PostgresRelationshipEndpointType;
  toEntityId?: string;
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
  attributeValueChange?: PostgresAttributeValueChangeMetadata | null;
}): Promise<PostgresRelationship> {
  return invoke<PostgresRelationship>("save_postgres_experiment_relationship_command", {
    request: data,
  });
}

export async function deletePostgresRelationship(projectId: string, relationshipId: string): Promise<void> {
  await invoke("delete_postgres_experiment_relationship_command", {
    projectId,
    relationshipId,
  });
}
