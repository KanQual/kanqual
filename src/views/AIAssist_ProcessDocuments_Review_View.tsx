import { useEffect, useMemo, useState } from "react";
import { useStore } from "../context/StoreContext";
import { HelpIcon } from "../components/AppIcons";
import { buildProcessedTranscriptContent } from "../components/ProcessedTranscriptView";
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
      <div className="segmented-control ai-process-doc-tablist" role="tablist" aria-label="Processing review sections">
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
                            disabled={!editable}
                            onChange={(e) =>
                              updateReviewSegment(index, { segmentType: e.target.value as SegmentType })
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
                          disabled={!editable}
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
                            disabled={!editable}
                            onChange={(e) => updateReviewSegment(index, { speakerId: e.target.value })}
                            placeholder="Unlabeled speaker"
                          />
                        </label>
                        {segment.timestampText.trim() && (
                          <div className="ai-process-doc-segment-timestamp">
                            {segment.timestampText.trim()}
                          </div>
                        )}
                      </div>
                      <label className="form-label ai-process-doc-segment-text-field">
                        Element text
                        <textarea
                          className="form-input ai-process-doc-segment-textarea"
                          value={segment.text}
                          disabled={!editable}
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
                    <span>{candidate.sourceType === "speaker" ? "Speaker label" : "Transcript text"}</span>
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
    setExportName(selectedReviewRecord.documentName || "Processed transcript");
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
      setReviewError("Could not load processed documents for review.");
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
      setSaveReviewError("Could not save review changes.");
    } finally {
      setSaveReviewBusy(false);
    }
  }

  async function handleExportToProject() {
    if (!activeProject || !selectedReviewRecord || !canExportAiOutputsToProject) return;
    const nextName = exportName.trim();
    if (!nextName) {
      setExportError("Enter a name for the processed document.");
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
        throw new Error("Processed document could not be exported because the document was not created.");
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
        `Exported processed document "${nextName}"`,
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
      setExportError(nextError instanceof Error ? nextError.message : "Could not export processed document.");
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
      setRerunError(nextError instanceof Error ? nextError.message : "Could not start document processing.");
    } finally {
      setRerunBusy(false);
    }
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Process Documents Review</h1>
        </header>
        <div className="empty-state">
          <p>Open a project first.</p>
        </div>
      </div>
    );
  }

  if (!canReviewProcessedDocuments) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Review Processed Documents</h1>
        </header>
        <div className="empty-state">
          <p>You do not have permission to review processed AI outputs for this project.</p>
        </div>
      </div>
    );
  }

  if (!aiAssistEnabledForProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Review Processed Documents</h1>
        </header>
        <div className="empty-state">
          <p>Enable AI Assist in Project Settings before reviewing processed AI outputs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view ai-process-doc-view ai-process-doc-view--reviewing">
      <div className="workspace-back-row">
        <button type="button" className="btn" onClick={() => setView("ai-assist-process-documents")}>
          Back to Processed Documents
        </button>
      </div>
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Review Processed Documents</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Show Help"
            aria-label="Show Help"
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
                  <div className="surface-card-title">Processed Documents</div>
                  <p className="surface-card-description">
                    Review saved processing outputs and continue where you left off.
                  </p>
                </div>
              </div>
              {reviewError && <div className="form-error project-settings-error">{reviewError}</div>}
              <div className="users-table-wrap">
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Processed</th>
                      <th>In Project</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingReviews ? (
                      <tr>
                        <td colSpan={4} className="users-td-msg">Loading...</td>
                      </tr>
                    ) : reviewRecords.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="users-td-msg">No processed documents yet.</td>
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
                          <td className="users-td users-td--name">{record.documentName || "Untitled document"}</td>
                          <td className="users-td users-td--muted">
                            {record.status === "reviewed"
                              ? "Reviewed"
                              : record.processingStatus === "partial"
                                ? `Partial (${record.processedChunkCount}/${record.chunkCount})`
                                : record.processingStatus === "error"
                                  ? "Failed"
                                  : record.processingStatus === "running"
                                    ? `Running (${record.processedChunkCount}/${record.chunkCount})`
                                    : "Pending"}
                          </td>
                          <td className="users-td users-td--muted">{formatProcessedReviewDate(record.updatedAt)}</td>
                          <td className="users-td users-td--muted">{record.exportedToProject ? "Yes" : "No"}</td>
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
                  <p>Select a processed document to review its segments and named entities.</p>
                </div>
              ) : (
                <>
                  <div className="ai-process-doc-review-modal-header ai-process-doc-review-modal-header--with-summary">
                    <div>
                      <h2>{selectedReviewRecord.documentName || "Untitled document"}</h2>
                      <p className="surface-card-description">
                        {selectedReviewRecord.model || "Unknown model"} | {selectedReviewRecord.chunkCount} chunk
                        {selectedReviewRecord.chunkCount === 1 ? "" : "s"} | {selectedReviewRecord.processedChunkCount} processed | Processed {formatProcessedReviewDate(selectedReviewRecord.updatedAt)}
                      </p>
                    </div>
                    {selectedReviewSpeakerSummaries.length > 0 && (
                      <div className="ai-process-doc-summary-strip" aria-label="Segment summary">
                        {selectedReviewSpeakerSummaries.map((speaker) => (
                          <div key={speaker.id} className="ai-process-doc-summary-chip">
                            <strong>{speaker.id}</strong>
                            <span>{speaker.turnCount} turns</span>
                            <small>{speaker.questionCount} q | {speaker.answerCount} a</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {saveReviewError && <div className="form-error project-settings-error">{saveReviewError}</div>}
                  {rerunError && <div className="form-error project-settings-error">{rerunError}</div>}
                  {selectedReviewRecord.processingStatus === "partial" && (
                    <div className="users-permission-note" style={{ marginBottom: 12 }}>
                      This run is partial. {selectedReviewRecord.processedChunkCount} of {selectedReviewRecord.chunkCount} chunks completed.
                      {selectedReviewRecord.processingError ? ` Last error: ${selectedReviewRecord.processingError}` : ""}
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
                        title={!canUseAiProcessDocuments ? "You do not have permission to process documents" : undefined}
                      >
                        {rerunBusy ? "Starting" : "Resume Processing"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn"
                      disabled={processBusy || rerunBusy || !canUseAiProcessDocuments}
                      onClick={() => void handleReprocessSelectedRecord({ restart: true })}
                      title={!canUseAiProcessDocuments ? "You do not have permission to process documents" : undefined}
                    >
                      {rerunBusy ? "Starting" : "Restart Processing"}
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
                          ? "You do not have permission to export AI outputs to the project"
                          : selectedReviewRecord.processingStatus !== "completed"
                            ? "Only completed processed documents can be exported to the project"
                            : undefined
                      }
                    >
                      {selectedReviewRecord.exportedToProject ? "Exported to Project" : "Export to Project"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={saveReviewBusy || !canSaveAiOutputs}
                      onClick={() => void handleSaveReview()}
                      title={!canSaveAiOutputs ? "You do not have permission to save AI output reviews" : undefined}
                    >
                      {saveReviewBusy ? "Saving" : "Save Review"}
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
            <h2>Processed Document Review Help</h2>
            <p className="users-guide-copy">
              Choose a processed document, inspect extracted entities and segments, edit tags, speakers, and text, save the reviewed output, and export reviewed results back into the project.
            </p>
            <p className="users-guide-copy">
              Use this page after processing completes. Pick a saved review record from the list, correct anything that needs cleanup, then save or export the reviewed version.
            </p>
            <p className="users-guide-copy">
              Processed results are saved in a project review queue so they can be revisited later. Exporting reviewed output changes shared project content.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {exportModalOpen && selectedReviewRecord && (
        <div className="modal-overlay" onClick={() => !exportBusy && setExportModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Export to Project</h2>
            <div className="form">
              <label className="form-label">
                Name
                <input
                  className="form-input"
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="form-label">
                Description
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
                  <strong>Delete original document</strong>
                  <small>
                    {canDeleteOriginalDocument
                      ? "Remove the source document after exporting this processed version."
                      : "You do not have permission to delete the source document."}
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
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleExportToProject()}
                  disabled={exportBusy || !exportName.trim() || !canExportAiOutputsToProject}
                >
                  {exportBusy ? "Exporting" : "Export"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
