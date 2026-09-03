import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  POSTGRES_PROJECT_CHANGED_EVENT,
  listPostgresReports,
  type PostgresProjectChangeEvent,
  type PostgresReport,
} from "../lib/postgres";
import { formatCurrentDateTime } from "../i18n/formatters";
import { LoadingCard } from "../components/LoadingCard";
import { ArrowLeftIcon, HelpIcon, PlusIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { useI18n } from "../i18n/provider";
import type { CodeReportKind, CodeReportRow, CodeReportSnapshot } from "./Reports_Codes_View";
import type { CoderReportKind, CoderReportRow, CoderReportSnapshot } from "./Reports_Users_View";
import type { ReportRow as AnnotationReportRow, ReportSnapshot as AnnotationReportSnapshot } from "./Reports_Annotations_View";

const LegacyCodeReportsViewLazy = lazy(() =>
  import("./Reports_Codes_View").then((module) => ({ default: module.CodesView })),
);
const LegacyUserReportsViewLazy = lazy(() =>
  import("./Reports_Users_View").then((module) => ({ default: module.ReportsUsersView })),
);
const LegacyAnnotationReportsViewLazy = lazy(() =>
  import("./Reports_Annotations_View").then((module) => ({ default: module.CodeReportsView })),
);

type ReportTypeFilter =
  | "all"
  | "code-frequencies"
  | "code-co-occurrences"
  | "user-activity"
  | "user-comparison"
  | "user-agreement"
  | "annotations";
type ReportTypeSortCol = "type" | "count";
type ActiveReportBuilder =
  | { type: "code"; kind?: CodeReportKind; savedReport?: CodeReportRow }
  | { type: "user"; kind?: CoderReportKind; savedReport?: CoderReportRow }
  | { type: "annotation"; savedReport?: AnnotationReportRow };

type ReportTypeOption = {
  id: ReportTypeFilter;
  title: string;
  description: string;
};

type PostgresReportsViewProps = {
  projectId: string;
  projectStoragePath?: string;
};

type NewReportOption = {
  id: string;
  title: string;
  description: string;
  builder: ActiveReportBuilder;
};

function formatReportDate(value: string): string {
  if (!value) return "-";
  try {
    return formatCurrentDateTime(value, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function formatReportType(value: string, genericReport: string, genericCodeReport: string, genericUserReport: string, genericAnnotationReport: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "code" || normalized === "code-report") return genericCodeReport;
  if (normalized === "user" || normalized === "coder" || normalized === "coder-report") return genericUserReport;
  if (normalized === "annotation" || normalized === "annotations") return genericAnnotationReport;
  if (!normalized) return genericReport;
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSpecificReportType(
  report: PostgresReport,
  reportTypes: ReportTypeOption[],
  genericReport: string,
  genericCodeReport: string,
  genericUserReport: string,
  genericAnnotationReport: string,
): string {
  const filterType = getReportFilterType(report);
  return reportTypes.find((type) => type.id === filterType)?.title
    ?? formatReportType(report.reportType, genericReport, genericCodeReport, genericUserReport, genericAnnotationReport);
}

function parseReportSnapshotKind(report: PostgresReport): string | null {
  try {
    const snapshot = JSON.parse(report.contentJson || "{}") as { kind?: unknown; reportType?: unknown };
    return typeof snapshot.kind === "string" ? snapshot.kind : null;
  } catch {
    return null;
  }
}

function getReportFilterType(report: PostgresReport): Exclude<ReportTypeFilter, "all"> | null {
  const reportType = report.reportType;
  const normalized = reportType.trim().toLowerCase();
  const kind = parseReportSnapshotKind(report);
  if (normalized === "code" || normalized === "code-report") {
    return kind === "summary" ? "code-co-occurrences" : "code-frequencies";
  }
  if (normalized === "user" || normalized === "coder" || normalized === "coder-report") {
    if (kind === "comparison") return "user-comparison";
    if (kind === "agreement") return "user-agreement";
    return "user-activity";
  }
  if (normalized === "annotation" || normalized === "annotations") return "annotations";
  return null;
}

function makeSavedReportBuilder(report: PostgresReport): ActiveReportBuilder | null {
  const normalized = report.reportType.trim().toLowerCase();

  try {
    if (normalized === "code-report" || normalized === "code") {
      const snapshot = JSON.parse(report.contentJson || "{}") as CodeReportSnapshot;
      if (snapshot?.reportType !== "code-report") return null;
      return {
        type: "code",
        kind: snapshot.kind,
        savedReport: {
          id: report.id,
          name: report.title,
          createdByName: report.createdByName || "-",
          createdAt: report.createdAt,
          snapshot,
        },
      };
    }

    if (normalized === "coder-report" || normalized === "coder" || normalized === "user") {
      const snapshot = JSON.parse(report.contentJson || "{}") as CoderReportSnapshot;
      if (snapshot?.reportType !== "coder-report") return null;
      return {
        type: "user",
        kind: snapshot.kind,
        savedReport: {
          id: report.id,
          name: report.title,
          createdByName: report.createdByName || "-",
          createdAt: report.createdAt,
          snapshot,
        },
      };
    }

    if (normalized === "annotations" || normalized === "annotation") {
      const snapshot = JSON.parse(report.contentJson || "{}") as AnnotationReportSnapshot;
      if (snapshot?.reportType !== "annotations") return null;
      const settings = JSON.parse(report.settingsJson || "{}") as Partial<AnnotationReportRow>;
      return {
        type: "annotation",
        savedReport: {
          id: report.id,
          name: report.title,
          createdByName: report.createdByName || "-",
          createdAt: report.createdAt,
          caseIds: Array.isArray(settings.caseIds) ? settings.caseIds : [],
          documentIds: Array.isArray(settings.documentIds)
            ? settings.documentIds
            : snapshot.filteredAnns.map((ann) => ann.documentId),
          codeIds: Array.isArray(settings.codeIds)
            ? settings.codeIds
            : snapshot.filteredAnns.map((ann) => ann.codeId),
          snapshot,
        },
      };
    }
  } catch {
    return null;
  }

  return null;
}

function ReportBuilderLoading() {
  return (
    <div className="view-loading-state">
      <LoadingCard />
    </div>
  );
}

function ReportBuilderShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap code-text-title-wrap">
          <button
            type="button"
            className="code-text-header-back-button"
            onClick={onBack}
            title={t("reportsLanding.backToReports")}
            aria-label={t("reportsLanding.backToReports")}
          >
            <ArrowLeftIcon className="code-text-header-back-icon" />
          </button>
          <h1>{title}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("reportsLanding.builderOpenHelp", { title: title.toLowerCase() })}
            aria-label={t("reportsLanding.builderOpenHelp", { title: title.toLowerCase() })}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>
      {helpOpen ? (
        <SettingsModal title={t("reportsLanding.builderHelpTitle", { title })} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("reportsLanding.builderHelpLine1")}
            </p>
            <p className="users-guide-copy">
              {t("reportsLanding.builderHelpLine2")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
      ) : null}
      <div style={{ minHeight: 0, flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

export function PostgresReportsView({ projectId, projectStoragePath }: PostgresReportsViewProps) {
  const { t } = useI18n();
  const [activeBuilder, setActiveBuilder] = useState<ActiveReportBuilder | null>(null);
  const [showNewReportModal, setShowNewReportModal] = useState(false);
  const [selectedReportTypeFilter, setSelectedReportTypeFilter] = useState<ReportTypeFilter>("all");
  const [reportTypeSortCol, setReportTypeSortCol] = useState<ReportTypeSortCol>("type");
  const [reportTypeSortDir, setReportTypeSortDir] = useState<"asc" | "desc">("asc");
  const [reports, setReports] = useState<PostgresReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const reportTypes = useMemo<ReportTypeOption[]>(() => [
    {
      id: "annotations",
      title: t("reportsLanding.reportTypesList.annotations.title"),
      description: t("reportsLanding.reportTypesList.annotations.description"),
    },
    {
      id: "code-co-occurrences",
      title: t("reportsLanding.reportTypesList.codeCoOccurrences.title"),
      description: t("reportsLanding.reportTypesList.codeCoOccurrences.description"),
    },
    {
      id: "code-frequencies",
      title: t("reportsLanding.reportTypesList.codeFrequencies.title"),
      description: t("reportsLanding.reportTypesList.codeFrequencies.description"),
    },
    {
      id: "user-activity",
      title: t("reportsLanding.reportTypesList.userActivity.title"),
      description: t("reportsLanding.reportTypesList.userActivity.description"),
    },
    {
      id: "user-agreement",
      title: t("reportsLanding.reportTypesList.userAgreement.title"),
      description: t("reportsLanding.reportTypesList.userAgreement.description"),
    },
    {
      id: "user-comparison",
      title: t("reportsLanding.reportTypesList.userComparison.title"),
      description: t("reportsLanding.reportTypesList.userComparison.description"),
    },
  ], [t]);
  const newReportOptions = useMemo<NewReportOption[]>(() => [
    {
      id: "annotations",
      title: t("reportsLanding.reportTypesList.annotations.title"),
      description: t("reportsLanding.reportTypesList.annotations.description"),
      builder: { type: "annotation" },
    },
    {
      id: "code-frequencies",
      title: t("reportsLanding.reportTypesList.codeFrequencies.title"),
      description: t("reportsLanding.reportTypesList.codeFrequencies.description"),
      builder: { type: "code", kind: "frequencies" },
    },
    {
      id: "code-co-occurrences",
      title: t("reportsLanding.reportTypesList.codeCoOccurrences.title"),
      description: t("reportsLanding.reportTypesList.codeCoOccurrences.description"),
      builder: { type: "code", kind: "summary" },
    },
    {
      id: "user-activity",
      title: t("reportsLanding.reportTypesList.userActivity.title"),
      description: t("reportsLanding.reportTypesList.userActivity.description"),
      builder: { type: "user", kind: "activity" },
    },
  ], [t]);

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    setReportError(null);
    try {
      const nextReports = await listPostgresReports(projectId);
      setReports(nextReports);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : t("reportsLanding.unableToLoadReports"));
    } finally {
      setLoadingReports(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function subscribe() {
      unlisten = await listen<PostgresProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
        if (disposed) return;
        if (event.payload.projectId !== projectId) return;
        if (event.payload.entityType !== "report") return;
        void loadReports();
      });
    }

    void subscribe();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [loadReports, projectId]);

  const reportTypeSummaries = useMemo(
    () => reportTypes.map((type) => ({
      ...type,
      count: reports.filter((report) => getReportFilterType(report) === type.id).length,
    })).sort((left, right) => {
      let comparison = 0;
      if (reportTypeSortCol === "count") {
        comparison = left.count - right.count;
        if (comparison === 0) {
          comparison = left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
        }
      } else {
        comparison = left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
      }
      return reportTypeSortDir === "asc" ? comparison : -comparison;
    }),
    [reportTypeSortCol, reportTypeSortDir, reportTypes, reports],
  );

  function handleReportTypeSort(column: ReportTypeSortCol) {
    if (reportTypeSortCol === column) {
      setReportTypeSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setReportTypeSortCol(column);
    setReportTypeSortDir("asc");
  }

  const filteredReports = useMemo(
    () => (
      selectedReportTypeFilter === "all"
        ? reports
        : reports.filter((report) => getReportFilterType(report) === selectedReportTypeFilter)
    ),
    [reports, selectedReportTypeFilter],
  );

  const sortedReports = useMemo(
    () => [...filteredReports].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [filteredReports],
  );

  const backToReportsLanding = () => setActiveBuilder(null);

  function handleOpenSavedReport(report: PostgresReport) {
    const builder = makeSavedReportBuilder(report);
    if (!builder) {
      setReportError(t("reportsLanding.unableToOpenReport", { title: report.title }));
      return;
    }
    setReportError(null);
    setActiveBuilder(builder);
  }

  if (activeBuilder?.type === "code") {
    const kind = activeBuilder.kind ?? activeBuilder.savedReport?.snapshot.kind ?? "frequencies";
    const title = kind === "frequencies" ? t("reportsLanding.builderTitles.codeFrequency") : t("reportsLanding.builderTitles.codeCoOccurrence");
    return (
      <ReportBuilderShell title={title} onBack={backToReportsLanding}>
        <Suspense fallback={<ReportBuilderLoading />}>
          <LegacyCodeReportsViewLazy
            initialNewReportKind={activeBuilder.savedReport ? undefined : kind}
            initialSavedReport={activeBuilder.savedReport ?? null}
            postgresProjectId={projectId}
            onBackToReports={backToReportsLanding}
          />
        </Suspense>
      </ReportBuilderShell>
    );
  }

  if (activeBuilder?.type === "user") {
    const kind = activeBuilder.kind ?? activeBuilder.savedReport?.snapshot.kind ?? "activity";
    const title = kind === "activity" ? t("reportsLanding.builderTitles.userActivity") : t("reportsLanding.builderTitles.userReports");
    return (
      <ReportBuilderShell title={title} onBack={backToReportsLanding}>
        <Suspense fallback={<ReportBuilderLoading />}>
          <LegacyUserReportsViewLazy
            initialNewReportKind={activeBuilder.savedReport ? undefined : kind}
            initialSavedReport={activeBuilder.savedReport ?? null}
            postgresProjectId={projectId}
            onBackToReports={backToReportsLanding}
          />
        </Suspense>
      </ReportBuilderShell>
    );
  }

  if (activeBuilder?.type === "annotation") {
    return (
      <ReportBuilderShell title={t("reportsLanding.builderTitles.annotation")} onBack={backToReportsLanding}>
        <Suspense fallback={<ReportBuilderLoading />}>
          <LegacyAnnotationReportsViewLazy
            initialNewReportOpen={!activeBuilder.savedReport}
            initialSavedReport={activeBuilder.savedReport ?? null}
            postgresProjectId={projectId}
            projectStoragePath={projectStoragePath}
            onBackToReports={backToReportsLanding}
          />
        </Suspense>
      </ReportBuilderShell>
    );
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("reportsLanding.title")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("reportsLanding.openHelp")}
            aria-label={t("reportsLanding.openHelp")}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen ? (
        <SettingsModal title={t("reportsLanding.helpTitle")} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("reportsLanding.helpLine1")}
            </p>
            <p className="users-guide-copy">
              {t("reportsLanding.helpLine2")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
      ) : null}

      <div
        className="postgres-sources-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)",
          gap: 20,
          alignItems: "center",
          flex: 1,
          minHeight: 0,
        }}
      >
        <section
          className="home-primary-column"
          style={{
            alignSelf: "center",
            justifyContent: "flex-start",
            gap: 16,
            minHeight: 0,
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 4,
          }}
        >
          <div className="home-project-card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 18,
                borderBottom: "1px solid rgba(53, 80, 112, 0.08)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{t("reportsLanding.reportTypes")}</h2>
              </div>
            </div>

            <div className="users-table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="users-table" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th
                      className={`users-th${reportTypeSortCol === "type" ? " users-th--sorted" : ""}`}
                      style={{ width: "76%" }}
                      onClick={() => handleReportTypeSort("type")}
                    >
                      {t("reportsLanding.type")}
                      <span className="users-sort-icon">
                        {reportTypeSortCol === "type" ? (reportTypeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </th>
                    <th
                      className={`users-th${reportTypeSortCol === "count" ? " users-th--sorted" : ""}`}
                      style={{ width: "24%" }}
                      onClick={() => handleReportTypeSort("count")}
                    >
                      {t("reportsLanding.count")}
                      <span className="users-sort-icon">
                        {reportTypeSortCol === "count" ? (reportTypeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    className="users-row"
                    style={{
                      background: selectedReportTypeFilter === "all" ? "rgba(53, 80, 112, 0.10)" : undefined,
                      borderBottom: "1px solid rgba(53, 80, 112, 0.10)",
                    }}
                  >
                    <td
                      className="users-td users-td--name"
                      style={{ fontWeight: 700 }}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedReportTypeFilter("all")}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedReportTypeFilter("all");
                        }
                      }}
                    >
                      {t("reportsLanding.allReports")}
                    </td>
                    <td className="users-td users-td--muted">{reports.length}</td>
                  </tr>
                  {reportTypeSummaries.map((summary) => (
                    <tr
                      key={summary.id}
                      className="users-row"
                      style={{
                        background: selectedReportTypeFilter === summary.id ? "rgba(53, 80, 112, 0.10)" : undefined,
                      }}
                    >
                      <td
                        className="users-td users-td--name"
                        style={{ paddingLeft: 32 }}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedReportTypeFilter(summary.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedReportTypeFilter(summary.id);
                          }
                        }}
                      >
                        {summary.title}
                      </td>
                      <td className="users-td users-td--muted">{summary.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section
          className="users-content"
          style={{
            alignItems: "stretch",
            justifyContent: "center",
            gap: 16,
            minHeight: 0,
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 4,
          }}
        >
          <div className="home-project-card project-table-card">
            <div className="project-table-card-header">
              <h2>{t("reportsLanding.savedReports")}</h2>
              <button
                type="button"
                className="btn btn--primary project-table-header-icon-button"
                onClick={() => setShowNewReportModal(true)}
                title={t("reportsLanding.newReport")}
                aria-label={t("reportsLanding.newReport")}
              >
                <PlusIcon className="project-table-header-icon" />
              </button>
            </div>

            {reportError ? <p className="users-error" style={{ margin: 16 }}>{reportError}</p> : null}

            <div className="users-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th className="users-th">{t("reportsLanding.reportTitle")}</th>
                    <th className="users-th">{t("reportsLanding.type")}</th>
                    <th className="users-th">{t("reportsLanding.saved")}</th>
                    <th className="users-th">{t("reportsLanding.createdBy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingReports ? (
                    <tr>
                      <td className="users-td-msg" colSpan={4}>{t("reportsLanding.loadingReports")}</td>
                    </tr>
                  ) : sortedReports.length === 0 ? (
                    <tr>
                      <td className="users-td-msg" colSpan={4}>{t("reportsLanding.noReportsYet")}</td>
                    </tr>
                  ) : (
                    sortedReports.map((report) => (
                      <tr
                        key={report.id}
                        className="users-row"
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpenSavedReport(report)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleOpenSavedReport(report);
                          }
                        }}
                      >
                        <td className="users-td">
                          <strong>{report.title}</strong>
                        </td>
                        <td className="users-td">{formatSpecificReportType(
                          report,
                          reportTypes,
                          t("reportsLanding.genericReport"),
                          t("reportsLanding.genericCodeReport"),
                          t("reportsLanding.genericUserReport"),
                          t("reportsLanding.genericAnnotationReport"),
                        )}</td>
                        <td className="users-td">{formatReportDate(report.updatedAt || report.createdAt)}</td>
                        <td className="users-td">{report.createdByName || "-"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {showNewReportModal ? (
        <SettingsModal title={t("reportsLanding.newReportTitle")} onClose={() => setShowNewReportModal(false)}>
          <div className="app-settings-modal-body">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 14,
                marginTop: 16,
              }}
            >
              {newReportOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setShowNewReportModal(false);
                    setActiveBuilder(option.builder);
                  }}
                >
                  <h3>{option.title}</h3>
                  <p>{option.description}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn" onClick={() => setShowNewReportModal(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </SettingsModal>
      ) : null}
    </div>
  );
}
