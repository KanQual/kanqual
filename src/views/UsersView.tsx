import { useState, useEffect, useCallback, useRef } from "react";
import type PocketBase from "pocketbase";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../types";
import type { Role } from "../types";
import { updateUserAccount } from "../lib/pb";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberRow {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdByName: string;
  createdAt: string;
  lastLogin: string;
}

type SortCol = keyof MemberRow;
type SortDir = "asc" | "desc";

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

// ─── User Detail sub-view ────────────────────────────────────────────────────

function UserDetail({
  row: initialRow,
  pb,
  projectId,
  canEdit,
  onBack,
}: {
  row: MemberRow;
  pb: PocketBase;
  projectId: string;
  canEdit: boolean;
  onBack: () => void;
}) {
  const [row, setRow]             = useState(initialRow);
  const [annotCount, setAnnotCount] = useState<number | null>(null);
  const [memoCount,  setMemoCount]  = useState<number | null>(null);

  const [editing, setEditing] = useState(false);
  const [name,    setName]    = useState(initialRow.name);
  const [email,   setEmail]   = useState(initialRow.email);
  const [role,    setRole]    = useState<Role>(initialRow.role);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

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

  function handleToggleEdit(on: boolean) {
    if (!on) {
      setName(row.name);
      setEmail(row.email);
      setRole(row.role);
      setError(null);
    }
    setEditing(on);
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const profileChanged = name !== row.name || email !== row.email;
      if (profileChanged) await updateUserAccount(row.userId, { name, email });
      if (role !== row.role)
        await pb.collection("project_members").update(row.memberId, { role });
      const updated = { ...row, name, email, role };
      setRow(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view user-detail">
      {/* Top bar */}
      <div className="user-detail-topbar">
        <button className="btn user-detail-back" onClick={onBack}>
          ← Back to Users
        </button>
        {canEdit && (
          <label className="toggle-switch" title={editing ? "Cancel editing" : "Edit user"}>
            <input
              type="checkbox"
              checked={editing}
              onChange={(e) => handleToggleEdit(e.target.checked)}
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
            <span className="toggle-label">{editing ? "Editing" : "Edit"}</span>
          </label>
        )}
      </div>

      {/* Card */}
      {editing ? (
        <form className="user-detail-card user-detail-card--editing" onSubmit={handleSave}>
          <div className="user-detail-avatar">{initials(name || row.name)}</div>
          <div className="user-detail-edit-fields">
            <label className="form-label">
              Name
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label className="form-label">
              Email
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="form-label">
              Role
              <select
                className="form-input"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="owner">Owner</option>
                <option value="editor">Editor</option>
                <option value="coder">Coder</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            {error && <p className="auth-error">{error}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => handleToggleEdit(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </form>
      ) : (
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
      )}

      <div className="user-detail-stats">
        <div className="user-detail-stat">
          <span className="user-detail-stat-value">{annotCount ?? "…"}</span>
          <span className="user-detail-stat-label">Annotations</span>
        </div>
        <div className="user-detail-stat">
          <span className="user-detail-stat-value">{memoCount ?? "…"}</span>
          <span className="user-detail-stat-label">Memos</span>
        </div>
      </div>

      <dl className="user-detail-meta">
        <dt>Created By</dt>
        <dd>{row.createdByName}</dd>
        <dt>Account Created</dt>
        <dd>{fmtDate(row.createdAt)}</dd>
        <dt>Last Login</dt>
        <dd>{row.lastLogin}</dd>
      </dl>
    </div>
  );
}

// ─── Add Member modal (pick existing user → assign role) ─────────────────────

function AddMemberModal({
  projectId,
  currentUserId,
  existingMemberIds,
  pb,
  onDone,
  onClose,
  onLog,
}: {
  projectId: string;
  currentUserId: string;
  existingMemberIds: Set<string>;
  pb: PocketBase;
  onDone: () => void;
  onClose: () => void;
  onLog: (action: string, label: string) => void;
}) {
  const [allUsers, setAllUsers]   = useState<{ id: string; name: string; email: string }[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [role, setRole]           = useState<Role>("coder");
  const [loading, setLoading]     = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    pb.collection("users")
      .getFullList({ sort: "name" })
      .then((records) =>
        setAllUsers(
          records
            .filter((r) => !existingMemberIds.has(r.id))
            .map((r) => ({ id: r.id, name: r.name || r.email, email: r.email })),
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
      await pb.collection("project_members").create({
        project:    projectId,
        user:       selectedId,
        role,
        created_by: currentUserId,
      });
      const added = allUsers.find((u) => u.id === selectedId);
      if (added) onLog("member.add", `Added "${added.name}" as ${role}`);
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
              <option value="owner">Owner</option>
              <option value="editor">Editor</option>
              <option value="coder">Coder</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
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
  onDone,
  onClose,
}: {
  row: MemberRow;
  pb: PocketBase;
  canEdit: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [email, setEmail] = useState(row.email);
  const [role, setRole] = useState<Role>(row.role);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!canEdit) return;
    setLoading(true);
    setError(null);
    try {
      const profileChanged = name !== row.name || email !== row.email;
      if (profileChanged) {
        await updateUserAccount(row.userId, { name, email });
      }
      if (role !== row.role) {
        await pb.collection("project_members").update(row.memberId, { role });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update user.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit User</h2>
        <form className="form" onSubmit={handleSubmit}>
          <label className="form-label">
            Name
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
            />
          </label>
          <label className="form-label">
            Email
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!canEdit}
            />
          </label>
          <label className="form-label">
            Role
            <select
              className="form-input"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              disabled={!canEdit}
            >
              <option value="owner">Owner</option>
              <option value="editor">Editor</option>
              <option value="coder">Coder</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          {error && <p className="auth-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            {canEdit && (
              <button
                type="submit"
                className="btn btn--primary"
                disabled={loading}
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
  { key: "createdByName", label: "Created By", width: "18%" },
  { key: "createdAt",     label: "Created",    width: "16%" },
  { key: "lastLogin",     label: "Last Login", width: "16%" },
];

// ─── Main view ────────────────────────────────────────────────────────────────

export function UsersView() {
  const { activeProject, pb, canEdit, logAction } = useStore();
  const { user: currentUser } = useAuth();

  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    row: MemberRow;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [confirmDelete, setConfirmDelete] = useState<MemberRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [selectedRow, setSelectedRow] = useState<MemberRow | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [editRow, setEditRow] = useState<MemberRow | null>(null);

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

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

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

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleRemoveFromProject() {
    if (!confirmDelete || !pb) return;
    setDeleteLoading(true);
    try {
      await pb.collection("project_members").delete(confirmDelete.memberId);
      if (activeProject) await logAction(activeProject.id, "member.remove", `Removed "${confirmDelete.name}" from project`);
      setRows((prev) => prev.filter((r) => r.memberId !== confirmDelete.memberId));
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
      <UserDetail
        row={selectedRow}
        pb={pb}
        projectId={activeProject.id}
        canEdit={canEdit}
        onBack={() => setSelectedRow(null)}
      />
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      {/* Header */}
      <header className="view-header">
        <h1>Users</h1>
        {canEdit && (
          <button
            className="btn btn--primary"
            onClick={() => setAddMemberOpen(true)}
          >
            + Add Member
          </button>
        )}
      </header>

      {error && <p className="users-error">{error}</p>}

      {/* Table */}
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
                  Loading…
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
                  className="users-row"
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
                  <td className="users-td users-td--muted">
                    {row.createdByName}
                  </td>
                  <td className="users-td users-td--muted">
                    {fmtDate(row.createdAt)}
                  </td>
                  <td className="users-td users-td--muted">{row.lastLogin}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              setEditRow(contextMenu.row);
              setContextMenu(null);
            }}
          >
            Edit
          </button>
          {canEdit && contextMenu.row.userId !== currentUser?.id && (
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
          pb={pb}
          onDone={() => { setAddMemberOpen(false); loadMembers(); }}
          onClose={() => setAddMemberOpen(false)}
          onLog={(action, label) => activeProject && logAction(activeProject.id, action, label)}
        />
      )}

      {/* Edit modal */}
      {editRow && pb && (
        <EditMemberModal
          row={editRow}
          pb={pb}
          canEdit={canEdit}
          onDone={() => {
            setEditRow(null);
            loadMembers();
          }}
          onClose={() => setEditRow(null)}
        />
      )}
    </div>
  );
}
