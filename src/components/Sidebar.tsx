import { useState } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../types";
import type { View } from "../types";

// ─── Nav structure ────────────────────────────────────────────────────────────

const NAV_SECTIONS: {
  key: string;
  label: string;
  items: { view: View; label: string }[];
}[] = [
  {
    key: "project",
    label: "Project",
    items: [
      { view: "home",      label: "Home" },
      { view: "users",     label: "Users" },
      { view: "cases",     label: "Cases" },
      { view: "documents", label: "Documents" },
      { view: "codebook",  label: "Codebook" },
      { view: "project-log", label: "Project Log" },
    ],
  },
  {
    key: "analysis",
    label: "Analysis",
    items: [
      { view: "code-text",  label: "Code Text" },
      { view: "memos",      label: "Memos" },
      { view: "ai-assist",  label: "AI Assist" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    items: [
      { view: "code-reports", label: "Code Reports" },
      { view: "coders",       label: "Coders" },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { view, setView, activeProject, userRole, closeProject } = useStore();
  const { user, logout } = useAuth();

  const [open, setOpen] = useState<Record<string, boolean>>({
    project: true,
    analysis: true,
    reports: true,
  });

  function toggleSection(key: string) {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className="sidebar">
      {/* Brand */}
      <button
        className="sidebar-brand sidebar-brand--clickable"
        onClick={() => setView("app-settings")}
        title="App settings"
      >
        <img src="/logo.png" alt="" className="brand-logo" />
        <span className="brand-name">Kanqual</span>
      </button>

      {/* Active project name / open project prompt */}
      {activeProject ? (
        <div className="sidebar-project-badge">
          <span className="project-badge-label">Project</span>
          <span className="project-badge-name">{activeProject.name}</span>
          <button
            className="sidebar-change-projects"
            onClick={() => closeProject(activeProject)}
          >
            Change project
          </button>
        </div>
      ) : (
        <div className="sidebar-open-project">
          <button
            className="sidebar-open-project-btn"
            onClick={() => setView("projects")}
          >
            Open Project
          </button>
        </div>
      )}

      {/* Collapsible nav sections */}
      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section) => (
          <div key={section.key} className="sidebar-section">
            <button
              className="sidebar-section-header"
              onClick={() => toggleSection(section.key)}
              aria-expanded={open[section.key]}
            >
              <span>{section.label}</span>
              <span className="sidebar-section-chevron">
                {open[section.key] ? "▾" : "▸"}
              </span>
            </button>

            {open[section.key] && (
              <div className="sidebar-section-items">
                {section.items.map(({ view: v, label }) => (
                  <button
                    key={v}
                    className={`nav-item ${view === v ? "nav-item--active" : ""}`}
                    onClick={() => setView(v)}
                    disabled={!activeProject}
                    title={!activeProject ? "Open a project first" : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* User area */}
      <div className="sidebar-user">
        <div className="sidebar-user-info">
          <button
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
        <button className="sidebar-logout" onClick={logout} title="Sign out">
          ↩
        </button>
      </div>
    </aside>
  );
}
