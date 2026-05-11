import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../types";
import type { View } from "../types";
import { readAppSettings } from "../lib/appSettings";
import {
  PROJECT_AI_ASSIST_SETTINGS_CHANGED_EVENT,
  readProjectAiAssistSettings,
} from "../lib/projectAiAssistSettings";
import computerLineIcon from "../assets/computer-line.svg";
import networkIcon from "../assets/network--2.svg";
import aiAssistReadyIcon from "../assets/cog-line.svg";
import aiAssistUnavailableIcon from "../assets/cog-outline-alerted.svg";
import sidebarLogo from "../assets/logo-no-background.png";

type EmbeddingModelStatus = {
  installed: boolean;
  repoId: string;
  displayName: string;
  modelDir: string;
  files: number;
  bytes: number;
  downloadedAtMs: number | null;
};

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
];

export function Sidebar() {
  const { view, setView, activeProject, userRole, networkMode, canCurrentUser } = useStore();
  const { user, logout } = useAuth();
  const [aiAssistStatus, setAiAssistStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const [aiAssistEnabledForProject, setAiAssistEnabledForProject] = useState(
    () => (activeProject ? readProjectAiAssistSettings(activeProject.id).enabled : false),
  );

  useEffect(() => {
    setAiAssistEnabledForProject(activeProject ? readProjectAiAssistSettings(activeProject.id).enabled : false);
  }, [activeProject?.id]);

  useEffect(() => {
    function handleProjectAiAssistSettingsChanged(event: Event) {
      const detail = (event as CustomEvent<{ projectId?: string; settings?: { enabled?: boolean } }>).detail;
      if (!activeProject || detail?.projectId !== activeProject.id) return;
      setAiAssistEnabledForProject(Boolean(detail?.settings?.enabled));
    }

    window.addEventListener(PROJECT_AI_ASSIST_SETTINGS_CHANGED_EVENT, handleProjectAiAssistSettingsChanged);
    return () => {
      window.removeEventListener(PROJECT_AI_ASSIST_SETTINGS_CHANGED_EVENT, handleProjectAiAssistSettingsChanged);
    };
  }, [activeProject?.id]);

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

  const [open, setOpen] = useState<Record<string, boolean>>({
    project: true,
    analysis: true,
    "ai-assist": true,
    reports: true,
  });

  function toggleSection(key: string) {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

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
    let cancelled = false;

    async function refreshAiAssistStatus() {
      const llmSettings = readAppSettings().llm;
      if (!llmSettings.ollamaEnabled || !llmSettings.ollamaSelectedModel) {
        if (!cancelled) setAiAssistStatus("unavailable");
        return;
      }

      try {
        const [modelStatus] = await Promise.all([
          invoke<EmbeddingModelStatus>("get_multilingual_e5_status"),
          invoke<number>("ping_address", {
            host: llmSettings.ollamaHost,
            port: llmSettings.ollamaPort,
          }),
        ]);

        if (cancelled) return;
        setAiAssistStatus(modelStatus.installed ? "ready" : "unavailable");
      } catch {
        if (!cancelled) setAiAssistStatus("unavailable");
      }
    }

    setAiAssistStatus("checking");
    void refreshAiAssistStatus();

    function handleFocus() {
      void refreshAiAssistStatus();
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [view]);

  return (
    <aside className="sidebar">
      <button
        type="button"
        className="sidebar-brand sidebar-brand--clickable"
        onClick={() => setView("app-settings")}
        title="App settings"
      >
        <img src={sidebarLogo} alt="Kanqual" className="brand-logo" />
        <span
          className={`brand-network-badge brand-network-badge--${networkMode}`}
          title={
            networkMode === "lan"
              ? "Network mode - other devices on your local network can connect to this instance"
              : "Local only - data is not accessible from other devices"
          }
        >
          <img
            src={networkMode === "lan" ? networkIcon : computerLineIcon}
            alt={networkMode === "lan" ? "Network enabled" : "Local only"}
            className="brand-network-icon"
          />
        </span>
        <span
          className={`brand-ai-badge brand-ai-badge--${aiAssistStatus === "ready" ? "ready" : "unavailable"}`}
          title={
            aiAssistStatus === "ready"
              ? "AI Assist ready"
              : "AI Assist not available, check app settings"
          }
        >
          <img
            src={aiAssistStatus === "ready" ? aiAssistReadyIcon : aiAssistUnavailableIcon}
            alt={aiAssistStatus === "ready" ? "AI Assist ready" : "AI Assist not available"}
            className="brand-ai-icon"
          />
        </span>
      </button>

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

                  return (
                    <button
                      key={nextView}
                      type="button"
                      className={`nav-item ${isNavItemActive(nextView) ? "nav-item--active" : ""}`}
                      onClick={() => setView(nextView)}
                      disabled={!activeProject || aiAssistItemDisabled || aiAssistPermissionDenied}
                      title={
                        !activeProject
                          ? "Open a project first"
                          : aiAssistPermissionDenied
                            ? "You do not have permission to use this AI Assist tool"
                          : aiAssistItemDisabled
                            ? "Enable AI Assist in Project Settings"
                            : undefined
                      }
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
          <button
            type="button"
            className="sidebar-user-name"
            onClick={() => setView("user-settings")}
            title="User settings"
          >
            {user?.name || user?.email}
          </button>
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
