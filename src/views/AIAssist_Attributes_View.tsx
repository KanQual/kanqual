import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../context/StoreContext";
import { readAppSettings } from "../lib/appSettings";
import { assertActiveLlmRuntime } from "../lib/llmRuntime";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { HelpIcon } from "../components/AppIcons";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import {
  AttributeValuesModal,
  type SharedAttributeDraft as AttributeDraft,
} from "../components/AttributeValuesModal";

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

type AttributeCoverageSummary = {
  attributeId: string;
  missingCount: number;
  totalOwners: number;
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

type TextCitationTarget = {
  documentId: string;
  startOffset: number;
  endOffset: number;
};

type AttributeSuggestionSnapshot = {
  reportType: "ai-attribute-suggestions";
  kind: "case" | "document";
  selectedAttributeId: string | null;
  suggestionRowsByAttribute: Record<string, AttributeSuggestionRow[]>;
  suggestionModelByAttribute: Record<string, string>;
};

type SavedAttributeSuggestionRow = {
  id: string;
  name: string;
  targetKind: "case" | "document";
  attributeId: string | null;
  attributeName: string;
  createdByName: string;
  createdAt: string;
  snapshot: AttributeSuggestionSnapshot;
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

const EMPTY_ATTRIBUTE_VALUES_BY_OWNER: Record<string, string> = {};

function renderMissingAttributeValue() {
  return <span className="users-td--muted">N/A</span>;
}

function fmtSavedRunDate(iso: string): string {
  if (!iso) return "";
  try {
    return formatCurrentDateTime(iso, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
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
    name: record.name?.trim() || "",
    dataType: record.data_type || "text",
    description: record.description?.trim() || "",
    options,
    sortOrder: typeof record.sort_order === "number" ? record.sort_order : Number.MAX_SAFE_INTEGER,
  };
}

function formatAttributeTypeLabel(
  dataType: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (dataType) {
    case "text":
      return t("aiAssist.attributes.attributeTypes.text");
    case "number":
      return t("aiAssist.attributes.attributeTypes.number");
    case "datetime":
      return t("aiAssist.attributes.attributeTypes.datetime");
    case "categorical":
      return t("aiAssist.attributes.attributeTypes.categorical");
    default:
      return dataType;
  }
}

function useAttributeDefinitions(kind: "case" | "document") {
  const { t } = useI18n();
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
        setDefinitions(records.map((record) => {
          const definition = toAttributeDefinition(record);
          return {
            ...definition,
            name: definition.name || t("aiAssist.attributes.labels.untitledAttribute"),
          };
        }).sort((left, right) => {
          if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
          return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        }));
        setError("");
      } catch (nextError) {
        console.error(`Failed to load ${kind} attribute definitions:`, nextError);
        if (!cancelled) {
          setDefinitions([]);
          setError(t("aiAssist.attributes.errors.failedToLoadAttributeDefinitions", { kind }));
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

function useAttributeCoverageSummary(kind: "case" | "document") {
  const { t } = useI18n();
  const { pb, activeProject } = useStore();
  const { definitions, loading: definitionsLoading, error: definitionsError } = useAttributeDefinitions(kind);
  const [coverageByAttributeId, setCoverageByAttributeId] = useState<Record<string, AttributeCoverageSummary>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      setCoverageByAttributeId({});
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;
    async function loadCoverage() {
      if (definitions.length === 0) {
        setCoverageByAttributeId({});
        setLoading(false);
        setError("");
        return;
      }

      setLoading(true);
      try {
        const [ownerRecords, valueRecords] = await Promise.all([
          kind === "case"
            ? pb.collection("cases").getFullList({
                filter: `project="${projectId}"&&deleted_at=""`,
                fields: "id",
              })
            : pb.collection("documents").getFullList({
                filter: `project="${projectId}"&&deleted_at=""`,
                fields: "id",
              }),
          kind === "case"
            ? pb.collection("case_attribute_values").getFullList({
                filter: `case.project="${projectId}"&&deleted_at=""`,
                fields: "id,case,attribute,value",
              })
            : pb.collection("document_attribute_values").getFullList({
                filter: `document.project="${projectId}"&&deleted_at=""`,
                fields: "id,document,attribute,value",
              }),
        ]);
        if (cancelled) return;

        const totalOwners = ownerRecords.length;
        const populatedOwnersByAttribute = new Map<string, Set<string>>();
        for (const record of valueRecords) {
          const attributeId = String(record.attribute ?? "");
          const ownerId = String(kind === "case" ? record.case ?? "" : record.document ?? "");
          const value = String(record.value ?? "").trim();
          if (!attributeId || !ownerId || !value) continue;
          const current = populatedOwnersByAttribute.get(attributeId) ?? new Set<string>();
          current.add(ownerId);
          populatedOwnersByAttribute.set(attributeId, current);
        }

        const nextCoverage = Object.fromEntries(
          definitions.map((definition) => {
            const populatedCount = populatedOwnersByAttribute.get(definition.id)?.size ?? 0;
            return [
              definition.id,
              {
                attributeId: definition.id,
                missingCount: Math.max(0, totalOwners - populatedCount),
                totalOwners,
              } satisfies AttributeCoverageSummary,
            ];
          }),
        );
        setCoverageByAttributeId(nextCoverage);
        setError("");
      } catch (nextError) {
        console.error(`Failed to load ${kind} attribute coverage:`, nextError);
        if (!cancelled) {
          setCoverageByAttributeId({});
          setError(t("aiAssist.attributes.errors.failedToLoadAttributeCoverage", { kind }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadCoverage();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, definitions, kind, pb, reloadToken]);

  return {
    definitions,
    coverageByAttributeId,
    loading: definitionsLoading || loading,
    error: definitionsError || error,
    reload,
  };
}

function useAttributeValueRows(kind: "case" | "document", selectedAttributeId: string | null) {
  const { t } = useI18n();
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
            ownerName: String(record.name ?? t("aiAssist.attributes.labels.untitledCase")),
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
            ownerName: String(record.name ?? t("aiAssist.attributes.labels.untitledDocument")),
            value: valuesByOwner.get(record.id)?.value ?? "",
          })));
        }
        setError("");
      } catch (nextError) {
        console.error(`Failed to load ${kind} attribute values:`, nextError);
        if (!cancelled) {
          setRows([]);
          setError(t("aiAssist.attributes.errors.failedToLoadAttributeValues", { kind }));
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

function useAttributeOwnerRows(kind: "case" | "document") {
  const { t } = useI18n();
  const { pb, activeProject } = useStore();
  const [rows, setRows] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;
    async function loadRows() {
      setLoading(true);
      try {
        const records = await pb.collection(kind === "case" ? "cases" : "documents").getFullList({
          filter: `project="${projectId}"&&deleted_at=""`,
          sort: "name,+created",
          fields: "id,name",
        });
        if (cancelled) return;
        setRows(records.map((record) => ({
          id: record.id,
          name: String(record.name ?? t("aiAssist.attributes.labels.untitledKind", { kind })),
        })));
        setError("");
      } catch (nextError) {
        console.error(`Failed to load ${kind} owner rows:`, nextError);
        if (!cancelled) {
          setRows([]);
          setError(t("aiAssist.attributes.errors.failedToLoadRows", { kind }));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRows();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, kind, pb, reloadToken]);

  return { rows, loading, error, reload };
}

function AttributeSuggestionEvidenceModal({
  ownerName,
  value,
  evidenceText,
  openBusy,
  onOpenEvidence,
  onClose,
}: {
  ownerName: string;
  value: string;
  evidenceText: string;
  openBusy: boolean;
  onOpenEvidence: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
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
            <h2 id="ai-attribute-evidence-title" className="settings-section-title">{t("aiAssist.attributes.modals.evidence.title")}</h2>
            <p className="settings-section-desc">{ownerName}</p>
          </div>
          <button className="btn" type="button" onClick={onClose}>{t("common.close")}</button>
        </div>
        <div className="app-settings-modal-body">
          <div className="app-settings-stat-card">
            <strong>{t("aiAssist.attributes.labels.suggestedValue")}</strong>
            <span>{value || "-"}</span>
          </div>
          {evidenceText ? (
            <div className="ai-chat-citation-list">
              <button
                type="button"
                className="ai-chat-citation-link ai-chat-citation-link--document"
                onClick={onOpenEvidence}
                disabled={openBusy}
                title={evidenceText}
              >
                <span className="ai-chat-citation-number">[1]</span>
                <span className="ai-chat-citation-kind">{t("aiAssist.attributes.labels.text")}</span>
                <span className="ai-chat-citation-line">
                  <strong>{t("aiAssist.attributes.modals.evidence.supportingTextSegment")}</strong>
                  <small>{evidenceText}</small>
                </span>
              </button>
            </div>
          ) : (
            <div className="project-model-modal-copy">
              <p>{t("aiAssist.attributes.modals.evidence.noSupportingExcerpt")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizeAttributeSuggestionSnapshot(raw: unknown): AttributeSuggestionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (candidate.reportType !== "ai-attribute-suggestions") return null;
  const kind = candidate.kind === "case" || candidate.kind === "document" ? candidate.kind : null;
  if (!kind) return null;

  const normalizeRowsByAttribute = (value: unknown): Record<string, AttributeSuggestionRow[]> => {
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([attributeId, rows]) => [
        attributeId,
        Array.isArray(rows)
          ? rows
              .map((row) => {
                if (!row || typeof row !== "object") return null;
                const candidateRow = row as Record<string, unknown>;
                return {
                  ownerId: typeof candidateRow.ownerId === "string" ? candidateRow.ownerId : "",
                  ownerName: typeof candidateRow.ownerName === "string" ? candidateRow.ownerName : "",
                  suggestedValue: typeof candidateRow.suggestedValue === "string" ? candidateRow.suggestedValue : "",
                  evidenceText: typeof candidateRow.evidenceText === "string" ? candidateRow.evidenceText : "",
                };
              })
              .filter((row): row is AttributeSuggestionRow => !!row && !!row.ownerId)
          : [],
      ]),
    );
  };

  const normalizeModelByAttribute = (value: unknown): Record<string, string> => {
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, model]) => typeof model === "string")
        .map(([attributeId, model]) => [attributeId, model as string]),
    );
  };

  return {
    reportType: "ai-attribute-suggestions",
    kind,
    selectedAttributeId: typeof candidate.selectedAttributeId === "string" ? candidate.selectedAttributeId : null,
    suggestionRowsByAttribute: normalizeRowsByAttribute(candidate.suggestionRowsByAttribute),
    suggestionModelByAttribute: normalizeModelByAttribute(candidate.suggestionModelByAttribute),
  };
}

function parseSavedAttributeSuggestionRow(record: {
  id: string;
  name?: string;
  target_kind?: string;
  attribute_id?: string;
  attribute_name?: string;
  created?: string;
  snapshot?: string;
  expand?: { created_by?: { name?: string; email?: string } };
}): SavedAttributeSuggestionRow | null {
  if (!record.snapshot) return null;
  try {
    const snapshot = normalizeAttributeSuggestionSnapshot(JSON.parse(record.snapshot));
    if (!snapshot) return null;
    return {
      id: record.id,
      name: record.name ?? "",
      targetKind: record.target_kind === "case" ? "case" : "document",
      attributeId: typeof record.attribute_id === "string" && record.attribute_id.trim() ? record.attribute_id : null,
      attributeName: record.attribute_name ?? "",
      createdByName: record.expand?.created_by?.name || record.expand?.created_by?.email || "-",
      createdAt: record.created ?? "",
      snapshot,
    };
  } catch {
    return null;
  }
}

function SaveAttributeSuggestionsModal({
  initialName,
  loading,
  error,
  onClose,
  onSave,
}: {
  initialName: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  return (
    <div className="modal-overlay" onClick={() => !loading && onClose()}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t("aiAssist.attributes.modals.saveSuggestions.title")}</h2>
        <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
          {t("aiAssist.attributes.modals.saveSuggestions.body")}
        </p>
        <label className="form-label">
          {t("aiAssist.attributes.modals.saveSuggestions.nameLabel")}
          <input
            className="form-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("aiAssist.attributes.modals.saveSuggestions.namePlaceholder")}
            autoFocus
            disabled={loading}
          />
        </label>
        {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        <div className="form-actions" style={{ marginTop: 24 }}>
          <button type="button" className="btn" onClick={onClose} disabled={loading}>{t("common.cancel")}</button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onSave(name)}
            disabled={loading || !name.trim()}
          >
            {loading ? t("aiAssist.attributes.statuses.saving") : t("aiAssist.attributes.actions.saveSuggestions")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AIAssistAttributeWorkspace({
  kind,
  onBack,
  initialRow,
  initialAttributeId,
  onSaved,
}: {
  kind: "case" | "document";
  onBack?: () => void;
  initialRow?: SavedAttributeSuggestionRow | null;
  initialAttributeId?: string | null;
  onSaved?: (row: SavedAttributeSuggestionRow) => void;
}) {
  const { t } = useI18n();
  const {
    pb,
    activeProject,
    documents,
    setView,
    setActiveDocument,
    setPendingTextCitation,
    logAction,
    canCurrentUser,
    projectAiAssistSettings,
    isLocalWorkspace,
    runAttributeSuggestions,
    createAiAttributeSuggestionRun,
    updateAiAttributeSuggestionRun,
    cancelAttributeSuggestionRun,
  } = useStore();
  const canUseAiAttributeTools = canCurrentUser("useAiAttributeTools");
  const pageTitle = t("aiAssist.attributes.workspace.pageTitle");
  const isCaseMode = kind === "case";
  const aiAssistEnabledForProject = activeProject ? projectAiAssistSettings.enabled : false;
  const { definitions, loading, error } = useAttributeDefinitions(kind);
  const [selectedAttributeId, setSelectedAttributeId] = useState<string | null>(null);
  const [suggestionRowsByAttribute, setSuggestionRowsByAttribute] = useState<Record<string, AttributeSuggestionRow[]>>({});
  const [suggestionModelByAttribute, setSuggestionModelByAttribute] = useState<Record<string, string>>({});
  const [suggestionError, setSuggestionError] = useState("");
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [suggestionRunState, setSuggestionRunState] = useState<AttributeSuggestionRunState | null>(null);
  const [suggestionStopBusy, setSuggestionStopBusy] = useState(false);
  const [suggestionJobId, setSuggestionJobId] = useState<string | null>(null);
  const [acceptingOwnerId, setAcceptingOwnerId] = useState<string | null>(null);
  const [evidenceModalRow, setEvidenceModalRow] = useState<AttributeSuggestionRow | null>(null);
  const [openingEvidenceOwnerId, setOpeningEvidenceOwnerId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [savedRow, setSavedRow] = useState<SavedAttributeSuggestionRow | null>(initialRow ?? null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const suggestionRunRef = useRef<AttributeSuggestionRunState | null>(null);
  const columnLabels = {
    owner: isCaseMode ? t("aiAssist.attributes.labels.case") : t("aiAssist.attributes.labels.document"),
    currentValue: t("aiAssist.attributes.labels.currentValue"),
    suggestedValue: t("aiAssist.attributes.labels.suggestedValue"),
    accept: t("aiAssist.attributes.labels.accept"),
  };

  useEffect(() => {
    setSelectedAttributeId((current) => {
      if (!definitions.length) return null;
      if (current && definitions.some((definition) => definition.id === current)) return current;
      if (initialAttributeId && definitions.some((definition) => definition.id === initialAttributeId)) {
        return initialAttributeId;
      }
      return definitions[0]?.id ?? null;
    });
  }, [definitions, initialAttributeId]);

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
  const hasGeneratedSuggestions = useMemo(
    () => Object.values(suggestionRowsByAttribute).some((rows) => rows.length > 0),
    [suggestionRowsByAttribute],
  );
  const snapshot = useMemo<AttributeSuggestionSnapshot>(() => ({
    reportType: "ai-attribute-suggestions",
    kind,
    selectedAttributeId,
    suggestionRowsByAttribute,
    suggestionModelByAttribute,
  }), [kind, selectedAttributeId, suggestionRowsByAttribute, suggestionModelByAttribute]);
  const documentsById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );

  useEffect(() => {
    setSavedRow(initialRow ?? null);
    setShowSaveModal(false);
    setSaveBusy(false);
    setSaveError("");
    if (initialRow) {
      setSelectedAttributeId(initialRow.snapshot.selectedAttributeId);
      setSuggestionRowsByAttribute(initialRow.snapshot.suggestionRowsByAttribute);
      setSuggestionModelByAttribute(initialRow.snapshot.suggestionModelByAttribute);
      setSuggestionError("");
      setSuggestionBusy(false);
      setSuggestionStopBusy(false);
      setSuggestionJobId(null);
      setSuggestionRunState(null);
      setEvidenceModalRow(null);
      setOpeningEvidenceOwnerId(null);
      return;
    }
    setSelectedAttributeId(initialAttributeId ?? null);
    setSuggestionRowsByAttribute({});
    setSuggestionModelByAttribute({});
    setSuggestionError("");
    setSuggestionBusy(false);
    setSuggestionStopBusy(false);
    setSuggestionJobId(null);
    setSuggestionRunState(null);
    setEvidenceModalRow(null);
    setOpeningEvidenceOwnerId(null);
  }, [initialAttributeId, initialRow?.id, initialRow]);

  function findEvidenceRangeInText(content: string, evidenceText: string): Omit<TextCitationTarget, "documentId"> | null {
    const trimmedEvidence = evidenceText.trim();
    if (!content || !trimmedEvidence) return null;

    const exactIndex = content.indexOf(trimmedEvidence);
    if (exactIndex >= 0) {
      return {
        startOffset: exactIndex,
        endOffset: exactIndex + trimmedEvidence.length,
      };
    }

    const normalizeWithMap = (value: string) => {
      let normalized = "";
      const indexMap: number[] = [];
      let inWhitespace = false;
      for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (/\s/.test(char)) {
          if (!inWhitespace) {
            normalized += " ";
            indexMap.push(index);
            inWhitespace = true;
          }
        } else {
          normalized += char;
          indexMap.push(index);
          inWhitespace = false;
        }
      }
      return { normalized: normalized.trim(), indexMap };
    };

    const normalizedContent = normalizeWithMap(content);
    const normalizedEvidence = trimmedEvidence.replace(/\s+/g, " ").trim();
    if (!normalizedContent.normalized || !normalizedEvidence) return null;
    const normalizedIndex = normalizedContent.normalized.indexOf(normalizedEvidence);
    if (normalizedIndex < 0) return null;

    const startOffset = normalizedContent.indexMap[normalizedIndex];
    const endMapIndex = normalizedIndex + normalizedEvidence.length - 1;
    const endOffset = typeof startOffset === "number" && typeof normalizedContent.indexMap[endMapIndex] === "number"
      ? normalizedContent.indexMap[endMapIndex] + 1
      : NaN;
    if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) return null;
    return { startOffset, endOffset };
  }

  async function resolveEvidenceTarget(row: AttributeSuggestionRow): Promise<TextCitationTarget | null> {
    const trimmedEvidence = row.evidenceText.trim();
    if (!trimmedEvidence) return null;

    if (kind === "document") {
      const document = documentsById.get(row.ownerId);
      if (!document) return null;
      const range = findEvidenceRangeInText(document.content ?? "", trimmedEvidence);
      return range ? { documentId: document.id, ...range } : null;
    }

    const links = await pb.collection("case_documents").getFullList({
      filter: `case="${row.ownerId}"`,
      fields: "document",
    });
    for (const link of links) {
      const documentId = String(link.document ?? "");
      const document = documentsById.get(documentId);
      if (!document) continue;
      const range = findEvidenceRangeInText(document.content ?? "", trimmedEvidence);
      if (range) return { documentId: document.id, ...range };
    }
    return null;
  }

  async function handleOpenSuggestionEvidence(row: AttributeSuggestionRow) {
    setOpeningEvidenceOwnerId(row.ownerId);
    setSuggestionError("");
    try {
      const target = await resolveEvidenceTarget(row);
      if (!target) {
        throw new Error(t("aiAssist.attributes.errors.failedToLocateEvidence"));
      }
      const document = documentsById.get(target.documentId);
      if (!document) {
        throw new Error(t("aiAssist.attributes.errors.failedToOpenEvidenceDocument"));
      }
      setActiveDocument(document);
      setPendingTextCitation({
        documentId: document.id,
        startOffset: target.startOffset,
        endOffset: target.endOffset,
        label: row.ownerName,
      });
      setEvidenceModalRow(null);
      setView("code-text");
    } catch (error) {
      console.error("Failed to open attribute suggestion evidence:", error);
      setSuggestionError(error instanceof Error ? error.message : t("aiAssist.attributes.errors.failedToOpenSupportingText"));
    } finally {
      setOpeningEvidenceOwnerId(null);
    }
  }

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
        setSuggestionStopBusy(false);
        setSuggestionJobId(null);
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
        name: String(document.name ?? t("aiAssist.attributes.labels.untitledDocument")),
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
        name: String(document.name ?? t("aiAssist.attributes.labels.untitledDocument")),
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
        name: String(caseRecord.name ?? t("aiAssist.attributes.labels.untitledCase")),
        content,
      };
    });
  }

  async function handleStartSuggestionGeneration() {
    if (!selectedAttribute || !activeProject) return;
    const runId = `${selectedAttribute.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSuggestionBusy(true);
    setSuggestionStopBusy(false);
    setSuggestionJobId(null);
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
      if (isLocalWorkspace) {
        assertActiveLlmRuntime(readAppSettings().llm, "generating AI suggestions");
      }
      const items = await loadSuggestionInputItems();
      setSuggestionRunState({
        runId,
        attributeId: selectedAttribute.id,
        completedItems: 0,
        totalItems: items.length,
      });
      const response = await runAttributeSuggestions({
        projectId: activeProject.id,
        runId,
        attributeName: selectedAttribute.name,
        attributeDataType: selectedAttribute.dataType,
        attributeDescription: selectedAttribute.description,
        attributeOptions: selectedAttribute.options,
        items,
      }, undefined, (jobId) => {
        setSuggestionJobId(jobId);
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
      setSuggestionStopBusy(false);
      setSuggestionJobId(null);
    } catch (nextError) {
      console.error("Failed to generate attribute suggestions:", nextError);
      setSuggestionError(nextError instanceof Error ? nextError.message : t("aiAssist.attributes.errors.failedToGenerateSuggestions"));
      setSuggestionRunState((current) => current?.runId === runId ? null : current);
      setSuggestionStopBusy(false);
      setSuggestionJobId(null);
    } finally {
      setSuggestionBusy(false);
    }
  }

  async function handleStopSuggestionGeneration() {
    const activeRun = suggestionRunRef.current;
    if (!activeRun || suggestionStopBusy) return;
    setSuggestionStopBusy(true);
    setSuggestionError("");
    try {
      await cancelAttributeSuggestionRun(activeRun.runId, suggestionJobId);
    } catch (nextError) {
      console.error("Failed to stop attribute suggestion generation:", nextError);
      setSuggestionError(nextError instanceof Error ? nextError.message : t("aiAssist.attributes.errors.failedToStopSuggestions"));
      setSuggestionStopBusy(false);
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
        let recordId = existingValueRow?.recordId;
        if (existingValueRow?.recordId) {
          await pb.collection("case_attribute_values").update(existingValueRow.recordId, {
            value: row.suggestedValue,
            deleted_at: "",
          });
        } else {
          const created = await pb.collection("case_attribute_values").create({
            case: row.ownerId,
            attribute: selectedAttribute.id,
            value: row.suggestedValue,
            deleted_at: "",
          });
          recordId = created.id;
        }
        await logAction(activeProject.id, "case_attribute.update", t("projectLog.labels.caseAttributeSuggestionAccepted", { name: selectedAttribute.name }), recordId ?? selectedAttribute.id, {
          entityType: "case_attribute_value",
          attributeId: selectedAttribute.id,
          attributeName: selectedAttribute.name,
          ownerId: row.ownerId,
          ownerName: row.ownerName,
          source: "ai_suggestion",
          operation: existingValueRow?.recordId ? "update" : "create",
          changedValueCount: 1,
        });
      } else {
        let recordId = existingValueRow?.recordId;
        if (existingValueRow?.recordId) {
          await pb.collection("document_attribute_values").update(existingValueRow.recordId, {
            value: row.suggestedValue,
            deleted_at: "",
          });
        } else {
          const created = await pb.collection("document_attribute_values").create({
            document: row.ownerId,
            attribute: selectedAttribute.id,
            value: row.suggestedValue,
            deleted_at: "",
          });
          recordId = created.id;
        }
        await logAction(activeProject.id, "document_attribute.update", t("projectLog.labels.documentAttributeSuggestionAccepted", { name: selectedAttribute.name }), recordId ?? selectedAttribute.id, {
          entityType: "document_attribute_value",
          attributeId: selectedAttribute.id,
          attributeName: selectedAttribute.name,
          ownerId: row.ownerId,
          ownerName: row.ownerName,
          source: "ai_suggestion",
          operation: existingValueRow?.recordId ? "update" : "create",
          changedValueCount: 1,
        });
      }
      reloadValueRows();
    } catch (nextError) {
      console.error("Failed to accept AI attribute suggestion:", nextError);
      setSuggestionError(nextError instanceof Error ? nextError.message : t("aiAssist.attributes.errors.failedToAcceptSuggestion"));
    } finally {
      setAcceptingOwnerId(null);
    }
  }

  async function handleSaveSuggestions(name: string) {
    if (!activeProject || !hasGeneratedSuggestions) return;
    setSaveBusy(true);
    setSaveError("");
    try {
      const selectedAttributeName = definitions.find((definition) => definition.id === selectedAttributeId)?.name ?? "";
      const snapshotJson = JSON.stringify(snapshot);
      if (savedRow) {
        await updateAiAttributeSuggestionRun(savedRow.id, {
          name,
          targetKind: kind,
          attributeId: selectedAttributeId,
          attributeName: selectedAttributeName,
          snapshot: snapshotJson,
        });
        const nextRow: SavedAttributeSuggestionRow = {
          ...savedRow,
          name,
          attributeId: selectedAttributeId,
          attributeName: selectedAttributeName,
          snapshot,
        };
        setSavedRow(nextRow);
        onSaved?.(nextRow);
      } else {
        const record = await createAiAttributeSuggestionRun({
          name,
          targetKind: kind,
          attributeId: selectedAttributeId,
          attributeName: selectedAttributeName,
          snapshot: snapshotJson,
        });
        if (!record) {
          throw new Error(t("aiAssist.attributes.errors.failedToSaveSuggestionsNoProject"));
        }
        const nextRow = parseSavedAttributeSuggestionRow(record);
        if (!nextRow) {
          throw new Error("Saved suggestions could not be reopened because the returned snapshot was invalid.");
        }
        setSavedRow(nextRow);
        onSaved?.(nextRow);
      }
      setShowSaveModal(false);
    } catch (nextError) {
      console.error("Failed to save attribute suggestions:", nextError);
      setSaveError(nextError instanceof Error ? nextError.message : t("aiAssist.attributes.errors.failedToSaveSuggestions"));
    } finally {
      setSaveBusy(false);
    }
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{pageTitle}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.attributes.workspace.empty.openProjectFirst")}</p>
        </div>
      </div>
    );
  }

  if (!canUseAiAttributeTools) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{pageTitle}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.attributes.workspace.empty.noPermission")}</p>
        </div>
      </div>
    );
  }

  if (!aiAssistEnabledForProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{pageTitle}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.attributes.workspace.empty.enableInProjectSettings")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="view ai-attribute-view">
      {onBack && (
        <div className="workspace-back-row">
          <button type="button" className="btn" onClick={onBack}>
            {t("aiAssist.attributes.actions.backToAttributes")}
          </button>
        </div>
      )}
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{pageTitle}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("aiAssist.attributes.openHelp")}
            aria-label={t("aiAssist.attributes.openHelp")}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <div className="users-header-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setShowSaveModal(true)}
            disabled={!hasGeneratedSuggestions || saveBusy}
            title={!hasGeneratedSuggestions ? t("aiAssist.attributes.workspace.saveDisabled") : undefined}
          >
            {saveBusy ? t("aiAssist.attributes.statuses.saving") : savedRow ? t("aiAssist.attributes.actions.saveChanges") : t("aiAssist.attributes.actions.saveSuggestions")}
          </button>
        </div>
      </header>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("aiAssist.attributes.workspace.help.title")}</h2>
            <p className="users-guide-copy">
              {t("aiAssist.attributes.workspace.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.attributes.workspace.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.attributes.workspace.help.line3")}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {(saveError || suggestionError) && (
        <div className="form-error project-settings-error">{saveError || suggestionError}</div>
      )}

      <section className="annotate-card ai-attribute-column ai-attribute-column--placeholder">
        <div className="annotate-card-header">
          <span className="annotate-card-title">{pageTitle}</span>
          <div className="users-header-actions">
            <button
              type="button"
              className="btn btn--small"
              onClick={() => void handleStopSuggestionGeneration()}
              disabled={!suggestionBusy || suggestionStopBusy}
            >
              {suggestionStopBusy ? t("aiAssist.attributes.statuses.stopping") : t("aiAssist.attributes.actions.stop")}
            </button>
            <button
              type="button"
              className="btn btn--small btn--danger"
              onClick={() => void handleStartSuggestionGeneration()}
              disabled={!selectedAttribute || suggestionBusy}
            >
              {suggestionBusy ? t("aiAssist.attributes.statuses.generating") : t("aiAssist.attributes.actions.generateSuggestions")}
            </button>
          </div>
        </div>
        {error && <div className="form-error project-settings-error">{error}</div>}
        {selectedAttribute ? (
          <div className="ai-attribute-selected-summary">
            <div className="ai-attribute-selected-summary-main">
              <div className="ai-attribute-selected-summary-badges">
                <span className="ai-attribute-selected-summary-kind">{isCaseMode ? t("aiAssist.attributes.labels.caseAttribute") : t("aiAssist.attributes.labels.documentAttribute")}</span>
                <span className="ai-attribute-selected-summary-type">{formatAttributeTypeLabel(selectedAttribute.dataType, t)}</span>
              </div>
              <strong>{selectedAttribute.name}</strong>
            </div>
            {selectedAttribute.description.trim() ? (
              <p className="backup-field-hint ai-attribute-selected-summary-description">{selectedAttribute.description}</p>
            ) : null}
          </div>
        ) : null}
        {selectedAttribute && suggestionBusy && (
          <div className="ai-segments-search-state">
            <div className="ai-segments-progress" aria-hidden="true">
              <span className="ai-segments-progress-bar" />
            </div>
            <div className="ai-segments-search-copy">
              {t("aiAssist.attributes.workspace.generatingFor", { name: selectedAttribute.name })}
              {visibleSuggestionProgress ? ` (${visibleSuggestionProgress.completedItems}/${visibleSuggestionProgress.totalItems})` : ""}.
            </div>
          </div>
        )}
        {!selectedAttribute ? (
          <div className="ai-attribute-placeholder">
            <p>{t("aiAssist.attributes.workspace.empty.openFromSpecificAttribute")}</p>
          </div>
        ) : valuesLoading || loading ? (
          <div className="ai-attribute-placeholder">
            <p>{t("aiAssist.attributes.workspace.empty.loadingCurrentValues")}</p>
          </div>
        ) : (
          <div className="ai-attribute-table-wrap">
            {valuesError && <div className="form-error project-settings-error">{valuesError}</div>}
            {suggestionModel && (
              <p className="backup-field-hint ai-attribute-suggestion-meta">{t("aiAssist.attributes.workspace.generatedWith", { model: suggestionModel })}</p>
            )}
            <table className="users-table ai-attribute-table">
              <thead>
                <tr>
                  <th className="users-th ai-attribute-table-owner-col">{columnLabels.owner}</th>
                  <th className="users-th ai-attribute-table-value-col">{columnLabels.currentValue}</th>
                  <th className="users-th ai-attribute-table-value-col">{columnLabels.suggestedValue}</th>
                  <th className="users-th ai-attribute-table-action-col">{columnLabels.accept}</th>
                </tr>
              </thead>
              <tbody>
                {valueRows.length === 0 ? (
                  <tr>
                    <td className="users-td-msg" colSpan={4}>
                      {isCaseMode ? t("aiAssist.attributes.workspace.empty.noCasesYet") : t("aiAssist.attributes.workspace.empty.noDocumentsYet")}
                    </td>
                  </tr>
                ) : (
                  valueRows.map((valueRow) => {
                    const suggestionRow = suggestionRows.find((row) => row.ownerId === valueRow.ownerId) ?? null;
                    const isAccepted = !!suggestionRow?.suggestedValue.trim()
                      && valueRow.value.trim() === suggestionRow.suggestedValue.trim();
                    return (
                      <tr key={valueRow.ownerId}>
                        <td className="users-td users-td--name ai-attribute-table-owner-cell">{valueRow.ownerName}</td>
                        <td className="users-td ai-attribute-table-value-cell">
                          {valueRow.value ? valueRow.value : renderMissingAttributeValue()}
                        </td>
                        <td className="users-td ai-attribute-table-value-cell">
                          {suggestionRow?.suggestedValue.trim() ? (
                            <button
                              type="button"
                              className="ai-attribute-suggestion-link"
                              onClick={() => setEvidenceModalRow(suggestionRow)}
                            >
                              {suggestionRow.suggestedValue}
                            </button>
                          ) : (
                            renderMissingAttributeValue()
                          )}
                        </td>
                        <td className="users-td ai-attribute-table-action-cell">
                          {suggestionRow?.suggestedValue.trim() ? (
                            <button
                              type="button"
                              className="btn btn--small"
                              onClick={() => void handleAcceptSuggestion(suggestionRow)}
                              disabled={acceptingOwnerId === suggestionRow.ownerId || isAccepted}
                            >
                              {acceptingOwnerId === suggestionRow.ownerId ? t("aiAssist.attributes.statuses.saving") : isAccepted ? t("aiAssist.attributes.statuses.accepted") : t("aiAssist.attributes.actions.accept")}
                            </button>
                          ) : (
                            renderMissingAttributeValue()
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {suggestionRows.length === 0 && (
              <div className="ai-attribute-placeholder" style={{ marginTop: 16 }}>
                <p>{t("aiAssist.attributes.workspace.generateToFill", { name: selectedAttribute.name })}</p>
              </div>
            )}
          </div>
        )}
      </section>
      {evidenceModalRow && (
        <AttributeSuggestionEvidenceModal
          ownerName={evidenceModalRow.ownerName}
          value={evidenceModalRow.suggestedValue}
          evidenceText={evidenceModalRow.evidenceText}
          openBusy={openingEvidenceOwnerId === evidenceModalRow.ownerId}
          onOpenEvidence={() => void handleOpenSuggestionEvidence(evidenceModalRow)}
          onClose={() => setEvidenceModalRow(null)}
        />
      )}

      {showSaveModal && (
        <SaveAttributeSuggestionsModal
          initialName={savedRow?.name ?? ""}
          loading={saveBusy}
          error={saveError}
          onClose={() => {
            if (saveBusy) return;
            setShowSaveModal(false);
            setSaveError("");
          }}
          onSave={(name) => void handleSaveSuggestions(name)}
        />
      )}
    </div>
  );
}

function AIAssistAttributeLandingView({ kind }: { kind: "case" | "document" }) {
  const { t } = useI18n();
  const {
    activeProject,
    pb,
    canCurrentUser,
    deleteAiAttributeSuggestionRun,
    logAction,
    setView,
  } = useStore();
  const [openRow, setOpenRow] = useState<SavedAttributeSuggestionRow | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [pendingAttributeId, setPendingAttributeId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [rows, setRows] = useState<SavedAttributeSuggestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAttributeModalOpen, setNewAttributeModalOpen] = useState(false);
  const [newAttributeBusy, setNewAttributeBusy] = useState(false);
  const [newAttributeError, setNewAttributeError] = useState("");
  const [newAttributeDraft, setNewAttributeDraft] = useState<AttributeDraft>({
    name: "",
    dataType: "text",
    description: "",
    options: [],
  });
  const [confirmDelete, setConfirmDelete] = useState<SavedAttributeSuggestionRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: SavedAttributeSuggestionRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  const canDeleteSavedSuggestions = canCurrentUser("deleteReports");
  const title = t("aiAssist.attributes.landing.pageTitle");
  const suggestionColumns: Array<{ key: "name" | "attributeName" | "createdByName" | "createdAt" | "actions"; label: string; width: string }> = [
    { key: "name", label: t("aiAssist.attributes.landing.table.name"), width: "30%" },
    { key: "attributeName", label: t("aiAssist.attributes.landing.table.attribute"), width: "24%" },
    { key: "createdByName", label: t("aiAssist.attributes.landing.table.createdBy"), width: "18%" },
    { key: "createdAt", label: t("aiAssist.attributes.landing.table.created"), width: "18%" },
    { key: "actions", label: "", width: "10%" },
  ];
  const {
    definitions: caseDefinitions,
    coverageByAttributeId: caseCoverageByAttributeId,
    loading: caseCoverageLoading,
    error: caseCoverageError,
    reload: reloadCaseCoverage,
  } = useAttributeCoverageSummary("case");
  const {
    definitions: documentDefinitions,
    coverageByAttributeId: documentCoverageByAttributeId,
    loading: documentCoverageLoading,
    error: documentCoverageError,
    reload: reloadDocumentCoverage,
  } = useAttributeCoverageSummary("document");
  const currentTargetKind = kind;
  const currentAttributeDefinitions = currentTargetKind === "case" ? caseDefinitions : documentDefinitions;
  const currentCoverageByAttributeId = currentTargetKind === "case"
    ? caseCoverageByAttributeId
    : documentCoverageByAttributeId;
  const currentCoverageLoading = currentTargetKind === "case" ? caseCoverageLoading : documentCoverageLoading;
  const currentCoverageError = currentTargetKind === "case" ? caseCoverageError : documentCoverageError;
  const currentOwnerLabel = currentTargetKind === "case" ? "cases" : "documents";
  const canCreateCurrentAttributes = currentTargetKind === "case"
    ? canCurrentUser("createCaseAttributes")
    : canCurrentUser("createDocumentAttributes");
  const {
    rows: caseOwnerRows,
    error: caseOwnerRowsError,
    reload: reloadCaseOwnerRows,
  } = useAttributeOwnerRows("case");
  const {
    rows: documentOwnerRows,
    error: documentOwnerRowsError,
    reload: reloadDocumentOwnerRows,
  } = useAttributeOwnerRows("document");
  const currentOwnerRows = currentTargetKind === "case" ? caseOwnerRows : documentOwnerRows;
  const currentOwnerRowsError = currentTargetKind === "case" ? caseOwnerRowsError : documentOwnerRowsError;

  const loadSuggestionRuns = useCallback(async () => {
    if (!activeProject) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const records = await pb.collection("ai_attribute_suggestion_runs").getFullList({
        filter: `project="${activeProject.id}"&&target_kind="${kind}"&&deleted_at=""`,
        expand: "created_by",
        sort: "-created",
      });
      const mappedRows = records
        .map((record) => parseSavedAttributeSuggestionRow(record))
        .filter(Boolean) as SavedAttributeSuggestionRow[];
      setRows(mappedRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("aiAssist.attributes.landing.failedToLoadSavedSuggestionRuns"));
    } finally {
      setLoading(false);
    }
  }, [activeProject, kind, pb, t]);

  useEffect(() => {
    void loadSuggestionRuns();
  }, [loadSuggestionRuns]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    try {
      await deleteAiAttributeSuggestionRun(confirmDelete.id, confirmDelete.name);
      setRows((prev) => prev.filter((row) => row.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("aiAssist.attributes.landing.failedToDeleteSavedSuggestions"));
      setConfirmDelete(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  if (creatingNew || openRow) {
    return (
      <AIAssistAttributeWorkspace
        kind={kind}
        onBack={() => {
          setOpenRow(null);
          setCreatingNew(false);
          setPendingAttributeId(null);
        }}
        initialRow={openRow}
        initialAttributeId={openRow ? undefined : pendingAttributeId}
        onSaved={(row) => {
          setCreatingNew(false);
          setOpenRow(row);
          setPendingAttributeId(null);
          setRows((prev) => [row, ...prev.filter((item) => item.id !== row.id)]);
        }}
      />
    );
  }

  async function handleCreateAttribute(draft: AttributeDraft, valuesByOwner: Record<string, string>) {
    if (!activeProject) return;
    if (!canCreateCurrentAttributes) {
      setNewAttributeError(t("aiAssist.attributes.landing.noPermissionToCreate", { kind: currentTargetKind }));
      return;
    }

    setNewAttributeBusy(true);
    setNewAttributeError("");
    try {
      const collection = currentTargetKind === "case" ? "case_attribute_definitions" : "document_attribute_definitions";
      const valueCollection = currentTargetKind === "case" ? "case_attribute_values" : "document_attribute_values";
      const existingDefinitions = currentTargetKind === "case" ? caseDefinitions : documentDefinitions;
      const created = await pb.collection(collection).create({
        project: activeProject.id,
        name: draft.name.trim(),
        data_type: draft.dataType,
        description: draft.description.trim(),
        options_json: JSON.stringify(draft.options),
        sort_order: existingDefinitions.length,
        deleted_at: "",
      });
      await Promise.all(
        Object.entries(valuesByOwner)
          .map(([ownerId, value]) => [ownerId, value.trim()] as const)
          .filter(([, value]) => Boolean(value))
          .map(([ownerId, value]) =>
            pb.collection(valueCollection).create({
              [currentTargetKind]: ownerId,
              attribute: created.id,
              value,
              deleted_at: "",
            }),
          ),
      );
      const changedOwnerIds = Object.entries(valuesByOwner)
        .map(([ownerId, value]) => [ownerId, value.trim()] as const)
        .filter(([, value]) => Boolean(value))
        .map(([ownerId]) => ownerId);
      await logAction(
        activeProject.id,
        currentTargetKind === "case" ? "case_attribute.create" : "document_attribute.create",
        t(currentTargetKind === "case" ? "projectLog.labels.caseAttributeAdded" : "projectLog.labels.documentAttributeAdded", {
          name: draft.name.trim(),
        }),
        created.id,
        {
          entityType: currentTargetKind === "case" ? "case_attribute" : "document_attribute",
          dataType: draft.dataType,
          changedOwnerIds,
          changedValueCount: changedOwnerIds.length,
          createdWithAiAssist: true,
        },
      );
      if (currentTargetKind === "case") {
        reloadCaseCoverage();
        reloadCaseOwnerRows();
      } else {
        reloadDocumentCoverage();
        reloadDocumentOwnerRows();
      }
      setNewAttributeModalOpen(false);
      setNewAttributeError("");
      setNewAttributeDraft({
        name: "",
        dataType: "text",
        description: "",
        options: [],
      });
    } catch (createError) {
      setNewAttributeError(createError instanceof Error ? createError.message : t("aiAssist.attributes.landing.failedToCreateAttribute"));
    } finally {
      setNewAttributeBusy(false);
    }
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{title}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label={t("aiAssist.attributes.landing.openHelp")}
            title={t("aiAssist.attributes.openHelp")}
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}

      <div className="users-content">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 0.95fr) minmax(440px, 1.25fr)", gap: 20, alignItems: "start" }}>
          <section className="users-layout-main">
            <div className="surface-card" style={{ minHeight: 420 }}>
              <div className="surface-card-header">
                <div>
                  <div className="surface-card-title">{t("aiAssist.attributes.landing.currentAttributesTitle")}</div>
                  <p className="surface-card-description">
                    {t("aiAssist.attributes.landing.currentAttributesBody")}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    setNewAttributeError("");
                    setNewAttributeDraft({
                      name: "",
                      dataType: "text",
                      description: "",
                      options: [],
                    });
                    setNewAttributeModalOpen(true);
                  }}
                  disabled={!canCreateCurrentAttributes}
                  title={!canCreateCurrentAttributes ? t("aiAssist.attributes.landing.noPermissionToCreateTitle", { kind: currentTargetKind }) : undefined}
                >
                  {t("aiAssist.attributes.actions.newAttribute")}
                </button>
              </div>

              <div className="ai-attribute-mode-toggle">
                <div className="segmented-control" role="tablist" aria-label={t("aiAssist.attributes.landing.attributeTarget")}>
                  {(["case", "document"] as const).map((targetKind) => (
                    <button
                      key={targetKind}
                      type="button"
                      role="tab"
                      aria-selected={currentTargetKind === targetKind}
                      className={
                        currentTargetKind === targetKind
                          ? "segmented-control-option segmented-control-option--active"
                          : "segmented-control-option"
                      }
                      onClick={() => setView(targetKind === "case" ? "ai-assist-case-attributes" : "ai-assist-document-attributes")}
                    >
                      {targetKind === "case" ? t("aiAssist.attributes.labels.cases") : t("aiAssist.attributes.labels.documents")}
                    </button>
                  ))}
                </div>
              </div>

              {currentCoverageError && <div className="form-error" style={{ marginTop: 16 }}>{currentCoverageError}</div>}
              {!currentCoverageError && currentOwnerRowsError && (
                <div className="form-error" style={{ marginTop: 16 }}>{currentOwnerRowsError}</div>
              )}

              <div className="ai-attribute-list" style={{ marginTop: 16 }}>
                {currentCoverageLoading ? (
                  <div className="empty-state ai-attribute-empty-state"><p>{t("aiAssist.attributes.landing.loadingAttributes")}</p></div>
                ) : currentAttributeDefinitions.length === 0 ? (
                  <div className="empty-state ai-attribute-empty-state"><p>{t("aiAssist.attributes.landing.noAttributesYet", { kind: currentTargetKind })}</p></div>
                ) : (
                  currentAttributeDefinitions.map((definition) => {
                    const coverage = currentCoverageByAttributeId[definition.id];
                    const missingCount = coverage?.missingCount ?? 0;
                    const totalOwners = coverage?.totalOwners ?? 0;
                    return (
                      <button
                        key={definition.id}
                        type="button"
                        className="ai-attribute-list-item"
                        style={{ width: "100%", textAlign: "left" }}
                        onClick={() => {
                          if (currentTargetKind !== kind) {
                            setView(currentTargetKind === "case" ? "ai-assist-case-attributes" : "ai-assist-document-attributes");
                            return;
                          }
                          setPendingAttributeId(definition.id);
                          setOpenRow(null);
                          setCreatingNew(true);
                        }}
                      >
                        <div className="ai-attribute-list-item-main" style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                          <strong>{definition.name}</strong>
                          <span>{formatAttributeTypeLabel(definition.dataType, t)}</span>
                        </div>
                        <div className="ai-attribute-list-item-meta">
                          {t("aiAssist.attributes.landing.missingOwners", { count: missingCount, owners: currentOwnerLabel })}
                          {totalOwners > 0 ? ` ${t("aiAssist.attributes.landing.ofOwners", { count: totalOwners })}` : ""}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          <section className="users-layout-main">
            <div className="surface-card" style={{ minHeight: 420 }}>
              <div className="surface-card-header">
                <div>
                  <div className="surface-card-title">{t("aiAssist.attributes.landing.savedSuggestionRunsTitle")}</div>
                  <p className="surface-card-description">
                    {t("aiAssist.attributes.landing.savedSuggestionRunsBody", { kind: kind === "case" ? t("aiAssist.attributes.labels.cases") : t("aiAssist.attributes.labels.documents") })}
                  </p>
                </div>
              </div>
              <div className="users-table-wrap" style={{ maxHeight: 34 + (Math.max(loading || rows.length === 0 ? 1 : rows.length, 1) + 2) * 36 }}>
                <table className="users-table">
                  <thead>
                      <tr>
                        {suggestionColumns.map((col) => (
                          <th key={col.key} style={{ width: col.width }} className="users-th">
                            {col.label}
                          </th>
                        ))}
                      </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={suggestionColumns.length} className="users-td-msg">{t("aiAssist.attributes.statuses.loading")}</td>
                      </tr>
                    )}
                    {!loading && rows.length === 0 && (
                      <tr>
                        <td colSpan={suggestionColumns.length} className="users-td-msg">{t("aiAssist.attributes.landing.noSavedSuggestionRuns")}</td>
                      </tr>
                    )}
                    {!loading && rows.map((row) => (
                      <tr
                        key={row.id}
                        className="users-row"
                        onClick={() => setOpenRow(row)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextMenu({ x: event.clientX, y: event.clientY, row });
                        }}
                      >
                        <td className="users-td users-td--name">{row.name}</td>
                        <td className="users-td users-td--muted">{row.attributeName || t("aiAssist.attributes.landing.noAttributeSelected")}</td>
                        <td className="users-td users-td--muted">{row.createdByName}</td>
                        <td className="users-td users-td--muted">{fmtSavedRunDate(row.createdAt)}</td>
                        <td className="users-td users-td--muted">{t("aiAssist.attributes.landing.rightClick")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(event) => event.stopPropagation()}>
            <h2>{t("aiAssist.attributes.landing.help.title")}</h2>
            <p className="users-guide-copy">
              {t("aiAssist.attributes.landing.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.attributes.landing.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.attributes.landing.help.line3")}
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {newAttributeModalOpen && (
        <AttributeValuesModal
          draft={newAttributeDraft}
          rows={currentOwnerRows}
          initialValuesByOwner={EMPTY_ATTRIBUTE_VALUES_BY_OWNER}
          saving={newAttributeBusy}
          error={newAttributeError}
          onCancel={() => {
            if (newAttributeBusy) return;
            setNewAttributeModalOpen(false);
            setNewAttributeError("");
          }}
          onSave={(draft, valuesByOwner) => void handleCreateAttribute(draft, valuesByOwner)}
          emptyStateLabel={currentTargetKind === "case" ? t("aiAssist.attributes.workspace.empty.noCasesYet") : t("aiAssist.attributes.workspace.empty.noDocumentsYet")}
        />
      )}

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={contextMenuStyle}>
          <button
            className="context-menu-item"
            onClick={() => {
              setOpenRow(contextMenu.row);
              setContextMenu(null);
            }}
          >
            {t("aiAssist.attributes.actions.openSuggestions")}
          </button>
          {canDeleteSavedSuggestions ? (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => {
                setConfirmDelete(contextMenu.row);
                setContextMenu(null);
              }}
            >
              {t("aiAssist.attributes.actions.deleteSuggestions")}
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title={t("aiAssist.attributes.landing.onlyEditorsOwnersDelete")}>
              {t("aiAssist.attributes.actions.deleteSuggestions")}
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleteBusy && setConfirmDelete(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>{t("aiAssist.attributes.modals.deleteSuggestions.title")}</h2>
            <p className="users-guide-copy">
              {t("aiAssist.attributes.modals.deleteSuggestions.bodyPrefix")} <strong>{confirmDelete.name}</strong>? {t("aiAssist.attributes.modals.deleteSuggestions.bodySuffix")}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteBusy}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn btn--danger" onClick={() => void handleDelete()} disabled={deleteBusy}>
                {deleteBusy ? t("aiAssist.attributes.statuses.deleting") : t("aiAssist.attributes.actions.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AIAssistAttributeCaseView() {
  return <AIAssistAttributeLandingView kind="case" />;
}

export function AIAssistAttributeDocumentView() {
  return <AIAssistAttributeLandingView kind="document" />;
}
