import { useState } from "react";
import { PlusIcon } from "../components/AppIcons";
import { CardHeader } from "../components/CardHeader";
import { HelpModal } from "../components/HelpModal";
import { TableMessageRow, TableShell } from "../components/TableShell";
import { ViewHeader } from "../components/ViewHeader";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import type { PostgresSavedDrawingSummary } from "../lib/postgres";

type PostgresAnalysisWorkspaceKind = "draw" | "network";

const WORKSPACE_COPY: Record<PostgresAnalysisWorkspaceKind, {
  title: string;
  tableTitle: string;
  itemLabel: string;
  newLabel: string;
  emptyLabel: string;
  helpTitle: string;
  helpLines: string[];
}> = {
  draw: {
    title: "Draw",
    tableTitle: "Drawings",
    itemLabel: "Drawing title",
    newLabel: "New drawing",
    emptyLabel: "No drawings yet.",
    helpTitle: "Draw Help",
    helpLines: [
      "Use Draw to collect visual analysis sketches, diagrams, and freeform interpretive notes in one project workspace.",
      "This page is ready for saved drawing workflows that sit alongside memos and reports.",
    ],
  },
  network: {
    title: "Network",
    tableTitle: "Networks",
    itemLabel: "Network title",
    newLabel: "New network",
    emptyLabel: "No network analyses yet.",
    helpTitle: "Network Help",
    helpLines: [
      "Use Network to review graph-based analysis outputs, including relationship structure and centrality-oriented summaries.",
      "This page is ready for saved network analysis workflows that sit alongside memos and reports.",
    ],
  },
};

function AnalysisWorkspaceView({
  kind,
  onCreateItem,
  drawings = [],
  onOpenDrawing,
}: {
  kind: PostgresAnalysisWorkspaceKind;
  onCreateItem?: () => void;
  drawings?: PostgresSavedDrawingSummary[];
  onOpenDrawing?: (drawingId: string) => void;
}) {
  const { t } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);
  const copy = WORKSPACE_COPY[kind];

  return (
    <div className="view view-shell">
      <ViewHeader
        title={copy.title}
        help={{ label: `Open ${copy.title.toLowerCase()} help`, onClick: () => setHelpOpen(true) }}
      />

      {helpOpen ? (
        <HelpModal title={copy.helpTitle} onClose={() => setHelpOpen(false)} lines={copy.helpLines} />
      ) : null}

      <div className="analysis-list-shell">
        <section className="content-card table-card analysis-list-card">
          <CardHeader
            title={copy.tableTitle}
            actions={<button
              type="button"
              className="btn btn--primary card-header-icon-button"
              onClick={onCreateItem}
              disabled={!onCreateItem}
              title={onCreateItem ? copy.newLabel : `${copy.newLabel} is not available yet`}
              aria-label={copy.newLabel}
            >
              <PlusIcon className="card-header-icon" />
            </button>}
          />
          <TableShell className="analysis-list-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="data-table-header">{copy.itemLabel}</th>
                  <th className="data-table-header">{t("analysisWorkspace.affiliations")}</th>
                  <th className="data-table-header">{t("analysisWorkspace.saved")}</th>
                  <th className="data-table-header">{t("analysisWorkspace.createdBy")}</th>
                </tr>
              </thead>
              <tbody>
                {kind === "draw" && drawings.length > 0 ? (
                  drawings.map((drawing) => (
                    <tr
                      key={drawing.id}
                      className="data-table-row"
                      role={onOpenDrawing ? "button" : undefined}
                      tabIndex={onOpenDrawing ? 0 : undefined}
                      onClick={() => onOpenDrawing?.(drawing.id)}
                      onKeyDown={(event) => {
                        if (!onOpenDrawing || (event.key !== "Enter" && event.key !== " ")) return;
                        event.preventDefault();
                        onOpenDrawing(drawing.id);
                      }}
                    >
                      <td className="data-table-cell data-table-cell--name">{drawing.name || "Untitled drawing"}</td>
                      <td className="data-table-cell data-table-cell--muted">{t("analysisWorkspace.projectGraph")}</td>
                      <td className="data-table-cell data-table-cell--muted">
                        {formatCurrentDateTime(drawing.updatedAt, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="data-table-cell data-table-cell--muted">-</td>
                    </tr>
                  ))
                ) : (
                  <TableMessageRow colSpan={4}>{copy.emptyLabel}</TableMessageRow>
                )}
              </tbody>
            </table>
          </TableShell>
        </section>
      </div>
    </div>
  );
}

export function AnalysisDrawView({
  drawings,
  onCreateDrawing,
  onOpenDrawing,
}: {
  drawings?: PostgresSavedDrawingSummary[];
  onCreateDrawing?: () => void;
  onOpenDrawing?: (drawingId: string) => void;
}) {
  return (
    <AnalysisWorkspaceView
      kind="draw"
      drawings={drawings}
      onCreateItem={onCreateDrawing}
      onOpenDrawing={onOpenDrawing}
    />
  );
}

export function AnalysisNetworkView() {
  return <AnalysisWorkspaceView kind="network" />;
}
