import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "../context/StoreContext";
import type { Project, View } from "../types";
import { hasHtmlText } from "../lib/htmlText";
import helpIcon from "../assets/ic_help_outline_24px.svg";

interface RemoteStats {
  memberCount: number;
  membersByRole: Record<string, number>;
  caseCount: number;
  annotationCount: number;
  reportCount: number;
}

const RTE_TOOLS: { cmd: string; label: string; title: string }[] = [
  { cmd: "bold", label: "B", title: "Bold" },
  { cmd: "italic", label: "I", title: "Italic" },
  { cmd: "underline", label: "U", title: "Underline" },
  { cmd: "insertUnorderedList", label: "- ", title: "Bullet list" },
  { cmd: "insertOrderedList", label: "1.", title: "Numbered list" },
];

function RichTextEditor({
  initialHtml,
  editorRef,
}: {
  initialHtml: string;
  editorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const id = useId();

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
  }, [initialHtml, editorRef]);

  function execCmd(cmd: string) {
    document.getElementById(id)?.focus();
    document.execCommand(cmd, false);
  }

  return (
    <div className="rte">
      <div className="rte-toolbar">
        {RTE_TOOLS.map((tool) => (
          <button
            key={tool.cmd}
            type="button"
            className="rte-btn"
            title={tool.title}
            onMouseDown={(e) => {
              e.preventDefault();
              execCmd(tool.cmd);
            }}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <div
        id={id}
        ref={editorRef}
        className="rte-content"
        contentEditable
        suppressContentEditableWarning
      />
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function StatCard({
  title,
  count,
  stats,
  onClick,
}: {
  title: string;
  count: number | null;
  stats: { label: string; value: string | number }[];
  onClick: () => void;
}) {
  return (
    <div className="home-stat-card" onClick={onClick}>
      <div className="home-stat-title">{title}</div>
      <div className="home-stat-count">{count ?? "—"}</div>
      <div className="home-stat-details">
        {stats.map((s) => (
          <div key={s.label} className="home-stat-row">
            <span className="home-stat-label">{s.label}</span>
            <span className="home-stat-value">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomeView() {
  const { pb, activeProject, documents, codes, memos, setView, userRole, deleteProject, updateProject, closeProject } = useStore();
  const [remote, setRemote] = useState<RemoteStats | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showEditProject, setShowEditProject] = useState(false);
  const [editProjectName, setEditProjectName] = useState("");
  const [editProjectError, setEditProjectError] = useState<string | null>(null);
  const [editProjectSaving, setEditProjectSaving] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const descriptionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeProject) return;
    const pid = activeProject.id;
    let cancelled = false;

    async function load() {
      const [members, casesRes, reportsRes, annRes] = await Promise.all([
        pb.collection("project_members").getFullList({ filter: `project="${pid}"` }),
        pb.collection("cases").getList(1, 1, { filter: `project="${pid}"&&deleted_at=""` }),
        pb.collection("code_reports").getList(1, 1, { filter: `project="${pid}"&&deleted_at=""` }),
        pb.collection("annotations").getList(1, 1, { filter: `document.project="${pid}"&&deleted_at=""` }),
      ]);
      if (cancelled) return;
      const membersByRole: Record<string, number> = {};
      members.forEach((m) => { membersByRole[m.role] = (membersByRole[m.role] || 0) + 1; });
      setRemote({
        memberCount: members.length,
        membersByRole,
        caseCount: casesRes.totalItems,
        annotationCount: annRes.totalItems,
        reportCount: reportsRes.totalItems,
      });
    }

    load().catch(console.error);
    return () => { cancelled = true; };
  }, [pb, activeProject]);

  const docCount = documents.length;
  const totalWords = documents.reduce(
    (sum, d) => sum + (d.content.trim() ? d.content.trim().split(/\s+/).length : 0),
    0
  );
  const avgWords = docCount > 0 ? Math.round(totalWords / docCount) : 0;

  const codeCount = codes.length;
  const topLevel = codes.filter((c) => !c.parentId).length;
  const subCodes = codeCount - topLevel;

  const memoCount = memos.length;
  const linkedMemos = memos.filter((m) => m.documentId || m.annotationId).length;
  const showRestrictedInfo = userRole === "owner" || userRole === "editor";

  const nav = (v: View) => () => setView(v);

  useEffect(() => {
    if (!menuOpen) return;

    function syncMenuPosition() {
      const rect = menuButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({
        top: rect.bottom + 8,
        left: Math.max(12, rect.right - 180),
      });
    }

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }

    syncMenuPosition();
    window.addEventListener("resize", syncMenuPosition);
    document.addEventListener("scroll", syncMenuPosition, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", syncMenuPosition);
      document.removeEventListener("scroll", syncMenuPosition, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function handleDeleteProject() {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteProject(confirmDelete);
      setConfirmDelete(null);
      setMenuOpen(false);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete project.");
    } finally {
      setDeleteBusy(false);
    }
  }

  function openEditProjectModal() {
    setMenuOpen(false);
    setEditProjectError(null);
    setEditProjectName(activeProject?.name ?? "");
    setShowEditProject(true);
  }

  async function handleSaveProjectDetails() {
    if (!activeProject || !editProjectName.trim()) return;
    setEditProjectSaving(true);
    setEditProjectError(null);
    try {
      const descriptionHtml = descriptionRef.current?.innerHTML ?? activeProject.description ?? "";
      await updateProject(activeProject.id, {
        name: editProjectName.trim(),
        description: hasHtmlText(descriptionHtml) ? descriptionHtml.trim() : "",
      });
      setShowEditProject(false);
    } catch (e) {
      setEditProjectError(e instanceof Error ? e.message : "Failed to update project.");
    } finally {
      setEditProjectSaving(false);
    }
  }

  return (
    <div className="view home-view">
      <header className="view-header">
        <div className="home-title-wrap">
          <h1>Home</h1>
          <button
            type="button"
            className="home-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Show Help"
            aria-label="Show Help"
          >
            <img src={helpIcon} alt="" className="home-help-icon" />
          </button>
        </div>
        {userRole === "owner" && (
          <button
            ref={menuButtonRef}
            className="btn home-menu-btn"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Project actions"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        )}
      </header>

      {menuOpen && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: menuPos.top, left: menuPos.left, minWidth: 180 }}
          role="menu"
        >
          <button
            className="context-menu-item"
            type="button"
            onClick={openEditProjectModal}
          >
            Edit Project
          </button>
          <button
            className="context-menu-item"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setView("project-settings");
            }}
          >
            Project Settings
          </button>
          <button
            className="context-menu-item"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              if (activeProject) closeProject(activeProject);
              setView("projects");
            }}
          >
            Change Active Project
          </button>
          <button
            className="context-menu-item context-menu-item--danger"
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setDeleteError(null);
              setConfirmDelete(activeProject);
            }}
          >
            Delete Project
          </button>
        </div>
      )}

      <div className="home-dashboard">
        <div className="home-primary-column">
          <section className="home-project-card" aria-label="Project title">
            <div className="home-project-card-header">
              <h2>Project Title</h2>
            </div>
            <p className="home-project-title-value">{activeProject?.name ?? "Untitled Project"}</p>
          </section>

          <section className="home-project-card" aria-label="Project description">
            <div className="home-project-card-header">
              <h2>Project Description</h2>
            </div>
            {activeProject?.description && hasHtmlText(activeProject.description) ? (
              <div
                className="home-project-description rich-description"
                dangerouslySetInnerHTML={{ __html: activeProject.description }}
              />
            ) : (
              <p className="home-project-description home-project-description--empty">
                No project description has been added yet.
              </p>
            )}
          </section>

          {showRestrictedInfo && activeProject && (
            <section className="home-project-card" aria-label="Project information">
              <div className="home-project-card-header">
                <h2>Project Information</h2>
              </div>
              <div className="home-restricted-list">
                <div className="home-restricted-item">
                  <span className="home-restricted-label">Your Access</span>
                  <span className="home-restricted-value">{userRole}</span>
                </div>
                <div className="home-restricted-item">
                  <span className="home-restricted-label">Created</span>
                  <span className="home-restricted-value">{fmtDate(activeProject.createdAt)}</span>
                </div>
                <div className="home-restricted-item">
                  <span className="home-restricted-label">Last Updated</span>
                  <span className="home-restricted-value">{fmtDate(activeProject.updatedAt)}</span>
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="home-stats-grid">
        <StatCard
          title="Users"
          count={remote?.memberCount ?? null}
          stats={[
            { label: "Owners",  value: remote?.membersByRole["owner"]  ?? 0 },
            { label: "Editors", value: remote?.membersByRole["editor"] ?? 0 },
            { label: "Coders",  value: remote?.membersByRole["coder"]  ?? 0 },
            { label: "Viewers", value: remote?.membersByRole["viewer"] ?? 0 },
          ]}
          onClick={nav("users")}
        />

        <StatCard
          title="Cases"
          count={remote?.caseCount ?? null}
          stats={[
            { label: "Documents", value: docCount },
          ]}
          onClick={nav("cases")}
        />

        <StatCard
          title="Documents"
          count={docCount}
          stats={[
            { label: "Total words",   value: totalWords.toLocaleString() },
            { label: "Avg per doc",   value: avgWords.toLocaleString() },
            { label: "Annotations",   value: remote?.annotationCount ?? "—" },
          ]}
          onClick={nav("documents")}
        />

        <StatCard
          title="Codebook"
          count={codeCount}
          stats={[
            { label: "Top-level", value: topLevel },
            { label: "Sub-codes", value: subCodes },
          ]}
          onClick={nav("codebook")}
        />

        <StatCard
          title="Memos"
          count={memoCount}
          stats={[
            { label: "Linked",   value: linkedMemos },
            { label: "Unlinked", value: memoCount - linkedMemos },
          ]}
          onClick={nav("memos")}
        />

        <StatCard
          title="Reports"
          count={remote?.reportCount ?? null}
          stats={[
            { label: "Codes applied", value: remote?.annotationCount ?? "—" },
          ]}
          onClick={nav("code-reports")}
        />
        </div>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Project Home Help</h2>
            <p className="users-guide-copy">
              This page gives you a quick overview of the active project, including key project details and summary counts for the main analysis areas.
            </p>
            <p className="users-guide-copy">
              Use the summary cards to jump directly to Users, Cases, Documents, Codebook, Memos, and Reports. Project owners can also open the menu in the top right to edit project details, change settings, switch projects, or delete the project.
            </p>
            <div className="form-actions">
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

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleteBusy && setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Project</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="modal-warning-text">
              All documents, codes, annotations, memos, reports, and project settings will be permanently lost and cannot be recovered.
            </p>
            {deleteError && <p className="auth-error" style={{ marginTop: 14 }}>{deleteError}</p>}
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteBusy}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={() => void handleDeleteProject()} disabled={deleteBusy}>
                {deleteBusy ? "Deleting..." : "Delete Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditProject && activeProject && (
        <div className="modal-overlay" onClick={() => !editProjectSaving && setShowEditProject(false)}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Project</h2>
            <div className="form">
              <label className="form-label">
                Project Title
                <input
                  className="form-input"
                  value={editProjectName}
                  onChange={(e) => setEditProjectName(e.target.value)}
                  placeholder="Project title"
                  autoFocus
                />
              </label>
              <div className="form-label">
                Project Description
                <RichTextEditor initialHtml={activeProject.description} editorRef={descriptionRef} />
              </div>
              {editProjectError && <p className="auth-error">{editProjectError}</p>}
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button className="btn" onClick={() => setShowEditProject(false)} disabled={editProjectSaving}>
                  Cancel
                </button>
                <button
                  className="btn btn--primary"
                  onClick={() => void handleSaveProjectDetails()}
                  disabled={editProjectSaving || !editProjectName.trim()}
                >
                  {editProjectSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
