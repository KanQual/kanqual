import type { RefObject } from "react";
import type { PostgresProject, PostgresProjectUser } from "../lib/postgres";

function PostgresStatCard({
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
  return (
    <div className="home-stat-card" onClick={onClick}>
      <div className="home-stat-title">{title}</div>
      <div className="home-stat-count">{count ?? "-"}</div>
      <div className="home-stat-details">
        {stats.map((stat) => (
          <div key={`${title}-${stat.label}`} className="home-stat-row">
            <span className="home-stat-label">{stat.label}</span>
            <span className="home-stat-value">{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PostgresProjectHomeDetailsView({
  project,
  users,
  currentProjectUser,
  isProjectAdmin,
  lastProjectActivityAt,
  sourceCount,
  sourceStats,
  objectCount,
  objectTypeCount,
  relationshipCount,
  relationshipTypeCount,
  codeCount,
  annotationCount,
  memoCount,
  reportCount,
  statsRef,
  statsHeight,
  formatDateTime,
  onShowUsers,
  onShowSources,
  onShowObjects,
  onShowRelationships,
  onShowCodebook,
  onShowAnnotations,
  onShowMemos,
  onShowReports,
}: {
  project: PostgresProject;
  users: PostgresProjectUser[];
  currentProjectUser: PostgresProjectUser | null;
  isProjectAdmin: boolean;
  lastProjectActivityAt: string;
  sourceCount: number;
  sourceStats: { label: string; value: number }[];
  objectCount: number;
  objectTypeCount: number;
  relationshipCount: number;
  relationshipTypeCount: number;
  codeCount: number;
  annotationCount: number;
  memoCount: number;
  reportCount: number;
  statsRef: RefObject<HTMLDivElement | null>;
  statsHeight: number;
  formatDateTime: (iso: string) => string;
  onShowUsers: () => void;
  onShowSources: () => void;
  onShowObjects: () => void;
  onShowRelationships: () => void;
  onShowCodebook: () => void;
  onShowAnnotations: () => void;
  onShowMemos: () => void;
  onShowReports: () => void;
}) {
  return (
    <div className="home-dashboard postgres-experiment-home-dashboard postgres-experiment-home-details-dashboard">
      <div
        className="home-primary-column postgres-experiment-home-primary-column"
        style={
          statsHeight > 0
            ? {
              height: statsHeight,
              maxHeight: statsHeight,
            }
            : undefined
        }
      >
        <section className="home-project-card" aria-label="Project title">
          <div className="home-project-card-header">
            <h2>Project Title</h2>
          </div>
          <p className="home-project-title-value">{project.name || "Untitled project"}</p>
        </section>

        <section className="home-project-card postgres-experiment-home-description-card" aria-label="Project description">
          <div className="home-project-card-header">
            <h2>Project Description</h2>
          </div>
          {project.description.trim() ? (
            <p className="home-project-description">{project.description}</p>
          ) : (
            <p className="home-project-description home-project-description--empty">
              No project description has been added yet.
            </p>
          )}
        </section>

        <section className="home-project-card" aria-label="Project information">
          <div className="home-project-card-header">
            <h2>Project Information</h2>
          </div>
          <div className="home-restricted-list">
            <div className="home-restricted-item">
              <span className="home-restricted-label">Your access</span>
              <span className="home-restricted-value">
                {isProjectAdmin ? "administrator" : (currentProjectUser?.role ?? "member")}
              </span>
            </div>
            <div className="home-restricted-item">
              <span className="home-restricted-label">Created</span>
              <span className="home-restricted-value">{formatDateTime(project.createdAt)}</span>
            </div>
            <div className="home-restricted-item">
              <span className="home-restricted-label">Last updated</span>
              <span className="home-restricted-value">{formatDateTime(lastProjectActivityAt)}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="home-stats-grid postgres-experiment-home-stats-grid" ref={statsRef}>
        <PostgresStatCard
          title="Users"
          count={users.length}
          stats={([
            { label: "Owners", value: users.filter((user) => user.role === "owner").length },
            { label: "Editors", value: users.filter((user) => user.role === "editor").length },
            { label: "Coders", value: users.filter((user) => user.role === "coder").length },
            { label: "Viewers", value: users.filter((user) => user.role === "viewer").length },
          ]).filter((stat) => stat.value > 0)}
          onClick={onShowUsers}
        />

        <PostgresStatCard title="Sources" count={sourceCount} stats={sourceStats} onClick={onShowSources} />
        <PostgresStatCard title="Objects" count={objectCount} stats={[{ label: "Types", value: objectTypeCount }]} onClick={onShowObjects} />
        <PostgresStatCard title="Relationships" count={relationshipCount} stats={[{ label: "Types", value: relationshipTypeCount }]} onClick={onShowRelationships} />
        <PostgresStatCard title="Codes" count={codeCount} stats={[]} onClick={onShowCodebook} />
        <PostgresStatCard title="Annotations" count={annotationCount} stats={[]} onClick={onShowAnnotations} />
        <PostgresStatCard title="Memos" count={memoCount} stats={[]} onClick={onShowMemos} />
        <PostgresStatCard title="Reports" count={reportCount} stats={[]} onClick={onShowReports} />
      </div>
    </div>
  );
}
