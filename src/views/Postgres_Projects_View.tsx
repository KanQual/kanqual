import { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getPostgresInstallationSettings,
  getPostgresUserProjectState,
  listPostgresProjects,
  POSTGRES_PROJECT_CHANGED_EVENT,
  rememberPostgresProjectClosed,
  rememberPostgresProjectOpened,
  type PostgresProject,
  type PostgresProjectChangeEvent,
  type PostgresRecentProject,
} from "../lib/postgres";
import { LogoutIcon } from "../components/AppIcons";

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatProjectLastLogin(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatProjectLastLoginBadge(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDelta = Math.floor((startOfToday - startOfDate) / 86_400_000);
  if (dayDelta === 0) return "Today";
  if (dayDelta === 1) return "Yesterday";
  if (dayDelta > 1 && dayDelta < 7) return `${dayDelta} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getProjectInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "P";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function getProjectAccentStyle(project: PostgresProject): CSSProperties {
  const seed = `${project.id}:${project.name}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  const hue = hash;
  return {
    "--project-accent": `hsl(${hue} 58% 46%)`,
    "--project-accent-soft": `hsl(${hue} 68% 93%)`,
    "--project-accent-border": `hsl(${hue} 48% 78%)`,
  } as CSSProperties;
}

export type PostgresProjectsViewProps = {
  onSignOut: () => void | Promise<void>;
  renderProjectHome: (
    project: PostgresProject,
    helpers: {
      onBack: () => void;
      onProjectUpdated: (project: PostgresProject) => void;
      onProjectDeleted: (projectId: string) => void;
      onProjectOpened: (project: PostgresProject) => void | Promise<void>;
    },
  ) => ReactNode;
};

export function PostgresProjectsView({
  onSignOut,
  renderProjectHome,
}: PostgresProjectsViewProps) {
  const [projects, setProjects] = useState<PostgresProject[]>([]);
  const [recentProjects, setRecentProjects] = useState<PostgresRecentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [openedProjectId, setOpenedProjectId] = useState<string | null>(null);

  const recordProjectOpened = useCallback(async (project: PostgresProject) => {
    const recentProject: PostgresRecentProject = {
      id: project.id,
      name: project.name,
      description: project.description,
      openedAt: new Date().toISOString(),
    };
    try {
      await rememberPostgresProjectOpened(recentProject);
      setRecentProjects((current) => [
        recentProject,
        ...current.filter((item) => item.id !== recentProject.id),
      ]);
    } catch (rememberError) {
      console.warn("Could not persist PostgreSQL recent project state:", describeUnknownError(rememberError));
    }
  }, []);

  const recordProjectClosed = useCallback(async (project: PostgresProject) => {
    try {
      await rememberPostgresProjectClosed(project.id);
    } catch (closeError) {
      console.warn("Could not persist PostgreSQL project close log:", describeUnknownError(closeError));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      setLoading(true);
      setError("");
      try {
        const [nextProjects, installationSettings, projectState] = await Promise.all([
          listPostgresProjects(),
          getPostgresInstallationSettings(),
          getPostgresUserProjectState(),
        ]);
        if (!cancelled) {
          setProjects(nextProjects);
          setRecentProjects(projectState.recentProjects);
          const reopenProjectId = installationSettings.startupReopenLastProject
            ? projectState.lastOpenedProjectId
            : null;
          const reopenProject = reopenProjectId
            ? nextProjects.find((project) => project.id === reopenProjectId) ?? null
            : null;
          setSelectedProjectId((current) => current ?? reopenProject?.id ?? nextProjects[0]?.id ?? null);
          setOpenedProjectId((current) => current ?? reopenProject?.id ?? null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setProjects([]);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  const openedProject = projects.find((project) => project.id === openedProjectId) ?? null;
  const recentProjectById = new Map(recentProjects.map((project) => [project.id, project]));
  const sortedProjects = [...projects].sort((left, right) => {
    const leftOpenedAt = recentProjectById.get(left.id)?.openedAt ?? "";
    const rightOpenedAt = recentProjectById.get(right.id)?.openedAt ?? "";
    if (leftOpenedAt && rightOpenedAt && leftOpenedAt !== rightOpenedAt) {
      return rightOpenedAt.localeCompare(leftOpenedAt);
    }
    if (leftOpenedAt && !rightOpenedAt) return -1;
    if (!leftOpenedAt && rightOpenedAt) return 1;
    return left.name.localeCompare(right.name);
  });
  const refreshProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextProjects, projectState] = await Promise.all([
        listPostgresProjects(),
        getPostgresUserProjectState(),
      ]);
      setProjects(nextProjects);
      setRecentProjects(projectState.recentProjects);
      setSelectedProjectId((current) => {
        if (current && nextProjects.some((project) => project.id === current)) return current;
        return nextProjects[0]?.id ?? null;
      });
    } catch (refreshError) {
      setProjects([]);
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function subscribeToProjectChanges() {
      unlisten = await listen<PostgresProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
        if (disposed) return;
        if (event.payload.entityType !== "project") return;
        void refreshProjects();
      });
    }

    void subscribeToProjectChanges();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [refreshProjects]);

  if (openedProject) {
    return renderProjectHome(openedProject, {
      onBack: () => {
        void recordProjectClosed(openedProject);
        setOpenedProjectId(null);
      },
      onProjectUpdated: (updatedProject) => {
        setProjects((current) => current.map((project) => (project.id === updatedProject.id ? updatedProject : project)));
        setSelectedProjectId(updatedProject.id);
      },
      onProjectDeleted: (projectId) => {
        setProjects((current) => current.filter((project) => project.id !== projectId));
        setSelectedProjectId((current) => (current === projectId ? null : current));
        setOpenedProjectId((current) => (current === projectId ? null : current));
      },
      onProjectOpened: async (project) => {
        if (openedProject.id !== project.id) {
          await recordProjectClosed(openedProject);
        }
        setProjects((current) => {
          if (current.some((item) => item.id === project.id)) {
            return current.map((item) => (item.id === project.id ? project : item));
          }
          return [project, ...current];
        });
        setSelectedProjectId(project.id);
        setOpenedProjectId(project.id);
        await recordProjectOpened(project);
      },
    });
  }

  return (
    <div className="auth-screen projects-auth-screen">
      <div className="auth-card projects-auth-card">
        <button
          type="button"
          className="projects-logout-button"
          onClick={() => void onSignOut()}
          aria-label="Sign out"
          title="Sign out"
        >
          <LogoutIcon className="projects-logout-icon" />
        </button>
        <div className="projects-view">
          <header className="view-header">
            <div className="view-title-with-help">
              <h1>Projects</h1>
            </div>
          </header>

          {error ? <p className="auth-error">{error}</p> : null}

          {loading ? (
            <div className="empty-state">
              <p>Loading PostgreSQL projects...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <p>No projects yet</p>
            </div>
          ) : (
            <div className="project-selection-card-list">
              {sortedProjects.map((project) => {
                const recentProject = recentProjectById.get(project.id);
                const description = (project.description || recentProject?.description || "").trim();
                return (
                  <button
                    key={project.id}
                    type="button"
                    className={`project-selection-card${selectedProjectId === project.id ? " project-selection-card--selected" : ""}`}
                    style={getProjectAccentStyle(project)}
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setOpenedProjectId(project.id);
                      void recordProjectOpened(project);
                    }}
                  >
                    <span className="project-selection-card-accent" aria-hidden="true">
                      {getProjectInitials(project.name)}
                    </span>
                    <span className="project-selection-card-body">
                      <span className="project-selection-card-name">{project.name}</span>
                      <span className="project-selection-card-desc">
                        {description || "No description"}
                      </span>
                    </span>
                    <span className="project-selection-card-meta">
                      <span className="project-selection-card-last-label">Last opened</span>
                      <span className="project-selection-card-last-badge">
                        {recentProject?.openedAt ? formatProjectLastLoginBadge(recentProject.openedAt) : "Never"}
                      </span>
                      {recentProject?.openedAt ? (
                        <span className="project-selection-card-last-time">
                          {formatProjectLastLogin(recentProject.openedAt)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
