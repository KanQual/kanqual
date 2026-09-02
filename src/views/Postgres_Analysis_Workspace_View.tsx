import { useState } from "react";
import { HelpIcon, PlusIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { formatCurrentDateTime } from "../i18n/formatters";
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

function PostgresAnalysisWorkspaceView({
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
  const [helpOpen, setHelpOpen] = useState(false);
  const copy = WORKSPACE_COPY[kind];

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{copy.title}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={`Open ${copy.title.toLowerCase()} help`}
            aria-label={`Open ${copy.title.toLowerCase()} help`}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen ? (
        <SettingsModal title={copy.helpTitle} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            {copy.helpLines.map((line) => (
              <p key={line} className="users-guide-copy">
                {line}
              </p>
            ))}
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              Close
            </button>
          </div>
        </SettingsModal>
      ) : null}

      <div className="postgres-memo-table-shell">
        <section className="home-project-card project-table-card postgres-memo-table-card">
          <div className="project-table-card-header">
            <h2>{copy.tableTitle}</h2>
            <button
              type="button"
              className="btn btn--primary project-table-header-icon-button"
              onClick={onCreateItem}
              disabled={!onCreateItem}
              title={onCreateItem ? copy.newLabel : `${copy.newLabel} is not available yet`}
              aria-label={copy.newLabel}
            >
              <PlusIcon className="project-table-header-icon" />
            </button>
          </div>
          <div className="users-table-wrap postgres-memo-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th className="users-th">{copy.itemLabel}</th>
                  <th className="users-th">Affiliations</th>
                  <th className="users-th">Saved</th>
                  <th className="users-th">Created by</th>
                </tr>
              </thead>
              <tbody>
                {kind === "draw" && drawings.length > 0 ? (
                  drawings.map((drawing) => (
                    <tr
                      key={drawing.id}
                      className="users-row"
                      role={onOpenDrawing ? "button" : undefined}
                      tabIndex={onOpenDrawing ? 0 : undefined}
                      onClick={() => onOpenDrawing?.(drawing.id)}
                      onKeyDown={(event) => {
                        if (!onOpenDrawing || (event.key !== "Enter" && event.key !== " ")) return;
                        event.preventDefault();
                        onOpenDrawing(drawing.id);
                      }}
                    >
                      <td className="users-td users-td--name">{drawing.name || "Untitled drawing"}</td>
                      <td className="users-td users-td--muted">Project graph</td>
                      <td className="users-td users-td--muted">
                        {formatCurrentDateTime(drawing.updatedAt, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="users-td users-td--muted">-</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="users-td-msg" colSpan={4}>
                      {copy.emptyLabel}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export function PostgresAnalysisDrawView({
  drawings,
  onCreateDrawing,
  onOpenDrawing,
}: {
  drawings?: PostgresSavedDrawingSummary[];
  onCreateDrawing?: () => void;
  onOpenDrawing?: (drawingId: string) => void;
}) {
  return (
    <PostgresAnalysisWorkspaceView
      kind="draw"
      drawings={drawings}
      onCreateItem={onCreateDrawing}
      onOpenDrawing={onOpenDrawing}
    />
  );
}

export function PostgresAnalysisNetworkView() {
  return <PostgresAnalysisWorkspaceView kind="network" />;
}
