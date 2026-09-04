import { useState } from "react";
import { AiAssistIcon, CloseIcon, CollaborationIcon, LogoutIcon, NetworkIcon } from "../components/AppIcons";
import { useI18n } from "../i18n/provider";
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
  networkMode?: PostgresSidebarNetworkMode;
  aiStatus?: PostgresSidebarAiStatus;
  aiAssistAllowed?: boolean;
  collaborationStatus?: PostgresSidebarCollaborationStatus;
  guideSpotlightItemId?: string | null;
  guideSpotlightSidebar?: boolean;
  forceExpanded?: boolean;
  lockExpandedNavigation?: boolean;
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
  onShowAppSettings?: () => void;
  onBackToGate: () => void;
  onSignOut: () => Promise<void>;
};

export function PostgresSidebar({
  activeScreen,
  activeProject,
  authSession,
  networkMode = "unknown",
  aiStatus = "unavailable",
  aiAssistAllowed = true,
  collaborationStatus = "disabled",
  guideSpotlightItemId = null,
  guideSpotlightSidebar = false,
  forceExpanded = false,
  lockExpandedNavigation = false,
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
  onShowAppSettings,
  onSignOut,
}: PostgresSidebarProps) {
  const { t } = useI18n();
  const [collapsedSidebarSections, setCollapsedSidebarSections] = useState<Set<string>>(() => new Set());
  const isSidebarSectionCollapsed = (sectionId: string) => (
    forceExpanded && lockExpandedNavigation ? false : collapsedSidebarSections.has(sectionId)
  );
  const toggleSidebarSection = (sectionId: string) => {
    if (forceExpanded && lockExpandedNavigation) return;
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
    { id: "home", label: t("sidebar.items.home"), disabled: !activeProject, onClick: onShowProjectHome },
    { id: "users", label: t("sidebar.items.users"), disabled: !activeProject, onClick: onShowProjectUsers },
    { id: "sources", label: t("sidebar.items.sources"), disabled: !activeProject, onClick: onShowProjectSources },
    { id: "objects", label: t("sidebar.items.objects"), disabled: !activeProject, onClick: onShowProjectObjects },
    { id: "relationships", label: t("sidebar.items.relationships"), disabled: !activeProject, onClick: onShowProjectRelationships },
    { id: "codebook", label: t("sidebar.items.codebook"), disabled: !activeProject, onClick: onShowProjectCodebook },
    { id: "annotations", label: t("sidebar.items.annotations"), disabled: !activeProject, onClick: onShowProjectAnnotations },
  ];
  const analysisItems = [
    { id: "code-text", label: t("sidebar.items.codeSources"), disabled: !activeProject, onClick: onShowProjectCodeText },
    { id: "memos", label: t("sidebar.items.memos"), disabled: !activeProject, onClick: onShowProjectMemos },
    { id: "reports", label: t("sidebar.items.reports"), disabled: !activeProject, onClick: onShowProjectReports },
  ];
  const aiAssistItems = [
    { id: "ai-assist", label: t("sidebar.items.home"), disabled: !activeProject, onClick: onShowAiAssistHome },
    ...(aiAssistAllowed ? [
      { id: "ai-assist-chat", label: t("sidebar.items.chat"), disabled: !activeProject, onClick: onShowAiAssistChat },
      { id: "ai-assisted-coding", label: t("sidebar.items.assistedCoding"), disabled: !activeProject, onClick: onShowAiAssistedCoding },
      { id: "ai-analyze", label: t("sidebar.items.analyzeCodes"), disabled: !activeProject, onClick: onShowAiAnalyze },
      { id: "ai-assist-source-attributes", label: t("sidebar.items.attributes"), disabled: !activeProject, onClick: onShowAiAssistSourceAttributes },
      { id: "ai-assist-process-documents", label: t("sidebar.items.transcripts"), disabled: !activeProject, onClick: onShowAiAssistProcessDocuments },
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
      ? t("sidebar.status.internetMode")
      : networkMode === "network"
        ? t("sidebar.status.lanMode")
        : networkMode === "device"
          ? t("sidebar.status.deviceMode")
          : t("sidebar.status.lanUnavailable");
  const collaborationTitle =
    collaborationStatus === "active-shared"
      ? t("sidebar.status.collaborationShared")
      : collaborationStatus === "active-solo"
        ? t("sidebar.status.collaborationSolo")
      : collaborationStatus === "idle"
        ? t("sidebar.status.collaborationIdle")
        : t("sidebar.status.collaborationUnavailable");
  const aiTitle =
    aiStatus === "running"
      ? t("sidebar.status.aiRunning")
      : aiStatus === "ready"
        ? t("sidebar.status.aiReady")
        : aiStatus === "disabled"
          ? t("sidebar.status.aiDisabled")
          : t("sidebar.status.aiUnavailable");

  return (
    <aside className={`sidebar${forceExpanded ? " sidebar--expanded" : ""}${guideSpotlightSidebar ? " getting-started-spotlight-target sidebar--getting-started" : ""}`}>
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
          <span className="project-badge-label project-badge-label--active">{t("sidebar.projectBadge.activeLabel")}</span>
          <span className="project-badge-collapsed-name" aria-hidden="true">
            {activeProject.name}
          </span>
          <div className="project-badge-row">
            <span className="project-badge-name">{activeProject.name}</span>
            <button
              type="button"
              className="project-badge-close"
              onClick={onShowProjects}
              aria-label={t("sidebar.projectBadge.closeProject")}
              title={t("sidebar.projectBadge.closeProject")}
            >
              <CloseIcon className="project-badge-close-icon" />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="sidebar-project-badge sidebar-project-badge--empty" onClick={onShowProjects}>
          <span className="project-badge-empty-text">{t("sidebar.projectBadge.openProject")}</span>
        </button>
      )}

      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!isSidebarSectionCollapsed("project")}
            onClick={() => toggleSidebarSection("project")}
          >
            <span>{t("sidebar.sections.project")}</span>
            <span className="sidebar-section-chevron">
              {isSidebarSectionCollapsed("project") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div className={`sidebar-section-items ${isSidebarSectionCollapsed("project") ? "sidebar-section-items--collapsed" : ""}`}>
            {projectItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}${guideSpotlightItemId === item.id ? " getting-started-spotlight-target" : ""}`}
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
            aria-expanded={!isSidebarSectionCollapsed("analysis")}
            onClick={() => toggleSidebarSection("analysis")}
          >
            <span>{t("sidebar.sections.analysis")}</span>
            <span className="sidebar-section-chevron">
              {isSidebarSectionCollapsed("analysis") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div className={`sidebar-section-items ${isSidebarSectionCollapsed("analysis") ? "sidebar-section-items--collapsed" : ""}`}>
            {analysisItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}${guideSpotlightItemId === item.id ? " getting-started-spotlight-target" : ""}`}
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
            aria-expanded={!isSidebarSectionCollapsed("ai-assist")}
            onClick={() => toggleSidebarSection("ai-assist")}
          >
            <span>{t("sidebar.sections.aiAssist")}</span>
            <span className="sidebar-section-chevron">
              {isSidebarSectionCollapsed("ai-assist") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div className={`sidebar-section-items ${isSidebarSectionCollapsed("ai-assist") ? "sidebar-section-items--collapsed" : ""}`}>
            {aiAssistItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}${guideSpotlightItemId === item.id ? " getting-started-spotlight-target" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? t("sidebar.nav.openPostgresProjectFirst") : undefined}
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
            <span>{t("sidebar.sections.settings")}</span>
          </button>
        </div>
      </nav>

      <div className="sidebar-user">
        <div className="sidebar-user-info">
          <div className="sidebar-user-name-row">
            <div className="sidebar-user-name">
              {authSession.authKind === "postgres_admin" ? t("sidebar.user.administrator") : authSession.user.name}
            </div>
            {authSession.authKind !== "postgres_admin" ? (
              <button
                type="button"
                className="sidebar-logout sidebar-logout--inline"
                onClick={() => void onSignOut()}
                aria-label={t("sidebar.user.signOutTitle")}
                title={t("sidebar.user.signOutTitle")}
              >
                <LogoutIcon className="sidebar-logout-icon" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
