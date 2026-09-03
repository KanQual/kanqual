import { useState } from "react";
import { useStore } from "../context/StoreContext";
import { HelpIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";

export function ReportView() {
  const { t } = useI18n();
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
        <div className="empty-state">{t("reportSummary.openProjectFirst")}</div>
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
      `${t("reportSummary.generated")}: ${formatCurrentDateTime(new Date())}`,
      "",
      `## ${t("reportSummary.summary")}`,
      `${t("reportSummary.documents")}: ${documents.length}`,
      `${t("reportSummary.totalAnnotations")}: ${projectAnnotations.length}`,
      `${t("reportSummary.memos")}: ${memos.length}`,
      "",
      `## ${t("reportSummary.annotationCountsByCode")}`,
      ...codes.map((c) => `- ${c.label}: ${countByCode[c.id] ?? 0}`),
      "",
      `## ${t("reportSummary.byDocument")}`,
    ];

    for (const { doc, entries } of docBreakdown) {
      lines.push(`\n### ${doc.name}`);
      if (entries.length === 0) {
        lines.push(t("reportSummary.noAnnotations"));
      }
      for (const entry of entries) {
        lines.push(`\n**${entry.code}** (${entry.quotes.length})`);
        for (const q of entry.quotes) {
          lines.push(`> "${q}"`);
        }
      }
    }

    if (memos.length > 0) {
      lines.push("", `## ${t("reportSummary.memos")}`);
      for (const memo of memos) {
        lines.push(`\n### ${memo.title}`);
        lines.push(memo.body || t("reportSummary.emptyMemo"));
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
          <h1>{t("reportSummary.title", { projectName: project.name })}</h1>
          <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label={t("reportSummary.openHelp")}>
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <button className="btn btn--primary" onClick={handleExport}>
          {t("reportSummary.exportMarkdown")}
        </button>
      </header>

      <div className="report-summary-cards">
        <div className="summary-card">
          <div className="summary-card-value">{documents.length}</div>
          <div className="summary-card-label">{t("reportSummary.documents")}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{projectAnnotations.length}</div>
          <div className="summary-card-label">{t("reportSummary.annotations")}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{codes.length}</div>
          <div className="summary-card-label">{t("reportSummary.codes")}</div>
        </div>
        <div className="summary-card">
          <div className="summary-card-value">{memos.length}</div>
          <div className="summary-card-label">{t("reportSummary.memos")}</div>
        </div>
      </div>

      <section className="report-section">
        <h2>{t("reportSummary.annotationCountsByCode")}</h2>
        {codes.length === 0 ? (
          <p className="report-empty">{t("reportSummary.noCodesDefined")}</p>
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
        <h2>{t("reportSummary.byDocument")}</h2>
        {docBreakdown.map(({ doc, entries }) => (
          <div key={doc.id} className="report-doc">
            <h3>{doc.name}</h3>
            {entries.length === 0 ? (
              <p className="report-empty">{t("reportSummary.noAnnotations")}</p>
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
        <SettingsModal
          title={t("reportSummary.helpTitle")}
          onClose={() => setHelpOpen(false)}
          modalClassName="modal--help"
        >
          <div className="app-settings-modal-body">
            <p className="settings-section-desc">
              {t("reportSummary.helpIntro")}
            </p>
            <ul className="settings-help-list">
              <li>{t("reportSummary.helpLine1")}</li>
              <li>{t("reportSummary.helpLine2")}</li>
              <li>{t("reportSummary.helpLine3")}</li>
            </ul>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
      )}
    </div>
  );
}
