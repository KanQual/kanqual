import { useEffect, useMemo, useState } from "react";
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

export function Sidebar() {
  const {
    view,
    setView,
    activeProject,
    userRole,
    networkMode,
    canCurrentUser,
    projectAiAssistSettings,
    projectAiAssistRuntimeStatus,
    isLocalWorkspace,
  } = useStore();
  const { user, logout, serverUrl } = useAuth();
  const [aiAssistStatus, setAiAssistStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const aiAssistEnabledForProject = projectAiAssistSettings.enabled;

  const projectNameFontSize = useMemo(() => {
    if (!activeProject) return 22;

    const availablePx = 168;
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
    ? `Remote workspace session - connected to ${serverUrl}`
    : networkMode === "lan"
      ? "Network mode - other devices on your local network can connect to this instance"
      : "Local only - data is not accessible from other devices";
  

  function openAppSettingsModal(modalId: "network" | "llm") {
    sessionStorage.setItem("kanqual:open-app-settings-modal", modalId);
    window.dispatchEvent(new CustomEvent("kanqual:open-app-settings-modal"));
    setView("app-settings");
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

  useEffect(() => {
    if (!activeProject) {
      setAiAssistStatus("checking");
      return;
    }

    if (isLocalWorkspace) {
      const ready =
        projectAiAssistRuntimeStatus.hostLlmEnabled
        && projectAiAssistRuntimeStatus.hostLlmModelSelected
        && projectAiAssistRuntimeStatus.hostLlmConnectionLive
        && projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled;
      setAiAssistStatus(ready ? "ready" : "unavailable");
      return;
    }

    if (
      projectAiAssistRuntimeStatus.hostLlmEnabled == null
      || projectAiAssistRuntimeStatus.hostLlmModelSelected == null
      || projectAiAssistRuntimeStatus.hostLlmConnectionLive == null
      || projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled == null
    ) {
      setAiAssistStatus("checking");
      return;
    }

    const ready =
      projectAiAssistRuntimeStatus.hostLlmEnabled
      && projectAiAssistRuntimeStatus.hostLlmModelSelected
      && projectAiAssistRuntimeStatus.hostLlmConnectionLive
      && projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled;
    setAiAssistStatus(ready ? "ready" : "unavailable");
  }, [activeProject, isLocalWorkspace, projectAiAssistRuntimeStatus, view]);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand" title="KanQual">
        <img src={sidebarLogo} alt="Kanqual" className="brand-logo" />
        <button
          type="button"
          className={`brand-network-badge brand-network-badge--${networkBadgeState}`}
          title={networkBadgeTitle}
          aria-label="Open network and collaboration settings"
          onClick={() => openAppSettingsModal("network")}
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
          className={`brand-ai-badge brand-ai-badge--${aiAssistStatus === "ready" ? "ready" : "unavailable"}`}
          title={
            aiAssistStatus === "ready"
              ? "AI Assist ready"
              : "AI Assist not available, check app settings"
          }
          aria-label="Open AI Assist settings"
          onClick={() => openAppSettingsModal("llm")}
        >
          <span
            aria-hidden="true"
            className="brand-ai-icon"
            dangerouslySetInnerHTML={{
              __html: aiAssistStatus === "ready" ? aiAssistReadyIconRaw : aiAssistUnavailableIconRaw,
            }}
          />
        </button>
      </div>

      {activeProject ? (
        <div className="sidebar-project-badge">
          <span className="project-badge-label">Project</span>
          <span className="project-badge-name" style={{ fontSize: projectNameFontSize }}>
            {activeProject.name}
          </span>
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
