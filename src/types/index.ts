// ─── Core data model ────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  createdBy?: string; // display name or email of the project owner
}

export interface Document {
  id: string;
  projectId: string;
  name: string;         // display name / file basename
  filePath: string;     // original path on disk
  content: string;      // full text content
  importedAt: string;
}

/** A labeling scheme entry — the vocabulary researchers code against */
export interface Code {
  id: string;
  projectId: string;
  label: string;        // e.g. "Theme: Power"
  color: string;        // hex color for highlighting
  description: string;
  shortcut?: string;    // optional keyboard shortcut letter
  parentId?: string;    // parent code id for hierarchy
}

/** A single annotation: a span of text in a document tagged with a code */
export interface Annotation {
  id: string;
  documentId: string;
  codeId: string;
  startOffset: number;  // character index in document.content
  endOffset: number;
  quote: string;        // the selected text (denormalized for display)
  note: string;         // researcher note about this annotation
  createdAt: string;
  createdBy: string;    // display name or email of the annotator
  createdById: string;  // user record id of the annotator
}

/** A freeform memo written by the researcher */
export interface Memo {
  id: string;
  projectId: string;
  documentId?: string;      // optionally linked to a document
  annotationId?: string;    // optionally linked to an annotation
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Roles ──────────────────────────────────────────────────────────────────

/** Hierarchical project roles, highest to lowest. */
export type Role = "owner" | "editor" | "coder" | "viewer";

export const ROLE_LABELS: Record<Role, string> = {
  owner:  "Owner",
  editor: "Editor",
  coder:  "Coder",
  viewer: "Viewer",
};

/** Membership record linking a user to a project with a role. */
export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: Role;
}

// ─── UI state ───────────────────────────────────────────────────────────────

export type View =
  | "projects"       // project list / no active project
  | "home"           // Project → Home
  | "users"          // Project → Users
  | "cases"          // Project → Cases
  | "documents"      // Project → Documents
  | "codebook"       // Project → Codebook
  | "project-log"    // Project → Project Log
  | "code-text"      // Analysis → Code Text
  | "memos"          // Analysis → Memos
  | "ai-assist"      // Analysis → AI Assist
  | "code-reports"   // Reports → Code Reports
  | "user-settings"  // user settings page
  | "app-settings";  // app settings page

export interface ProjectLogEntry {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  action: string;    // e.g. "document.create"
  label: string;     // human-readable summary
  recordId?: string; // id of the affected record (set for delete actions)
  occurredAt: string; // ISO 8601
}

export interface AppState {
  view: View;
  activeProject: Project | null;
  activeDocument: Document | null;
}
