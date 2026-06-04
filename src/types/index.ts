export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface Document {
  id: string;
  projectId: string;
  name: string;
  type: string;
  filePath: string;
  content: string;
  structuredContentJson: string;
  importedAt: string;
}

export interface ProjectUploadedFile {
  id: string;
  projectId: string;
  documentId: string | null;
  caseId: string | null;
  uploadedFile: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sourceKind: "document" | "case" | "other";
  status: "active" | "processed" | "orphaned" | "deleted";
  statusHistory: Array<{
    at: string;
    fromStatus: "active" | "processed" | "orphaned" | "deleted" | null;
    toStatus: "active" | "processed" | "orphaned" | "deleted";
    reason: string;
    actorUserId: string | null;
    actorIdentifier: string;
    documentId?: string | null;
    caseId?: string | null;
  }>;
  statusHistoryJson: string;
  contentHash: string;
  importSummaryJson: string;
  createdBy?: string | null;
  createdByIdentifier?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
}

export interface Case {
  id: string;
  projectId: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Code {
  id: string;
  projectId: string;
  label: string;
  color: string;
  description: string;
  shortcut?: string;
  parentId?: string;
}

export interface Annotation {
  id: string;
  documentId: string;
  codeId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  note: string;
  createdAt: string;
  createdBy: string;
  createdById: string;
}

export interface Memo {
  id: string;
  projectId: string;
  documentId?: string;
  annotationId?: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export type AppRole = "administrator" | "standard";
export type Role = "owner" | "editor" | "coder" | "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  editor: "Editor",
  coder: "Coder",
  viewer: "Viewer",
};

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: Role;
}

export interface ProjectPresenceEntry {
  id: string;
  projectId: string;
  userId: string;
  userIdentifier: string;
  userName: string;
  clientId: string;
  view: string;
  lastSeen: string;
  sessionStartedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type ImportedUserResolutionStatus =
  | "no_access"
  | "associated_current_user"
  | "associated_existing_user"
  | "temporary_password_created"
  | "removed";

export interface PendingImportedUser {
  sourceUserId: string;
  userIdentifier: string;
  name: string;
  email: string;
  role: Role;
  status: ImportedUserResolutionStatus;
}

export interface PendingImportedUserResolution {
  projectId: string;
  projectName: string;
  source: "import" | "restore";
  mismatchNotes: string[];
  users: PendingImportedUser[];
}

export type View =
  | "projects"
  | "home"
  | "users"
  | "cases"
  | "documents"
  | "codebook"
  | "annotations"
  | "project-log"
  | "project-settings"
  | "code-text"
  | "memos"
  | "ai-assist"
  | "ai-assist-chat"
  | "ai-assist-process-documents"
  | "ai-assist-process-documents-review"
  | "ai-assisted-coding"
  | "ai-assist-case-attributes"
  | "ai-assist-document-attributes"
  | "ai-analyze"
  | "code-reports"
  | "coders"
  | "codes"
  | "user-settings"
  | "app-settings";

export interface ProjectLogEntry {
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
}

export interface AppState {
  view: View;
  activeProject: Project | null;
  activeDocument: Document | null;
}
