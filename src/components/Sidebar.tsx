import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../types";
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

const NAV_SECTIONS: {
  key: string;
  label: string;
  items: { view: View; label: string }[];
}[] = [
  {
    key: "project",
    label: "Project",
    items: [
      { view: "home", label: "Home" },
      { view: "users", label: "Users" },
      { view: "cases", label: "Cases" },
      { view: "documents", label: "Documents" },
      { view: "codebook", label: "Codebook" },
      { view: "annotations", label: "Annotations" },
    ],
  },
  {
    key: "analysis",
    label: "Analysis",
    items: [
      { view: "code-text", label: "Code" },
      { view: "memos", label: "Memos" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    items: [
      { view: "code-reports", label: "Annotations" },
      { view: "codes", label: "Codes" },
      { view: "coders", label: "Users" },
    ],
  },
  {
    key: "ai-assist",
    label: "AI Assist",
    items: [
      { view: "ai-assist", label: "Home" },
      { view: "ai-assist-process-documents", label: "Process" },
      { view: "ai-assist-chat", label: "Chat" },
      { view: "ai-assisted-coding", label: "Code" },
      { view: "ai-assist-case-attributes", label: "Attributes" },
      { view: "ai-analyze", label: "Analyze" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { view: "app-settings", label: "App Settings" },
      { view: "project-settings", label: "Project Settings" },
      { view: "user-settings", label: "User Settings" },
    ],
  },
];

function createDefaultSidebarOpenState() {
  return Object.fromEntries(NAV_SECTIONS.map((section) => [section.key, false])) as Record<string, boolean>;
}

type SidebarTooltipState = {
  text: string;
  anchorRect: DOMRect;
};

type SidebarTooltipPlacement = {
  left: number;
  top: number;
};

export function Sidebar() {
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
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<SidebarTooltipState | null>(null);
  const [tooltipPlacement, setTooltipPlacement] = useState<SidebarTooltipPlacement | null>(null);

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
  const networkBadgeState = isRemoteBackendSession ? "remote" : networkMode;
  const networkBadgeTitle = isRemoteBackendSession
    ? `Remote workspace connected (${serverUrl}). Open network settings.`
    : networkMode === "lan"
      ? "LAN workspace available to other devices. Open network settings."
      : "Local workspace only. Open network settings.";
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
      ? "AI task running in background. Open AI Assist Home."
      : !activeProject
        ? "Open a project to view project AI status. Open AI Assist Home."
      : aiBadgeState === "disabled"
        ? "AI Assist disabled for this project. Open AI Assist Home."
        : aiBadgeState === "ready"
          ? "AI Assist ready for this project. Open AI Assist Home."
          : "AI Assist setup incomplete. Open AI Assist Home.";
  const otherActiveUsersCount = activeProject
    ? activeProjectPresenceUsers.filter((entry) => entry.userId !== user?.id).length
    : 0;
  const collaborationBadgeState = !activeProject
    ? "disabled"
    : otherActiveUsersCount > 0
      ? "active"
      : "idle";
  const collaborationBadgeTitle = !activeProject
    ? "No active project. Open a project to view user activity."
    : otherActiveUsersCount === 0
      ? "No other users currently active. Open Project Users activity."
      : otherActiveUsersCount === 1
        ? "1 other user active in this project. Open Project Users activity."
        : `${otherActiveUsersCount} other users active in this project. Open Project Users activity.`;

  function showTooltip(text: string, element: HTMLElement) {
    setActiveTooltip({
      text,
      anchorRect: element.getBoundingClientRect(),
    });
  }

  function hideTooltip() {
    setActiveTooltip(null);
    setTooltipPlacement(null);
  }

  function bindTooltip(text: string | undefined) {
    if (!text) return {};
    return {
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => showTooltip(text, event.currentTarget),
      onMouseLeave: hideTooltip,
      onFocus: (event: React.FocusEvent<HTMLElement>) => showTooltip(text, event.currentTarget),
      onBlur: hideTooltip,
    };
  }

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

  useEffect(() => {
    if (!activeTooltip) return;

    const refreshTooltipAnchor = () => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (
        activeElement &&
        (activeElement.classList.contains("brand-network-badge")
          || activeElement.classList.contains("brand-ai-badge")
          || activeElement.classList.contains("brand-collaboration-badge"))
      ) {
        setActiveTooltip((prev) =>
          prev
            ? {
                ...prev,
                anchorRect: activeElement.getBoundingClientRect(),
              }
            : prev,
        );
      }
    };

    window.addEventListener("resize", refreshTooltipAnchor);
    window.addEventListener("scroll", refreshTooltipAnchor, true);
    return () => {
      window.removeEventListener("resize", refreshTooltipAnchor);
      window.removeEventListener("scroll", refreshTooltipAnchor, true);
    };
  }, [activeTooltip]);

  useLayoutEffect(() => {
    if (!activeTooltip || !tooltipRef.current) return;

    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const offset = 10;
    const margin = 12;

    const fitsLeft = activeTooltip.anchorRect.left - offset - tooltipRect.width >= margin;
    const fitsRight = activeTooltip.anchorRect.right + offset + tooltipRect.width <= viewportWidth - margin;

    const left = fitsLeft
      ? activeTooltip.anchorRect.left - offset - tooltipRect.width
      : fitsRight
        ? activeTooltip.anchorRect.right + offset
        : Math.max(
            margin,
            Math.min(
              activeTooltip.anchorRect.left + (activeTooltip.anchorRect.width - tooltipRect.width) / 2,
              viewportWidth - tooltipRect.width - margin,
            ),
          );

    const centeredTop = activeTooltip.anchorRect.top + (activeTooltip.anchorRect.height - tooltipRect.height) / 2;
    const fitsCentered = centeredTop >= margin && centeredTop + tooltipRect.height <= viewportHeight - margin;
    const fitsBelow = activeTooltip.anchorRect.bottom + offset + tooltipRect.height <= viewportHeight - margin;
    const fitsAbove = activeTooltip.anchorRect.top - offset - tooltipRect.height >= margin;

    const top = fitsCentered
      ? centeredTop
      : fitsBelow
        ? activeTooltip.anchorRect.bottom + offset
        : fitsAbove
          ? activeTooltip.anchorRect.top - offset - tooltipRect.height
          : Math.max(margin, Math.min(centeredTop, viewportHeight - tooltipRect.height - margin));

    setTooltipPlacement({ left, top });
  }, [activeTooltip]);

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
      <div className="sidebar-brand" title="KanQual">
        <img src={sidebarLogo} alt="Kanqual" className="brand-logo" />
        <button
          type="button"
          className={`sidebar-icon-button brand-network-badge brand-status-badge brand-network-badge--${networkBadgeState}`}
          title={networkBadgeTitle}
          aria-label={networkBadgeTitle}
          onClick={handleNetworkBadgeActivate}
          onPointerUp={handleNetworkBadgeActivate}
          {...bindTooltip(networkBadgeTitle)}
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
          {...bindTooltip(aiBadgeTitle)}
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
          {...bindTooltip(collaborationBadgeTitle)}
        >
          <span
            aria-hidden="true"
            className="brand-collaboration-icon"
            dangerouslySetInnerHTML={{ __html: usersGroupIconRaw }}
          />
        </button>
        {activeTooltip && (
          <div
            ref={tooltipRef}
            className="brand-status-tooltip"
            style={
              tooltipPlacement
                ? {
                    left: tooltipPlacement.left,
                    top: tooltipPlacement.top,
                  }
                : {
                    left: -9999,
                    top: -9999,
                  }
            }
            role="tooltip"
          >
            {activeTooltip.text}
          </div>
        )}
      </div>

      {activeProject ? (
        <div className="sidebar-project-badge">
          <span className="project-badge-label">Project</span>
          <div className="project-badge-row">
            <span className="project-badge-name" style={{ fontSize: projectNameFontSize }}>
              {activeProject.name}
            </span>
            <button
              type="button"
              className="sidebar-icon-button project-badge-close"
              title="Close Project"
              aria-label="Close Project"
              onClick={() => void closeProject(activeProject)}
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
          <span className="project-badge-label">Project</span>
          <span className="project-badge-empty-text" style={{ fontSize: projectNameFontSize }}>
            Open a Project
          </span>
        </button>
      )}

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section) => (
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
                      ? "Open a project first"
                      : section.key !== "settings" && !activeProject
                        ? "Open a project first"
                        : aiAssistPermissionDenied
                          ? "You do not have permission to use this AI Assist tool"
                          : aiAssistItemDisabled
                            ? "Enable AI Assist in Project Settings"
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
              {ROLE_LABELS[userRole]}
            </span>
          )}
        </div>
        <button type="button" className="sidebar-logout" onClick={logout} title="Sign out">
          {"\u21A9"}
        </button>
      </div>
    </aside>
  );
}
