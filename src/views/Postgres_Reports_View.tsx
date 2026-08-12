import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  POSTGRES_PROJECT_CHANGED_EVENT,
  listPostgresReports,
  type PostgresProjectChangeEvent,
  type PostgresReport,
} from "../lib/postgres";
import { formatCurrentDateTime } from "../i18n/formatters";
import type { CodeReportKind } from "./Reports_Codes_View";
import type { CoderReportKind } from "./Reports_Users_View";

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
type ActiveReportBuilder =
  | { type: "code"; kind: CodeReportKind }
  | { type: "user"; kind: CoderReportKind }
  | { type: "annotation" };

type ReportTypeOption = {
  id: ReportTypeFilter;
  title: string;
  description: string;
};

type PostgresReportsViewProps = {
  projectId: string;
  projectStoragePath?: string;
};

const REPORT_TYPES: ReportTypeOption[] = [
  {
    id: "annotations",
    title: "Annotation Report",
    description: "Filter annotations and export excerpt, grouping, sorting, and statistics views.",
  },
  {
    id: "code-co-occurrences",
    title: "Code Co-occurrence",
    description: "Build co-occurrence matrices that show which selected codes appear together.",
  },
  {
    id: "code-frequencies",
    title: "Code Frequency",
    description: "Count and compare how often selected codes appear across sources, cases, and coders.",
  },
  {
    id: "user-activity",
    title: "User Activity",
    description: "Review coder output, source coverage, code usage, and recent project activity.",
  },
  {
    id: "user-agreement",
    title: "User Agreement",
    description: "Inspect overlap and agreement signals across coders for selected project material.",
  },
  {
    id: "user-comparison",
    title: "User Comparison",
    description: "Compare coding patterns across users by code, source, and selected filters.",
  },
];

const NEW_REPORT_OPTIONS: Array<{
  id: string;
  title: string;
  description: string;
  builder: ActiveReportBuilder;
}> = [
  {
    id: "annotations",
    title: "Annotation Report",
    description: "Filter annotations and export excerpt, grouping, sorting, and statistics views.",
    builder: { type: "annotation" },
  },
  {
    id: "code-frequencies",
    title: "Code Frequency",
    description: "Count and compare how often selected codes appear across sources, cases, and coders.",
    builder: { type: "code", kind: "frequencies" },
  },
  {
    id: "code-co-occurrences",
    title: "Code Co-occurrence",
    description: "Build co-occurrence matrices that show which selected codes appear together.",
    builder: { type: "code", kind: "summary" },
  },
  {
    id: "user-activity",
    title: "User Activity",
    description: "Review coder output, source coverage, code usage, and recent project activity.",
    builder: { type: "user", kind: "activity" },
  },
];

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

function formatReportType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "code" || normalized === "code-report") return "Code report";
  if (normalized === "user" || normalized === "coder" || normalized === "coder-report") return "User report";
  if (normalized === "annotation" || normalized === "annotations") return "Annotation report";
  if (!normalized) return "Report";
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSpecificReportType(report: PostgresReport): string {
  const filterType = getReportFilterType(report);
  return REPORT_TYPES.find((type) => type.id === filterType)?.title ?? formatReportType(report.reportType);
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

function ReportBuilderLoading() {
  return <div className="view-loading-state">Loading report builder...</div>;
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
  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{title}</h1>
        </div>
        <button type="button" className="btn" onClick={onBack}>
          Back to reports
        </button>
      </header>
      <div style={{ minHeight: 0, flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

export function PostgresReportsView({ projectId, projectStoragePath }: PostgresReportsViewProps) {
  const [activeBuilder, setActiveBuilder] = useState<ActiveReportBuilder | null>(null);
  const [showNewReportModal, setShowNewReportModal] = useState(false);
  const [selectedReportTypeFilter, setSelectedReportTypeFilter] = useState<ReportTypeFilter>("all");
  const [reports, setReports] = useState<PostgresReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    setReportError(null);
    try {
      const nextReports = await listPostgresReports(projectId);
      setReports(nextReports);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Unable to load saved reports.");
    } finally {
      setLoadingReports(false);
    }
  }, [projectId]);

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
    () => REPORT_TYPES.map((type) => ({
      ...type,
      count: reports.filter((report) => getReportFilterType(report) === type.id).length,
    })),
    [reports],
  );

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

  const selectedReportType = selectedReportTypeFilter === "all"
    ? null
    : REPORT_TYPES.find((type) => type.id === selectedReportTypeFilter) ?? null;
  const backToReportsLanding = () => setActiveBuilder(null);

  if (activeBuilder?.type === "code") {
    const title = activeBuilder.kind === "frequencies" ? "Code Frequency Report" : "Code Co-Occurrence Report";
    return (
      <ReportBuilderShell title={title} onBack={backToReportsLanding}>
        <Suspense fallback={<ReportBuilderLoading />}>
          <LegacyCodeReportsViewLazy
            initialNewReportKind={activeBuilder.kind}
            postgresProjectId={projectId}
            onBackToReports={backToReportsLanding}
          />
        </Suspense>
      </ReportBuilderShell>
    );
  }

  if (activeBuilder?.type === "user") {
    const title = activeBuilder.kind === "activity" ? "User Activity Report" : "User Reports";
    return (
      <ReportBuilderShell title={title} onBack={backToReportsLanding}>
        <Suspense fallback={<ReportBuilderLoading />}>
          <LegacyUserReportsViewLazy
            initialNewReportKind={activeBuilder.kind}
            postgresProjectId={projectId}
            onBackToReports={backToReportsLanding}
          />
        </Suspense>
      </ReportBuilderShell>
    );
  }

  if (activeBuilder?.type === "annotation") {
    return (
      <ReportBuilderShell title="Annotation Report" onBack={backToReportsLanding}>
        <Suspense fallback={<ReportBuilderLoading />}>
          <LegacyAnnotationReportsViewLazy
            initialNewReportOpen
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
          <h1>Reports</h1>
          <p className="view-subtitle">
            Open report builders and review saved project reports in one workspace.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setShowNewReportModal(true)}>
          New report
        </button>
      </header>

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
                <h2 style={{ margin: 0, fontSize: 18 }}>Report types</h2>
                <span className="home-restricted-value">{REPORT_TYPES.length}</span>
              </div>
            </div>

            <div className="users-table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="users-table">
                <thead>
                  <tr>
                    <th className="users-th">Type</th>
                    <th className="users-th" style={{ width: "32%" }}>Count</th>
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
                      All reports
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
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>Saved reports</h2>
                  <p className="view-subtitle" style={{ margin: "4px 0 0" }}>
                    {selectedReportType ? selectedReportType.title : "All report types"}
                  </p>
                </div>
                <span className="home-restricted-value">{sortedReports.length}</span>
              </div>
            </div>

            {reportError ? <p className="users-error" style={{ margin: 16 }}>{reportError}</p> : null}

            <div className="users-table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="users-table">
                <thead>
                  <tr>
                    <th className="users-th">Report title</th>
                    <th className="users-th">Type</th>
                    <th className="users-th">Saved</th>
                    <th className="users-th">Created by</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingReports ? (
                    <tr>
                      <td className="users-td" colSpan={4}>Loading reports...</td>
                    </tr>
                  ) : sortedReports.length === 0 ? (
                    <tr>
                      <td className="users-td" colSpan={4}>No PostgreSQL reports yet.</td>
                    </tr>
                  ) : (
                    sortedReports.map((report) => (
                      <tr key={report.id} className="users-row">
                        <td className="users-td">
                          <strong>{report.title}</strong>
                        </td>
                        <td className="users-td">{formatSpecificReportType(report)}</td>
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
        <div className="modal-overlay" onClick={() => setShowNewReportModal(false)}>
          <div
            className="modal"
            style={{ width: "min(680px, calc(100vw - 32px))", maxWidth: 680 }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>New report</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 14,
                marginTop: 16,
              }}
            >
              {NEW_REPORT_OPTIONS.map((option) => (
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
            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn" onClick={() => setShowNewReportModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
