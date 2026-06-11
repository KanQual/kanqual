import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "../context/StoreContext";
import {
  loadProjectBackupBannerIssue,
  OPEN_PROJECT_SETTINGS_MODAL_EVENT,
  PROJECT_BACKUPS_CHANGED_EVENT,
  type ProjectBackupBannerIssue,
} from "../lib/projectBackupBanner";
import { loadProjectBackupManifest } from "../lib/projectBackups";
import type { Project, View } from "../types";
import { hasHtmlText } from "../lib/htmlText";
import { HelpIcon } from "../components/AppIcons";
import { formatCurrentDateTime, formatCurrentNumber } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";

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
    return formatCurrentDateTime(iso, {
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
  count: string | number | null;
  stats: { label: string; value: string | number }[];
  onClick: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="home-stat-card" onClick={onClick}>
      <div className="home-stat-title">{title}</div>
      <div className="home-stat-count">{count ?? "—"}</div>
      <div className="home-stat-details">
        {stats.map((s) => (
          <div
            key={
              s.label === "Avg per doc"
                ? t("projectHome.stats.avgPerDoc")
                : s.label === "Annotations"
                  ? t("projectHome.stats.annotations")
                  : s.label
            }
            className="home-stat-row"
          >
            <span className="home-stat-label">
              {s.label === "Avg per doc"
                ? t("projectHome.stats.avgPerDoc")
                : s.label === "Annotations"
                  ? t("projectHome.stats.annotations")
                  : s.label}
            </span>
            <span className="home-stat-value">
              {typeof s.value === "number" ? formatCurrentNumber(s.value) : s.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomeView() {
  const { t } = useI18n();
  const { pb, activeProject, documents, codes, memos, logEntries, setView, userRole, canCurrentUser, deleteProject, updateProject, closeProject } = useStore();
  const [remote, setRemote] = useState<RemoteStats | null>(null);
  const [backupCardIssue, setBackupCardIssue] = useState<ProjectBackupBannerIssue | null>(null);
  const [backupCount, setBackupCount] = useState(0);
  const [latestBackupAt, setLatestBackupAt] = useState("");
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
      const [members, casesRes, reportsRes, analysesRes, annRes] = await Promise.all([
        pb.collection("project_members").getFullList({ filter: `project="${pid}"` }),
        pb.collection("cases").getList(1, 1, { filter: `project="${pid}"&&deleted_at=""` }),
        pb.collection("code_reports").getList(1, 1, { filter: `project="${pid}"&&deleted_at=""` }),
        pb.collection("ai_analyses").getList(1, 1, { filter: `project="${pid}"&&deleted_at=""` }),
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
        reportCount: reportsRes.totalItems + analysesRes.totalItems,
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
  const canAccessBackups = canCurrentUser("manageBackupsAndRestores") || canCurrentUser("restoreProjectBackup");
  const lastProjectUpdateAt =
    logEntries.find((entry) => entry.action !== "project.open" && entry.action !== "project.close")?.occurredAt
    || logEntries[0]?.occurredAt
    || activeProject?.updatedAt
    || activeProject?.createdAt
    || "";

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

  useEffect(() => {
    let cancelled = false;

    async function refreshBackupCard() {
      if (!activeProject || !canAccessBackups) {
        if (!cancelled) {
          setBackupCardIssue(null);
          setBackupCount(0);
          setLatestBackupAt("");
        }
        return;
      }

      const [manifest, issue] = await Promise.all([
        loadProjectBackupManifest(activeProject),
        loadProjectBackupBannerIssue(activeProject),
      ]);

      if (cancelled) return;
      setBackupCount(manifest.backups.length);
      setLatestBackupAt(manifest.latestBackupAt || manifest.backups[0]?.createdAt || "");
      setBackupCardIssue(issue);
    }

    void refreshBackupCard();

    function handleBackupsChanged(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail as { projectId?: string } | undefined : undefined;
      if (detail?.projectId && activeProject && detail.projectId !== activeProject.id) return;
      void refreshBackupCard();
    }

    window.addEventListener(PROJECT_BACKUPS_CHANGED_EVENT, handleBackupsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(PROJECT_BACKUPS_CHANGED_EVENT, handleBackupsChanged);
    };
  }, [activeProject, canAccessBackups]);

  async function handleDeleteProject() {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteProject(confirmDelete);
      setConfirmDelete(null);
      setMenuOpen(false);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : t("projectHome.deleteFailed"));
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
      setEditProjectError(e instanceof Error ? e.message : t("projectHome.editModal.updateFailed"));
    } finally {
      setEditProjectSaving(false);
    }
  }

  function openBackupSettings() {
    sessionStorage.setItem("kanqual:open-project-settings-modal", "backups");
    window.dispatchEvent(new CustomEvent(OPEN_PROJECT_SETTINGS_MODAL_EVENT));
    setView("project-settings");
  }

  return (
    <div className="view home-view">
      <header className="view-header">
        <div className="home-title-wrap">
          <h1>{t("projectHome.title")}</h1>
          <button
            type="button"
            className="home-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Show Help"
            aria-label={t("projectHome.openHelp")}
          >
            <HelpIcon className="home-help-icon" />
          </button>
        </div>
        {userRole === "owner" && (
          <button
            ref={menuButtonRef}
            className="btn"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t("projectHome.actionsLabel")}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {t("projectHome.actions")}
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
            {t("projectHome.editProject")}
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
            {t("projectHome.changeActiveProject")}
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
            {t("projectHome.deleteProject")}
          </button>
        </div>
      )}

      <div className="home-dashboard">
        <div className="home-primary-column">
          <section className="home-project-card" aria-label={t("projectHome.projectTitle")}>
            <div className="home-project-card-header">
              <h2>{t("projectHome.projectTitle")}</h2>
            </div>
            <p className="home-project-title-value">{activeProject?.name ?? t("projectHome.untitledProject")}</p>
          </section>

          <section className="home-project-card" aria-label={t("projectHome.projectDescription")}>
            <div className="home-project-card-header">
              <h2>{t("projectHome.projectDescription")}</h2>
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
            <section className="home-project-card" aria-label={t("projectHome.projectInformation")}>
              <div className="home-project-card-header">
                <h2>{t("projectHome.projectInformation")}</h2>
              </div>
              <div className="home-restricted-list">
                <div className="home-restricted-item">
                  <span className="home-restricted-label">{t("projectHome.yourAccess")}</span>
                  <span className="home-restricted-value">{userRole}</span>
                </div>
                <div className="home-restricted-item">
                  <span className="home-restricted-label">{t("projectHome.created")}</span>
                  <span className="home-restricted-value">{fmtDate(activeProject.createdAt)}</span>
                </div>
                <div className="home-restricted-item">
                  <span className="home-restricted-label">{t("projectHome.lastUpdated")}</span>
                  <span className="home-restricted-value">{fmtDate(lastProjectUpdateAt)}</span>
                </div>
              </div>
            </section>
          )}

          {activeProject && canAccessBackups && (
            <button
              type="button"
              className={`home-project-card home-project-card--interactive home-project-card--backup${
                backupCardIssue ? " home-project-card--backup-error" : ""
              }`}
              aria-label={t("projectHome.openBackups")}
              onClick={openBackupSettings}
            >
              <div className="home-project-card-header">
                <h2>{t("projectHome.backups")}</h2>
              </div>
              <div className="home-restricted-list">
                <div className="home-restricted-item">
                  <span className="home-restricted-label">{t("projectHome.mostRecent")}</span>
                  <span className="home-restricted-value">{fmtDate(latestBackupAt)}</span>
                </div>
                <div className="home-restricted-item">
                  <span className="home-restricted-label">{t("projectHome.totalBackups")}</span>
                  <span className="home-restricted-value">{backupCount}</span>
                </div>
              </div>
              {backupCardIssue ? (
                <div className="home-backup-card-alert">
                  <strong>
                    {backupCardIssue.kind === "failed"
                      ? "Backup attention needed"
                      : backupCardIssue.kind === "interrupted"
                        ? "Backup may be incomplete"
                        : "No backups available"}
                  </strong>
                  <span>{backupCardIssue.message}</span>
                </div>
              ) : null}
            </button>
          )}
        </div>

        <div className="home-stats-grid">
        <StatCard
          title={t("projectHome.stats.users")}
          count={remote?.memberCount != null ? formatCurrentNumber(remote.memberCount) : null}
          stats={[
            { label: t("projectHome.stats.owners"), value: remote?.membersByRole["owner"] ?? 0 },
            { label: t("projectHome.stats.editors"), value: remote?.membersByRole["editor"] ?? 0 },
            { label: t("projectHome.stats.coders"), value: remote?.membersByRole["coder"] ?? 0 },
            { label: t("projectHome.stats.viewers"), value: remote?.membersByRole["viewer"] ?? 0 },
          ]}
          onClick={nav("users")}
        />

        <StatCard
          title={t("projectHome.stats.cases")}
          count={remote?.caseCount != null ? formatCurrentNumber(remote.caseCount) : null}
          stats={[
            { label: t("projectHome.stats.documents"), value: docCount },
          ]}
          onClick={nav("cases")}
        />

        <StatCard
          title={t("projectHome.stats.documents")}
          count={formatCurrentNumber(docCount)}
          stats={[
            { label: t("projectHome.stats.totalWords"), value: formatCurrentNumber(totalWords) },
            { label: t("projectHome.stats.avgPerDoc"), value: formatCurrentNumber(avgWords) },
            { label: "Annotations",   value: remote?.annotationCount ?? "—" },
          ]}
          onClick={nav("documents")}
        />

        <StatCard
          title={t("projectHome.stats.codebook")}
          count={formatCurrentNumber(codeCount)}
          stats={[
            { label: t("projectHome.stats.topLevel"), value: topLevel },
            { label: t("projectHome.stats.subcodes"), value: subCodes },
          ]}
          onClick={nav("codebook")}
        />

        <StatCard
          title={t("projectHome.stats.memos")}
          count={formatCurrentNumber(memoCount)}
          stats={[
            { label: t("projectHome.stats.linked"), value: linkedMemos },
            { label: t("projectHome.stats.unlinked"), value: memoCount - linkedMemos },
          ]}
          onClick={nav("memos")}
        />

        <StatCard
          title={t("projectHome.stats.reports")}
          count={remote?.reportCount != null ? formatCurrentNumber(remote.reportCount) : null}
          stats={[
            { label: t("projectHome.stats.codesApplied"), value: remote?.annotationCount ?? "—" },
          ]}
          onClick={nav("code-reports")}
        />
        </div>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectHome.help.title")}</h2>
            <p className="users-guide-copy">
              {t("projectHome.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("projectHome.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("projectHome.help.line3")}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setHelpOpen(false)}
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleteBusy && setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectHome.deleteModal.title")}</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("projectHome.deleteModal.body", { projectName: confirmDelete.name })}
            </p>
            <p className="modal-warning-text">
              All documents, codes, annotations, memos, reports, and project settings will be permanently lost and cannot be recovered.
            </p>
            {deleteError && <p className="auth-error" style={{ marginTop: 14 }}>{deleteError}</p>}
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteBusy}>
                {t("common.cancel")}
              </button>
              <button className="btn btn--danger" onClick={() => void handleDeleteProject()} disabled={deleteBusy}>
                {deleteBusy ? t("projectSettings.shell.deleting") : t("projectHome.deleteProject")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditProject && activeProject && (
        <div className="modal-overlay" onClick={() => !editProjectSaving && setShowEditProject(false)}>
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectHome.editModal.title")}</h2>
            <div className="form">
              <label className="form-label">
                {t("projectHome.editModal.projectTitle")}
                <input
                  className="form-input"
                  value={editProjectName}
                  onChange={(e) => setEditProjectName(e.target.value)}
                  placeholder={t("projectHome.editModal.projectTitlePlaceholder")}
                  autoFocus
                />
              </label>
              <div className="form-label">
                {t("projectHome.editModal.projectDescription")}
                <RichTextEditor initialHtml={activeProject.description} editorRef={descriptionRef} />
              </div>
              {editProjectError && <p className="auth-error">{editProjectError}</p>}
              <div className="form-actions" style={{ marginTop: 20 }}>
                <button className="btn" onClick={() => setShowEditProject(false)} disabled={editProjectSaving}>
                  {t("common.cancel")}
                </button>
                <button
                  className="btn btn--primary"
                  onClick={() => void handleSaveProjectDetails()}
                  disabled={editProjectSaving || !editProjectName.trim()}
                >
                  {editProjectSaving ? t("projectSettings.shell.saving") : t("projectHome.editModal.saveChanges")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
