import { useEffect, useMemo, useState } from "react";
import { useStore } from "../context/StoreContext";
import { HelpIcon } from "../components/AppIcons";
import { buildProcessedTranscriptContent } from "../components/ProcessedTranscriptView";
import { useI18n } from "../i18n/provider";
import {
  collectSpeakerSummaries,
  formatProcessedReviewDate,
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
function ReviewResultsPanel({
  reviewSegments,
  setReviewSegments,
  properNameCandidates,
  enabledReviewLenses,
  activeReviewTab,
  onChangeReviewTab,
  editable,
}: {
  reviewSegments: TranscriptProcessingSegment[];
  setReviewSegments: React.Dispatch<React.SetStateAction<TranscriptProcessingSegment[]>>;
  properNameCandidates: TranscriptNameCandidate[];
  enabledReviewLenses: Record<ReviewLensId, boolean>;
  activeReviewTab: ReviewLensId;
  onChangeReviewTab: (tab: ReviewLensId) => void;
  editable: boolean;
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
                            disabled={!editable}
                            onChange={(e) =>
                              updateReviewSegment(index, { segmentType: e.target.value as SegmentType })
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
                          disabled={!editable}
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
                            disabled={!editable}
                            onChange={(e) => updateReviewSegment(index, { speakerId: e.target.value })}
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
                          disabled={!editable}
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

export function AIAssistProcessDocumentsReviewView() {
  const { t } = useI18n();
  const {
    activeProject,
    addDocument,
    pb,
    setView,
    deleteDocument,
    logAction,
    canCurrentUser,
    projectAiAssistSettings,
    startBackgroundDocumentProcessing,
    documentProcessingStatus,
  } = useStore();
  const canReviewProcessedDocuments = canCurrentUser("reviewProcessedDocuments");
  const canUseAiProcessDocuments = canCurrentUser("useAiProcessDocuments");
  const canEditAiOutputs = canCurrentUser("editAiOutputs");
  const canSaveAiOutputs = canCurrentUser("saveAiOutputs");
  const canExportAiOutputsToProject = canCurrentUser("exportAiOutputsToProject");
  const canDeleteOriginalDocument = canCurrentUser("deleteDocument");
  const canModifyReview = canEditAiOutputs || canSaveAiOutputs;
  const aiAssistEnabledForProject = activeProject ? projectAiAssistSettings.enabled : false;
  const [helpOpen, setHelpOpen] = useState(false);
  const [reviewRecords, setReviewRecords] = useState<ProcessedDocumentReviewRecord[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [selectedReviewRecord, setSelectedReviewRecord] = useState<ProcessedDocumentReviewRecord | null>(null);
  const [selectedReviewSegments, setSelectedReviewSegments] = useState<TranscriptProcessingSegment[]>([]);
  const [selectedReviewActiveTab, setSelectedReviewActiveTab] = useState<ReviewLensId>("speaker-segmentation");
  const [saveReviewBusy, setSaveReviewBusy] = useState(false);
  const [saveReviewError, setSaveReviewError] = useState("");
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportName, setExportName] = useState("");
  const [exportDescription, setExportDescription] = useState("");
  const [deleteOriginalOnExport, setDeleteOriginalOnExport] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunError, setRerunError] = useState("");

  const processBusy =
    documentProcessingStatus?.phase === "running" &&
    documentProcessingStatus.projectId === activeProject?.id;

  const selectedReviewSpeakerSummaries = useMemo(
    () => collectSpeakerSummaries(selectedReviewSegments),
    [selectedReviewSegments],
  );

  function openReviewRecord(record: ProcessedDocumentReviewRecord) {
    setSelectedReviewRecord(record);
    setSelectedReviewSegments(record.segments);
    setSelectedReviewActiveTab(getFirstEnabledProcessedReviewLens(record.enabledReviewLenses));
    setSaveReviewError("");
    setRerunError("");
  }

  function openExportModal() {
    if (!selectedReviewRecord || !canExportAiOutputsToProject) return;
    setExportName(selectedReviewRecord.documentName || t("aiAssist.processDocuments.review.export.defaultName"));
    setExportDescription("");
    setDeleteOriginalOnExport(false);
    setExportError("");
    setExportModalOpen(true);
  }

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
      const mapped = records.map(toProcessedReviewRecord);
      setReviewRecords(mapped);
      if (!selectedReviewRecord && mapped.length > 0) {
        openReviewRecord(mapped[0]);
      } else if (selectedReviewRecord) {
        const refreshed = mapped.find((record) => record.id === selectedReviewRecord.id);
        if (refreshed) openReviewRecord(refreshed);
      }
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

  async function handleSaveReview() {
    if (!selectedReviewRecord || !canSaveAiOutputs) return;
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
    } catch (nextError) {
      console.error("Failed to save processed document review:", nextError);
      setSaveReviewError(t("aiAssist.processDocuments.errors.failedToSaveReview"));
    } finally {
      setSaveReviewBusy(false);
    }
  }

  async function handleExportToProject() {
    if (!activeProject || !selectedReviewRecord || !canExportAiOutputsToProject) return;
    const nextName = exportName.trim();
    if (!nextName) {
      setExportError(t("aiAssist.processDocuments.errors.enterName"));
      return;
    }

    setExportBusy(true);
    setExportError("");
    try {
      const processedTranscript = buildProcessedTranscriptContent(selectedReviewSegments);
      const created = await addDocument(
        nextName,
        selectedReviewRecord.filePath,
        processedTranscript.content,
        pb.authStore.record?.id ?? "",
        {
          type: "Processed Transcript",
          notes: exportDescription.trim(),
          structuredContentJson: JSON.stringify(processedTranscript.segments),
        },
      );
      if (!created?.id) {
        throw new Error(t("aiAssist.processDocuments.errors.documentNotCreated"));
      }

      await pb.collection(PROCESSED_DOCUMENT_REVIEW_COLLECTION).update(selectedReviewRecord.id, {
        exported_to_project: true,
      });

      if (deleteOriginalOnExport && canDeleteOriginalDocument) {
        await deleteDocument(selectedReviewRecord.documentId, selectedReviewRecord.documentName);
      }

      await logAction(
        activeProject.id,
        "project.ai_processed_document.export",
        t("projectLog.labels.projectAiProcessedDocumentExport", { name: nextName }),
        created.id,
        {
          entityType: "document",
          name: nextName,
          type: "Processed Transcript",
          sourceProcessedReviewId: selectedReviewRecord.id,
          sourceDocumentId: selectedReviewRecord.documentId,
          segmentCount: processedTranscript.segments.length,
          deletedOriginalDocument: deleteOriginalOnExport && canDeleteOriginalDocument,
        },
      );

      const nextRecord: ProcessedDocumentReviewRecord = {
        ...selectedReviewRecord,
        exportedToProject: true,
      };
      setSelectedReviewRecord(nextRecord);
      setReviewRecords((current) =>
        current.map((record) => (record.id === nextRecord.id ? nextRecord : record)),
      );
      setExportModalOpen(false);
    } catch (nextError) {
      console.error("Failed to export processed document:", nextError);
      setExportError(
        nextError instanceof Error ? nextError.message : t("aiAssist.processDocuments.errors.failedToExport"),
      );
    } finally {
      setExportBusy(false);
    }
  }

  async function handleReprocessSelectedRecord(options?: { restart?: boolean }) {
    if (!activeProject || !selectedReviewRecord || !canUseAiProcessDocuments) return;
    setRerunBusy(true);
    setRerunError("");
    try {
      await startBackgroundDocumentProcessing({
        projectId: activeProject.id,
        documentIds: [selectedReviewRecord.documentId],
        reviewLenses: selectedReviewRecord.enabledReviewLenses,
        restartDocumentIds: options?.restart ? [selectedReviewRecord.documentId] : undefined,
      });
    } catch (nextError) {
      console.error("Failed to restart processed document run:", nextError);
      setRerunError(
        nextError instanceof Error ? nextError.message : t("aiAssist.processDocuments.errors.failedToStart"),
      );
    } finally {
      setRerunBusy(false);
    }
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.processDocuments.review.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.processDocuments.empty.openProjectFirst")}</p>
        </div>
      </div>
    );
  }

  if (!canReviewProcessedDocuments) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.processDocuments.review.pageTitle")}</h1>
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
          <h1>{t("aiAssist.processDocuments.review.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.processDocuments.empty.enableInProjectSettings")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view ai-process-doc-view ai-process-doc-view--reviewing">
      <div className="workspace-back-row">
        <button type="button" className="btn" onClick={() => setView("ai-assist-process-documents")}>
          {t("aiAssist.processDocuments.review.backToProcessedDocuments")}
        </button>
      </div>
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("aiAssist.processDocuments.review.pageTitle")}</h1>
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

      <div className="ai-process-doc-review-shell">
        <div className="doc-detail-layout ai-process-doc-review-layout">
          <div className="doc-detail-left ai-process-doc-review-list-panel">
            <div className="surface-card ai-process-doc-review-list-card">
              <div className="surface-card-header">
                <div>
                  <div className="surface-card-title">{t("aiAssist.processDocuments.review.savedDocumentsTitle")}</div>
                  <p className="surface-card-description">
                    {t("aiAssist.processDocuments.review.savedDocumentsBody")}
                  </p>
                </div>
              </div>
              {reviewError && <div className="form-error project-settings-error">{reviewError}</div>}
              <div className="users-table-wrap">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>{t("aiAssist.processDocuments.review.table.name")}</th>
                      <th>{t("aiAssist.processDocuments.review.table.status")}</th>
                      <th>{t("aiAssist.processDocuments.review.table.processed")}</th>
                      <th>{t("aiAssist.processDocuments.review.table.inProject")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingReviews ? (
                      <tr>
                        <td colSpan={4} className="users-td-msg">{t("common.loading")}</td>
                      </tr>
                    ) : reviewRecords.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="users-td-msg">{t("aiAssist.processDocuments.review.noProcessedDocuments")}</td>
                      </tr>
                    ) : (
                      reviewRecords.map((record) => (
                        <tr
                          key={record.id}
                          className={`users-row process-review-row${
                            selectedReviewRecord?.id === record.id ? " assoc-doc-row--selected" : ""
                          }`}
                          onClick={() => openReviewRecord(record)}
                        >
                          <td className="users-td users-td--name">{record.documentName || t("aiAssist.processDocuments.labels.untitledDocument")}</td>
                          <td className="users-td users-td--muted">
                            {record.status === "reviewed"
                              ? t("aiAssist.processDocuments.statuses.reviewed")
                              : record.processingStatus === "partial"
                                ? t("aiAssist.processDocuments.review.partialWithCount", {
                                    completed: record.processedChunkCount,
                                    total: record.chunkCount,
                                  })
                                : record.processingStatus === "error"
                                  ? t("aiAssist.processDocuments.statuses.failed")
                                  : record.processingStatus === "running"
                                    ? t("aiAssist.processDocuments.review.runningWithCount", {
                                        completed: record.processedChunkCount,
                                        total: record.chunkCount,
                                      })
                                    : t("aiAssist.processDocuments.statuses.pending")}
                          </td>
                          <td className="users-td users-td--muted">{formatProcessedReviewDate(record.updatedAt)}</td>
                          <td className="users-td users-td--muted">
                            {record.exportedToProject
                              ? t("aiAssist.processDocuments.review.yes")
                              : t("aiAssist.processDocuments.review.no")}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="doc-detail-right ai-process-doc-review-detail-panel">
            <div className="surface-card ai-process-doc-review-detail-card">
              {!selectedReviewRecord ? (
                <div className="empty-state ai-process-doc-review-empty">
                  <p>{t("aiAssist.processDocuments.review.selectDocumentPrompt")}</p>
                </div>
              ) : (
                <>
                  <div className="ai-process-doc-review-modal-header ai-process-doc-review-modal-header--with-summary">
                    <div>
                      <h2>{selectedReviewRecord.documentName || t("aiAssist.processDocuments.labels.untitledDocument")}</h2>
                      <p className="surface-card-description">
                        {t("aiAssist.processDocuments.review.recordSummary", {
                          model: selectedReviewRecord.model || t("aiAssist.processDocuments.review.unknownModel"),
                          chunkCount: selectedReviewRecord.chunkCount,
                          processedChunkCount: selectedReviewRecord.processedChunkCount,
                          processedAt: formatProcessedReviewDate(selectedReviewRecord.updatedAt),
                        })}
                      </p>
                    </div>
                    {selectedReviewSpeakerSummaries.length > 0 && (
                      <div className="ai-process-doc-summary-strip" aria-label={t("aiAssist.processDocuments.review.segmentSummary")}>
                        {selectedReviewSpeakerSummaries.map((speaker) => (
                          <div key={speaker.id} className="ai-process-doc-summary-chip">
                            <strong>{speaker.id}</strong>
                            <span>{t("aiAssist.processDocuments.review.turnCount", { count: speaker.turnCount })}</span>
                            <small>
                              {t("aiAssist.processDocuments.review.questionAnswerCount", {
                                questions: speaker.questionCount,
                                answers: speaker.answerCount,
                              })}
                            </small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {saveReviewError && <div className="form-error project-settings-error">{saveReviewError}</div>}
                  {rerunError && <div className="form-error project-settings-error">{rerunError}</div>}
                  {selectedReviewRecord.processingStatus === "partial" && (
                    <div className="users-permission-note" style={{ marginBottom: 12 }}>
                      {t("aiAssist.processDocuments.review.partialRun", {
                        completed: selectedReviewRecord.processedChunkCount,
                        total: selectedReviewRecord.chunkCount,
                      })}
                      {selectedReviewRecord.processingError
                        ? ` ${t("aiAssist.processDocuments.review.lastError", {
                            message: selectedReviewRecord.processingError,
                          })}`
                        : ""}
                    </div>
                  )}
                  {selectedReviewRecord.processingStatus === "error" && selectedReviewRecord.processingError && (
                    <div className="form-error project-settings-error">{selectedReviewRecord.processingError}</div>
                  )}

                  <ReviewResultsPanel
                    reviewSegments={selectedReviewSegments}
                    setReviewSegments={setSelectedReviewSegments}
                    properNameCandidates={selectedReviewRecord.properNameCandidates}
                    enabledReviewLenses={selectedReviewRecord.enabledReviewLenses}
                    activeReviewTab={selectedReviewActiveTab}
                    onChangeReviewTab={setSelectedReviewActiveTab}
                    editable={canModifyReview}
                  />

                  <div className="form-actions">
                    {(selectedReviewRecord.processingStatus === "partial" || selectedReviewRecord.processingStatus === "error") && (
                      <button
                        type="button"
                        className="btn"
                        disabled={processBusy || rerunBusy || !canUseAiProcessDocuments}
                        onClick={() => void handleReprocessSelectedRecord()}
                        title={!canUseAiProcessDocuments ? t("aiAssist.processDocuments.empty.noPermissionToProcess") : undefined}
                      >
                        {rerunBusy ? t("aiAssist.processDocuments.review.starting") : t("aiAssist.processDocuments.review.resumeProcessing")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={processBusy || rerunBusy || !canUseAiProcessDocuments}
                      onClick={() => void handleReprocessSelectedRecord({ restart: true })}
                      title={!canUseAiProcessDocuments ? t("aiAssist.processDocuments.empty.noPermissionToProcess") : undefined}
                    >
                      {rerunBusy ? t("aiAssist.processDocuments.review.starting") : t("aiAssist.processDocuments.actions.restartSelected")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={
                        exportBusy
                        || !canExportAiOutputsToProject
                        || selectedReviewRecord.processingStatus !== "completed"
                      }
                      onClick={openExportModal}
                      title={
                        !canExportAiOutputsToProject
                          ? t("aiAssist.processDocuments.review.noPermissionToExport")
                          : selectedReviewRecord.processingStatus !== "completed"
                            ? t("aiAssist.processDocuments.review.onlyCompletedCanExport")
                            : undefined
                      }
                    >
                      {selectedReviewRecord.exportedToProject
                        ? t("aiAssist.processDocuments.review.exportedToProject")
                        : t("aiAssist.processDocuments.review.exportToProject")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={saveReviewBusy || !canSaveAiOutputs}
                      onClick={() => void handleSaveReview()}
                      title={!canSaveAiOutputs ? t("aiAssist.processDocuments.review.noPermissionToSave") : undefined}
                    >
                      {saveReviewBusy ? t("aiAssist.processDocuments.review.saving") : t("aiAssist.processDocuments.review.saveReview")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>{t("aiAssist.processDocuments.review.help.title")}</h2>
            <p className="users-guide-copy">
              {t("aiAssist.processDocuments.review.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.processDocuments.review.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.processDocuments.review.help.line3")}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {exportModalOpen && selectedReviewRecord && (
        <div className="modal-overlay" onClick={() => !exportBusy && setExportModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("aiAssist.processDocuments.review.export.title")}</h2>
            <div className="form">
              <label className="form-label">
                {t("aiAssist.processDocuments.review.export.name")}
                <input
                  className="form-input"
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="form-label">
                {t("aiAssist.processDocuments.review.export.description")}
                <textarea
                  className="form-input"
                  rows={5}
                  value={exportDescription}
                  onChange={(e) => setExportDescription(e.target.value)}
                />
              </label>
              <label className="ai-process-doc-lens">
                <input
                  type="checkbox"
                  checked={deleteOriginalOnExport}
                  onChange={(e) => setDeleteOriginalOnExport(e.target.checked)}
                  disabled={exportBusy || !canDeleteOriginalDocument}
                />
                <span>
                  <strong>{t("aiAssist.processDocuments.review.export.deleteOriginalDocument")}</strong>
                  <small>
                    {canDeleteOriginalDocument
                      ? t("aiAssist.processDocuments.review.export.deleteOriginalAllowed")
                      : t("aiAssist.processDocuments.review.export.deleteOriginalDenied")}
                  </small>
                </span>
              </label>
              {exportError && <div className="form-error project-settings-error">{exportError}</div>}
              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setExportModalOpen(false)}
                  disabled={exportBusy}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleExportToProject()}
                  disabled={exportBusy || !exportName.trim() || !canExportAiOutputsToProject}
                >
                  {exportBusy ? t("aiAssist.processDocuments.review.export.exporting") : t("aiAssist.processDocuments.review.export.action")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
