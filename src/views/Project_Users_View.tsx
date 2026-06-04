import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type PocketBase from "pocketbase";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../types";
import type { AppRole, PendingImportedUser, ProjectLogEntry, ProjectPresenceEntry, Role } from "../types";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { createUserAccount } from "../lib/pb";
import { HelpIcon } from "../components/AppIcons";
type ProjectLogDetails = Record<string, unknown>;

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberRow {
  memberId: string;
  userId: string;
  userIdentifier: string;
  name: string;
  email: string;
  role: Role;
  createdByName: string;
  createdAt: string;
  lastLogin: string;
}

type SortCol = keyof MemberRow;
type SortDir = "asc" | "desc";

type ActivityRow = {
  userId: string;
  userIdentifier: string;
  name: string;
  active: boolean;
  cumulativeActiveMinutes: number;
  loginCount: number;
  casesCreated: number;
  documentsCreated: number;
  codesCreated: number;
  annotationsCreated: number;
  memosCreated: number;
  reportsCreated: number;
};

type ActivityCounts = {
  casesCreated: number;
  documentsCreated: number;
  codesCreated: number;
  annotationsCreated: number;
  memosCreated: number;
  reportsCreated: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseIsoMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRoundedMinutes(minutes: number): string {
  if (minutes <= 0) return "0 min";
  return `${minutes} min`;
}

function countUserProjectLogins(entries: ProjectLogEntry[], userId: string): number {
  return entries.filter((entry) => entry.userId === userId && entry.action === "project.open").length;
}

function countUserActiveMinutes(
  entries: ProjectLogEntry[],
  userId: string,
  currentlyActive: boolean,
  nowMs: number,
): number {
  const relevantEntries = entries
    .filter((entry) =>
      entry.userId === userId
      && (entry.action === "project.open" || entry.action === "project.close" || entry.action === "presence.inactive"))
    .sort((left, right) => (parseIsoMs(left.occurredAt) ?? 0) - (parseIsoMs(right.occurredAt) ?? 0));

  let openAtMs: number | null = null;
  let totalMs = 0;

  for (const entry of relevantEntries) {
    const occurredAtMs = parseIsoMs(entry.occurredAt);
    if (occurredAtMs == null) continue;

    if (entry.action === "project.open") {
      if (openAtMs == null) openAtMs = occurredAtMs;
      continue;
    }

    if (openAtMs != null && occurredAtMs >= openAtMs) {
      totalMs += occurredAtMs - openAtMs;
      openAtMs = null;
    }
  }

  if (currentlyActive && openAtMs != null && nowMs >= openAtMs) {
    totalMs += nowMs - openAtMs;
  }

  return Math.max(0, Math.round(totalMs / 60_000));
}

function buildEmptyActivityCounts(): ActivityCounts {
  return {
    casesCreated: 0,
    documentsCreated: 0,
    codesCreated: 0,
    annotationsCreated: 0,
    memosCreated: 0,
    reportsCreated: 0,
  };
}

function incrementActivityCount(
  next: Record<string, ActivityCounts>,
  key: string,
  field: keyof ActivityCounts,
): void {
  if (!key) return;
  const current = next[key] ?? buildEmptyActivityCounts();
  current[field] += 1;
  next[key] = current;
}

const ALL_PROJECT_ROLES: Role[] = ["owner", "editor", "coder", "viewer"];
const NON_OWNER_PROJECT_ROLES: Role[] = ["editor", "coder", "viewer"];

function getAssignableRoles(canTransferOwnership: boolean): Role[] {
  return canTransferOwnership ? ALL_PROJECT_ROLES : NON_OWNER_PROJECT_ROLES;
}

function canViewActivityRow(args: {
  appRole: AppRole;
  projectRole: Role | null;
  currentUserId: string | null;
  row: MemberRow;
}): boolean {
  const { appRole, projectRole, currentUserId, row } = args;

  if (appRole === "administrator" || projectRole === "owner") return true;
  if (!currentUserId) return false;
  if (row.userId === currentUserId) return true;

  if (projectRole === "editor") {
    return row.role === "coder" || row.role === "viewer";
  }

  return false;
}

// ─── User Detail sub-view ────────────────────────────────────────────────────

function UserDetail({
  row: initialRow,
  pb,
  projectId,
  canEdit,
  canRemove,
  onBack,
  onRequestEdit,
  onRequestRemove,
}: {
  row: MemberRow;
  pb: PocketBase;
  projectId: string;
  canEdit: boolean;
  canRemove: boolean;
  onBack: () => void;
  onRequestEdit: (row: MemberRow) => void;
  onRequestRemove: (row: MemberRow) => void;
}) {
  const [row, setRow] = useState(initialRow);
  const [annotCount, setAnnotCount] = useState<number | null>(null);
  const [memoCount, setMemoCount] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRow(initialRow);
  }, [initialRow]);

  useEffect(() => {
    pb.collection("annotations")
      .getList(1, 1, { filter: `created_by="${row.userId}"&&deleted_at=""`, fields: "id" })
      .then((r) => setAnnotCount(r.totalItems))
      .catch(() => setAnnotCount(0));

    pb.collection("memos")
      .getList(1, 1, {
        filter: `created_by="${row.userId}"&&project="${projectId}"&&deleted_at=""`,
        fields: "id",
      })
      .then((r) => setMemoCount(r.totalItems))
      .catch(() => setMemoCount(0));
  }, [pb, row.userId, projectId]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  return (
    <div className="view user-detail">
      <div className="workspace-back-row workspace-back-row--split">
        <button className="btn user-detail-back" onClick={onBack}>
          Back to Users
        </button>
        <div className="workspace-back-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onRequestEdit(row)}
            disabled={!canEdit}
            title={!canEdit ? "You do not have permission to edit this user's role" : undefined}
          >
            Edit User
          </button>
          <div className="user-detail-menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="btn"
              aria-label="User actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              Actions
            </button>
            {menuOpen && (
              <div className="context-menu user-detail-menu" role="menu">
                {canRemove ? (
                  <button
                    type="button"
                    className="context-menu-item context-menu-item--danger"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onRequestRemove(row);
                    }}
                  >
                    Remove from Project
                  </button>
                ) : (
                  <div className="context-menu-item context-menu-item--disabled" title="You do not have permission to remove this user from the project">
                    Remove from Project
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="user-detail-card">
        <div className="user-detail-avatar">{initials(row.name)}</div>
        <div className="user-detail-info">
          <h2 className="user-detail-name">{row.name}</h2>
          <p className="user-detail-email">{row.email}</p>
          <span className={`role-badge role-badge--${row.role}`}>
            {ROLE_LABELS[row.role]}
          </span>
        </div>
      </div>

      <div className="user-detail-stats">
        <div className="user-detail-stat">
          <span className="user-detail-stat-value">{annotCount ?? "..."}</span>
          <span className="user-detail-stat-label">Annotations</span>
        </div>
        <div className="user-detail-stat">
          <span className="user-detail-stat-value">{memoCount ?? "..."}</span>
          <span className="user-detail-stat-label">Memos</span>
        </div>
      </div>

      <dl className="user-detail-meta">
        <dt>Added By</dt>
        <dd>{row.createdByName}</dd>
        <dt>Account Created</dt>
        <dd>{fmtDate(row.createdAt)}</dd>
        <dt>Last Login</dt>
        <dd>{row.lastLogin}</dd>
      </dl>
    </div>
  );
}

function AddMemberModal({
  projectId,
  currentUserId,
  existingMemberIds,
  allowedRoles,
  pb,
  onDone,
  onClose,
  onLog,
}: {
  projectId: string;
  currentUserId: string;
  existingMemberIds: Set<string>;
  allowedRoles: Role[];
  pb: PocketBase;
  onDone: () => void;
  onClose: () => void;
  onLog: (action: string, label: string, recordId?: string, details?: ProjectLogDetails) => void;
}) {
  const [allUsers, setAllUsers]   = useState<{ id: string; name: string; email: string; userIdentifier: string }[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [role, setRole]           = useState<Role>(allowedRoles.includes("coder") ? "coder" : allowedRoles[0] ?? "viewer");
  const [loading, setLoading]     = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    if (!allowedRoles.includes(role)) {
      setRole(allowedRoles.includes("coder") ? "coder" : allowedRoles[0] ?? "viewer");
    }
  }, [allowedRoles, role]);

  useEffect(() => {
    pb.collection("users")
      .getFullList({ sort: "name" })
      .then((records) =>
        setAllUsers(
          records
            .filter((r) => !existingMemberIds.has(r.id))
            .map((r) => ({
              id: r.id,
              name: r.name || r.email,
              email: r.email,
              userIdentifier: r.user_identifier || "",
            })),
        ),
      )
      .catch(() => setError("Failed to load users."))
      .finally(() => setLoadingUsers(false));
  }, [pb, existingMemberIds]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const record = await pb.collection("project_members").create({
        project:    projectId,
        user:       selectedId,
        user_identifier: allUsers.find((u) => u.id === selectedId)?.userIdentifier || "",
        role,
        created_by: currentUserId,
      });
      const added = allUsers.find((u) => u.id === selectedId);
      if (added) onLog("member.add", `Added "${added.name}" as ${role}`, record.id, {
        entityType: "project_member",
        userId: selectedId,
        userIdentifier: added.userIdentifier,
        role,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member.");
    } finally {
      setLoading(false);
    }
  }

  const available = allUsers.filter((u) => u.id !== currentUserId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add Member</h2>
        <form className="form" onSubmit={handleSubmit}>
          <label className="form-label">
            User
            {loadingUsers ? (
              <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>Loading users…</p>
            ) : available.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                All registered users are already in this project.
              </p>
            ) : (
              <select
                className="form-input"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                required
                autoFocus
              >
                <option value="">— select a user —</option>
                {available.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="form-label">
            Role
            <select
              className="form-input"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {allowedRoles.map((allowedRole) => (
                <option key={allowedRole} value={allowedRole}>
                  {ROLE_LABELS[allowedRole]}
                </option>
              ))}
            </select>
          </label>
          {!allowedRoles.includes("owner") && (
            <p className="users-guide-copy" style={{ marginTop: 0 }}>
              Ownership can only be assigned by a current owner or an administrator.
            </p>
          )}
          {error && <p className="auth-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading || !selectedId || available.length === 0}
            >
              {loading ? "Adding…" : "Add to Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Member modal ────────────────────────────────────────────────────────

function EditMemberModal({
  row,
  pb,
  canEdit,
  allowedRoles,
  soleOwnerLocked,
  onDone,
  onLog,
  onClose,
}: {
  row: MemberRow;
  pb: PocketBase;
  canEdit: boolean;
  allowedRoles: Role[];
  soleOwnerLocked: boolean;
  onDone: (updatedRole: Role) => void;
  onLog: (action: string, label: string, recordId?: string, details?: ProjectLogDetails) => void;
  onClose: () => void;
}) {
  const [role, setRole] = useState<Role>(
    allowedRoles.includes(row.role) ? row.role : allowedRoles[0] ?? row.role,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowedRoles.includes(role)) {
      setRole(allowedRoles.includes(row.role) ? row.role : allowedRoles[0] ?? row.role);
    }
  }, [allowedRoles, role, row.role]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!canEdit || soleOwnerLocked) return;
    setLoading(true);
    setError(null);
    try {
      if (role !== row.role) {
        await pb.collection("project_members").update(row.memberId, { role });
        onLog("member.update", `Changed "${row.name}" role from ${row.role} to ${role}`, row.memberId, {
          entityType: "project_member",
          userId: row.userId,
          userIdentifier: row.userIdentifier,
          previousRole: row.role,
          nextRole: role,
        });
      }
      onDone(role);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update user.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit User Role</h2>
        <form className="form" onSubmit={handleSubmit}>
          <p className="users-guide-copy" style={{ marginTop: 0 }}>
            This only changes the user's role in the current project. Their name and email stay tied to their account.
          </p>
          <label className="form-label">
            Role
            <select
              className="form-input"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              disabled={!canEdit}
            >
              {allowedRoles.map((allowedRole) => (
                <option key={allowedRole} value={allowedRole}>
                  {ROLE_LABELS[allowedRole]}
                </option>
              ))}
            </select>
          </label>
          {soleOwnerLocked && (
            <p className="users-guide-copy" style={{ marginTop: 0 }}>
              This user is currently the only owner of the project. Add or promote another owner before changing this role.
            </p>
          )}
          {!allowedRoles.includes("owner") && row.role !== "owner" && (
            <p className="users-guide-copy" style={{ marginTop: 0 }}>
              Ownership can only be assigned by a current owner or an administrator.
            </p>
          )}
          {error && <p className="auth-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            {canEdit && (
              <button
                type="submit"
                className="btn btn--primary"
                disabled={loading || soleOwnerLocked}
              >
                {loading ? "Saving…" : "Save Changes"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Table column definitions ─────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "name",          label: "Name",       width: "18%" },
  { key: "email",         label: "Email",      width: "22%" },
  { key: "role",          label: "Role",       width: "10%" },
  { key: "createdByName", label: "Added By", width: "18%" },
  { key: "createdAt",     label: "Created",    width: "16%" },
  { key: "lastLogin",     label: "Last Login", width: "16%" },
];

const ACTIVITY_COLS: Array<{ key: keyof ActivityRow | "active"; label: string; width: string }> = [
  { key: "name", label: "User Name", width: "18%" },
  { key: "active", label: "Currently Active", width: "10%" },
  { key: "cumulativeActiveMinutes", label: "Active Time", width: "11%" },
  { key: "loginCount", label: "Logins", width: "8%" },
  { key: "casesCreated", label: "Cases", width: "8%" },
  { key: "documentsCreated", label: "Documents", width: "9%" },
  { key: "codesCreated", label: "Codes", width: "8%" },
  { key: "annotationsCreated", label: "Annotations", width: "9%" },
  { key: "memosCreated", label: "Memos", width: "8%" },
  { key: "reportsCreated", label: "Reports", width: "8%" },
];


// ─── Main view ────────────────────────────────────────────────────────────────

export function UsersView() {
  const {
    activeProject,
    activeProjectPresenceUsers,
    logEntries,
    pb,
    appRole,
    userRole,
    canCurrentUser,
    ensureProjectSafetyBackup,
    logAction,
    pendingImportedUserResolution,
    setPendingImportedUserResolution,
  } = useStore();
  const { user: currentUser } = useAuth();
  const canInviteMembers = canCurrentUser("inviteProjectUsers");
  const canChangeRoles = canCurrentUser("changeProjectRoles");
  const canRemoveMembers = canCurrentUser("removeProjectUsers");
  const canTransferOwnership = canCurrentUser("transferProjectOwnership");

  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showActivityTable, setShowActivityTable] = useState(false);
  const [activityCountsByUser, setActivityCountsByUser] = useState<Record<string, ActivityCounts>>({});
  const [activityLoading, setActivityLoading] = useState(false);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    row: MemberRow;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  const [confirmDelete, setConfirmDelete] = useState<MemberRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [selectedRow, setSelectedRow] = useState<MemberRow | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [editRow, setEditRow] = useState<MemberRow | null>(null);
  const [selectedImportedUser, setSelectedImportedUser] = useState<PendingImportedUser | null>(null);
  const [associateUserId, setAssociateUserId] = useState("");
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: string; name: string; email: string; userIdentifier: string }>>([]);
  const [availableUsersLoading, setAvailableUsersLoading] = useState(false);
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const [removeImportedUser, setRemoveImportedUser] = useState<PendingImportedUser | null>(null);

  useEffect(() => {
    const requestedTab = sessionStorage.getItem("kanqual:open-project-users-tab");
    if (!requestedTab) return;
    sessionStorage.removeItem("kanqual:open-project-users-tab");
    setShowActivityTable(requestedTab === "activity");
  }, []);
  const [tempPasswordUser, setTempPasswordUser] = useState<PendingImportedUser | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [confirmTemporaryPassword, setConfirmTemporaryPassword] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const activePendingResolution = pendingImportedUserResolution?.projectId === activeProject?.id
    ? pendingImportedUserResolution
    : null;

  // ── Load members ─────────────────────────────────────────────────────────────

  const loadMembers = useCallback(async () => {
    if (!activeProject || !pb) return;
    setLoading(true);
    setError(null);
    try {
      const records = await pb.collection("project_members").getFullList({
        filter: `project="${activeProject.id}"`,
        expand: "user,created_by",
        sort: "created",
      });
      setRows(
        records.map((r) => {
          const u = r.expand?.user;
          const cb = r.expand?.created_by;
          return {
            memberId: r.id,
            userId: r.user,
            userIdentifier: r.user_identifier || u?.user_identifier || "—",
            name: u?.name || u?.email || "—",
            email: u?.email || "—",
            role: r.role as Role,
            createdByName: cb?.name || cb?.email || "—",
            createdAt: u?.created || r.created,
            lastLogin: r.last_active ? fmtDate(r.last_active) : "Never",
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

  const updatePendingImportedUser = useCallback((
    userIdentifier: string,
    status: PendingImportedUser["status"],
  ) => {
    setPendingImportedUserResolution((current) => {
      if (!current || current.projectId !== activeProject?.id) return current;
      return {
        ...current,
        users: current.users.map((user) =>
          user.userIdentifier === userIdentifier ? { ...user, status } : user,
        ),
      };
    });
  }, [activeProject?.id, setPendingImportedUserResolution]);

  const clearPendingResolutionIfDone = useCallback(() => {
    setPendingImportedUserResolution((current) => {
      if (!current || current.projectId !== activeProject?.id) return current;
      return current.users.every((user) => user.status !== "no_access") ? null : current;
    });
  }, [activeProject?.id, setPendingImportedUserResolution]);

  const loadAvailableUsers = useCallback(async () => {
    if (!pb) return;
    setAvailableUsersLoading(true);
    try {
      const records = await pb.collection("users").getFullList({ sort: "name" });
      setAvailableUsers(records.map((record) => ({
        id: record.id,
        name: record.name || record.email,
        email: record.email,
        userIdentifier: record.user_identifier || "",
      })));
    } finally {
      setAvailableUsersLoading(false);
    }
  }, [pb]);

  async function applyImportedUserAssociation(importedUser: PendingImportedUser, targetUser: {
    id: string;
    name: string;
    email: string;
    userIdentifier: string;
  }, status: PendingImportedUser["status"]) {
    if (!pb || !activeProject) return;
    setResolutionBusy(true);
    setError(null);
    try {
      const existingMembership = rows.find((row) => row.userId === targetUser.id);
      if (!existingMembership) {
        await pb.collection("project_members").create({
          project: activeProject.id,
          user: targetUser.id,
          user_identifier: targetUser.userIdentifier,
          role: importedUser.role,
          created_by: currentUser?.id || "",
        });
      }

      const reassignCreatedBy = async (collection: string, filter: string) => {
        const records = await pb.collection(collection).getFullList({ filter });
        await Promise.all(records.map((record) => pb.collection(collection).update(record.id, {
          created_by: targetUser.id,
          created_by_identifier: targetUser.userIdentifier,
        })));
      };

      await Promise.all([
        reassignCreatedBy("documents", `project="${activeProject.id}" && created_by_identifier="${importedUser.userIdentifier}"`),
        reassignCreatedBy("cases", `project="${activeProject.id}" && created_by_identifier="${importedUser.userIdentifier}"`),
        reassignCreatedBy("codes", `project="${activeProject.id}" && created_by_identifier="${importedUser.userIdentifier}"`),
        reassignCreatedBy("annotations", `document.project="${activeProject.id}" && created_by_identifier="${importedUser.userIdentifier}"`),
        reassignCreatedBy("memos", `project="${activeProject.id}" && created_by_identifier="${importedUser.userIdentifier}"`),
        reassignCreatedBy("code_reports", `project="${activeProject.id}" && created_by_identifier="${importedUser.userIdentifier}"`),
        reassignCreatedBy("coder_reports", `project="${activeProject.id}" && created_by_identifier="${importedUser.userIdentifier}"`),
        reassignCreatedBy("ai_analyses", `project="${activeProject.id}" && created_by_identifier="${importedUser.userIdentifier}"`),
      ]);

      const logRecords = await pb.collection("project_log").getFullList({
        filter: `project="${activeProject.id}" && user_identifier="${importedUser.userIdentifier}"`,
      });
      await Promise.all(logRecords.map((record) => pb.collection("project_log").update(record.id, {
        user: targetUser.id,
        user_identifier: targetUser.userIdentifier,
        user_name: targetUser.name || targetUser.email,
      })));

      const coderReports = await pb.collection("coder_reports").getFullList({
        filter: `project="${activeProject.id}"`,
      });
      await Promise.all(coderReports.map(async (record) => {
        const identifiers = parseStringArray(record.coder_identifiers);
        if (!identifiers.includes(importedUser.userIdentifier)) return;
        const nextIdentifiers = Array.from(new Set(
          identifiers.map((identifier) =>
            identifier === importedUser.userIdentifier ? targetUser.userIdentifier : identifier,
          ),
        ));
        const nextCoders = Array.from(new Set([
          ...parseStringArray(record.coders),
          targetUser.id,
        ]));
        await pb.collection("coder_reports").update(record.id, {
          coders: nextCoders,
          coder_identifiers: JSON.stringify(nextIdentifiers),
        });
      }));

      await logAction(
        activeProject.id,
        "member.reassociate",
        `Associated imported user "${importedUser.name}" with "${targetUser.name || targetUser.email}"`,
      );
      updatePendingImportedUser(importedUser.userIdentifier, status);
      setSelectedImportedUser(null);
      setAssociateUserId("");
      await loadMembers();
      clearPendingResolutionIfDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to associate imported user.");
    } finally {
      setResolutionBusy(false);
    }
  }

  async function handleRemoveImportedUserFromProject() {
    if (!pb || !activeProject || !removeImportedUser) return;
    setResolutionBusy(true);
    setError(null);
    try {
      const clearCreatedByIdentifier = async (collection: string, filter: string) => {
        const records = await pb.collection(collection).getFullList({ filter });
        await Promise.all(records.map((record) => pb.collection(collection).update(record.id, {
          created_by_identifier: "",
        })));
      };

      await Promise.all([
        clearCreatedByIdentifier("documents", `project="${activeProject.id}" && created_by_identifier="${removeImportedUser.userIdentifier}"`),
        clearCreatedByIdentifier("cases", `project="${activeProject.id}" && created_by_identifier="${removeImportedUser.userIdentifier}"`),
        clearCreatedByIdentifier("codes", `project="${activeProject.id}" && created_by_identifier="${removeImportedUser.userIdentifier}"`),
        clearCreatedByIdentifier("annotations", `document.project="${activeProject.id}" && created_by_identifier="${removeImportedUser.userIdentifier}"`),
        clearCreatedByIdentifier("memos", `project="${activeProject.id}" && created_by_identifier="${removeImportedUser.userIdentifier}"`),
        clearCreatedByIdentifier("code_reports", `project="${activeProject.id}" && created_by_identifier="${removeImportedUser.userIdentifier}"`),
        clearCreatedByIdentifier("coder_reports", `project="${activeProject.id}" && created_by_identifier="${removeImportedUser.userIdentifier}"`),
        clearCreatedByIdentifier("ai_analyses", `project="${activeProject.id}" && created_by_identifier="${removeImportedUser.userIdentifier}"`),
      ]);

      const logRecords = await pb.collection("project_log").getFullList({
        filter: `project="${activeProject.id}" && user_identifier="${removeImportedUser.userIdentifier}"`,
      });
      await Promise.all(logRecords.map((record) => pb.collection("project_log").update(record.id, {
        user_identifier: "",
      })));

      const coderReports = await pb.collection("coder_reports").getFullList({
        filter: `project="${activeProject.id}"`,
      });
      await Promise.all(coderReports.map(async (record) => {
        const identifiers = parseStringArray(record.coder_identifiers);
        if (!identifiers.includes(removeImportedUser.userIdentifier)) return;
        await pb.collection("coder_reports").update(record.id, {
          coder_identifiers: JSON.stringify(
            identifiers.filter((identifier) => identifier !== removeImportedUser.userIdentifier),
          ),
        });
      }));

      await logAction(activeProject.id, "member.remove_unresolved", `Removed imported user "${removeImportedUser.name}" from project resolution`);
      updatePendingImportedUser(removeImportedUser.userIdentifier, "removed");
      setRemoveImportedUser(null);
      setSelectedImportedUser(null);
      clearPendingResolutionIfDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove imported user from the project.");
    } finally {
      setResolutionBusy(false);
    }
  }

  async function handleCreateTemporaryPasswordAccount() {
    if (!tempPasswordUser) return;
    setError(null);
    if (!temporaryPassword || !confirmTemporaryPassword) {
      setError("Enter the temporary password twice.");
      return;
    }
    if (temporaryPassword.length < 8) {
      setError("Temporary password must be at least 8 characters.");
      return;
    }
    if (temporaryPassword !== confirmTemporaryPassword) {
      setError("Temporary passwords do not match.");
      return;
    }

    setResolutionBusy(true);
    try {
      const createdUserId = await createUserAccount({
        pb,
        name: tempPasswordUser.name,
        email: tempPasswordUser.email,
        password: temporaryPassword,
        passwordConfirm: confirmTemporaryPassword,
        userIdentifier: tempPasswordUser.userIdentifier,
        mustChangePassword: true,
      });
      await applyImportedUserAssociation(
        tempPasswordUser,
        {
          id: createdUserId,
          name: tempPasswordUser.name,
          email: tempPasswordUser.email,
          userIdentifier: tempPasswordUser.userIdentifier,
        },
        "temporary_password_created",
      );
      setTempPasswordUser(null);
      setTemporaryPassword("");
      setConfirmTemporaryPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create a temporary-password account.");
      setResolutionBusy(false);
    }
  }

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (!activeProject || !pb) {
      setActivityCountsByUser({});
      setActivityLoading(false);
      return;
    }

    let cancelled = false;
    setActivityLoading(true);

    const fields = "id,created_by,created_by_identifier";
    Promise.all([
      pb.collection("cases").getFullList({ filter: `project="${activeProject.id}"&&deleted_at=""`, fields }),
      pb.collection("documents").getFullList({ filter: `project="${activeProject.id}"&&deleted_at=""`, fields }),
      pb.collection("codes").getFullList({ filter: `project="${activeProject.id}"&&deleted_at=""`, fields }),
      pb.collection("annotations").getFullList({ filter: `document.project="${activeProject.id}"&&deleted_at=""`, fields }),
      pb.collection("memos").getFullList({ filter: `project="${activeProject.id}"&&deleted_at=""`, fields }),
      pb.collection("code_reports").getFullList({ filter: `project="${activeProject.id}"&&deleted_at=""`, fields }),
      pb.collection("coder_reports").getFullList({ filter: `project="${activeProject.id}"&&deleted_at=""`, fields }),
      pb.collection("ai_analyses").getFullList({ filter: `project="${activeProject.id}"&&deleted_at=""`, fields }),
    ])
      .then(([caseRecords, documentRecords, codeRecords, annotationRecords, memoRecords, codeReportRecords, coderReportRecords, analysisRecords]) => {
        if (cancelled) return;
        const next: Record<string, ActivityCounts> = {};
        const addRecord = (record: Record<string, unknown>, field: keyof ActivityCounts) => {
          const userId = typeof record.created_by === "string" ? record.created_by : "";
          const userIdentifier = typeof record.created_by_identifier === "string" ? record.created_by_identifier : "";
          if (userId) incrementActivityCount(next, userId, field);
          else if (userIdentifier) incrementActivityCount(next, `identifier:${userIdentifier}`, field);
        };

        caseRecords.forEach((record) => addRecord(record as Record<string, unknown>, "casesCreated"));
        documentRecords.forEach((record) => addRecord(record as Record<string, unknown>, "documentsCreated"));
        codeRecords.forEach((record) => addRecord(record as Record<string, unknown>, "codesCreated"));
        annotationRecords.forEach((record) => addRecord(record as Record<string, unknown>, "annotationsCreated"));
        memoRecords.forEach((record) => addRecord(record as Record<string, unknown>, "memosCreated"));
        [...codeReportRecords, ...coderReportRecords, ...analysisRecords].forEach((record) => addRecord(record as Record<string, unknown>, "reportsCreated"));
        setActivityCountsByUser(next);
      })
      .catch((loadError) => {
        console.error("Failed to load user activity counts:", loadError);
        if (!cancelled) setActivityCountsByUser({});
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProject, pb]);

  useEffect(() => {
    if (selectedImportedUser && availableUsers.length === 0 && !availableUsersLoading) {
      void loadAvailableUsers();
    }
  }, [selectedImportedUser, availableUsers.length, availableUsersLoading, loadAvailableUsers]);

  // ── Close context menu on outside click / Escape ──────────────────────────

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // ── Sort ──────────────────────────────────────────────────────────────────

  const sorted = [...rows].sort((a, b) => {
    const cmp = String(a[sortCol]).localeCompare(
      String(b[sortCol]),
      undefined,
      { sensitivity: "base" },
    );
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const ownerCount = rows.filter((row) => row.role === "owner").length;
  const assignableRoles = getAssignableRoles(canTransferOwnership);
  const nowMs = Date.now();
  const activePresenceUserIds = useMemo(
    () => new Set(activeProjectPresenceUsers.map((entry: ProjectPresenceEntry) => entry.userId)),
    [activeProjectPresenceUsers],
  );
  const visibleActivityMembers = useMemo(
    () =>
      rows.filter((row) =>
        canViewActivityRow({
          appRole,
          projectRole: userRole,
          currentUserId: currentUser?.id ?? null,
          row,
        })),
    [appRole, currentUser?.id, rows, userRole],
  );
  const activityRows = useMemo<ActivityRow[]>(() => (
    visibleActivityMembers
      .map((row) => {
        const counts = activityCountsByUser[row.userId]
          ?? activityCountsByUser[`identifier:${row.userIdentifier}`]
          ?? buildEmptyActivityCounts();
        const active = activePresenceUserIds.has(row.userId);
        return {
          userId: row.userId,
          userIdentifier: row.userIdentifier,
          name: row.name,
          active,
          cumulativeActiveMinutes: countUserActiveMinutes(logEntries, row.userId, active, nowMs),
          loginCount: countUserProjectLogins(logEntries, row.userId),
          casesCreated: counts.casesCreated,
          documentsCreated: counts.documentsCreated,
          codesCreated: counts.codesCreated,
          annotationsCreated: counts.annotationsCreated,
          memosCreated: counts.memosCreated,
          reportsCreated: counts.reportsCreated,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
  ), [activityCountsByUser, activePresenceUserIds, logEntries, nowMs, visibleActivityMembers]);

  function getEditableRolesForRow(row: MemberRow): Role[] {
    if (row.role === "owner" && (!canTransferOwnership || ownerCount <= 1)) return ["owner"];
    return assignableRoles;
  }

  function canEditRoleForRow(row: MemberRow): boolean {
    if (!canChangeRoles) return false;
    if (row.role === "owner" && !canTransferOwnership) return false;
    return true;
  }

  function getRemoveBlockReason(row: MemberRow | null): string | null {
    if (!row) return "No user selected.";
    if (!canRemoveMembers) return "You do not have permission to remove users from this project.";
    if (row.userId === currentUser?.id) return "You cannot remove your own account from the project here.";
    if (row.role === "owner" && !canTransferOwnership) {
      return "Only project owners or administrators can remove a project owner.";
    }
    if (row.role === "owner" && ownerCount <= 1) {
      return "A project must always have at least one owner.";
    }
    return null;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleRemoveFromProject() {
    if (!confirmDelete || !pb) return;
    const blockReason = getRemoveBlockReason(confirmDelete);
    if (blockReason) {
      setError(blockReason);
      setConfirmDelete(null);
      return;
    }
    setDeleteLoading(true);
    try {
      await ensureProjectSafetyBackup(
        "member.remove",
        `Removed "${confirmDelete.name}" from project`,
      );
      await pb.collection("project_members").delete(confirmDelete.memberId);
      if (activeProject) await logAction(activeProject.id, "member.remove", `Removed "${confirmDelete.name}" from project`, confirmDelete.memberId, {
        entityType: "project_member",
        userId: confirmDelete.userId,
        userIdentifier: confirmDelete.userIdentifier,
        role: confirmDelete.role,
      });
      setRows((prev) => prev.filter((r) => r.memberId !== confirmDelete.memberId));
      setSelectedRow((prev) => (prev?.memberId === confirmDelete.memberId ? null : prev));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove user.");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Detail view ───────────────────────────────────────────────────────────

  if (selectedRow && pb && activeProject) {
    return (
      <>
        <UserDetail
          row={selectedRow}
          pb={pb}
          projectId={activeProject.id}
          canEdit={canEditRoleForRow(selectedRow)}
          canRemove={!getRemoveBlockReason(selectedRow)}
          onBack={() => setSelectedRow(null)}
          onRequestEdit={(row) => setEditRow(row)}
          onRequestRemove={(row) => setConfirmDelete(row)}
        />

        {editRow && (
        <EditMemberModal
          row={editRow}
          pb={pb}
          canEdit={canEditRoleForRow(editRow)}
          allowedRoles={getEditableRolesForRow(editRow)}
          soleOwnerLocked={editRow.role === "owner" && ownerCount <= 1}
          onLog={(action, label, recordId, details) => activeProject && logAction(activeProject.id, action, label, recordId, details)}
          onDone={(updatedRole) => {
              setRows((prev) =>
                prev.map((row) => (row.memberId === editRow.memberId ? { ...row, role: updatedRole } : row)),
              );
              setSelectedRow((prev) =>
                prev?.memberId === editRow.memberId ? { ...prev, role: updatedRole } : prev,
              );
              setEditRow(null);
              loadMembers();
            }}
            onClose={() => setEditRow(null)}
          />
        )}

        {confirmDelete && (
          <div
            className="modal-overlay"
            onClick={() => !deleteLoading && setConfirmDelete(null)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>Remove from Project</h2>
              <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                Remove <strong>{confirmDelete.name}</strong> from this project?
              </p>
              <p className="modal-warning-text">
                Their account will not be deleted - they will simply lose access
                to this project.
              </p>
              <div className="form-actions" style={{ marginTop: 24 }}>
                <button
                  className="btn"
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleteLoading}
                >
                  Cancel
                </button>
                <button
                  className="btn btn--danger"
                  onClick={handleRemoveFromProject}
                  disabled={deleteLoading}
                >
                  {deleteLoading ? "Removing..." : "Remove from Project"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      {/* Header */}
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Users</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Show Help"
            aria-label="Show Help"
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <div className="view-header-actions">
          <button
            className="btn btn--primary"
            onClick={() => setAddMemberOpen(true)}
            disabled={!canInviteMembers}
            title={!canInviteMembers ? "You do not have permission to add users to this project" : undefined}
          >
            + Add User
          </button>
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
        <div className="segmented-control" role="tablist" aria-label="User workspace views">
          <button
            type="button"
            role="tab"
            aria-selected={!showActivityTable}
            className={showActivityTable ? "segmented-control-option" : "segmented-control-option segmented-control-option--active"}
            onClick={() => setShowActivityTable(false)}
          >
            Details
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showActivityTable}
            className={showActivityTable ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
            onClick={() => setShowActivityTable(true)}
          >
            Activity
          </button>
        </div>

        {!showActivityTable ? (
          <div
            className="users-table-wrap"
            style={{
              maxHeight:
                34 + (Math.max(loading || sorted.length === 0 ? 1 : sorted.length, 1) + 2) * 36,
            }}
          >
            <table className="users-table">
              <thead>
                <tr>
                  {COLS.map((col) => (
                    <th
                      key={col.key}
                      style={{ width: col.width }}
                      className={`users-th${sortCol === col.key ? " users-th--sorted" : ""}`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      <span className="users-sort-icon">
                        {sortCol === col.key
                          ? sortDir === "asc"
                            ? " ↑"
                            : " ↓"
                          : " ↕"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="users-td-msg">
                      Loading...
                    </td>
                  </tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr>
                    <td colSpan={6} className="users-td-msg">
                      No users found.
                    </td>
                  </tr>
                )}
                {!loading &&
                  sorted.map((row) => (
                    <tr
                      key={row.memberId}
                      className="users-row project-users-row"
                      onClick={() => setSelectedRow(row)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, row });
                      }}
                    >
                      <td className="users-td users-td--name">{row.name}</td>
                      <td className="users-td users-td--muted">{row.email}</td>
                      <td className="users-td">
                        <span className={`role-badge role-badge--${row.role}`}>
                          {ROLE_LABELS[row.role]}
                        </span>
                      </td>
                      <td className="users-td users-td--muted">{row.createdByName}</td>
                      <td className="users-td users-td--muted">{fmtDate(row.createdAt)}</td>
                      <td className="users-td users-td--muted">{row.lastLogin}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="users-table-wrap users-table-wrap--activity">
            <table className="users-table users-table--activity">
              <thead>
                <tr>
                  {ACTIVITY_COLS.map((col) => (
                    <th key={col.key} style={{ width: col.width }} className="users-th">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activityLoading && (
                  <tr>
                    <td colSpan={ACTIVITY_COLS.length} className="users-td-msg">
                      Loading activity...
                    </td>
                  </tr>
                )}
                {!activityLoading && activityRows.length === 0 && (
                  <tr>
                    <td colSpan={ACTIVITY_COLS.length} className="users-td-msg">
                      No user activity yet.
                    </td>
                  </tr>
                )}
                {!activityLoading && activityRows.map((row) => (
                  <tr key={row.userId} className="users-row">
                    <td className="users-td users-td--name">{row.name}</td>
                    <td className="users-td">
                      <span className={`users-activity-status ${row.active ? "users-activity-status--active" : "users-activity-status--inactive"}`}>
                        {row.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="users-td">{formatRoundedMinutes(row.cumulativeActiveMinutes)}</td>
                    <td className="users-td">{row.loginCount}</td>
                    <td className="users-td">{row.casesCreated}</td>
                    <td className="users-td">{row.documentsCreated}</td>
                    <td className="users-td">{row.codesCreated}</td>
                    <td className="users-td">{row.annotationsCreated}</td>
                    <td className="users-td">{row.memosCreated}</td>
                    <td className="users-td">{row.reportsCreated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>Users Help</h2>
            <p className="users-guide-copy">
              Review members and roles, add a member, open row details, edit a member role, remove a member, resolve imported users, and create a temporary password when needed.
            </p>
            <p className="users-guide-copy">
              Use this page to manage who can access the project. Add registered users to the project, inspect current roles, switch between the details and activity tabs, and resolve user-account issues after imports or restores.
            </p>
            <p className="users-guide-copy">
              User-management actions depend on project role and app role. Some imported-user flows create or reassociate workspace accounts.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setHelpOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={contextMenuStyle}
        >
          {canEditRoleForRow(contextMenu.row) && (
            <button
              className="context-menu-item"
              onClick={() => {
                setEditRow(contextMenu.row);
                setContextMenu(null);
              }}
            >
              Edit
            </button>
          )}
          {!getRemoveBlockReason(contextMenu.row) && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => {
                setConfirmDelete(contextMenu.row);
                setContextMenu(null);
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {activePendingResolution && (
        <div className="modal-overlay">
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>Imported Users Need Configuration</h2>
            <p className="import-project-copy">
              These users came from the {activePendingResolution.source === "restore" ? "restored backup" : "imported project"}.
            </p>
            <div className="users-table-wrap" style={{ maxHeight: 360 }}>
              <table className="users-table">
                <thead>
                  <tr>
                    <th className="users-th">User</th>
                    <th className="users-th">Email</th>
                    <th className="users-th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activePendingResolution.users.map((user) => (
                    <tr
                      key={user.userIdentifier}
                      className="users-row"
                      onClick={() => user.status === "no_access" && setSelectedImportedUser(user)}
                    >
                      <td className="users-td users-td--name">{user.name}</td>
                      <td className="users-td users-td--muted">{user.email}</td>
                      <td className="users-td users-td--muted">
                        {user.status === "no_access" && "No access to project"}
                        {user.status === "associated_current_user" && "Associated with current account"}
                        {user.status === "associated_existing_user" && "Associated with existing user"}
                        {user.status === "temporary_password_created" && "Temporary password created"}
                        {user.status === "removed" && "Removed from project"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={activePendingResolution.users.some((user) => user.status === "no_access")}
                onClick={() => setPendingImportedUserResolution(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedImportedUser && currentUser && (
        <div className="modal-overlay">
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>Resolve Imported User</h2>
            <p className="import-project-copy">
              Choose what to do with <strong>{selectedImportedUser.name}</strong>.
            </p>
            <div className="form">
              <button
                type="button"
                className="btn btn--primary"
                disabled={resolutionBusy}
                onClick={() => void applyImportedUserAssociation(selectedImportedUser, {
                  id: currentUser.id,
                  name: currentUser.name || currentUser.email,
                  email: currentUser.email,
                  userIdentifier: currentUser.user_identifier || "",
                }, "associated_current_user")}
              >
                This is me
              </button>
              <label className="form-label">
                Associate with an existing user
                {availableUsersLoading ? (
                  <p className="users-td users-td--muted">Loading registered users…</p>
                ) : (
                  <select
                    className="form-input"
                    value={associateUserId}
                    onChange={(e) => setAssociateUserId(e.target.value)}
                  >
                    <option value="">— select a user —</option>
                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} ({user.email})
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  disabled={resolutionBusy || !associateUserId}
                  onClick={() => {
                    const target = availableUsers.find((user) => user.id === associateUserId);
                    if (!target) return;
                    void applyImportedUserAssociation(selectedImportedUser, target, "associated_existing_user");
                  }}
                >
                  Associate with Selected User
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={resolutionBusy}
                  onClick={() => setRemoveImportedUser(selectedImportedUser)}
                >
                  Remove from Project
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={resolutionBusy}
                  onClick={() => {
                    setTempPasswordUser(selectedImportedUser);
                    setTemporaryPassword("");
                    setConfirmTemporaryPassword("");
                    setSelectedImportedUser(null);
                  }}
                >
                  Create Temporary Password
                </button>
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn" disabled={resolutionBusy} onClick={() => setSelectedImportedUser(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {tempPasswordUser && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create Temporary Password</h2>
            <p className="import-project-copy">
              Create a temporary password for <strong>{tempPasswordUser.name}</strong>.
            </p>
            <p className="modal-warning-text">
              Note this password before continuing. This user will be required to create a new password immediately after they log in.
            </p>
            <label className="form-label">
              Temporary password
              <input
                className="form-input"
                type="password"
                value={temporaryPassword}
                onChange={(e) => setTemporaryPassword(e.target.value)}
                autoFocus
                autoComplete="new-password"
              />
            </label>
            <label className="form-label">
              Confirm temporary password
              <input
                className="form-input"
                type="password"
                value={confirmTemporaryPassword}
                onChange={(e) => setConfirmTemporaryPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                disabled={resolutionBusy}
                onClick={() => {
                  setTempPasswordUser(null);
                  setTemporaryPassword("");
                  setConfirmTemporaryPassword("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={resolutionBusy}
                onClick={() => void handleCreateTemporaryPasswordAccount()}
              >
                {resolutionBusy ? "Creating..." : "Create Account"}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeImportedUser && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Remove from Project</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Remove <strong>{removeImportedUser.name}</strong> from this project?
            </p>
            <p className="modal-warning-text">
              This removes the imported user from the project reassociation flow and clears their unresolved user links.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button
                className="btn"
                onClick={() => setRemoveImportedUser(null)}
                disabled={resolutionBusy}
              >
                Cancel
              </button>
              <button
                className="btn btn--danger"
                onClick={() => void handleRemoveImportedUserFromProject()}
                disabled={resolutionBusy}
              >
                {resolutionBusy ? "Removing…" : "Remove from Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="modal-overlay"
          onClick={() => !deleteLoading && setConfirmDelete(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Remove from Project</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Remove <strong>{confirmDelete.name}</strong> from this project?
            </p>
            <p className="modal-warning-text">
              Their account will not be deleted — they will simply lose access
              to this project.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button
                className="btn"
                onClick={() => setConfirmDelete(null)}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                className="btn btn--danger"
                onClick={handleRemoveFromProject}
                disabled={deleteLoading}
              >
                {deleteLoading ? "Removing…" : "Remove from Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member modal */}
      {addMemberOpen && pb && activeProject && (
        <AddMemberModal
          projectId={activeProject.id}
          currentUserId={currentUser?.id ?? ""}
          existingMemberIds={new Set(rows.map((r) => r.userId))}
          allowedRoles={assignableRoles}
          pb={pb}
          onDone={() => { setAddMemberOpen(false); loadMembers(); }}
          onClose={() => setAddMemberOpen(false)}
          onLog={(action, label, recordId, details) => activeProject && logAction(activeProject.id, action, label, recordId, details)}
        />
      )}

      {/* Edit modal */}
      {editRow && pb && (
        <EditMemberModal
          row={editRow}
          pb={pb}
          canEdit={canEditRoleForRow(editRow)}
          allowedRoles={getEditableRolesForRow(editRow)}
          soleOwnerLocked={editRow.role === "owner" && ownerCount <= 1}
          onLog={(action, label, recordId, details) => activeProject && logAction(activeProject.id, action, label, recordId, details)}
          onDone={(updatedRole) => {
            setRows((prev) =>
              prev.map((row) => (row.memberId === editRow.memberId ? { ...row, role: updatedRole } : row)),
            );
            setSelectedRow((prev) =>
              prev?.memberId === editRow.memberId ? { ...prev, role: updatedRole } : prev,
            );
            setEditRow(null);
            loadMembers();
          }}
          onClose={() => setEditRow(null)}
        />
      )}
    </div>
  );
}
