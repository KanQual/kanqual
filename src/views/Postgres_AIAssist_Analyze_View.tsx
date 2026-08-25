import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpIcon, PlusIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import {
  createPostgresAiAnalysis,
  deletePostgresAiAnalysis,
  getPostgresInstallationSettings,
  getPostgresProjectAiAssistSettings,
  listPostgresAiAnalyses,
  type PostgresAiAnalysis,
  type PostgresAnnotationSummary,
  type PostgresCode,
  type PostgresInstallationSettings,
} from "../lib/postgres";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";
import { PostgresSourceCodebookCard } from "./Postgres_Source_Coding_Shared";

type AnalysisId = "conceptual-summary" | "decomposition" | "position" | "most-typical-annotation" | "most-unique-annotation";

type AnnotationRef = {
  id: string;
  sourceId: string;
  sourceName: string;
  quote: string;
};

type AnalyzeCitationModalState = {
  ref: AnnotationRef;
  index: number;
};

type AnalysisSnapshot = {
  reportType: "ai-analysis";
  selectedCodeId: string | null;
  selectedAnalysisIds: AnalysisId[];
  results: Partial<Record<AnalysisId, AnalysisResult>>;
};

type AnalysisResult = {
  title: string;
  body: string;
  model: string;
  baseUrl?: string;
  annotationRefs: AnnotationRef[];
};

type AnalysisState = {
  busy: boolean;
  error: string;
  result: AnalysisResult | null;
};

const ANALYSIS_OPTIONS: Array<{ id: AnalysisId; title: string; description: string }> = [
  {
    id: "conceptual-summary",
    title: "Conceptual Summary",
    description: "Summarize what the selected code represents across its annotations.",
  },
  {
    id: "decomposition",
    title: "Code Decomposition",
    description: "Look for sub-clusters, outliers, and internal tensions.",
  },
  {
    id: "position",
    title: "Code Position",
    description: "Review how this code fits in the codebook hierarchy.",
  },
  {
    id: "most-typical-annotation",
    title: "Most Typical Annotations",
    description: "Find annotations that best exemplify the code.",
  },
  {
    id: "most-unique-annotation",
    title: "Most Unique Annotations",
    description: "Find annotations that are most distinct within the code.",
  },
];

function emptyAnalysisState(): AnalysisState {
  return { busy: false, error: "", result: null };
}

function parseContentSection(text: string, heading: string): string {
  const match = new RegExp(`##\\s*${heading}\\s*([\\s\\S]*?)(?=##|$)`, "i").exec(text);
  return match?.[1]?.trim() ?? "";
}

function compactText(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeResultItems(response: unknown): Array<{ annotationIndex: number; reasoning: string }> {
  if (!response || typeof response !== "object") return [];
  const candidate = response as Record<string, unknown>;
  const rows = Array.isArray(candidate.annotations)
    ? candidate.annotations
    : Array.isArray(candidate.items)
      ? candidate.items
      : Array.isArray(candidate.results)
        ? candidate.results
        : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const rawIndex = item.annotationIndex ?? item.annotation_index ?? item.index ?? item.annotation;
      const annotationIndex = typeof rawIndex === "number" ? rawIndex : Number(rawIndex);
      if (!Number.isFinite(annotationIndex)) return null;
      return {
        annotationIndex,
        reasoning: typeof item.reasoning === "string" ? item.reasoning : typeof item.reason === "string" ? item.reason : "",
      };
    })
    .filter((item): item is { annotationIndex: number; reasoning: string } => item !== null);
}

function buildRuntimeRequest(settings: PostgresInstallationSettings) {
  const llm = settings.llm;
  const model = llm.connectionMode === "cloud" ? llm.cloudSelectedModel : llm.ollamaSelectedModel;
  return {
    connectionMode: llm.connectionMode,
    cloudProvider: llm.cloudProvider,
    cloudApiSecret: llm.cloudApiSecret,
    protocol: llm.ollamaProtocol,
    host: llm.ollamaHost,
    port: llm.ollamaPort,
    model,
    timeoutSeconds: llm.ollamaRequestTimeoutSeconds,
    temperature: llm.ollamaTemperature,
    numCtx: llm.ollamaNumCtx,
    keepAliveMinutes: llm.ollamaKeepAliveMinutes,
  };
}

function parseSnapshot(row: PostgresAiAnalysis): AnalysisSnapshot | null {
  try {
    const parsed = JSON.parse(row.snapshotJson || "{}");
    if (!parsed || typeof parsed !== "object" || parsed.reportType !== "ai-analysis") return null;
    const candidate = parsed as Record<string, unknown>;
    const selectedAnalysisIds = Array.isArray(candidate.selectedAnalysisIds)
      ? candidate.selectedAnalysisIds.filter((id): id is AnalysisId => ANALYSIS_OPTIONS.some((option) => option.id === id))
      : [];
    const results = (candidate.results && typeof candidate.results === "object" ? candidate.results : {}) as Partial<Record<AnalysisId, AnalysisResult>>;
    return {
      reportType: "ai-analysis",
      selectedCodeId: typeof candidate.selectedCodeId === "string" ? candidate.selectedCodeId : null,
      selectedAnalysisIds,
      results,
    };
  } catch {
    return null;
  }
}

function renderTextWithCitations(
  text: string,
  annotationRefs: AnnotationRef[],
  onCitationClick: (ref: AnnotationRef, citationIndex: number) => void,
) {
  const parts: React.ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    const index = Number(match[1]) - 1;
    const ref = annotationRefs[index];
    if (!ref) continue;
    if (match.index > lastIndex) parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    parts.push(
      <button key={key++} type="button" className="ai-analyze-citation-link" onClick={() => onCitationClick(ref, index)}>
        [{index + 1}]
      </button>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  return parts;
}

function formatDate(value: string): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function PostgresAIAssistAnalyzeView({
  projectId,
  canUseAiAnalyzeTools,
  onOpenAnnotation,
}: {
  projectId: string;
  canUseAiAnalyzeTools: boolean;
  onOpenAnnotation: (target: { sourceId: string; annotationId: string }) => void;
}) {
  const [codes, setCodes] = useState<PostgresCode[]>([]);
  const [annotations, setAnnotations] = useState<PostgresAnnotationSummary[]>([]);
  const [sourceNameById, setSourceNameById] = useState<Record<string, string>>({});
  const [savedAnalyses, setSavedAnalyses] = useState<PostgresAiAnalysis[]>([]);
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const [selectedAnalyses, setSelectedAnalyses] = useState<Set<AnalysisId>>(new Set());
  const [states, setStates] = useState<Record<AnalysisId, AnalysisState>>({
    "conceptual-summary": emptyAnalysisState(),
    decomposition: emptyAnalysisState(),
    position: emptyAnalysisState(),
    "most-typical-annotation": emptyAnalysisState(),
    "most-unique-annotation": emptyAnalysisState(),
  });
  const [loadedAnalysis, setLoadedAnalysis] = useState<PostgresAiAnalysis | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiAssistEnabled, setAiAssistEnabled] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [analysisTypesOpen, setAnalysisTypesOpen] = useState(false);
  const [openCitationIds, setOpenCitationIds] = useState<Record<string, boolean>>({});
  const [highlightedCitation, setHighlightedCitation] = useState<{ sectionId: AnalysisId; index: number } | null>(null);
  const [citationModal, setCitationModal] = useState<AnalyzeCitationModalState | null>(null);
  const [savedAnalysisContextMenu, setSavedAnalysisContextMenu] = useState<{ x: number; y: number; analysisId: string } | null>(null);
  const savedAnalysisContextMenuRef = useRef<HTMLDivElement | null>(null);
  const citationLinkRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const savedAnalysisContextMenuStyle = useViewportContextMenuStyle(savedAnalysisContextMenu, savedAnalysisContextMenuRef);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [snapshot, analyses] = await Promise.all([
        loadPostgresProjectWorkspaceSnapshot(projectId),
        listPostgresAiAnalyses(projectId),
      ]);
      const aiSettings = await getPostgresProjectAiAssistSettings(projectId);
      setCodes(snapshot.codes);
      setAnnotations(snapshot.annotations);
      setSourceNameById(Object.fromEntries(snapshot.sources.map((source) => [source.id, source.title])));
      setSavedAnalyses(analyses);
      setAiAssistEnabled(aiSettings.enabled);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load AI analyses.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (savedAnalysisContextMenuRef.current && !savedAnalysisContextMenuRef.current.contains(event.target as Node)) {
        setSavedAnalysisContextMenu(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSavedAnalysisContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!highlightedCitation || !openCitationIds[highlightedCitation.sectionId]) return;
    const citationKey = `${highlightedCitation.sectionId}:${highlightedCitation.index}`;
    citationLinkRefs.current[citationKey]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [highlightedCitation, openCitationIds]);

  const selectedCode = useMemo(
    () => codes.find((code) => code.id === selectedCodeId) ?? null,
    [codes, selectedCodeId],
  );

  const annotationCountsByCode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      for (const codeId of annotation.codeIds) counts.set(codeId, (counts.get(codeId) ?? 0) + 1);
    }
    return counts;
  }, [annotations]);

  const selectedAnnotationRefs = useMemo<AnnotationRef[]>(() => {
    if (!selectedCodeId) return [];
    return annotations
      .filter((annotation) => annotation.codeIds.includes(selectedCodeId))
      .map((annotation) => ({
        id: annotation.id,
        sourceId: annotation.sourceId,
        sourceName: sourceNameById[annotation.sourceId] || "Unknown source",
        quote: annotation.quote,
      }));
  }, [annotations, selectedCodeId, sourceNameById]);

  const hasBusyAnalysis = Object.values(states).some((state) => state.busy);
  const hasAnyResult = Object.values(states).some((state) => state.result);
  const isReadOnly = !!loadedAnalysis;

  function resetResults() {
    setStates({
      "conceptual-summary": emptyAnalysisState(),
      decomposition: emptyAnalysisState(),
      position: emptyAnalysisState(),
      "most-typical-annotation": emptyAnalysisState(),
      "most-unique-annotation": emptyAnalysisState(),
    });
  }

  function handleSelectCode(codeId: string) {
    setLoadedAnalysis(null);
    setSelectedCodeId(codeId);
    resetResults();
  }

  function toggleAnalysis(id: AnalysisId) {
    if (isReadOnly) return;
    setSelectedAnalyses((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCitationOpen(sectionId: AnalysisId) {
    setOpenCitationIds((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  function handleInlineCitationClick(sectionId: AnalysisId, citationIndex: number) {
    setOpenCitationIds((current) => ({
      ...current,
      [sectionId]: true,
    }));
    setHighlightedCitation({ sectionId, index: citationIndex });
  }

  function handleOpenAnalyzeCitationFromModal() {
    if (!citationModal) return;
    const ref = citationModal.ref;
    setCitationModal(null);
    onOpenAnnotation({ sourceId: ref.sourceId, annotationId: ref.id });
  }

  function setAnalysisState(id: AnalysisId, next: AnalysisState) {
    setStates((current) => ({ ...current, [id]: next }));
  }

  async function runAnalysis(id: AnalysisId, settings: PostgresInstallationSettings) {
    if (!selectedCode) return;
    const option = ANALYSIS_OPTIONS.find((entry) => entry.id === id);
    const runtime = buildRuntimeRequest(settings);
    const annotationInputs = selectedAnnotationRefs.map((ref) => ({
      quote: ref.quote,
      documentName: ref.sourceName,
    }));
    const baseRequest = {
      codeLabel: selectedCode.label,
      codeDescription: selectedCode.description || null,
      annotations: annotationInputs,
      ...runtime,
    };
    setAnalysisState(id, { busy: true, error: "", result: null });
    try {
      if (id === "conceptual-summary") {
        const response = await invoke<{ content: string; model: string; baseUrl: string }>("generate_code_conceptual_summary_with_ollama", { request: baseRequest });
        const summary = parseContentSection(response.content, "Summary") || response.content;
        const insights = parseContentSection(response.content, "Key Insights");
        setAnalysisState(id, {
          busy: false,
          error: "",
          result: {
            title: option?.title ?? "Conceptual Summary",
            body: compactText(insights ? `${summary}\n\nKey Insights\n${insights}` : summary),
            model: response.model,
            baseUrl: response.baseUrl,
            annotationRefs: selectedAnnotationRefs,
          },
        });
      } else if (id === "decomposition") {
        const response = await invoke<{ content: string; model: string; baseUrl: string }>("generate_code_decomposition_with_ollama", { request: baseRequest });
        setAnalysisState(id, {
          busy: false,
          error: "",
          result: {
            title: option?.title ?? "Code Decomposition",
            body: compactText(response.content),
            model: response.model,
            baseUrl: response.baseUrl,
            annotationRefs: selectedAnnotationRefs,
          },
        });
      } else if (id === "position") {
        const codebook = codes.map((code) => ({
          label: code.label,
          description: code.description || null,
          parentLabel: code.parentCodeId ? (codes.find((parent) => parent.id === code.parentCodeId)?.label ?? null) : null,
        }));
        const response = await invoke<{ content: string; model: string; baseUrl: string }>("generate_code_position_with_ollama", { request: { ...baseRequest, codebook } });
        setAnalysisState(id, {
          busy: false,
          error: "",
          result: {
            title: option?.title ?? "Code Position",
            body: compactText(response.content),
            model: response.model,
            baseUrl: response.baseUrl,
            annotationRefs: selectedAnnotationRefs,
          },
        });
      } else {
        const command = id === "most-typical-annotation"
          ? "generate_most_typical_annotation_with_ollama"
          : "generate_code_unique_annotations_with_ollama";
        const response = await invoke<{ annotations: unknown[]; model: string; baseUrl: string }>(command, { request: baseRequest });
        const items = normalizeResultItems(response)
          .map((item) => {
            const ref = selectedAnnotationRefs[item.annotationIndex - 1];
            return ref ? { ref, reasoning: item.reasoning } : null;
          })
          .filter((item): item is { ref: AnnotationRef; reasoning: string } => item !== null);
        setAnalysisState(id, {
          busy: false,
          error: "",
          result: {
            title: option?.title ?? "Annotation Analysis",
            body: items.map((item, index) => `${index + 1}. ${item.ref.sourceName}\n"${item.ref.quote}"${item.reasoning ? `\n${item.reasoning}` : ""}`).join("\n\n"),
            model: response.model,
            baseUrl: response.baseUrl,
            annotationRefs: items.map((item) => item.ref),
          },
        });
      }
    } catch (runError) {
      setAnalysisState(id, {
        busy: false,
        error: runError instanceof Error ? runError.message : "Could not run analysis.",
        result: null,
      });
    }
  }

  async function handleRunSelected() {
    if (!selectedCode || selectedAnalyses.size === 0 || hasBusyAnalysis) return;
    const settings = await getPostgresInstallationSettings();
    if (settings.llm.connectionMode === "none") {
      for (const id of selectedAnalyses) {
        setAnalysisState(id, { busy: false, error: "Choose an LLM connection before running code analysis.", result: null });
      }
      return;
    }
    for (const id of selectedAnalyses) {
      await runAnalysis(id, settings);
    }
  }

  function currentSnapshot(): AnalysisSnapshot {
    const results: Partial<Record<AnalysisId, AnalysisResult>> = {};
    for (const [id, state] of Object.entries(states) as Array<[AnalysisId, AnalysisState]>) {
      if (state.result) results[id] = state.result;
    }
    return {
      reportType: "ai-analysis",
      selectedCodeId,
      selectedAnalysisIds: [...selectedAnalyses],
      results,
    };
  }

  async function handleSave() {
    if (!selectedCode || !hasAnyResult || hasBusyAnalysis) return;
    const title = saveName.trim() || `${selectedCode.label} Analysis`;
    setSaving(true);
    setSaveError("");
    try {
      const snapshot = currentSnapshot();
      const resultValues = Object.values(snapshot.results).filter(Boolean) as AnalysisResult[];
      const saved = await createPostgresAiAnalysis({
        projectId,
        analysisType: "code",
        targetCodeId: selectedCode.id,
        title,
        snapshotJson: JSON.stringify(snapshot),
        resultJson: JSON.stringify(snapshot.results),
        contentText: resultValues.map((result) => `${result.title}\n${result.body}`).join("\n\n"),
        model: resultValues[0]?.model ?? "",
        baseUrl: resultValues[0]?.baseUrl ?? "",
      });
      setLoadedAnalysis(saved);
      setSaveName("");
      await loadData();
    } catch (saveErrorValue) {
      setSaveError(saveErrorValue instanceof Error ? saveErrorValue.message : "Could not save analysis.");
    } finally {
      setSaving(false);
    }
  }

  function handleOpenSaved(row: PostgresAiAnalysis) {
    setSavedAnalysisContextMenu(null);
    const snapshot = parseSnapshot(row);
    if (!snapshot) {
      setError("The saved analysis snapshot could not be read.");
      return;
    }
    setLoadedAnalysis(row);
    setSelectedCodeId(snapshot.selectedCodeId);
    setSelectedAnalyses(new Set(snapshot.selectedAnalysisIds));
    const nextStates = {
      "conceptual-summary": emptyAnalysisState(),
      decomposition: emptyAnalysisState(),
      position: emptyAnalysisState(),
      "most-typical-annotation": emptyAnalysisState(),
      "most-unique-annotation": emptyAnalysisState(),
    };
    for (const id of ANALYSIS_OPTIONS.map((option) => option.id)) {
      const result = snapshot.results[id];
      if (result) nextStates[id] = { busy: false, error: "", result };
    }
    setStates(nextStates);
  }

  async function handleDeleteSaved(row: PostgresAiAnalysis) {
    setDeleteBusyId(row.id);
    setSavedAnalysisContextMenu(null);
    setError("");
    try {
      await deletePostgresAiAnalysis(projectId, row.id);
      if (loadedAnalysis?.id === row.id) {
        setLoadedAnalysis(null);
        resetResults();
      }
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete analysis.");
    } finally {
      setDeleteBusyId(null);
    }
  }

  if (!canUseAiAnalyzeTools) {
    return <div className="view"><div className="empty-state"><p>You do not have permission to use AI code analysis tools.</p></div></div>;
  }

  if (!aiAssistEnabled) {
    return <div className="view"><div className="empty-state"><p>Enable AI Assist in project settings before running code analysis.</p></div></div>;
  }

  return (
    <div className="view annotate-view ai-assisted-coding-annotate-view">
      <div className="annotate-back-bar">
        <div className="users-title-wrap">
          <h1>Analyze Codes</h1>
          <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} title="About Analyze Codes" aria-label="About Analyze Codes">
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </div>

      {error ? <p className="users-error">{error}</p> : null}
      {loading ? <p className="users-guide-copy">Loading code analyses...</p> : null}

      <div className="annotate-layout ai-assisted-coding-annotate-layout ai-assisted-coding-analyze-layout">
        <div className="annotate-left">
          <PostgresSourceCodebookCard
            codes={codes}
            selectedCodeId={selectedCodeId}
            annotationCountByCodeId={annotationCountsByCode}
            canSelectCodes={!isReadOnly}
            onSelectCode={handleSelectCode}
          />

          <div className="annotate-card" style={{ marginTop: 16 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Saved Analyses</span>
              <button
                type="button"
                className="btn btn--small ai-saved-new-icon-button"
                aria-label="New analysis"
                title="New analysis"
                onClick={() => {
                  setLoadedAnalysis(null);
                  setSelectedCodeId(null);
                  setSelectedAnalyses(new Set());
                  resetResults();
                }}
              >
                <PlusIcon className="ai-saved-new-icon" />
              </button>
            </div>
            <div className="ai-chat-list">
              {savedAnalyses.length === 0 ? (
                <div className="empty-state ai-chat-empty-state">
                  <p>No saved analyses.</p>
                </div>
              ) : savedAnalyses.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`ai-chat-list-item${loadedAnalysis?.id === row.id ? " ai-chat-list-item--active" : ""}`}
                  onClick={() => handleOpenSaved(row)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSavedAnalysisContextMenu({ x: event.clientX, y: event.clientY, analysisId: row.id });
                  }}
                >
                    <strong>{row.title}</strong>
                    <span>{row.createdByName || "Unknown"} · {formatDate(row.createdAt)}</span>
                </button>
              ))}
            </div>
          </div>
          {savedAnalysisContextMenu ? (
            <div ref={savedAnalysisContextMenuRef} className="context-menu" style={savedAnalysisContextMenuStyle}>
              <button
                type="button"
                className="context-menu-item context-menu-item--danger"
                onClick={() => {
                  const row = savedAnalyses.find((analysis) => analysis.id === savedAnalysisContextMenu.analysisId);
                  if (row) void handleDeleteSaved(row);
                }}
                disabled={deleteBusyId === savedAnalysisContextMenu.analysisId}
              >
                Delete analysis
              </button>
            </div>
          ) : null}
        </div>

        <div className="annotate-main">
          <div className="annotate-card annotate-card--grow ai-analyze-results-card">
            <div className="annotate-card-header">
              <span className="annotate-card-title">Analysis</span>
              {loadedAnalysis ? (
                <span className="backup-field-hint">Saved</span>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    className="form-input"
                    style={{ width: 220, height: 30 }}
                    value={saveName}
                    onChange={(event) => setSaveName(event.target.value)}
                    placeholder={selectedCode ? `${selectedCode.label} Analysis` : "Analysis name"}
                    disabled={!hasAnyResult || saving}
                  />
                  <button type="button" className="btn btn--small btn--primary" onClick={() => void handleSave()} disabled={!hasAnyResult || hasBusyAnalysis || saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>

            {saveError ? <p className="form-error project-settings-error">{saveError}</p> : null}

            <div className="doc-viewer-inline-section ai-analyze-controls-embedded">
              <div className="doc-inline-section-header">
                <button
                  type="button"
                  className={`doc-inline-disclosure${analysisTypesOpen ? " doc-inline-disclosure--open" : ""}`}
                  aria-expanded={analysisTypesOpen}
                  onClick={() => setAnalysisTypesOpen((open) => !open)}
                >
                  <span className="doc-inline-disclosure-chevron" aria-hidden="true">
                    {analysisTypesOpen ? "\u25be" : "\u25b8"}
                  </span>
                  <span className="doc-inline-disclosure-label">Analysis Types</span>
                  <span className="ai-analyze-inline-badge">{selectedAnalyses.size} selected</span>
                </button>
                <div className="ai-segments-header-actions">
                  {!isReadOnly ? (
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      onClick={() => void handleRunSelected()}
                      disabled={!selectedCode || selectedAnalyses.size === 0 || selectedAnnotationRefs.length === 0 || hasBusyAnalysis}
                    >
                      {hasBusyAnalysis ? "Running" : "Run Selected"}
                    </button>
                  ) : null}
                </div>
              </div>
              {analysisTypesOpen ? (
                <div className="doc-viewer-inline-section-body ai-analyze-controls-body">
                  <div className="ai-segments-summary">
                    {selectedCode ? (
                      <>
                        <span className="ai-segments-summary-label">Selected code</span>
                        <span className="ai-segments-summary-value">{selectedCode.label}</span>
                      </>
                    ) : (
                      <span className="annotation-list-empty">Select one code before running an analysis.</span>
                    )}
                  </div>
                  <div className="ai-analyze-options">
                    {ANALYSIS_OPTIONS.map((option) => {
                      const state = states[option.id];
                      const selected = selectedAnalyses.has(option.id);
                      return (
                        <div key={option.id} className={`ai-analyze-option${selected ? " ai-analyze-option--selected" : ""}${isReadOnly ? " ai-analyze-option--disabled" : ""}`}>
                          <div className="ai-analyze-option-main">
                            <button type="button" className="ai-analyze-option-select" onClick={() => toggleAnalysis(option.id)} disabled={isReadOnly}>
                              <span className="ai-analyze-option-check" aria-hidden="true" />
                              <div className="ai-analyze-option-body">
                                <strong className="ai-analyze-option-title">{option.title}</strong>
                                <span className="ai-analyze-option-desc">{option.description}</span>
                              </div>
                            </button>
                            <span className={`ai-analyze-option-status ai-analyze-option-status--${state.busy ? "busy" : state.error ? "error" : state.result ? "done" : "idle"}`}>
                              {state.busy ? "Running" : state.error ? "Error" : state.result ? "Done" : ""}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {selectedCode && selectedAnnotationRefs.length === 0 ? (
                    <p className="form-error project-settings-error">This code has no annotations yet.</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {!hasAnyResult && !hasBusyAnalysis ? (
              <div className="ai-attribute-placeholder">
                <p>Select a code, choose one or more analyses, and run them.</p>
              </div>
            ) : null}

            <div className="ai-analyze-result">
              {ANALYSIS_OPTIONS.map((option) => {
                const state = states[option.id];
                if (!state.busy && !state.error && !state.result) return null;
                return (
                  <div key={option.id} className="ai-analyze-result-section">
                    <h3 className="ai-analyze-result-heading">
                      {option.title}
                      {selectedCode ? (
                        <span className="ai-analyze-result-code-badge" style={{ background: selectedCode.color }}>{selectedCode.label}</span>
                      ) : null}
                    </h3>
                    {state.busy ? (
                      <div className="ai-segments-search-state ai-analyze-inline-progress">
                        <div className="ai-segments-progress" aria-hidden="true"><span className="ai-segments-progress-bar" /></div>
                        <div className="ai-segments-search-copy">Running analysis...</div>
                      </div>
                    ) : null}
                    {state.error ? <div className="form-error project-settings-error">{state.error}</div> : null}
                    {state.result ? (
                      <>
                        <p className="ai-analyze-result-body">
                          {renderTextWithCitations(
                            state.result.body,
                            state.result.annotationRefs,
                            (_ref, citationIndex) => handleInlineCitationClick(option.id, citationIndex),
                          )}
                        </p>
                        <p className="backup-field-hint ai-analyze-result-meta">Generated with {state.result.model}</p>
                        {state.result.annotationRefs.length > 0 ? (
                          <div className="ai-chat-citations ai-chat-citations--collapsible ai-analyze-citations">
                            <div className="ai-chat-citations-toggle">
                              <div className="ai-chat-citations-title">
                                <strong>Citations</strong>
                                <span>{state.result.annotationRefs.length}</span>
                              </div>
                              <button
                                type="button"
                                className="btn ai-chat-citations-toggle-btn"
                                onClick={() => toggleCitationOpen(option.id)}
                              >
                                {openCitationIds[option.id] ? "Hide" : "Show"}
                              </button>
                            </div>
                            {openCitationIds[option.id] ? (
                              <div className="ai-chat-citation-list">
                                {state.result.annotationRefs.map((ref, index) => {
                                  const citationKey = `${option.id}:${index}`;
                                  const isHighlightedCitation = highlightedCitation?.sectionId === option.id
                                    && highlightedCitation.index === index;
                                  return (
                                    <button
                                      key={`${ref.id}-${index}`}
                                      ref={(node) => {
                                        citationLinkRefs.current[citationKey] = node;
                                      }}
                                      type="button"
                                      className={`ai-chat-citation-link ai-chat-citation-link--annotation${isHighlightedCitation ? " ai-chat-citation-link--highlighted" : ""}`}
                                      onClick={() => setCitationModal({ ref, index })}
                                      title={ref.quote}
                                    >
                                      <span className="ai-chat-citation-number">[{index + 1}]</span>
                                      <span className="ai-chat-citation-kind ai-chat-citation-kind--annotation">Annotation:</span>
                                      <span className="ai-chat-citation-line">
                                        <strong>{ref.sourceName}</strong>
                                        <small>{ref.quote}</small>
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {citationModal ? (
        <SettingsModal
          title={`Citation [${citationModal.index + 1}]`}
          subtitle="Annotation"
          onClose={() => setCitationModal(null)}
          modalClassName="modal--wide ai-citation-detail-modal"
        >
            <div className="ai-citation-detail-body">
              <div className="ai-citation-detail-summary">
                <span>Source</span>
                <strong>{citationModal.ref.sourceName}</strong>
              </div>
              <div className="ai-citation-detail-text">
                <span>Annotation</span>
                <p>{citationModal.ref.quote}</p>
              </div>
              <div className="ai-citation-detail-grid">
                <div>
                  <span>Annotation ID</span>
                  <strong>{citationModal.ref.id}</strong>
                </div>
                <div>
                  <span>Source ID</span>
                  <strong>{citationModal.ref.sourceId}</strong>
                </div>
              </div>
            </div>
            <div className="project-export-actions project-export-actions--modal ai-citation-detail-actions">
              <button type="button" className="btn btn--primary" onClick={handleOpenAnalyzeCitationFromModal}>
                Open
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {helpOpen ? (
        <SettingsModal title="Analyze Codes" onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">Select a code, choose one or more analysis actions, run grounded AI analyses, and open citations back in the coding view.</p>
          </div>
        </SettingsModal>
      ) : null}
    </div>
  );
}
