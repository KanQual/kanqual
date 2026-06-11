import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../context/StoreContext";
import { HelpIcon } from "../components/AppIcons";
import { useI18n } from "../i18n/provider";
import {
  collectSpeakerSummaries,
  DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES,
  getFirstEnabledProcessedReviewLens,
  PROCESSED_DOCUMENT_REVIEW_COLLECTION,
  PROCESSED_DOCUMENT_REVIEW_LENSES as REVIEW_LENSES,
  segmentContainsTimestamp,
  toProcessedReviewRecord,
  type ProcessedDocumentReviewLensId as ReviewLensId,
  type ProcessedDocumentReviewRecord,
  type TranscriptNameCandidate,
  type TranscriptProcessingSegment,
} from "../lib/processedDocumentReviews";

type SegmentType = TranscriptProcessingSegment["segmentType"];

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
  return "";
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
  const { t } = useI18n();
  function getLensLabel(lensId: ReviewLensId) {
    return t(`aiAssist.processDocuments.review.lenses.${lensId}.label`);
  }
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
        aria-label={t("aiAssist.processDocuments.review.tabsAriaLabel")}
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
            {getLensLabel(lens.id)}
          </button>
        ))}
      </div>

      {activeReviewTab === "speaker-segmentation" && (
        <div className="ai-process-doc-review-section">
          <div className="ai-process-doc-review-summary">
            <strong>{speakerSummaries.length}</strong>
            <span>{t("aiAssist.processDocuments.review.speakerSummary", { count: speakerSummaries.length })}</span>
          </div>
          <div className="ai-process-doc-review-grid">
            <div className="surface-card ai-process-doc-segment-review-card">
              <div className="surface-card-title">{t("aiAssist.processDocuments.review.segmentReview")}</div>
              <div className="ai-process-doc-segment-list">
                {reviewSegments.length === 0 ? (
                  <div className="empty-state ai-process-doc-empty">
                    <p>{t("aiAssist.processDocuments.review.noElementsRemain")}</p>
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
                          {t(`aiAssist.processDocuments.review.segmentTypes.${segment.segmentType}`)}
                        </span>
                        <label
                          className="ai-process-doc-segment-tag-select"
                          aria-label={t("aiAssist.processDocuments.review.elementTag")}
                        >
                          <select
                            className="form-select"
                            value={segment.segmentType}
                            onChange={(e) =>
                              updateReviewSegment(index, {
                                segmentType: e.target.value as SegmentType,
                              })
                            }
                          >
                            <option value="metadata">{t("aiAssist.processDocuments.review.segmentTypes.metadata")}</option>
                            <option value="question">{t("aiAssist.processDocuments.review.segmentTypes.question")}</option>
                            <option value="answer">{t("aiAssist.processDocuments.review.segmentTypes.answer")}</option>
                          </select>
                        </label>
                        {segment.segmentType !== "metadata" && segmentContainsTimestamp(segment) && (
                          <span className="role-badge role-badge--viewer">{t("aiAssist.processDocuments.review.metadataBadge")}</span>
                        )}
                        <button
                          type="button"
                          className="btn btn--ghost ai-process-doc-segment-delete"
                          onClick={() => removeReviewSegment(index)}
                        >
                          {t("aiAssist.processDocuments.review.delete")}
                        </button>
                      </div>
                      <div className="ai-process-doc-segment-editor">
                        <label className="form-label">
                          {t("aiAssist.processDocuments.review.speaker")}
                          <input
                            className="form-input"
                            value={segment.speakerId}
                            onChange={(e) =>
                              updateReviewSegment(index, { speakerId: e.target.value })
                            }
                            placeholder={t("aiAssist.processDocuments.review.unlabeledSpeaker")}
                          />
                        </label>
                        {segment.timestampText.trim() && (
                          <div className="ai-process-doc-segment-timestamp">
                            {segment.timestampText.trim()}
                          </div>
                        )}
                      </div>
                      <label className="form-label ai-process-doc-segment-text-field">
                        {t("aiAssist.processDocuments.review.elementText")}
                        <textarea
                          className="form-input ai-process-doc-segment-textarea"
                          value={segment.text}
                          onChange={(e) => updateReviewSegment(index, { text: e.target.value })}
                          rows={5}
                        />
                      </label>
                      <div className="ai-process-doc-segment-footnote">
                        {segment.speakerId.trim() || t("aiAssist.processDocuments.review.unlabeledSpeaker")}
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
            <span>{t("aiAssist.processDocuments.review.nameCandidateSummary", { count: properNameCandidates.length })}</span>
          </div>
          <div className="surface-card">
            <div className="surface-card-title">{t("aiAssist.processDocuments.review.nameCandidates")}</div>
            {properNameCandidates.length === 0 ? (
              <p className="surface-card-description">
                {t("aiAssist.processDocuments.review.noSpeakerNamesDetected")}
              </p>
            ) : (
              <div className="ai-process-doc-chip-list">
                {properNameCandidates.map((candidate, index) => (
                  <div key={`${candidate.text}-${index}`} className="ai-process-doc-chip-card">
                    <strong>{candidate.text}</strong>
                    <span>
                      {candidate.sourceType === "speaker"
                        ? t("aiAssist.processDocuments.review.speakerLabel")
                        : t("aiAssist.processDocuments.review.transcriptText")}
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
  const { t } = useI18n();
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
    ...DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES,
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
        setProcessReviewLenses({ ...DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES });
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
      const records = await pb.collection(PROCESSED_DOCUMENT_REVIEW_COLLECTION).getFullList({
        filter: `project="${activeProject.id}"&&deleted_at=""`,
        sort: "-updated",
      });
      setReviewRecords(records.map(toProcessedReviewRecord));
    } catch (nextError) {
      console.error("Failed to load processed document reviews:", nextError);
      setReviewError(t("aiAssist.processDocuments.errors.failedToLoadReviews"));
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

  async function handleRunProcessingSelection(options?: { restart?: boolean }) {
    if (!activeProject || selectedProcessDocuments.length === 0 || !canUseAiProcessDocuments) return;
    setProcessError("");
    try {
      await startBackgroundDocumentProcessing({
        projectId: activeProject.id,
        documentIds: selectedProcessDocuments.map((document) => document.id),
        reviewLenses: processReviewLenses,
        restartDocumentIds: options?.restart
          ? selectedProcessDocuments.map((document) => document.id)
          : undefined,
      });
      setProcessModalOpen(false);
    } catch (nextError) {
      console.error("Failed to start background document processing:", nextError);
      setProcessError(describeProcessingError(nextError) || t("aiAssist.processDocuments.errors.failedToStart"));
    }
  }

  function openReviewRecord(record: ProcessedDocumentReviewRecord) {
    setSelectedReviewRecord(record);
    setSelectedReviewSegments(record.segments);
    setSelectedReviewActiveTab(getFirstEnabledProcessedReviewLens(record.enabledReviewLenses));
    setSaveReviewError("");
  }

  async function handleSaveReview() {
    if (!selectedReviewRecord) return;
    setSaveReviewBusy(true);
    setSaveReviewError("");
    try {
      await pb.collection(PROCESSED_DOCUMENT_REVIEW_COLLECTION).update(selectedReviewRecord.id, {
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
      setSaveReviewError(t("aiAssist.processDocuments.errors.failedToSaveReview"));
    } finally {
      setSaveReviewBusy(false);
    }
  }
  void handleSaveReview;

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.processDocuments.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.processDocuments.empty.openProjectFirst")}</p>
        </div>
      </div>
    );
  }

  if (!canUseAiProcessDocuments && !canReviewProcessedDocuments) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.processDocuments.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.processDocuments.empty.noPermission")}</p>
        </div>
      </div>
    );
  }

  if (!aiAssistEnabledForProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.processDocuments.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.processDocuments.empty.enableInProjectSettings")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view ai-process-doc-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("aiAssist.processDocuments.pageTitle")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("aiAssist.processDocuments.openHelp")}
            aria-label={t("aiAssist.processDocuments.openHelp")}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      <div className="ai-process-doc-home-grid">
          <section className="surface-card ai-process-doc-home-card">
            <div className="surface-card-header">
              <div>
                <div className="surface-card-title">{t("aiAssist.processDocuments.pageTitle")}</div>
                <p className="surface-card-description">
                  {t("aiAssist.processDocuments.home.processBody")}
                </p>
              </div>
            </div>
            <div className="ai-process-doc-home-copy">
              <span>{t("aiAssist.processDocuments.home.documentsAvailable", { count: documents.length })}</span>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={processBusy || !canUseAiProcessDocuments}
                onClick={() => setProcessModalOpen(true)}
                title={!canUseAiProcessDocuments ? t("aiAssist.processDocuments.empty.noPermissionToProcess") : undefined}
              >
                {processBusy ? t("aiAssist.processDocuments.statuses.processing") : t("aiAssist.processDocuments.actions.processDocuments")}
              </button>
            </div>
          </section>

          <section className="surface-card ai-process-doc-home-card">
            <div className="surface-card-header">
              <div>
                <div className="surface-card-title">{t("aiAssist.processDocuments.review.title")}</div>
                <p className="surface-card-description">
                  {t("aiAssist.processDocuments.home.reviewBody")}
                </p>
              </div>
            </div>
            <div className="ai-process-doc-home-copy">
              <span>{t("aiAssist.processDocuments.home.processedDocumentsCount", { count: reviewRecords.length })}</span>
              <span>{t("aiAssist.processDocuments.home.pendingReviewCount", { count: pendingReviewCount })}</span>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                disabled={!canReviewProcessedDocuments}
                onClick={() => setView("ai-assist-process-documents-review")}
                title={!canReviewProcessedDocuments ? t("aiAssist.processDocuments.empty.noPermissionToReview") : undefined}
              >
                {t("aiAssist.processDocuments.actions.openReview")}
              </button>
            </div>
          </section>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>{t("aiAssist.processDocuments.help.title")}</h2>
            <p className="users-guide-copy">
              {t("aiAssist.processDocuments.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.processDocuments.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.processDocuments.help.line3")}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
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
            <h2>{t("aiAssist.processDocuments.actions.processDocuments")}</h2>
            <div className="ai-process-doc-modal-layout">
              <div>
                <label className="form-label">
                  {t("aiAssist.processDocuments.labels.findDocuments")}
                  <input
                    className="form-input"
                    value={documentQuery}
                    onChange={(e) => setDocumentQuery(e.target.value)}
                    placeholder={t("aiAssist.processDocuments.labels.searchDocuments")}
                    disabled={processBusy}
                  />
                </label>
                <div className="case-card">
                  <div className="memo-card-header">
                    <h3 className="case-card-title" style={{ margin: 0 }}>
                      {t("aiAssist.processDocuments.labels.documents")}{selectedProcessDocumentIds.length > 0 ? ` (${selectedProcessDocumentIds.length})` : ""}
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
                        {t("aiAssist.processDocuments.labels.all")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 11, padding: "1px 8px" }}
                        disabled={processBusy || selectedProcessDocumentIds.length === 0}
                        onClick={() => setSelectedProcessDocumentIds([])}
                      >
                        {t("aiAssist.processDocuments.labels.clear")}
                      </button>
                    </div>
                  )}
                  <ul className="memo-sel-list">
                    {visibleDocuments.length === 0 ? (
                      <li className="memo-sel-empty">{t("aiAssist.processDocuments.empty.noMatchingDocuments")}</li>
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
                              <span className="memo-sel-item-label">{document.name || t("aiAssist.processDocuments.labels.untitledDocument")}</span>
                              <span className="memo-sel-item-sub">{document.filePath || "-"}</span>
                            </span>
                            <span className="memo-sel-item-status-col">
                              <span
                                className={`memo-sel-item-status-badge${
                                  processedReview
                                    ? processedReview.status === "reviewed"
                                      ? " memo-sel-item-status-badge--reviewed"
                                      : processedReview.processingStatus === "partial" || processedReview.processingStatus === "error"
                                        ? " memo-sel-item-status-badge--pending"
                                        : " memo-sel-item-status-badge--pending"
                                    : " memo-sel-item-status-badge--none"
                                }`}
                                title={
                                  processedReview
                                    ? processedReview.status === "reviewed"
                                      ? t("aiAssist.processDocuments.statuses.reviewedSaved")
                                      : processedReview.processingStatus === "partial"
                                        ? t("aiAssist.processDocuments.statuses.partialSaved", { completed: processedReview.processedChunkCount, total: processedReview.chunkCount })
                                        : processedReview.processingStatus === "error"
                                          ? processedReview.processingError || t("aiAssist.processDocuments.statuses.processingFailedBeforeCompletion")
                                          : t("aiAssist.processDocuments.statuses.pendingSaved")
                                    : t("aiAssist.processDocuments.statuses.noneSaved")
                                }
                              >
                                {processedReview
                                  ? processedReview.status === "reviewed"
                                    ? t("aiAssist.processDocuments.statuses.reviewed")
                                    : processedReview.processingStatus === "partial"
                                      ? t("aiAssist.processDocuments.statuses.partial")
                                      : processedReview.processingStatus === "error"
                                        ? t("aiAssist.processDocuments.statuses.failed")
                                        : t("aiAssist.processDocuments.statuses.pending")
                                  : t("aiAssist.processDocuments.statuses.none")}
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
                      <div className="surface-card-title">{t("aiAssist.processDocuments.labels.settings")}</div>
                      <p className="surface-card-description">
                        {t("aiAssist.processDocuments.labels.settingsBody")}
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
                          <strong>{t(`aiAssist.processDocuments.review.lenses.${lens.id}.label`)}</strong>
                          <small>{t(`aiAssist.processDocuments.review.lenses.${lens.id}.description`)}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {processBusy && documentProcessingStatus && (
                  <div className="surface-card ai-process-doc-progress-card">
                    <div className="surface-card-title">
                      {t("aiAssist.processDocuments.statuses.processingProgress", { current: documentProcessingStatus.completedDocuments + 1, total: documentProcessingStatus.totalDocuments })}
                    </div>
                    <div className="ai-segments-search-state">
                      <div className="ai-segments-progress" aria-hidden="true">
                        <span className="ai-segments-progress-bar" />
                      </div>
                      <div className="ai-segments-search-copy">
                        {t("aiAssist.processDocuments.statuses.processingBackground", { name: documentProcessingStatus.currentDocumentName || t("aiAssist.processDocuments.labels.selectedDocuments") })}
                        {documentProcessingStatus.currentChunkIndex && documentProcessingStatus.currentChunkTotal
                          ? ` ${t("aiAssist.processDocuments.statuses.chunkProgress", {
                              index: documentProcessingStatus.currentChunkIndex,
                              total: documentProcessingStatus.currentChunkTotal,
                            })}`
                          : ""}
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
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn"
                disabled={processBusy || selectedProcessDocumentIds.length === 0}
                onClick={() => void handleRunProcessingSelection({ restart: true })}
              >
                {processBusy ? t("aiAssist.processDocuments.statuses.processing") : t("aiAssist.processDocuments.actions.restartSelected")}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={processBusy || selectedProcessDocumentIds.length === 0}
                onClick={() => void handleRunProcessingSelection()}
              >
                {processBusy ? t("aiAssist.processDocuments.statuses.processing") : t("aiAssist.processDocuments.actions.processResume")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
