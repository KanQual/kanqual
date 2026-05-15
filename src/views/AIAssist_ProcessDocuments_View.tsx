import { useEffect, useMemo, useRef, useState } from "react";
import type { RecordModel } from "pocketbase";
import { useStore } from "../context/StoreContext";
import helpIcon from "../assets/ic_help_outline_24px.svg";

type TranscriptProcessingSegment = {
  segmentType: "metadata" | "question" | "answer";
  speakerId: string;
  startOffset: number;
  endOffset: number;
  sortOrder: number;
  text: string;
  chunkIndex: number;
};

type SegmentType = TranscriptProcessingSegment["segmentType"];

type TranscriptNameCandidate = {
  text: string;
  sourceType: string;
};

type ReviewLensId = "speaker-segmentation" | "named-entity-extraction";

type ReviewLens = {
  id: ReviewLensId;
  label: string;
  description: string;
};

type SpeakerSummary = {
  id: string;
  turnCount: number;
  questionCount: number;
  answerCount: number;
};

type ProcessedDocumentReviewRecord = {
  id: string;
  projectId: string;
  documentId: string;
  documentName: string;
  filePath: string;
  status: "pending_review" | "reviewed";
  processedContent: string;
  segments: TranscriptProcessingSegment[];
  properNameCandidates: TranscriptNameCandidate[];
  enabledReviewLenses: Record<ReviewLensId, boolean>;
  model: string;
  baseUrl: string;
  chunkCount: number;
  exportedToProject: boolean;
  createdAt: string;
  updatedAt: string;
};

const REVIEW_LENSES: ReviewLens[] = [
  {
    id: "speaker-segmentation",
    label: "Identify elements",
    description: "Identify metadata, speakers, and roles in the transcript.",
  },
  {
    id: "named-entity-extraction",
    label: "Named entity extraction",
    description: "Show likely speaker-name candidates that may need review or anonymization.",
  },
];

const REVIEW_COLLECTION = "processed_document_reviews";

function describeProcessingError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error !== null) {
    const maybeMessage = Reflect.get(error, "message");
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      // Fall through.
    }
  }
  return "Could not process this transcript.";
}

function fmtDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}
void fmtDate;

function segmentContainsTimestamp(segment: TranscriptProcessingSegment): boolean {
  const patterns = [
    /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
    /\[\d{1,2}:\d{2}(?::\d{2})?\]/g,
    /\b\d{1,2}\.\d{2}(?::\d{2})?\b/g,
  ];
  return patterns.some((pattern) => pattern.test(segment.text));
}

function collectSpeakerSummaries(segments: TranscriptProcessingSegment[]): SpeakerSummary[] {
  const bySpeaker = new Map<string, SpeakerSummary>();
  for (const segment of segments) {
    const speaker = segment.speakerId.trim() || "Unlabeled";
    const current = bySpeaker.get(speaker) ?? {
      id: speaker,
      turnCount: 0,
      questionCount: 0,
      answerCount: 0,
    };
    current.turnCount += 1;
    if (segment.segmentType === "question") current.questionCount += 1;
    if (segment.segmentType === "answer") current.answerCount += 1;
    bySpeaker.set(speaker, current);
  }
  return [...bySpeaker.values()].sort(
    (left, right) => right.turnCount - left.turnCount || left.id.localeCompare(right.id),
  );
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeReviewLenses(value: unknown): Record<ReviewLensId, boolean> {
  const fallback: Record<ReviewLensId, boolean> = {
    "speaker-segmentation": true,
    "named-entity-extraction": true,
  };
  if (!value || typeof value !== "object") return fallback;
  return {
    "speaker-segmentation":
      typeof Reflect.get(value, "speaker-segmentation") === "boolean"
        ? Boolean(Reflect.get(value, "speaker-segmentation"))
        : fallback["speaker-segmentation"],
    "named-entity-extraction":
      typeof Reflect.get(value, "named-entity-extraction") === "boolean"
        ? Boolean(Reflect.get(value, "named-entity-extraction"))
        : fallback["named-entity-extraction"],
  };
}

function toProcessedReviewRecord(record: RecordModel): ProcessedDocumentReviewRecord {
  return {
    id: record.id,
    projectId: String(record.project ?? ""),
    documentId: String(record.document ?? ""),
    documentName: String(record.document_name ?? ""),
    filePath: String(record.file_path ?? ""),
    status: record.status === "reviewed" ? "reviewed" : "pending_review",
    processedContent: String(record.processed_content ?? ""),
    segments: parseJsonValue<TranscriptProcessingSegment[]>(record.segments_json, []),
    properNameCandidates: parseJsonValue<TranscriptNameCandidate[]>(record.proper_name_candidates_json, []),
    enabledReviewLenses: normalizeReviewLenses(
      parseJsonValue<Record<string, boolean> | null>(record.enabled_review_lenses_json, null),
    ),
    model: String(record.model ?? ""),
    baseUrl: String(record.base_url ?? ""),
    chunkCount: Number(record.chunk_count ?? 0),
    exportedToProject: Boolean(record.exported_to_project),
    createdAt: String(record.created ?? ""),
    updatedAt: String(record.updated ?? ""),
  };
}

function ReviewResultsPanel({
  reviewSegments,
  setReviewSegments,
  properNameCandidates,
  enabledReviewLenses,
  activeReviewTab,
  onChangeReviewTab,
}: {
  reviewSegments: TranscriptProcessingSegment[];
  setReviewSegments: React.Dispatch<React.SetStateAction<TranscriptProcessingSegment[]>>;
  properNameCandidates: TranscriptNameCandidate[];
  enabledReviewLenses: Record<ReviewLensId, boolean>;
  activeReviewTab: ReviewLensId;
  onChangeReviewTab: (tab: ReviewLensId) => void;
}) {
  const visibleReviewTabs = useMemo(
    () => REVIEW_LENSES.filter((lens) => enabledReviewLenses[lens.id]),
    [enabledReviewLenses],
  );

  const speakerSummaries = useMemo(
    () => collectSpeakerSummaries(reviewSegments),
    [reviewSegments],
  );

  function updateReviewSegment(index: number, updates: Partial<TranscriptProcessingSegment>) {
    setReviewSegments((current) =>
      current.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, ...updates } : segment,
      ),
    );
  }

  function removeReviewSegment(index: number) {
    setReviewSegments((current) => current.filter((_, segmentIndex) => segmentIndex !== index));
  }

  return (
    <div className="ai-process-doc-column-body ai-process-doc-column-body--review">
      <div
        className="segmented-control ai-process-doc-tablist"
        role="tablist"
        aria-label="Processing review sections"
      >
        {visibleReviewTabs.map((lens) => (
          <button
            key={lens.id}
            type="button"
            role="tab"
            aria-selected={activeReviewTab === lens.id}
            className={
              activeReviewTab === lens.id
                ? "segmented-control-option segmented-control-option--active"
                : "segmented-control-option"
            }
            onClick={() => onChangeReviewTab(lens.id)}
          >
            {lens.label}
          </button>
        ))}
      </div>

      {activeReviewTab === "speaker-segmentation" && (
        <div className="ai-process-doc-review-section">
          <div className="ai-process-doc-review-summary">
            <strong>{speakerSummaries.length}</strong>
            <span>speakers or speaker labels identified</span>
          </div>
          <div className="ai-process-doc-review-grid">
            <div className="surface-card ai-process-doc-segment-review-card">
              <div className="surface-card-title">Segment Review</div>
              <div className="ai-process-doc-segment-list">
                {reviewSegments.length === 0 ? (
                  <div className="empty-state ai-process-doc-empty">
                    <p>No elements remain in this review.</p>
                  </div>
                ) : (
                  reviewSegments.map((segment, index) => (
                    <article key={`${segment.sortOrder}-${index}`} className="ai-process-doc-segment">
                      <div className="ai-process-doc-segment-meta">
                        <span
                          className={`role-badge role-badge--${
                            segment.segmentType === "question"
                              ? "editor"
                              : segment.segmentType === "metadata"
                                ? "viewer"
                                : "coder"
                          }`}
                        >
                          {segment.segmentType}
                        </span>
                        <label className="ai-process-doc-segment-tag-select" aria-label="Element tag">
                          <select
                            className="form-select"
                            value={segment.segmentType}
                            onChange={(e) =>
                              updateReviewSegment(index, {
                                segmentType: e.target.value as SegmentType,
                              })
                            }
                          >
                            <option value="metadata">metadata</option>
                            <option value="question">question</option>
                            <option value="answer">answer</option>
                          </select>
                        </label>
                        {segment.segmentType !== "metadata" && segmentContainsTimestamp(segment) && (
                          <span className="role-badge role-badge--viewer">Metadata</span>
                        )}
                        <button
                          type="button"
                          className="btn btn--ghost ai-process-doc-segment-delete"
                          onClick={() => removeReviewSegment(index)}
                        >
                          Delete
                        </button>
                      </div>
                      <div className="ai-process-doc-segment-editor">
                        <label className="form-label">
                          Speaker
                          <input
                            className="form-input"
                            value={segment.speakerId}
                            onChange={(e) =>
                              updateReviewSegment(index, { speakerId: e.target.value })
                            }
                            placeholder="Unlabeled speaker"
                          />
                        </label>
                      </div>
                      <label className="form-label ai-process-doc-segment-text-field">
                        Element text
                        <textarea
                          className="form-input ai-process-doc-segment-textarea"
                          value={segment.text}
                          onChange={(e) => updateReviewSegment(index, { text: e.target.value })}
                          rows={5}
                        />
                      </label>
                      <div className="ai-process-doc-segment-footnote">
                        {segment.speakerId.trim() || "Unlabeled speaker"}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeReviewTab === "named-entity-extraction" && (
        <div className="ai-process-doc-review-section">
          <div className="ai-process-doc-review-summary">
            <strong>{properNameCandidates.length}</strong>
            <span>likely speaker-name candidates surfaced for review</span>
          </div>
          <div className="surface-card">
            <div className="surface-card-title">Name Candidates</div>
            {properNameCandidates.length === 0 ? (
              <p className="surface-card-description">
                No likely real speaker names were detected in transcript labels.
              </p>
            ) : (
              <div className="ai-process-doc-chip-list">
                {properNameCandidates.map((candidate, index) => (
                  <div key={`${candidate.text}-${index}`} className="ai-process-doc-chip-card">
                    <strong>{candidate.text}</strong>
                    <span>
                      {candidate.sourceType === "speaker" ? "Speaker label" : "Transcript text"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
void ReviewResultsPanel;

export function AIAssistProcessDocumentsView() {
  const {
    activeProject,
    documents,
    pb,
    setView,
    canCurrentUser,
    startBackgroundDocumentProcessing,
    documentProcessingStatus,
    projectAiAssistSettings,
  } = useStore();
  const canUseAiProcessDocuments = canCurrentUser("useAiProcessDocuments");
  const canReviewProcessedDocuments = canCurrentUser("reviewProcessedDocuments");
  const aiAssistEnabledForProject = activeProject ? projectAiAssistSettings.enabled : false;
  const [helpOpen, setHelpOpen] = useState(false);
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const [reviewWorkspaceOpen, setReviewWorkspaceOpen] = useState(false);
  const [documentQuery, setDocumentQuery] = useState("");
  const [selectedProcessDocumentIds, setSelectedProcessDocumentIds] = useState<string[]>([]);
  const [processError, setProcessError] = useState("");
  const [processReviewLenses, setProcessReviewLenses] = useState<Record<ReviewLensId, boolean>>({
    "speaker-segmentation": true,
    "named-entity-extraction": true,
  });
  const [reviewRecords, setReviewRecords] = useState<ProcessedDocumentReviewRecord[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [selectedReviewRecord, setSelectedReviewRecord] =
    useState<ProcessedDocumentReviewRecord | null>(null);
  const [selectedReviewSegments, setSelectedReviewSegments] = useState<TranscriptProcessingSegment[]>([]);
  const [selectedReviewActiveTab, setSelectedReviewActiveTab] =
    useState<ReviewLensId>("speaker-segmentation");
  const [saveReviewBusy, setSaveReviewBusy] = useState(false);
  const [saveReviewError, setSaveReviewError] = useState("");
  const lastDocumentProcessingPhase = useRef<string | null>(null);
  void setReviewWorkspaceOpen;
  void loadingReviews;
  void reviewError;
  void selectedReviewActiveTab;
  void saveReviewBusy;
  void saveReviewError;

  const processBusy =
    documentProcessingStatus?.phase === "running" &&
    documentProcessingStatus.projectId === activeProject?.id;

  useEffect(() => {
    if (!processModalOpen) {
      setDocumentQuery("");
      setSelectedProcessDocumentIds([]);
      setProcessError("");
      if (!processBusy) {
        setProcessReviewLenses({
          "speaker-segmentation": true,
          "named-entity-extraction": true,
        });
      }
    }
  }, [processModalOpen, processBusy]);

  const visibleDocuments = useMemo(() => {
    const query = documentQuery.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((document) => {
      const haystack = `${document.name} ${document.filePath}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [documentQuery, documents]);

  const selectedProcessDocuments = useMemo(
    () => documents.filter((document) => selectedProcessDocumentIds.includes(document.id)),
    [documents, selectedProcessDocumentIds],
  );

  const pendingReviewCount = useMemo(
    () => reviewRecords.filter((record) => record.status === "pending_review").length,
    [reviewRecords],
  );
  const processedReviewByDocumentId = useMemo(
    () => new Map(reviewRecords.map((record) => [record.documentId, record])),
    [reviewRecords],
  );
  const selectedReviewSpeakerSummaries = useMemo(
    () => collectSpeakerSummaries(selectedReviewSegments),
    [selectedReviewSegments],
  );
  void selectedReviewSpeakerSummaries;

  useEffect(() => {
    const phase = documentProcessingStatus?.phase ?? null;
    const previousPhase = lastDocumentProcessingPhase.current;
    lastDocumentProcessingPhase.current = phase;
    if (
      documentProcessingStatus?.projectId === activeProject?.id &&
      (phase === "completed" || phase === "error") &&
      phase !== previousPhase
    ) {
      void loadReviewRecords();
    }
  }, [activeProject?.id, documentProcessingStatus]);

  useEffect(() => {
    if (!reviewWorkspaceOpen) return;
    if (selectedReviewRecord) {
      const refreshed = reviewRecords.find((record) => record.id === selectedReviewRecord.id);
      if (refreshed) {
        setSelectedReviewRecord(refreshed);
      }
      return;
    }
    if (reviewRecords.length > 0) {
      openReviewRecord(reviewRecords[0]);
    }
  }, [reviewWorkspaceOpen, reviewRecords]);

  async function loadReviewRecords() {
    if (!activeProject) {
      setReviewRecords([]);
      return;
    }
    setLoadingReviews(true);
    setReviewError("");
    try {
      const records = await pb.collection(REVIEW_COLLECTION).getFullList({
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        sort: "-updated",
      });
      setReviewRecords(records.map(toProcessedReviewRecord));
    } catch (nextError) {
      console.error("Failed to load processed document reviews:", nextError);
      setReviewError("Could not load processed documents for review.");
    } finally {
      setLoadingReviews(false);
    }
  }

  useEffect(() => {
    void loadReviewRecords();
  }, [activeProject?.id]);

  function toggleProcessDocumentSelection(documentId: string) {
    setSelectedProcessDocumentIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  }

  function toggleProcessReviewLens(lensId: ReviewLensId) {
    setProcessReviewLenses((current) => {
      const enabledCount = Object.values(current).filter(Boolean).length;
      if (current[lensId] && enabledCount === 1) return current;
      return { ...current, [lensId]: !current[lensId] };
    });
  }

  async function handleRunProcessingSelection() {
    if (!activeProject || selectedProcessDocuments.length === 0 || !canUseAiProcessDocuments) return;
    setProcessError("");
    try {
      await startBackgroundDocumentProcessing({
        projectId: activeProject.id,
        documentIds: selectedProcessDocuments.map((document) => document.id),
        reviewLenses: processReviewLenses,
      });
      setProcessModalOpen(false);
    } catch (nextError) {
      console.error("Failed to start background document processing:", nextError);
      setProcessError(describeProcessingError(nextError));
    }
  }

  function openReviewRecord(record: ProcessedDocumentReviewRecord) {
    setSelectedReviewRecord(record);
    setSelectedReviewSegments(record.segments);
    const firstEnabledLens =
      REVIEW_LENSES.find((lens) => record.enabledReviewLenses[lens.id])?.id ??
      "speaker-segmentation";
    setSelectedReviewActiveTab(firstEnabledLens);
    setSaveReviewError("");
  }

  async function handleSaveReview() {
    if (!selectedReviewRecord) return;
    setSaveReviewBusy(true);
    setSaveReviewError("");
    try {
      await pb.collection(REVIEW_COLLECTION).update(selectedReviewRecord.id, {
        segments_json: JSON.stringify(selectedReviewSegments),
        status: "reviewed",
      });
      const nextRecord: ProcessedDocumentReviewRecord = {
        ...selectedReviewRecord,
        segments: selectedReviewSegments,
        status: "reviewed",
        updatedAt: new Date().toISOString(),
      };
      setSelectedReviewRecord(nextRecord);
      setReviewRecords((current) =>
        current.map((record) => (record.id === nextRecord.id ? nextRecord : record)),
      );
      setSelectedReviewRecord(nextRecord);
    } catch (nextError) {
      console.error("Failed to save processed document review:", nextError);
      setSaveReviewError("Could not save review changes.");
    } finally {
      setSaveReviewBusy(false);
    }
  }
  void handleSaveReview;

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Process Documents</h1>
        </header>
        <div className="empty-state">
          <p>Open a project first.</p>
        </div>
      </div>
    );
  }

  if (!canUseAiProcessDocuments && !canReviewProcessedDocuments) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Process Documents</h1>
        </header>
        <div className="empty-state">
          <p>You do not have permission to use AI Assist document processing for this project.</p>
        </div>
      </div>
    );
  }

  if (!aiAssistEnabledForProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Process Documents</h1>
        </header>
        <div className="empty-state">
          <p>Enable AI Assist in Project Settings before using AI document processing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view ai-process-doc-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Process Documents</h1>
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

      <div className="ai-process-doc-home-grid">
          <section className="surface-card ai-process-doc-home-card">
            <div className="surface-card-header">
              <div>
                <div className="surface-card-title">Process Documents</div>
                <p className="surface-card-description">
                  Select one or more documents and send them to Ollama for transcript processing.
                </p>
              </div>
            </div>
            <div className="ai-process-doc-home-copy">
              <span>{documents.length} document{documents.length === 1 ? "" : "s"} available</span>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={processBusy || !canUseAiProcessDocuments}
                onClick={() => setProcessModalOpen(true)}
                title={!canUseAiProcessDocuments ? "You do not have permission to process documents" : undefined}
              >
                {processBusy ? "Processing" : "Process Documents"}
              </button>
            </div>
          </section>

          <section className="surface-card ai-process-doc-home-card">
            <div className="surface-card-header">
              <div>
                <div className="surface-card-title">Review</div>
                <p className="surface-card-description">
                  Open the processed-document review queue and continue reviewing saved outputs.
                </p>
              </div>
            </div>
            <div className="ai-process-doc-home-copy">
              <span>{reviewRecords.length} processed document{reviewRecords.length === 1 ? "" : "s"}</span>
              <span>{pendingReviewCount} pending review</span>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                disabled={!canReviewProcessedDocuments}
                onClick={() => setView("ai-assist-process-documents-review")}
                title={!canReviewProcessedDocuments ? "You do not have permission to review processed documents" : undefined}
              >
                Open Review
              </button>
            </div>
          </section>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>Process Documents Help</h2>
            <p className="users-guide-copy">
              Select one or more documents, choose processing options, submit processing, monitor progress, and return later to review saved results.
            </p>
            <p className="users-guide-copy">
              Use this page to send supported transcripts or documents through the document-processing workflow. Start the run here, then open the review page to inspect and clean the output.
            </p>
            <p className="users-guide-copy">
              Processing may run through host-executed AI in collaborative sessions. A batch can continue even if one document fails, and failures are surfaced in the banner.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {processModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => {
            setProcessModalOpen(false);
          }}
        >
          <div className="modal modal--wide ai-process-doc-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Process Documents</h2>
            <div className="ai-process-doc-modal-layout">
              <div>
                <label className="form-label">
                  Find documents
                  <input
                    className="form-input"
                    value={documentQuery}
                    onChange={(e) => setDocumentQuery(e.target.value)}
                    placeholder="Search documents"
                    disabled={processBusy}
                  />
                </label>
                <div className="case-card">
                  <div className="memo-card-header">
                    <h3 className="case-card-title" style={{ margin: 0 }}>
                      Documents{selectedProcessDocumentIds.length > 0 ? ` (${selectedProcessDocumentIds.length})` : ""}
                    </h3>
                  </div>
                  {visibleDocuments.length > 0 && (
                    <div style={{ padding: "2px 14px 4px", display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 11, padding: "1px 8px" }}
                        disabled={processBusy}
                        onClick={() => setSelectedProcessDocumentIds(visibleDocuments.map((document) => document.id))}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 11, padding: "1px 8px" }}
                        disabled={processBusy || selectedProcessDocumentIds.length === 0}
                        onClick={() => setSelectedProcessDocumentIds([])}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                  <ul className="memo-sel-list">
                    {visibleDocuments.length === 0 ? (
                      <li className="memo-sel-empty">No matching documents.</li>
                    ) : (
                      visibleDocuments.map((document) => {
                        const checked = selectedProcessDocumentIds.includes(document.id);
                        const processedReview = processedReviewByDocumentId.get(document.id);
                        return (
                          <li
                            key={document.id}
                            className={`memo-sel-item${checked ? " memo-sel-item--checked" : ""}`}
                            onClick={() => {
                              if (!processBusy) toggleProcessDocumentSelection(document.id);
                            }}
                          >
                            <input
                              type="checkbox"
                              className="memo-sel-checkbox"
                              checked={checked}
                              onChange={() => toggleProcessDocumentSelection(document.id)}
                              onClick={(e) => e.stopPropagation()}
                              disabled={processBusy}
                            />
                            <span className="memo-sel-item-text">
                              <span className="memo-sel-item-label">{document.name || "Untitled document"}</span>
                              <span className="memo-sel-item-sub">{document.filePath || "-"}</span>
                            </span>
                            <span className="memo-sel-item-status-col">
                              <span
                                className={`memo-sel-item-status-badge${
                                  processedReview
                                    ? processedReview.status === "reviewed"
                                      ? " memo-sel-item-status-badge--reviewed"
                                      : " memo-sel-item-status-badge--pending"
                                    : " memo-sel-item-status-badge--none"
                                }`}
                                title={
                                  processedReview
                                    ? processedReview.status === "reviewed"
                                      ? "A reviewed processed version is already saved for this document"
                                      : "A processed version is already saved and still pending review"
                                    : "No processed version is currently saved for this document"
                                }
                              >
                                {processedReview
                                  ? processedReview.status === "reviewed"
                                    ? "Reviewed"
                                    : "Pending"
                                  : "None"}
                              </span>
                            </span>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>

                <div className="surface-card">
                  <div className="surface-card-header">
                    <div>
                      <div className="surface-card-title">Settings</div>
                      <p className="surface-card-description">
                        Choose which review outputs to save with each processed document.
                      </p>
                    </div>
                  </div>
                  <div className="ai-process-doc-lenses">
                    {REVIEW_LENSES.map((lens) => (
                      <label key={lens.id} className="ai-process-doc-lens">
                        <input
                          type="checkbox"
                          checked={processReviewLenses[lens.id]}
                          onChange={() => toggleProcessReviewLens(lens.id)}
                          disabled={processBusy}
                        />
                        <span>
                          <strong>{lens.label}</strong>
                          <small>{lens.description}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {processBusy && documentProcessingStatus && (
                  <div className="surface-card ai-process-doc-progress-card">
                    <div className="surface-card-title">
                      Processing {documentProcessingStatus.completedDocuments + 1} of {documentProcessingStatus.totalDocuments}
                    </div>
                    <div className="ai-segments-search-state">
                      <div className="ai-segments-progress" aria-hidden="true">
                        <span className="ai-segments-progress-bar" />
                      </div>
                      <div className="ai-segments-search-copy">
                        {documentProcessingStatus.currentDocumentName || "Selected documents"} are being processed in the background.
                      </div>
                    </div>
                  </div>
                )}

                {processError && <div className="form-error project-settings-error">{processError}</div>}
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setProcessModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={processBusy || selectedProcessDocumentIds.length === 0}
                onClick={() => void handleRunProcessingSelection()}
              >
                {processBusy ? "Processing" : "Run"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
