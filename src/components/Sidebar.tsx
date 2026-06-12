import { useEffect, useMemo, useState } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/provider";
import type { View } from "../types";
import { LOCAL_PB_URL } from "../lib/authHistory";

// inline SVG raw imports (avoid mask issues in WebView)
import computerLineIconRaw from "../assets/computer-line.svg?raw";
import networkIconRaw from "../assets/network--2.svg?raw";
import remoteWorkIconRaw from "../assets/link-45deg.svg?raw";
import aiAssistReadyIconRaw from "../assets/cog-line.svg?raw";
import aiAssistUnavailableIconRaw from "../assets/cog-outline-alerted.svg?raw";
import aiAssistDisabledIconRaw from "../assets/cog-line-disabled.svg?raw";
import usersGroupIconRaw from "../assets/users-group-line.svg?raw";
import closeProjectIconRaw from "../assets/x.svg?raw";
import sidebarLogo from "../assets/logo-no-background.png";

const NAV_SECTION_KEYS = [
  "project",
  "analysis",
  "reports",
  "ai-assist",
  "settings",
] as const;

function createDefaultSidebarOpenState() {
  return Object.fromEntries(NAV_SECTION_KEYS.map((sectionKey) => [sectionKey, false])) as Record<string, boolean>;
}

export function Sidebar() {
  const { t } = useI18n();
  const {
    view,
    setView,
    activeProject,
    closeProject,
    userRole,
    networkMode,
    canCurrentUser,
    activeProjectPresenceUsers,
    projectAiAssistSettings,
    projectAiAssistRuntimeStatus,
    projectEmbeddingBuildStatus,
    embeddingModelDownloadStatus,
  } = useStore();
  const { user, logout, serverUrl } = useAuth();
  const aiAssistEnabledForProject = projectAiAssistSettings.enabled;

  const projectNameFontSize = useMemo(() => {
    if (!activeProject) return 22;

    const availablePx = 144;
    const maxPx = 22;
    const minPx = 10;
    const longestWord = activeProject.name
      .split(/\s+/)
      .reduce((a, b) => (a.length > b.length ? a : b), "");

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return maxPx;

    for (let size = maxPx; size >= minPx; size -= 0.5) {
      ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
      if (ctx.measureText(longestWord).width <= availablePx) return size;
    }

    return minPx;
  }, [activeProject]);

  const [open, setOpen] = useState<Record<string, boolean>>(() => createDefaultSidebarOpenState());

  const isRemoteBackendSession = serverUrl !== LOCAL_PB_URL;
  const navSections: {
    key: string;
    label: string;
    items: { view: View; label: string }[];
  }[] = [
    {
      key: "project",
      label: t("sidebar.sections.project"),
      items: [
        { view: "home", label: t("sidebar.items.home") },
        { view: "users", label: t("sidebar.items.users") },
        { view: "cases", label: t("sidebar.items.cases") },
        { view: "documents", label: t("sidebar.items.documents") },
        { view: "codebook", label: t("sidebar.items.codebook") },
        { view: "annotations", label: t("sidebar.items.annotations") },
      ],
    },
    {
      key: "analysis",
      label: t("sidebar.sections.analysis"),
      items: [
        { view: "code-text", label: t("sidebar.items.codeText") },
        { view: "memos", label: t("sidebar.items.memos") },
      ],
    },
    {
      key: "reports",
      label: t("sidebar.sections.reports"),
      items: [
        { view: "code-reports", label: t("sidebar.items.annotations") },
        { view: "codes", label: t("sidebar.items.codebook") },
        { view: "coders", label: t("sidebar.items.users") },
      ],
    },
    {
      key: "ai-assist",
      label: t("sidebar.sections.aiAssist"),
      items: [
        { view: "ai-assist", label: t("sidebar.items.home") },
        { view: "ai-assist-process-documents", label: t("sidebar.items.process") },
        { view: "ai-assist-chat", label: t("sidebar.items.chat") },
        { view: "ai-assisted-coding", label: t("sidebar.items.code") },
        { view: "ai-assist-case-attributes", label: t("sidebar.items.attributes") },
        { view: "ai-analyze", label: t("sidebar.items.analyze") },
      ],
    },
    {
      key: "settings",
      label: t("sidebar.sections.settings"),
      items: [
        { view: "app-settings", label: t("sidebar.items.appSettings") },
        { view: "project-settings", label: t("sidebar.items.projectSettings") },
        { view: "user-settings", label: t("sidebar.items.userSettings") },
      ],
    },
  ];
  const networkBadgeState = isRemoteBackendSession ? "remote" : networkMode;
  const networkBadgeTitle = isRemoteBackendSession
    ? t("sidebar.badges.networkRemote", { serverUrl })
    : networkMode === "lan"
      ? t("sidebar.badges.networkLan")
      : t("sidebar.badges.networkLocal");
  const aiBackgroundJobRunning =
    embeddingModelDownloadStatus?.phase === "downloading"
    || embeddingModelDownloadStatus?.phase === "cancelling"
    || (activeProject != null
      && projectEmbeddingBuildStatus?.projectId === activeProject.id
      && (projectEmbeddingBuildStatus.phase === "running" || projectEmbeddingBuildStatus.phase === "cancelling"));
  const aiRuntimeReady =
    Boolean(activeProject)
    && Boolean(projectAiAssistRuntimeStatus.hostLlmEnabled)
    && Boolean(projectAiAssistRuntimeStatus.hostLlmModelSelected)
    && Boolean(projectAiAssistRuntimeStatus.hostLlmConnectionLive)
    && Boolean(projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled);
  const aiBadgeState = aiBackgroundJobRunning
    ? "running"
    : !activeProject
      ? "unavailable"
      : !aiAssistEnabledForProject
        ? "disabled"
        : aiRuntimeReady
          ? "ready"
          : "unavailable";
  const aiBadgeTitle =
    aiBadgeState === "running"
      ? t("sidebar.badges.aiRunning")
      : !activeProject
        ? t("sidebar.badges.aiNoProject")
        : aiBadgeState === "disabled"
          ? t("sidebar.badges.aiDisabled")
          : aiBadgeState === "ready"
            ? t("sidebar.badges.aiReady")
            : t("sidebar.badges.aiUnavailable");
  const otherActiveUsersCount = activeProject
    ? activeProjectPresenceUsers.filter((entry) => entry.userId !== user?.id).length
    : 0;
  const collaborationBadgeState = !activeProject
    ? "disabled"
    : otherActiveUsersCount > 0
      ? "active"
      : "idle";
  const collaborationBadgeTitle = !activeProject
    ? t("sidebar.badges.collaborationNoProject")
    : otherActiveUsersCount === 0
      ? t("sidebar.badges.collaborationNone")
      : otherActiveUsersCount === 1
        ? t("sidebar.badges.collaborationOne")
        : t("sidebar.badges.collaborationMany", { count: otherActiveUsersCount });

  function openAppSettingsModal(modalId: "network" | "llm") {
    sessionStorage.setItem("kanqual:open-app-settings-modal", modalId);
    window.dispatchEvent(new CustomEvent("kanqual:open-app-settings-modal"));
    setView("app-settings");
  }

  function openProjectUsersActivity() {
    sessionStorage.setItem("kanqual:open-project-users-tab", "activity");
    setView("users");
  }

  function handleNetworkBadgeActivate() {
    openAppSettingsModal("network");
  }

  function handleAiBadgeActivate() {
    setView("ai-assist");
  }

  function handleUsersBadgeActivate() {
    if (!activeProject) return;
    openProjectUsersActivity();
  }

  function toggleSection(key: string) {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  useEffect(() => {
    setOpen((prev) => {
      const next = { ...createDefaultSidebarOpenState(), ...prev };
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && prevKeys.every((key) => prev[key] === next[key])) {
        return prev;
      }
      return next;
    });
  }, []);

  function isNavItemActive(targetView: View): boolean {
    return view === targetView;
  }

  function isAiAssistNavItemAllowed(targetView: View): boolean {
    if (targetView === "ai-assist") return canCurrentUser("viewAiAssistHome");
    if (targetView === "ai-assist-process-documents") return canCurrentUser("useAiProcessDocuments");
    if (targetView === "ai-assist-chat") return canCurrentUser("useAiChat");
    if (targetView === "ai-assisted-coding") return canCurrentUser("useAiCodingTools");
    if (targetView === "ai-assist-case-attributes") return canCurrentUser("useAiAttributeTools");
    if (targetView === "ai-analyze") return canCurrentUser("useAiAnalyzeTools");
    return true;
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={sidebarLogo} alt="Kanqual" className="brand-logo" />
        <button
          type="button"
          className={`sidebar-icon-button brand-network-badge brand-status-badge brand-network-badge--${networkBadgeState}`}
          title={networkBadgeTitle}
          aria-label={networkBadgeTitle}
          onClick={handleNetworkBadgeActivate}
          onPointerUp={handleNetworkBadgeActivate}
        >
          <span
            aria-hidden="true"
            className="brand-network-icon"
            dangerouslySetInnerHTML={{
              __html: isRemoteBackendSession
                ? remoteWorkIconRaw
                : networkMode === "lan"
                ? networkIconRaw
                : computerLineIconRaw,
            }}
          />
        </button>
        <button
          type="button"
          className={`sidebar-icon-button brand-ai-badge brand-status-badge brand-ai-badge--${aiBadgeState}`}
          title={aiBadgeTitle}
          aria-label={aiBadgeTitle}
          onClick={handleAiBadgeActivate}
          onPointerUp={handleAiBadgeActivate}
        >
          <span
            aria-hidden="true"
            className="brand-ai-icon"
            dangerouslySetInnerHTML={{
              __html:
                aiBadgeState === "disabled"
                  ? aiAssistDisabledIconRaw
                  : aiBadgeState === "ready"
                    ? aiAssistReadyIconRaw
                    : aiAssistUnavailableIconRaw,
            }}
          />
        </button>
        <button
          type="button"
          className={`sidebar-icon-button brand-collaboration-badge brand-status-badge brand-collaboration-badge--${collaborationBadgeState}`}
          title={collaborationBadgeTitle}
          aria-label={collaborationBadgeTitle}
          onClick={handleUsersBadgeActivate}
          onPointerUp={handleUsersBadgeActivate}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleUsersBadgeActivate();
            }
          }}
          aria-disabled={!activeProject}
        >
          <span
            aria-hidden="true"
            className="brand-collaboration-icon"
            dangerouslySetInnerHTML={{ __html: usersGroupIconRaw }}
          />
        </button>
      </div>

      {activeProject ? (
        <div className="sidebar-project-badge">
          <span className="project-badge-label">{t("sidebar.projectBadge.label")}</span>
          <div className="project-badge-row">
            <span className="project-badge-name" style={{ fontSize: projectNameFontSize }}>
              {activeProject.name}
            </span>
            <button
              type="button"
              className="sidebar-icon-button project-badge-close"
              title={t("sidebar.projectBadge.closeProject")}
              aria-label={t("sidebar.projectBadge.closeProject")}
              onClick={() => void closeProject(activeProject)}
              onPointerUp={() => void closeProject(activeProject)}
            >
              <span
                aria-hidden="true"
                className="project-badge-close-icon"
                dangerouslySetInnerHTML={{ __html: closeProjectIconRaw }}
              />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="sidebar-project-badge sidebar-project-badge--empty"
          onClick={() => setView("projects")}
        >
          <span className="project-badge-label">{t("sidebar.projectBadge.label")}</span>
          <span className="project-badge-empty-text" style={{ fontSize: projectNameFontSize }}>
            {t("sidebar.projectBadge.openProject")}
          </span>
        </button>
      )}

      <nav className="sidebar-nav">
        {navSections.map((section) => (
          <div key={section.key} className="sidebar-section">
            <button
              type="button"
              className="sidebar-section-header"
              onClick={() => toggleSection(section.key)}
              aria-expanded={open[section.key]}
            >
              <span>{section.label}</span>
              <span className="sidebar-section-chevron">
                {open[section.key] ? "\u25BE" : "\u25B8"}
              </span>
            </button>

            {open[section.key] && (
              <div className="sidebar-section-items">
                {section.items.map(({ view: nextView, label }) => {
                  const aiAssistPermissionDenied =
                    section.key === "ai-assist" && !isAiAssistNavItemAllowed(nextView);
                  const aiAssistItemDisabled =
                    section.key === "ai-assist" &&
                    Boolean(activeProject) &&
                    !aiAssistEnabledForProject &&
                    nextView !== "ai-assist";
                  const settingsItemDisabled =
                    section.key === "settings" &&
                    nextView === "project-settings" &&
                    !activeProject;
                  const itemDisabled =
                    (section.key !== "settings" && !activeProject)
                    || aiAssistItemDisabled
                    || aiAssistPermissionDenied
                    || settingsItemDisabled;
                  const itemTitle =
                    settingsItemDisabled
                      ? t("sidebar.nav.openProjectFirst")
                      : section.key !== "settings" && !activeProject
                        ? t("sidebar.nav.openProjectFirst")
                        : aiAssistPermissionDenied
                          ? t("sidebar.nav.aiPermissionDenied")
                          : aiAssistItemDisabled
                            ? t("sidebar.nav.enableAi")
                            : undefined;

                  return (
                    <button
                      key={nextView}
                      type="button"
                      className={`nav-item ${isNavItemActive(nextView) ? "nav-item--active" : ""}`}
                      onClick={() => setView(nextView)}
                      disabled={itemDisabled}
                      title={itemTitle}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-user">
        <div className="sidebar-user-info">
          <div className="sidebar-user-name" title={user?.email ?? undefined}>
            {user?.name || user?.email}
          </div>
          {userRole && (
            <span className={`role-badge role-badge--${userRole}`}>
              {t(`sidebar.roles.${userRole}`)}
            </span>
          )}
        </div>
        <button type="button" className="sidebar-logout" onClick={logout} title={t("sidebar.user.signOutTitle")}>
          {"\u21A9"}
        </button>
      </div>
    </aside>
  );
}
