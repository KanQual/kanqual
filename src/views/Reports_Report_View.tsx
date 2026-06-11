import { useState } from "react";
import { useStore } from "../context/StoreContext";
import { HelpIcon } from "../components/AppIcons";
import { formatCurrentDateTime } from "../i18n/formatters";

export function ReportView() {
  const {
    activeProject,
    codes,
    allAnnotations,
    documents,
    memos,
  } = useStore();
  const [helpOpen, setHelpOpen] = useState(false);

  if (!activeProject) {
    return (
      <div className="view">
        <div className="empty-state">Open a project first.</div>
      </div>
    );
  }

  const project = activeProject;

  const projectDocIds = new Set(documents.map((d) => d.id));
  const projectAnnotations = allAnnotations.filter((a) => projectDocIds.has(a.documentId));
  const codeMap = Object.fromEntries(codes.map((c) => [c.id, c]));

  const countByCode: Record<string, number> = {};
  for (const ann of projectAnnotations) {
    countByCode[ann.codeId] = (countByCode[ann.codeId] ?? 0) + 1;
  }

  const docBreakdown = documents.map((doc) => {
    const docAnns = projectAnnotations.filter((a) => a.documentId === doc.id);
    const byCode: Record<string, { code: string; color: string; quotes: string[] }> = {};
    for (const ann of docAnns) {
      const code = codeMap[ann.codeId];
      if (!code) continue;
      if (!byCode[ann.codeId]) {
        byCode[ann.codeId] = { code: code.label, color: code.color, quotes: [] };
      }
      byCode[ann.codeId].quotes.push(ann.quote);
    }
    return { doc, entries: Object.values(byCode) };
  });

  function handleExport() {
    const lines: string[] = [
      `# Report: ${project.name}`,
      `Generated: ${formatCurrentDateTime(new Date())}`,
      "",
      "## Summary",
      `Documents: ${documents.length}`,
      `Total annotations: ${projectAnnotations.length}`,
      `Memos: ${memos.length}`,
      "",
      "## Annotation Counts by Code",
      ...codes.map((c) => `- ${c.label}: ${countByCode[c.id] ?? 0}`),
      "",
      "## By Document",
    ];

    for (const { doc, entries } of docBreakdown) {
      lines.push(`\n### ${doc.name}`);
      if (entries.length === 0) {
        lines.push("No annotations.");
      }
      for (const entry of entries) {
        lines.push(`\n**${entry.code}** (${entry.quotes.length})`);
        for (const q of entry.quotes) {
          lines.push(`> "${q}"`);
        }
      }
    }

    if (memos.length > 0) {
      lines.push("", "## Memos");
      for (const memo of memos) {
        lines.push(`\n### ${memo.title}`);
        lines.push(memo.body || "*(empty)*");
      }
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, "_")}_report.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="view report-view">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>Report - {project.name}</h1>
          <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open report help">
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <button className="btn btn--primary" onClick={handleExport}>
          Export as Markdown
        </button>
      </header>

      <div className="report-summary-cards">
        <div className="summary-card">
          <div className="summary-card-value">{documents.length}</div>
          <div className="summary-card-label">Documents</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{projectAnnotations.length}</div>
          <div className="summary-card-label">Annotations</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{codes.length}</div>
          <div className="summary-card-label">Codes</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{memos.length}</div>
          <div className="summary-card-label">Memos</div>
        </div>
      </div>

      <section className="report-section">
        <h2>Annotation Counts by Code</h2>
        {codes.length === 0 ? (
          <p className="report-empty">No codes defined.</p>
        ) : (
          <ul className="report-code-list">
            {codes.map((code) => {
              const count = countByCode[code.id] ?? 0;
              const max = Math.max(...Object.values(countByCode), 1);
              return (
                <li key={code.id} className="report-code-row">
                  <span
                    className="report-code-swatch"
                    style={{ background: code.color }}
                  />
                  <span className="report-code-label">{code.label}</span>
                  <div className="report-bar-track">
                    <div
                      className="report-bar-fill"
                      style={{
                        width: `${(count / max) * 100}%`,
                        background: code.color,
                      }}
                    />
                  </div>
                  <span className="report-code-count">{count}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="report-section">
        <h2>By Document</h2>
        {docBreakdown.map(({ doc, entries }) => (
          <div key={doc.id} className="report-doc">
            <h3>{doc.name}</h3>
            {entries.length === 0 ? (
              <p className="report-empty">No annotations.</p>
            ) : (
              entries.map((entry) => (
                <div key={entry.code} className="report-doc-code">
                  <span
                    className="report-doc-badge"
                    style={{ background: entry.color }}
                  >
                    {entry.code} ({entry.quotes.length})
                  </span>
                  <ul className="report-quote-list">
                    {entry.quotes.map((q, i) => (
                      <li key={i} className="report-quote">"{q}"</li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        ))}
      </section>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>Report Help</h2>
            <div className="app-settings-modal-body">
                <p className="settings-section-desc">
                  Review summary cards, inspect code-count comparisons, inspect document-level quotation breakdowns, and export the report as markdown.
                </p>
                <ul className="settings-help-list">
                  <li>Use this page as a lightweight project-wide summary report. Read the overall counts first, then move into the code and document breakdowns for detail.</li>
                  <li>This is a synthesized readout of existing project content, not a separate editable report-configuration page.</li>
                  <li>Current project content such as codes, annotations, documents, and memos, plus export-as-markdown behavior, affect what appears here.</li>
                </ul>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
