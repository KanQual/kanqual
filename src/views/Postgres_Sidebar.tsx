import { useState } from "react";
import { AiAssistIcon, CloseIcon, CollaborationIcon, LogoutIcon, NetworkIcon } from "../components/AppIcons";
import sidebarMarkLogo from "../assets/logo-mark-no-background.png";
import sidebarLogo from "../assets/logo-no-background.png";
import type { PostgresAuthSession, PostgresProject } from "../lib/postgres";

export type PostgresSidebarNetworkMode = "device" | "network" | "internet" | "unknown";
export type PostgresSidebarAiStatus = "ready" | "running" | "disabled" | "unavailable";
export type PostgresSidebarCollaborationStatus = "idle" | "active-solo" | "active-shared" | "disabled";

type PostgresSidebarProps = {
  activeScreen: string;
  activeProject: PostgresProject | null;
  authSession: PostgresAuthSession;
  projectRoleLabel: string;
  networkMode?: PostgresSidebarNetworkMode;
  aiStatus?: PostgresSidebarAiStatus;
  aiAssistAllowed?: boolean;
  collaborationStatus?: PostgresSidebarCollaborationStatus;
  onShowProjects?: () => void;
  onShowProjectHome?: () => void;
  onShowProjectUsers?: () => void;
  onShowProjectSources?: () => void;
  onShowProjectAnnotations?: () => void;
  onShowProjectCodebook?: () => void;
  onShowProjectCodeText?: () => void;
  onShowProjectMemos?: () => void;
  onShowProjectReports?: () => void;
  onShowProjectObjects?: () => void;
  onShowProjectRelationships?: () => void;
  onShowAiAssistHome?: () => void;
  onShowAiAssistChat?: () => void;
  onShowAiAssistedCoding?: () => void;
  onShowAiAnalyze?: () => void;
  onShowAiAssistSourceAttributes?: () => void;
  onShowAiAssistProcessDocuments?: () => void;
  onShowFreeDraw?: () => void;
  onShowExplore?: () => void;
  onShowConstruct?: () => void;
  onShowCanvasView?: () => void;
  onShowAppSettings?: () => void;
  onBackToGate: () => void;
  onSignOut: () => Promise<void>;
};

export function PostgresSidebar({
  activeScreen,
  activeProject,
  authSession,
  projectRoleLabel,
  networkMode = "unknown",
  aiStatus = "unavailable",
  aiAssistAllowed = true,
  collaborationStatus = "disabled",
  onShowProjects,
  onShowProjectHome,
  onShowProjectUsers,
  onShowProjectSources,
  onShowProjectAnnotations,
  onShowProjectCodebook,
  onShowProjectCodeText,
  onShowProjectMemos,
  onShowProjectReports,
  onShowProjectObjects,
  onShowProjectRelationships,
  onShowAiAssistHome,
  onShowAiAssistChat,
  onShowAiAssistedCoding,
  onShowAiAnalyze,
  onShowAiAssistSourceAttributes,
  onShowAiAssistProcessDocuments,
  onShowFreeDraw,
  onShowExplore,
  onShowConstruct,
  onShowCanvasView,
  onShowAppSettings,
  onSignOut,
}: PostgresSidebarProps) {
  const [collapsedSidebarSections, setCollapsedSidebarSections] = useState<Set<string>>(() => new Set());
  const toggleSidebarSection = (sectionId: string) => {
    setCollapsedSidebarSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };
  const projectItems = [
    { id: "home", label: "Home", disabled: !activeProject, onClick: onShowProjectHome },
    { id: "users", label: "Users", disabled: !activeProject, onClick: onShowProjectUsers },
    { id: "sources", label: "Sources", disabled: !activeProject, onClick: onShowProjectSources },
    { id: "objects", label: "Objects", disabled: !activeProject, onClick: onShowProjectObjects },
    { id: "relationships", label: "Relationships", disabled: !activeProject, onClick: onShowProjectRelationships },
    { id: "codebook", label: "Codebook", disabled: !activeProject, onClick: onShowProjectCodebook },
    { id: "annotations", label: "Annotations", disabled: !activeProject, onClick: onShowProjectAnnotations },
  ];
  const canvasItems = [
    { id: "free-draw", label: "Free Draw", disabled: !activeProject, onClick: onShowFreeDraw },
    { id: "explore", label: "Explore", disabled: !activeProject, onClick: onShowExplore },
    { id: "construct", label: "Construct", disabled: !activeProject, onClick: onShowConstruct },
    { id: "view", label: "View", disabled: !activeProject, onClick: onShowCanvasView },
  ];
  const analysisItems = [
    { id: "code-text", label: "Code Sources", disabled: !activeProject, onClick: onShowProjectCodeText },
    { id: "memos", label: "Memos", disabled: !activeProject, onClick: onShowProjectMemos },
    { id: "reports", label: "Reports", disabled: !activeProject, onClick: onShowProjectReports },
  ];
  const aiAssistItems = [
    { id: "ai-assist", label: "Home", disabled: !activeProject, onClick: onShowAiAssistHome },
    ...(aiAssistAllowed ? [
      { id: "ai-assist-chat", label: "Chat", disabled: !activeProject, onClick: onShowAiAssistChat },
      { id: "ai-assisted-coding", label: "Assisted Coding", disabled: !activeProject, onClick: onShowAiAssistedCoding },
      { id: "ai-analyze", label: "Analyze Codes", disabled: !activeProject, onClick: onShowAiAnalyze },
      { id: "ai-assist-source-attributes", label: "Attributes", disabled: !activeProject, onClick: onShowAiAssistSourceAttributes },
      { id: "ai-assist-process-documents", label: "Transcripts", disabled: !activeProject, onClick: onShowAiAssistProcessDocuments },
    ] : []),
  ];
  const networkBadgeClass =
    networkMode === "internet"
      ? "brand-network-badge--remote"
      : networkMode === "network"
        ? "brand-network-badge--lan"
        : "brand-network-badge--local";
  const networkTitle =
    networkMode === "internet"
      ? "Internet mode: remote users can connect through the configured address."
      : networkMode === "network"
        ? "LAN mode: local network users can connect."
        : networkMode === "device"
          ? "Device mode: only this machine can connect."
          : "LAN mode is unavailable.";
  const collaborationTitle =
    collaborationStatus === "active-shared"
      ? "Collaboration is active. Other users are also connected."
      : collaborationStatus === "active-solo"
        ? "Collaboration is active. You are the only connected user."
      : collaborationStatus === "idle"
        ? "Collaboration is limited to this device."
        : "Open a project to use collaboration.";
  const aiTitle =
    aiStatus === "running"
      ? "AI Assist is preparing project embeddings."
      : aiStatus === "ready"
        ? "AI Assist is ready for this project."
        : aiStatus === "disabled"
          ? "AI Assist is disabled for this project."
          : "AI Assist is not ready for this project.";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={sidebarLogo} alt="Kanqual" className="brand-logo" />
        <div className="brand-collapsed-lockup" aria-hidden="true">
          <img src={sidebarMarkLogo} alt="" className="brand-collapsed-logo" />
          <span className="brand-collapsed-title">KanQual</span>
        </div>
        <span className={`brand-network-badge ${networkBadgeClass}`} title={networkTitle} aria-label={networkTitle} role="img">
          <span className="brand-network-icon">
            <NetworkIcon />
          </span>
        </span>
        <span className={`brand-collaboration-badge brand-collaboration-badge--${collaborationStatus}`} title={collaborationTitle} aria-label={collaborationTitle} role="img">
          <span className="brand-collaboration-icon">
            <CollaborationIcon />
          </span>
        </span>
        <span className={`brand-ai-badge brand-ai-badge--${aiStatus}`} title={aiTitle} aria-label={aiTitle} role="img">
          <span className="brand-ai-icon">
            <AiAssistIcon />
          </span>
        </span>
      </div>

      {activeProject ? (
        <div className="sidebar-project-badge">
          <span className="project-badge-label project-badge-label--active">Active Project</span>
          <span className="project-badge-collapsed-name" aria-hidden="true">
            {activeProject.name}
          </span>
          <div className="project-badge-row">
            <span className="project-badge-name">{activeProject.name}</span>
            <button
              type="button"
              className="project-badge-close"
              onClick={onShowProjects}
              aria-label="Close project"
              title="Close project"
            >
              <CloseIcon className="project-badge-close-icon" />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="sidebar-project-badge sidebar-project-badge--empty" onClick={onShowProjects}>
          <span className="project-badge-empty-text">Open Project</span>
        </button>
      )}

      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!collapsedSidebarSections.has("project")}
            onClick={() => toggleSidebarSection("project")}
          >
            <span>Project</span>
            <span className="sidebar-section-chevron">
              {collapsedSidebarSections.has("project") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div className={`sidebar-section-items ${collapsedSidebarSections.has("project") ? "sidebar-section-items--collapsed" : ""}`}>
            {projectItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!collapsedSidebarSections.has("analysis")}
            onClick={() => toggleSidebarSection("analysis")}
          >
            <span>Analysis</span>
            <span className="sidebar-section-chevron">
              {collapsedSidebarSections.has("analysis") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div className={`sidebar-section-items ${collapsedSidebarSections.has("analysis") ? "sidebar-section-items--collapsed" : ""}`}>
            {analysisItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!collapsedSidebarSections.has("ai-assist")}
            onClick={() => toggleSidebarSection("ai-assist")}
          >
            <span>AI Assist</span>
            <span className="sidebar-section-chevron">
              {collapsedSidebarSections.has("ai-assist") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div className={`sidebar-section-items ${collapsedSidebarSections.has("ai-assist") ? "sidebar-section-items--collapsed" : ""}`}>
            {aiAssistItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Open a PostgreSQL project first." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button
            type="button"
            className={`sidebar-section-header sidebar-section-header--link ${activeScreen === "app-settings" ? "sidebar-section-header--active" : ""}`}
            onClick={() => onShowAppSettings?.()}
          >
            <span>Settings</span>
          </button>
        </div>
        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!collapsedSidebarSections.has("canvas")}
            onClick={() => toggleSidebarSection("canvas")}
          >
            <span>Canvas</span>
            <span className="sidebar-section-chevron">
              {collapsedSidebarSections.has("canvas") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div className={`sidebar-section-items ${collapsedSidebarSections.has("canvas") ? "sidebar-section-items--collapsed" : ""}`}>
            {canvasItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Open a PostgreSQL project first." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="sidebar-user">
        <div className="sidebar-user-info">
          <div className="sidebar-user-name-row">
            <div className="sidebar-user-name">
              {authSession.authKind === "postgres_admin" ? "Administrator" : authSession.user.name}
            </div>
            {authSession.authKind !== "postgres_admin" ? (
              <button
                type="button"
                className="sidebar-logout sidebar-logout--inline"
                onClick={() => void onSignOut()}
                aria-label="Log out"
                title="Log out"
              >
                <LogoutIcon className="sidebar-logout-icon" />
              </button>
            ) : null}
          </div>
          {authSession.authKind !== "postgres_admin" ? <div className="sidebar-user-email">{projectRoleLabel}</div> : null}
        </div>
      </div>
    </aside>
  );
}
