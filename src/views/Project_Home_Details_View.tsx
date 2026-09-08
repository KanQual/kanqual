import type { RefObject } from "react";
import { HomeCardHeader } from "../components/CardHeader";
import { useI18n } from "../i18n/provider";
import type { PostgresProject, PostgresProjectUser } from "../lib/postgres";

function ProjectStatCard({
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

export function ProjectHomeDetailsView({
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
  const { t } = useI18n();
  return (
    <div className="home-dashboard project-home-dashboard project-home-details-dashboard">
      <div
        className="home-primary-column project-home-primary-column"
        style={
          statsHeight > 0
            ? {
              height: statsHeight,
              maxHeight: statsHeight,
            }
            : undefined
        }
      >
        <section className="content-card" aria-label={t("projectCore.home.titleAria")}>
          <HomeCardHeader title={t("projectCore.home.titleHeading")} />
          <p className="home-project-title-value">{project.name || t("projectCore.home.untitledProject")}</p>
        </section>

        <section className="content-card project-home-description-card" aria-label={t("projectCore.home.descriptionAria")}>
          <HomeCardHeader title={t("projectCore.home.descriptionHeading")} />
          {project.description.trim() ? (
            <p className="home-project-description">{project.description}</p>
          ) : (
            <p className="home-project-description home-project-description--empty">
              {t("projectCore.home.noDescription")}
            </p>
          )}
        </section>

        <section className="content-card" aria-label={t("projectCore.home.informationAria")}>
          <HomeCardHeader title={t("projectCore.home.informationHeading")} />
          <div className="home-restricted-list">
            <div className="home-restricted-item">
              <span className="home-restricted-label">{t("projectCore.home.yourAccess")}</span>
              <span className="home-restricted-value">
                {isProjectAdmin ? t("projectCore.home.administrator") : (currentProjectUser?.role ?? t("projectCore.home.member"))}
              </span>
            </div>
            <div className="home-restricted-item">
              <span className="home-restricted-label">{t("projectCore.entities.created")}</span>
              <span className="home-restricted-value">{formatDateTime(project.createdAt)}</span>
            </div>
            <div className="home-restricted-item">
              <span className="home-restricted-label">{t("projectCore.entities.lastUpdated")}</span>
              <span className="home-restricted-value">{formatDateTime(lastProjectActivityAt)}</span>
            </div>
          </div>
        </section>
      </div>

      <div className="home-stats-grid project-home-stats-grid" ref={statsRef}>
        <ProjectStatCard
          title={t("projectCore.entities.users")}
          count={users.length}
          stats={([
            { label: t("projectCore.home.roles.owners"), value: users.filter((user) => user.role === "owner").length },
            { label: t("projectCore.home.roles.editors"), value: users.filter((user) => user.role === "editor").length },
            { label: t("projectCore.home.roles.coders"), value: users.filter((user) => user.role === "coder").length },
            { label: t("projectCore.home.roles.viewers"), value: users.filter((user) => user.role === "viewer").length },
          ]).filter((stat) => stat.value > 0)}
          onClick={onShowUsers}
        />

        <ProjectStatCard title={t("projectCore.entities.sources")} count={sourceCount} stats={sourceStats} onClick={onShowSources} />
        <ProjectStatCard title={t("projectCore.entities.objects")} count={objectCount} stats={[{ label: t("projectCore.entities.types"), value: objectTypeCount }]} onClick={onShowObjects} />
        <ProjectStatCard title={t("projectCore.entities.relationships")} count={relationshipCount} stats={[{ label: t("projectCore.entities.types"), value: relationshipTypeCount }]} onClick={onShowRelationships} />
        <ProjectStatCard title={t("projectCore.entities.codes")} count={codeCount} stats={[]} onClick={onShowCodebook} />
        <ProjectStatCard title={t("projectCore.entities.annotations")} count={annotationCount} stats={[]} onClick={onShowAnnotations} />
        <ProjectStatCard title={t("projectCore.entities.memos")} count={memoCount} stats={[]} onClick={onShowMemos} />
        <ProjectStatCard title={t("projectCore.entities.reports")} count={reportCount} stats={[]} onClick={onShowReports} />
      </div>
    </div>
  );
}
