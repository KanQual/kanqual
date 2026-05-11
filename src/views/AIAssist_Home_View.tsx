import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../context/StoreContext";
import { readAppSettings } from "../lib/appSettings";
import {
  buildProjectEmbeddingItems,
  type ProjectEmbeddingIndexStatus,
} from "../lib/projectEmbeddings";
import { readProjectAiAssistSettings } from "../lib/projectAiAssistSettings";
import helpIcon from "../assets/ic_help_outline_24px.svg";

type EmbeddingModelStatus = {
  installed: boolean;
  repoId: string;
  displayName: string;
  modelDir: string;
  files: number;
  bytes: number;
  downloadedAtMs: number | null;
};

type AttributeDefinition = {
  id: string;
  name: string;
  dataType: string;
  description: string;
  options: string[];
  sortOrder: number;
};

type AttributeValueRow = {
  recordId?: string;
  ownerId: string;
  ownerName: string;
  value: string;
};

type AttributeSuggestionInputItem = {
  id: string;
  name: string;
  content: string;
};

type AttributeSuggestionRow = {
  ownerId: string;
  ownerName: string;
  suggestedValue: string;
  evidenceText: string;
};

type OllamaAttributeSuggestionResponse = {
  model: string;
  baseUrl: string;
  suggestions: Array<{
    itemId: string;
    itemName: string;
    suggestedValue: string;
    evidenceText: string;
  }>;
};

type OllamaAttributeSuggestionProgressEvent = {
  runId: string;
  itemId: string;
  itemName: string;
  suggestedValue: string;
  evidenceText: string;
  completedItems: number;
  totalItems: number;
  model: string;
  baseUrl: string;
};

type AttributeSuggestionRunState = {
  runId: string;
  attributeId: string;
  completedItems: number;
  totalItems: number;
};

const AI_ASSIST_ADD_ATTRIBUTE_TARGET_KEY = "kq_ai_assist_add_attribute_target";

function queueAiAssistAddAttributeTarget(target: "case" | "document") {
  try {
    window.localStorage.setItem(AI_ASSIST_ADD_ATTRIBUTE_TARGET_KEY, target);
  } catch {
    // Best-effort navigation helper only.
  }
}

function toAttributeDefinition(record: {
  id: string;
  name?: string;
  data_type?: string;
  description?: string;
  options_json?: string;
  sort_order?: number;
}): AttributeDefinition {
  let options: string[] = [];
  if (typeof record.options_json === "string" && record.options_json.trim()) {
    try {
      const parsed = JSON.parse(record.options_json);
      if (Array.isArray(parsed)) {
        options = parsed
          .map((value) => String(value ?? "").trim())
          .filter(Boolean);
      }
    } catch (error) {
      console.warn("Could not parse attribute options JSON:", error);
    }
  }
  return {
    id: record.id,
    name: record.name?.trim() || "Untitled attribute",
    dataType: record.data_type || "text",
    description: record.description?.trim() || "",
    options,
    sortOrder: typeof record.sort_order === "number" ? record.sort_order : Number.MAX_SAFE_INTEGER,
  };
}

function useAttributeDefinitions(kind: "case" | "document") {
  const { pb, activeProject } = useStore();
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      setDefinitions([]);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadDefinitions() {
      setLoading(true);
      try {
        const collection = kind === "case" ? "case_attribute_definitions" : "document_attribute_definitions";
        const records = await pb.collection(collection).getFullList({
          filter: `project="${projectId}" && deleted_at = ""`,
          sort: "+sort_order,+created",
          fields: "id,name,data_type,description,options_json,sort_order",
        });
        if (cancelled) return;
        setDefinitions(records.map((record) => toAttributeDefinition(record)).sort((left, right) => {
          if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
          return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        }));
        setError("");
      } catch (nextError) {
        console.error(`Failed to load ${kind} attribute definitions:`, nextError);
        if (!cancelled) {
          setDefinitions([]);
          setError(`Could not load ${kind} attribute definitions.`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDefinitions();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, kind, pb]);

  return { definitions, loading, error };
}

function useAttributeValueRows(kind: "case" | "document", selectedAttributeId: string | null) {
  const { pb, activeProject } = useStore();
  const [rows, setRows] = useState<AttributeValueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId || !selectedAttributeId) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;
    async function loadRows() {
      setLoading(true);
      try {
        if (kind === "case") {
          const [caseRecords, valueRecords] = await Promise.all([
            pb.collection("cases").getFullList({
              filter: `project="${projectId}"&&deleted_at=""`,
              sort: "name,+created",
              fields: "id,name",
            }),
            pb.collection("case_attribute_values").getFullList({
              filter: `attribute="${selectedAttributeId}"&&deleted_at=""`,
              fields: "id,case,attribute,value",
            }),
          ]);
          if (cancelled) return;
          const valuesByOwner = new Map<string, { recordId: string; value: string }>();
          for (const record of valueRecords) {
            valuesByOwner.set(String(record.case), {
              recordId: record.id,
              value: String(record.value ?? ""),
            });
          }
          setRows(caseRecords.map((record) => ({
            recordId: valuesByOwner.get(record.id)?.recordId,
            ownerId: record.id,
            ownerName: String(record.name ?? "Untitled case"),
            value: valuesByOwner.get(record.id)?.value ?? "",
          })));
        } else {
          const [documentRecords, valueRecords] = await Promise.all([
            pb.collection("documents").getFullList({
              filter: `project="${projectId}"&&deleted_at=""`,
              sort: "name,+created",
              fields: "id,name",
            }),
            pb.collection("document_attribute_values").getFullList({
              filter: `attribute="${selectedAttributeId}"&&deleted_at=""`,
              fields: "id,document,attribute,value",
            }),
          ]);
          if (cancelled) return;
          const valuesByOwner = new Map<string, { recordId: string; value: string }>();
          for (const record of valueRecords) {
            valuesByOwner.set(String(record.document), {
              recordId: record.id,
              value: String(record.value ?? ""),
            });
          }
          setRows(documentRecords.map((record) => ({
            recordId: valuesByOwner.get(record.id)?.recordId,
            ownerId: record.id,
            ownerName: String(record.name ?? "Untitled document"),
            value: valuesByOwner.get(record.id)?.value ?? "",
          })));
        }
        setError("");
      } catch (nextError) {
        console.error(`Failed to load ${kind} attribute values:`, nextError);
        if (!cancelled) {
          setRows([]);
          setError(`Could not load ${kind} attribute values.`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRows();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, kind, pb, selectedAttributeId, reloadToken]);

  return { rows, loading, error, reload };
}

function AttributeSuggestionEvidenceModal({
  ownerName,
  value,
  evidenceText,
  onClose,
}: {
  ownerName: string;
  value: string;
  evidenceText: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal app-settings-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-attribute-evidence-title"
      >
        <div className="settings-section-header">
          <div>
            <h2 id="ai-attribute-evidence-title" className="settings-section-title">Suggestion Evidence</h2>
            <p className="settings-section-desc">{ownerName}</p>
          </div>
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="app-settings-modal-body">
          <div className="app-settings-stat-card">
            <strong>Suggested Value</strong>
            <span>{value || "—"}</span>
          </div>
          <div className="project-model-modal-copy">
            <p>{evidenceText || "No supporting excerpt was returned for this suggestion."}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AIAssistAttributeWorkspace({ kind }: { kind: "case" | "document" }) {
  const { pb, activeProject, setView, logAction, canCurrentUser } = useStore();
  const canUseAiAttributeTools = canCurrentUser("useAiAttributeTools");
  const aiAssistEnabledForProject = activeProject ? readProjectAiAssistSettings(activeProject.id).enabled : false;
  const canAddAttribute = kind === "case"
    ? canCurrentUser("createCaseAttributes")
    : canCurrentUser("createDocumentAttributes");
  const { definitions, loading, error } = useAttributeDefinitions(kind);
  const [selectedAttributeId, setSelectedAttributeId] = useState<string | null>(null);
  const [suggestionRowsByAttribute, setSuggestionRowsByAttribute] = useState<Record<string, AttributeSuggestionRow[]>>({});
  const [suggestionModelByAttribute, setSuggestionModelByAttribute] = useState<Record<string, string>>({});
  const [suggestionError, setSuggestionError] = useState("");
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [suggestionRunState, setSuggestionRunState] = useState<AttributeSuggestionRunState | null>(null);
  const [acceptingOwnerId, setAcceptingOwnerId] = useState<string | null>(null);
  const [evidenceModalRow, setEvidenceModalRow] = useState<AttributeSuggestionRow | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const suggestionRunRef = useRef<AttributeSuggestionRunState | null>(null);
  const leftCardRef = useRef<HTMLElement | null>(null);
  const middleCardRef = useRef<HTMLElement | null>(null);
  const rightCardRef = useRef<HTMLElement | null>(null);
  const [leftDividerHeight, setLeftDividerHeight] = useState(0);
  const [rightDividerHeight, setRightDividerHeight] = useState(0);

  useEffect(() => {
    setSelectedAttributeId((current) => {
      if (!definitions.length) return null;
      if (current && definitions.some((definition) => definition.id === current)) return current;
      return definitions[0]?.id ?? null;
    });
  }, [definitions]);

  const selectedAttribute = useMemo(
    () => definitions.find((definition) => definition.id === selectedAttributeId) ?? null,
    [definitions, selectedAttributeId],
  );
  const {
    rows: valueRows,
    loading: valuesLoading,
    error: valuesError,
    reload: reloadValueRows,
  } = useAttributeValueRows(kind, selectedAttributeId);
  const suggestionRows = selectedAttributeId ? (suggestionRowsByAttribute[selectedAttributeId] ?? []) : [];
  const suggestionModel = selectedAttributeId ? (suggestionModelByAttribute[selectedAttributeId] ?? "") : "";
  const visibleSuggestionProgress = selectedAttributeId && suggestionRunState?.attributeId === selectedAttributeId
    ? suggestionRunState
    : null;

  useEffect(() => {
    const leftEl = leftCardRef.current;
    const middleEl = middleCardRef.current;
    const rightEl = rightCardRef.current;
    if (!leftEl || !middleEl || !rightEl) return;

    const measure = () => {
      setLeftDividerHeight(Math.max(leftEl.offsetHeight, middleEl.offsetHeight));
      setRightDividerHeight(Math.max(middleEl.offsetHeight, rightEl.offsetHeight));
    };

    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(leftEl);
    obs.observe(middleEl);
    obs.observe(rightEl);
    return () => obs.disconnect();
  }, [definitions.length, selectedAttributeId, valueRows.length, suggestionRows.length, suggestionBusy, kind]);

  useEffect(() => {
    setSuggestionError("");
  }, [selectedAttributeId, kind]);

  useEffect(() => {
    suggestionRunRef.current = suggestionRunState;
  }, [suggestionRunState]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<OllamaAttributeSuggestionProgressEvent>("attribute-suggestion-progress", (event) => {
      const payload = event.payload;
      const activeRun = suggestionRunRef.current;
      if (!activeRun || payload.runId !== activeRun.runId) return;

      setSuggestionRowsByAttribute((current) => {
        const currentRows = current[activeRun.attributeId] ?? [];
        const nextRow: AttributeSuggestionRow = {
          ownerId: payload.itemId,
          ownerName: payload.itemName,
          suggestedValue: payload.suggestedValue,
          evidenceText: payload.evidenceText,
        };
        const existingIndex = currentRows.findIndex((row) => row.ownerId === nextRow.ownerId);
        const nextRows = existingIndex >= 0
          ? currentRows.map((row, index) => index === existingIndex ? nextRow : row)
          : [...currentRows, nextRow];
        return {
          ...current,
          [activeRun.attributeId]: nextRows,
        };
      });
      setSuggestionModelByAttribute((current) => ({
        ...current,
        [activeRun.attributeId]: payload.model,
      }));
      setSuggestionRunState({
        ...activeRun,
        completedItems: payload.completedItems,
        totalItems: payload.totalItems,
      });
      if (payload.completedItems >= payload.totalItems) {
        setSuggestionBusy(false);
        setSuggestionRunState(null);
      }
    }).then((dispose) => {
      unlisten = dispose;
    }).catch((error) => {
      console.error("Could not listen for attribute suggestion progress:", error);
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  async function loadSuggestionInputItems(): Promise<AttributeSuggestionInputItem[]> {
    if (!activeProject) return [];
    if (kind === "document") {
      const documents = await pb.collection("documents").getFullList({
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        sort: "name,+created",
        fields: "id,name,content",
      });
      return documents.map((document) => ({
        id: document.id,
        name: String(document.name ?? "Untitled document"),
        content: String(document.content ?? ""),
      }));
    }

    const [cases, caseDocuments, documents] = await Promise.all([
      pb.collection("cases").getFullList({
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        sort: "name,+created",
        fields: "id,name",
      }),
      pb.collection("case_documents").getFullList({
        fields: "id,case,document",
      }),
      pb.collection("documents").getFullList({
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        fields: "id,name,content",
      }),
    ]);
    const projectCaseIds = new Set(cases.map((item) => item.id));
    const documentsById = new Map(documents.map((document) => ([
      document.id,
      {
        name: String(document.name ?? "Untitled document"),
        content: String(document.content ?? ""),
      },
    ])));
    const documentIdsByCase = new Map<string, string[]>();
    for (const link of caseDocuments) {
      const caseId = String(link.case ?? "");
      const documentId = String(link.document ?? "");
      if (!projectCaseIds.has(caseId) || !documentsById.has(documentId)) continue;
      const next = documentIdsByCase.get(caseId) ?? [];
      next.push(documentId);
      documentIdsByCase.set(caseId, next);
    }
    return cases.map((caseRecord) => {
      const documentIds = documentIdsByCase.get(caseRecord.id) ?? [];
      const content = documentIds
        .map((documentId) => {
          const document = documentsById.get(documentId);
          if (!document) return "";
          return `Document: ${document.name}\n${document.content}`;
        })
        .filter(Boolean)
        .join("\n\n");
      return {
        id: caseRecord.id,
        name: String(caseRecord.name ?? "Untitled case"),
        content,
      };
    });
  }

  async function handleStartSuggestionGeneration() {
    if (!selectedAttribute || !activeProject) return;
    const runId = `${selectedAttribute.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSuggestionBusy(true);
    setSuggestionError("");
    setSuggestionRowsByAttribute((current) => ({
      ...current,
      [selectedAttribute.id]: [],
    }));
    setSuggestionModelByAttribute((current) => ({
      ...current,
      [selectedAttribute.id]: "",
    }));
    try {
      const llmSettings = readAppSettings().llm;
      if (!llmSettings.ollamaEnabled) {
        throw new Error("Enable Ollama in App Settings before generating AI suggestions.");
      }
      if (!llmSettings.ollamaSelectedModel) {
        throw new Error("Choose an Ollama model in App Settings before generating AI suggestions.");
      }
      const items = await loadSuggestionInputItems();
      setSuggestionRunState({
        runId,
        attributeId: selectedAttribute.id,
        completedItems: 0,
        totalItems: items.length,
      });
      const response = await invoke<OllamaAttributeSuggestionResponse>("generate_attribute_value_suggestions_with_ollama", {
        request: {
          runId,
          attributeName: selectedAttribute.name,
          attributeDataType: selectedAttribute.dataType,
          attributeDescription: selectedAttribute.description,
          attributeOptions: selectedAttribute.options,
          items,
          protocol: llmSettings.ollamaProtocol,
          host: llmSettings.ollamaHost,
          port: llmSettings.ollamaPort,
          model: llmSettings.ollamaSelectedModel,
          timeoutSeconds: llmSettings.ollamaRequestTimeoutSeconds,
          temperature: llmSettings.ollamaTemperature,
          numCtx: llmSettings.ollamaNumCtx,
          keepAliveMinutes: llmSettings.ollamaKeepAliveMinutes,
        },
      });
      const nextRows = response.suggestions.map((suggestion) => ({
        ownerId: suggestion.itemId,
        ownerName: suggestion.itemName,
        suggestedValue: suggestion.suggestedValue,
        evidenceText: suggestion.evidenceText,
      }));
      setSuggestionRowsByAttribute((current) => ({
        ...current,
        [selectedAttribute.id]: (() => {
          const existingRows = current[selectedAttribute.id] ?? [];
          if (existingRows.length === 0) return nextRows;
          const byOwnerId = new Map(existingRows.map((row) => [row.ownerId, row]));
          for (const row of nextRows) {
            byOwnerId.set(row.ownerId, row);
          }
          return existingRows.map((row) => byOwnerId.get(row.ownerId) ?? row)
            .concat(nextRows.filter((row) => !existingRows.some((existing) => existing.ownerId === row.ownerId)));
        })(),
      }));
      setSuggestionModelByAttribute((current) => ({
        ...current,
        [selectedAttribute.id]: response.model,
      }));
      setSuggestionRunState((current) => current?.runId === runId ? null : current);
    } catch (nextError) {
      console.error("Failed to generate attribute suggestions:", nextError);
      setSuggestionError(nextError instanceof Error ? nextError.message : "Could not generate AI suggestions.");
      setSuggestionRunState((current) => current?.runId === runId ? null : current);
    } finally {
      setSuggestionBusy(false);
    }
  }

  async function handleAcceptSuggestion(row: AttributeSuggestionRow) {
    if (!selectedAttribute || !activeProject || !row.suggestedValue.trim()) return;
    if (
      selectedAttribute.dataType === "categorical"
      && !selectedAttribute.options.includes(row.suggestedValue.trim())
    ) {
      setSuggestionError(`"${row.suggestedValue}" is not one of the allowed categories for ${selectedAttribute.name}.`);
      return;
    }
    const existingValueRow = valueRows.find((valueRow) => valueRow.ownerId === row.ownerId);
    setAcceptingOwnerId(row.ownerId);
    setSuggestionError("");
    try {
      if (kind === "case") {
        if (existingValueRow?.recordId) {
          await pb.collection("case_attribute_values").update(existingValueRow.recordId, {
            value: row.suggestedValue,
            deleted_at: "",
          });
        } else {
          await pb.collection("case_attribute_values").create({
            case: row.ownerId,
            attribute: selectedAttribute.id,
            value: row.suggestedValue,
            deleted_at: "",
          });
        }
        await logAction(activeProject.id, "case_attribute.update", `Accepted AI suggestion for case attribute "${selectedAttribute.name}"`, selectedAttribute.id);
      } else {
        if (existingValueRow?.recordId) {
          await pb.collection("document_attribute_values").update(existingValueRow.recordId, {
            value: row.suggestedValue,
            deleted_at: "",
          });
        } else {
          await pb.collection("document_attribute_values").create({
            document: row.ownerId,
            attribute: selectedAttribute.id,
            value: row.suggestedValue,
            deleted_at: "",
          });
        }
        await logAction(activeProject.id, "document_attribute.update", `Accepted AI suggestion for document attribute "${selectedAttribute.name}"`, selectedAttribute.id);
      }
      reloadValueRows();
    } catch (nextError) {
      console.error("Failed to accept AI attribute suggestion:", nextError);
      setSuggestionError(nextError instanceof Error ? nextError.message : "Could not accept the suggested value.");
    } finally {
      setAcceptingOwnerId(null);
    }
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Identify Attributes</h1>
        </header>
        <div className="empty-state">
          <p>Open a project first.</p>
        </div>
      </div>
    );
  }

  if (!canUseAiAttributeTools) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Attributes</h1>
        </header>
        <div className="empty-state">
          <p>You do not have permission to use AI Assist attribute tools for this project.</p>
        </div>
      </div>
    );
  }

  if (!aiAssistEnabledForProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Attributes</h1>
        </header>
        <div className="empty-state">
          <p>Enable AI Assist in Project Settings before using AI attribute tools.</p>
        </div>
      </div>
    );
  }

  const pageTitle = "Identify Attributes";
  const isCaseMode = kind === "case";

  function handleModeChange(nextKind: "case" | "document") {
    if (nextKind === kind) return;
    setView(nextKind === "case" ? "ai-assist-case-attributes" : "ai-assist-document-attributes");
  }

  function handleAddAttribute() {
    queueAiAssistAddAttributeTarget(kind);
    setView(isCaseMode ? "cases" : "documents");
  }

  return (
    <div className="view ai-attribute-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{pageTitle}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Show Help"
            aria-label="Show Help"
          >
            <img src={helpIcon} alt="" className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Identify Attributes Help</h2>
            <p className="users-guide-copy">
              Use this page to review case or document attributes and inspect their current values across the project.
            </p>
            <p className="users-guide-copy">
              Switch between <strong>Cases</strong> and <strong>Documents</strong> with the toggle, choose an attribute, and then review or accept AI-assisted suggestions for each item.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <section
        className="ai-attribute-layout"
        style={{
          ["--ai-attribute-left-divider-height" as string]: `${leftDividerHeight}px`,
          ["--ai-attribute-right-divider-height" as string]: `${rightDividerHeight}px`,
        }}
      >
        <aside ref={leftCardRef} className="annotate-card ai-attribute-column">
          <div className="annotate-card-header">
            <span className="annotate-card-title">{pageTitle}</span>
            {canAddAttribute && (
              <button type="button" className="btn btn--small" onClick={handleAddAttribute}>
                Add Attribute
              </button>
            )}
          </div>
          <div className="segmented-control ai-attribute-mode-toggle" role="tablist" aria-label="Attribute target">
            <button
              type="button"
              role="tab"
              aria-selected={isCaseMode}
              className={isCaseMode ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
              onClick={() => handleModeChange("case")}
            >
              Cases
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isCaseMode}
              className={!isCaseMode ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
              onClick={() => handleModeChange("document")}
            >
              Documents
            </button>
          </div>
          {error && <div className="form-error project-settings-error">{error}</div>}
          <div className="ai-attribute-list">
              {loading ? (
                <div className="empty-state ai-attribute-empty-state"><p>Loading attributes...</p></div>
              ) : definitions.length === 0 ? (
                <div className="empty-state ai-attribute-empty-state"><p>No {isCaseMode ? "case" : "document"} attributes yet.</p></div>
              ) : (
                definitions.map((definition) => (
                <button
                  key={definition.id}
                  type="button"
                  className={`ai-attribute-list-item${definition.id === selectedAttributeId ? " ai-attribute-list-item--active" : ""}`}
                  onClick={() => setSelectedAttributeId(definition.id)}
                >
                  <strong>{definition.name}</strong>
                  <span>{definition.dataType}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="ai-attribute-divider" aria-hidden="true">
          <span className="ai-attribute-divider-line ai-attribute-divider-line--left" />
        </div>

        <section ref={middleCardRef} className="annotate-card ai-attribute-column ai-attribute-column--placeholder">
          <div className="annotate-card-header">
            <span className="annotate-card-title">
              {selectedAttribute ? `${selectedAttribute.name} Values` : "Attribute Values"}
            </span>
          </div>
          {valuesError && <div className="form-error project-settings-error">{valuesError}</div>}
          {!selectedAttribute ? (
            <div className="ai-attribute-placeholder">
              <p>Select an attribute from the left column.</p>
            </div>
          ) : valuesLoading ? (
            <div className="ai-attribute-placeholder">
              <p>Loading current values...</p>
            </div>
          ) : (
            <div className="ai-attribute-table-wrap">
              <table className="users-table ai-attribute-table">
                <thead>
                    <tr>
                      <th className="users-th ai-attribute-table-owner-col">
                        {isCaseMode ? "Case" : "Document"}
                      </th>
                      <th className="users-th ai-attribute-table-value-col">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valueRows.length === 0 ? (
                      <tr>
                        <td className="users-td-msg" colSpan={2}>
                          No {isCaseMode ? "cases" : "documents"} yet.
                        </td>
                      </tr>
                    ) : (
                    valueRows.map((row) => (
                      <tr key={row.ownerId}>
                        <td className="users-td users-td--name ai-attribute-table-owner-cell">{row.ownerName}</td>
                        <td className="users-td ai-attribute-table-value-cell">{row.value || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="ai-attribute-divider" aria-hidden="true">
          <span className="ai-attribute-divider-line ai-attribute-divider-line--right" />
        </div>

        <section ref={rightCardRef} className="annotate-card ai-attribute-column ai-attribute-column--placeholder">
          <div className="annotate-card-header">
            <span className="annotate-card-title">AI Suggestions</span>
            <button
              type="button"
              className="btn btn--small btn--danger"
              onClick={() => void handleStartSuggestionGeneration()}
              disabled={!selectedAttribute || suggestionBusy}
            >
              {suggestionBusy ? "Generating..." : "Generate Suggestions"}
            </button>
          </div>
          {selectedAttribute && suggestionBusy && (
            <div className="ai-segments-search-state">
              <div className="ai-segments-progress" aria-hidden="true">
                <span className="ai-segments-progress-bar" />
              </div>
              <div className="ai-segments-search-copy">
                Ollama is generating suggested values for {selectedAttribute.name}
                {visibleSuggestionProgress ? ` (${visibleSuggestionProgress.completedItems}/${visibleSuggestionProgress.totalItems})` : ""}.
              </div>
            </div>
          )}
          {suggestionError && <div className="form-error project-settings-error">{suggestionError}</div>}
          {!selectedAttribute ? (
            <div className="ai-attribute-placeholder">
              <p>Select an attribute from the left column.</p>
            </div>
          ) : suggestionRows.length === 0 ? (
            <div className="ai-attribute-placeholder">
              <p>Generate suggestions to see proposed values for {selectedAttribute.name}.</p>
            </div>
          ) : (
            <div className="ai-attribute-table-wrap">
              {suggestionModel && (
                <p className="backup-field-hint ai-attribute-suggestion-meta">Generated with {suggestionModel}</p>
              )}
              <table className="users-table ai-attribute-table">
                <thead>
                    <tr>
                      <th className="users-th ai-attribute-table-owner-col">
                        {isCaseMode ? "Case" : "Document"}
                      </th>
                    <th className="users-th ai-attribute-table-value-col">Suggested Value</th>
                    <th className="users-th ai-attribute-table-action-col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestionRows.map((row) => (
                    (() => {
                      const currentValueRow = valueRows.find((valueRow) => valueRow.ownerId === row.ownerId);
                      const isAccepted = row.suggestedValue.trim().length > 0
                        && currentValueRow?.value.trim() === row.suggestedValue.trim();
                      return (
                        <tr key={row.ownerId}>
                          <td className="users-td users-td--name ai-attribute-table-owner-cell">{row.ownerName}</td>
                          <td className="users-td ai-attribute-table-value-cell">
                            <button
                              type="button"
                              className="ai-attribute-suggestion-link"
                              onClick={() => setEvidenceModalRow(row)}
                            >
                              {row.suggestedValue || "—"}
                            </button>
                          </td>
                          <td className="users-td ai-attribute-table-action-cell">
                            {row.suggestedValue.trim() ? (
                              <button
                                type="button"
                                className="btn btn--small"
                                onClick={() => void handleAcceptSuggestion(row)}
                                disabled={acceptingOwnerId === row.ownerId || isAccepted}
                              >
                                {acceptingOwnerId === row.ownerId ? "Saving..." : isAccepted ? "Accepted" : "Accept"}
                              </button>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })()
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>

      {evidenceModalRow && (
        <AttributeSuggestionEvidenceModal
          ownerName={evidenceModalRow.ownerName}
          value={evidenceModalRow.suggestedValue}
          evidenceText={evidenceModalRow.evidenceText}
          onClose={() => setEvidenceModalRow(null)}
        />
      )}
    </div>
  );
}

function useEmbeddingRunState() {
  const {
    activeProject,
    userRole,
    setView,
    documents,
    cases,
    codes,
    annotations,
    memos,
    projectEmbeddingBuildStatus,
    startProjectEmbeddingBuild,
  } = useStore();
  const [indexStatus, setIndexStatus] = useState<ProjectEmbeddingIndexStatus | null>(null);
  const [modelStatus, setModelStatus] = useState<EmbeddingModelStatus | null>(null);
  const [error, setError] = useState("");
  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const busy =
    projectEmbeddingBuildStatus?.phase === "running" || projectEmbeddingBuildStatus?.phase === "cancelling";

  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      setIndexStatus(null);
      setModelStatus(null);
      setError("");
      return;
    }

    let cancelled = false;
    async function refreshStatuses() {
      try {
        const [nextIndexStatus, nextModelStatus] = await Promise.all([
          invoke<ProjectEmbeddingIndexStatus>("get_project_embedding_index_status", { projectId }),
          invoke<EmbeddingModelStatus>("get_multilingual_e5_status"),
        ]);
        if (cancelled) return;
        setIndexStatus(nextIndexStatus);
        setModelStatus(nextModelStatus);
        setError("");
      } catch (nextError) {
        console.error("Failed to load AI Assist embedding status:", nextError);
        if (!cancelled) setError("Could not load the latest embedding run details.");
      }
    }

    void refreshStatuses();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, projectEmbeddingBuildStatus?.phase, projectEmbeddingBuildStatus?.projectId]);

  function openBuildModal() {
    setError("");
    setBuildModalOpen(true);
  }

  async function handleRunEmbedding() {
    if (!activeProject) return false;
    setError("");

    try {
      const latestModelStatus = await invoke<EmbeddingModelStatus>("get_multilingual_e5_status");
      setModelStatus(latestModelStatus);
      if (!latestModelStatus.installed) {
        sessionStorage.setItem("kanqual:open-app-settings-modal", "llm");
        setView("app-settings");
        return false;
      }

      const llmSettings = readAppSettings().llm;
      const items = buildProjectEmbeddingItems(documents, cases, codes, annotations, memos, llmSettings);
      if (items.length === 0) {
        setError("There is no project content available to embed yet.");
        return false;
      }

      await startProjectEmbeddingBuild({
        projectId: activeProject.id,
        llmSettings,
        items,
        successLog: {
          projectId: activeProject.id,
          action: "ai_assist.reindex",
          label: "Rebuilt local AI Assist embeddings",
        },
      });
      return true;
    } catch (nextError) {
      console.error("Failed to rerun project embeddings:", nextError);
      setError(nextError instanceof Error ? nextError.message : "Could not rerun project embeddings.");
      return false;
    }
  }

  return {
    activeProject,
    userRole,
    setView,
    indexStatus,
    modelStatus,
    busy,
    error,
    buildModalOpen,
    setBuildModalOpen,
    openBuildModal,
    handleRunEmbedding,
  };
}

function EmbeddingBuildModal({
  buildModalOpen,
  hasExistingIndex,
  onClose,
  onRun,
}: {
  buildModalOpen: boolean;
  hasExistingIndex: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  if (!buildModalOpen) return null;
  return (
    <div className="modal-overlay">
      <div className="modal modal--wide app-settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-assist-rerun-title">
        <div className="settings-section-header">
          <div>
            <h2 id="ai-assist-rerun-title" className="settings-section-title">{hasExistingIndex ? "Rebuild Project Embeddings" : "Run Project Embeddings"}</h2>
            <p className="settings-section-desc">
              Kanqual is refreshing the local multilingual-e5 index for this project.
            </p>
          </div>
        </div>
        <div className="app-settings-modal-body">
          <div className="project-model-modal-copy">
            <p>
              This is mostly a first-run style task, but you can rerun it any time the project changes enough that you want a fresh AI Assist index.
            </p>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={onRun}>
              {hasExistingIndex ? "Re-run" : "Run"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AIAssistView() {
  const { canCurrentUser } = useStore();
  const {
    activeProject,
    setView,
    indexStatus,
    modelStatus,
    error,
    buildModalOpen,
    setBuildModalOpen,
    handleRunEmbedding,
  } = useEmbeddingRunState();
  const llmSettings = readAppSettings().llm;
  const aiAssistProjectSettings = activeProject ? readProjectAiAssistSettings(activeProject.id) : null;
  const [llmConnectionStatus, setLlmConnectionStatus] = useState<"checking" | "live" | "offline" | "disabled">(
    llmSettings.ollamaEnabled ? "checking" : "disabled",
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canViewAiAssistHome = canCurrentUser("viewAiAssistHome");
  const canManageLlmSettings = canCurrentUser("manageLlmSettings");
  const canDownloadEmbeddingModel = canCurrentUser("downloadEmbeddingModel");
  const canManageProjectAiAssist =
    canCurrentUser("enableProjectAiAssist")
    || canCurrentUser("buildEmbeddings")
    || canCurrentUser("deleteEmbeddings");
  const canOpenAiAssistSettings = canManageLlmSettings || canDownloadEmbeddingModel || canManageProjectAiAssist;
  const aiAssistRequirements = [
    {
      label: "Embeddings model download",
      met: Boolean(modelStatus?.installed),
      value: modelStatus?.installed ? "Ready" : "Missing",
      disabled: !(canManageLlmSettings || canDownloadEmbeddingModel),
      onClick: () => {
        sessionStorage.setItem("kanqual:open-app-settings-modal", "llm");
        setView("app-settings");
      },
    },
    {
      label: "Local LLM connection",
      met: llmConnectionStatus === "live",
      value:
        llmConnectionStatus === "checking"
          ? "Checking..."
          : llmConnectionStatus === "live"
            ? "Ready"
            : llmConnectionStatus === "disabled"
              ? "Disabled"
              : "Offline",
      disabled: !canManageLlmSettings,
      onClick: () => {
        sessionStorage.setItem("kanqual:open-app-settings-modal", "llm");
        setView("app-settings");
      },
    },
    {
      label: "AI Assist enabled in project settings",
      met: Boolean(aiAssistProjectSettings?.enabled),
      value: aiAssistProjectSettings?.enabled ? "Enabled" : "Disabled",
      disabled: !canManageProjectAiAssist,
      onClick: () => {
        sessionStorage.setItem("kanqual:open-project-settings-modal", "ai-assist");
        setView("project-settings");
      },
    },
    {
      label: "Embeddings built",
      met: Boolean(indexStatus?.exists),
      value: indexStatus?.exists ? "Ready" : "Not Built",
      disabled: !canManageProjectAiAssist,
      onClick: () => {
        sessionStorage.setItem("kanqual:open-project-settings-modal", "ai-assist");
        setView("project-settings");
      },
    },
  ];

  useEffect(() => {
    if (!llmSettings.ollamaEnabled) {
      setLlmConnectionStatus("disabled");
      return;
    }

    let cancelled = false;
    setLlmConnectionStatus("checking");
    void invoke<number>("ping_address", {
      host: llmSettings.ollamaHost,
      port: llmSettings.ollamaPort,
    })
      .then(() => {
        if (!cancelled) setLlmConnectionStatus("live");
      })
      .catch(() => {
        if (!cancelled) setLlmConnectionStatus("offline");
      });

    return () => {
      cancelled = true;
    };
  }, [llmSettings.ollamaEnabled, llmSettings.ollamaHost, llmSettings.ollamaPort]);

  useEffect(() => {
    if (!menuOpen) return;

    function syncMenuPosition() {
      const rect = menuButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({
        top: rect.bottom + 8,
        left: Math.max(12, rect.right - 180),
      });
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    syncMenuPosition();
    window.addEventListener("resize", syncMenuPosition);
    document.addEventListener("scroll", syncMenuPosition, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", syncMenuPosition);
      document.removeEventListener("scroll", syncMenuPosition, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function openAiAssistSettings() {
    if (!canOpenAiAssistSettings) return;
    sessionStorage.setItem("kanqual:open-app-settings-modal", "llm");
    setMenuOpen(false);
    setView("app-settings");
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>AI Assist</h1>
        </header>
        <div className="empty-state">
          <p>Open a project first.</p>
        </div>
      </div>
    );
  }

  if (!canViewAiAssistHome) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>AI Assist</h1>
        </header>
        <div className="empty-state">
          <p>You do not have permission to view AI Assist for this project.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view home-view ai-assist-home-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>AI Assist</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label="Show AI Assist help"
            title="Show Help"
            onClick={() => setHelpOpen(true)}
          >
            <img src={helpIcon} alt="" className="users-help-icon" />
          </button>
        </div>
        <button
          ref={menuButtonRef}
          className="btn home-menu-btn"
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="AI Assist actions"
          disabled={!canOpenAiAssistSettings}
          title={!canOpenAiAssistSettings ? "You do not have permission to change AI Assist settings" : undefined}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      {menuOpen && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: menuPos.top, left: menuPos.left, minWidth: 180 }}
          role="menu"
        >
          <button
            className="context-menu-item"
            type="button"
            onClick={openAiAssistSettings}
          >
            AI Assist Settings
          </button>
        </div>
      )}

      {error && <div className="form-error project-settings-error">{error}</div>}

        <div className="home-dashboard ai-assist-home-dashboard">
        <div className="home-stats-grid">
          <section className="home-project-card ai-assist-home-card ai-assist-home-card--status" aria-label="AI Assist status">
            <div className="home-project-card-header">
              <div>
                <h2>Status</h2>
                <p className="ai-assist-card-subcopy">
                  These four requirements need to be in place for the full AI Assist workflow to be ready.
                </p>
              </div>
            </div>
            <div className="home-restricted-list">
              {aiAssistRequirements.map((requirement) => (
                <button
                  key={requirement.label}
                  type="button"
                  className="home-restricted-item home-restricted-item--clickable"
                  onClick={requirement.onClick}
                  disabled={requirement.disabled}
                  title={requirement.disabled ? "You do not have permission to change this setting" : undefined}
                >
                  <span className="home-restricted-label">{requirement.label}</span>
                  <span className={`home-restricted-value${requirement.met ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                    {requirement.value}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>AI Assist Help</h2>
            <p className="users-guide-copy">
              AI Assist uses your local embedding index to ground chat, coding, attribute identification, and code analysis in project materials already stored in Kanqual.
            </p>
            <p className="users-guide-copy">
              Re-running embeddings refreshes the AI Assist index using the currently downloaded model.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <EmbeddingBuildModal
        buildModalOpen={buildModalOpen}
        hasExistingIndex={!!indexStatus?.exists}
        onClose={() => setBuildModalOpen(false)}
        onRun={() => {
          void handleRunEmbedding().then((started) => {
            if (started) setBuildModalOpen(false);
          });
        }}
      />

    </div>
  );
}

export function AIAssistAttributeCaseView() {
  return <AIAssistAttributeWorkspace kind="case" />;
}

export function AIAssistAttributeDocumentView() {
  return <AIAssistAttributeWorkspace kind="document" />;
}
