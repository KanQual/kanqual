import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HelpIcon, ProcessTranscriptIcon } from "../components/AppIcons";
import { buildProcessedTranscriptContent } from "../components/ProcessedTranscriptView";
import {
  collectSpeakerSummaries,
  DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES,
  formatProcessedReviewDate,
  PROCESSED_DOCUMENT_REVIEW_LENSES,
  segmentContainsTimestamp,
  type ProcessedDocumentReviewLensId,
  type TranscriptNameCandidate,
  type TranscriptProcessingSegment,
} from "../lib/processedDocumentReviews";
import { readAppSettings } from "../lib/appSettings";
import { buildLlmInvokeRequestFields } from "../lib/llmRuntime";
import { notifyPostgresDocumentProcessingChanged } from "./App_Shell_Helpers";
import {
  createPostgresSource,
  listPostgresSourceAttributeDefinitions,
  listPostgresSourceAttributeValues,
  listPostgresProcessedDocumentReviews,
  listPostgresSources,
  savePostgresSourceAttribute,
  upsertPostgresProcessedDocumentReview,
  type PostgresProcessedDocumentReview,
  type PostgresSource,
  type PostgresSourceAttributeDefinition,
} from "../lib/postgres";

type ProcessingProgress = {
  sourceTitle: string;
  sourceIndex: number;
  sourceTotal: number;
  chunkIndex?: number;
  chunkTotal?: number;
};

type ProcessingAggregate = {
  processedContent: string;
  segments: TranscriptProcessingSegment[];
  properNameCandidates: TranscriptNameCandidate[];
};

type SegmentType = TranscriptProcessingSegment["segmentType"];
type ProcessSourceGroup = "raw" | "processed";
type ProcessReviewSideTab = "speakers" | "anonymization";
type ProcessReviewNavigationCard = {
  id: string;
  label: string;
  detail: string;
  colorClassName: string;
};

type ProcessedSourceReviewRecord = PostgresProcessedDocumentReview & {
  segments: TranscriptProcessingSegment[];
  properNameCandidates: TranscriptNameCandidate[];
  enabledReviewLenses: Record<ProcessedDocumentReviewLensId, boolean>;
};

function parseJson<T>(value: string, fallback: T): T {
  if (!value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeTranscriptSegments(value: unknown): TranscriptProcessingSegment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((segment, index) => {
      if (!segment || typeof segment !== "object") return null;
      const record = segment as Record<string, unknown>;
      const text = String(record.text ?? "").trim();
      if (!text) return null;
      return {
        segmentType:
          record.segmentType === "metadata" || record.segmentType === "question"
            ? record.segmentType
            : "answer",
        speakerId: String(record.speakerId ?? "").trim(),
        timestampText: String(record.timestampText ?? "").trim(),
        startOffset: Number(record.startOffset ?? 0),
        endOffset: Number(record.endOffset ?? 0),
        sortOrder: Number(record.sortOrder ?? index),
        text,
        chunkIndex: Number(record.chunkIndex ?? 0),
      } satisfies TranscriptProcessingSegment;
    })
    .filter((segment): segment is TranscriptProcessingSegment => segment !== null)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.startOffset - right.startOffset);
}

function normalizeReviewLenses(value: unknown): Record<ProcessedDocumentReviewLensId, boolean> {
  if (!value || typeof value !== "object") return DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES;
  return {
    "speaker-segmentation":
      typeof Reflect.get(value, "speaker-segmentation") === "boolean"
        ? Boolean(Reflect.get(value, "speaker-segmentation"))
        : DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES["speaker-segmentation"],
    "named-entity-extraction":
      typeof Reflect.get(value, "named-entity-extraction") === "boolean"
        ? Boolean(Reflect.get(value, "named-entity-extraction"))
        : DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES["named-entity-extraction"],
  };
}

function toProcessedSourceReviewRecord(review: PostgresProcessedDocumentReview): ProcessedSourceReviewRecord {
  return {
    ...review,
    segments: normalizeTranscriptSegments(parseJson<unknown[]>(review.segmentsJson, [])),
    properNameCandidates: parseJson<TranscriptNameCandidate[]>(review.properNameCandidatesJson, []),
    enabledReviewLenses: normalizeReviewLenses(parseJson<Record<string, boolean> | null>(review.enabledReviewLensesJson, null)),
  };
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" focusable="false">
      <path
        fill="currentColor"
        d="M9 3h6l1 2h5v2H3V5h5l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2v8h2v-8H9Zm4 0v8h2v-8h-2Z"
      />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" focusable="false">
      <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
    </svg>
  );
}

const SPEAKER_SEGMENT_COLOR_COUNT = 12;
const METADATA_NAVIGATION_ID = "__metadata__";

function getReviewSegmentSpeakerId(segment: TranscriptProcessingSegment): string {
  return segment.speakerId.trim();
}

function isNavigableSpeakerSegment(segment: TranscriptProcessingSegment): boolean {
  return segment.segmentType !== "metadata" && Boolean(getReviewSegmentSpeakerId(segment));
}

function ReviewResultsPanel({
  reviewSegments,
  setReviewSegments,
  editable,
  activeSegmentIndex,
  registerReviewSegmentElement,
  onActivateReviewSegment,
}: {
  reviewSegments: TranscriptProcessingSegment[];
  setReviewSegments: React.Dispatch<React.SetStateAction<TranscriptProcessingSegment[]>>;
  editable: boolean;
  activeSegmentIndex: number | null;
  registerReviewSegmentElement: (index: number, element: HTMLElement | null) => void;
  onActivateReviewSegment: (index: number) => void;
}) {
  const [newSpeakerSegmentKeys, setNewSpeakerSegmentKeys] = useState<Set<string>>(new Set());

  function updateReviewSegment(index: number, updates: Partial<TranscriptProcessingSegment>) {
    setReviewSegments((current) =>
      current.map((segment, segmentIndex) => (segmentIndex === index ? { ...segment, ...updates } : segment)),
    );
  }

  function removeReviewSegment(index: number) {
    setReviewSegments((current) => current.filter((_, segmentIndex) => segmentIndex !== index));
  }

  function insertReviewSegment(afterIndex: number) {
    setReviewSegments((current) => {
      const previous = current[afterIndex];
      const next = current[afterIndex + 1];
      const insertOffset = previous?.endOffset ?? next?.startOffset ?? 0;
      const nextSegments = [
        ...current.slice(0, afterIndex + 1),
        {
          segmentType: "answer",
          speakerId: "",
          timestampText: "",
          startOffset: insertOffset,
          endOffset: insertOffset,
          sortOrder: afterIndex + 1,
          text: "",
          chunkIndex: previous?.chunkIndex ?? next?.chunkIndex ?? 0,
        } satisfies TranscriptProcessingSegment,
        ...current.slice(afterIndex + 1),
      ];
      return nextSegments.map((segment, sortOrder) => ({ ...segment, sortOrder }));
    });
  }

  const speakerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          reviewSegments
            .filter(isNavigableSpeakerSegment)
            .map((segment) => segment.speakerId.trim())
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [reviewSegments],
  );
  const speakerColorKeys = useMemo(
    () =>
      Array.from(
        new Set(
          reviewSegments
            .filter(isNavigableSpeakerSegment)
            .map((segment) => getReviewSegmentSpeakerId(segment)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [reviewSegments],
  );

  return (
    <div className="ai-process-doc-column-body ai-process-doc-column-body--review">
      <div className="ai-process-doc-review-section">
        <div className="ai-process-doc-review-grid">
          <div className="ai-process-doc-segment-review-card">
            <div className="ai-process-doc-segment-list">
              {reviewSegments.length === 0 ? (
                <div className="empty-state ai-process-doc-empty">
                  <p>No segments remain.</p>
                </div>
              ) : (
                reviewSegments.map((segment, index) => {
                  const segmentKey = `${segment.sortOrder}-${index}`;
                  const speakerKey = getReviewSegmentSpeakerId(segment);
                  const speakerColorIndex = Math.max(0, speakerColorKeys.indexOf(speakerKey)) % SPEAKER_SEGMENT_COLOR_COUNT;
                  const isNewSpeaker = newSpeakerSegmentKeys.has(segmentKey);
                  const segmentClassName =
                    segment.segmentType === "metadata"
                      ? "ai-process-doc-segment ai-process-doc-segment--metadata"
                      : `ai-process-doc-segment ai-process-doc-segment--speaker ai-process-doc-segment--speaker-${speakerColorIndex}`;
                  return (
                    <div key={segmentKey} className="ai-process-doc-segment-stack">
                      <article
                        ref={(element) => registerReviewSegmentElement(index, element)}
                        className={index === activeSegmentIndex ? `${segmentClassName} ai-process-doc-segment--active` : segmentClassName}
                        onClick={() => onActivateReviewSegment(index)}
                      >
                        <button
                          type="button"
                          className="ai-process-doc-segment-delete"
                          disabled={!editable}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeReviewSegment(index);
                          }}
                          title="Delete segment"
                          aria-label="Delete segment"
                        >
                          <TrashIcon className="ai-process-doc-segment-delete-icon" />
                        </button>
                        <div className="ai-process-doc-segment-two-col">
                          <div className="ai-process-doc-segment-controls">
                            <label className="form-label ai-process-doc-segment-tag-select">
                              Tag
                              <select
                                className="form-select"
                                value={segment.segmentType}
                                disabled={!editable}
                                onChange={(event) => {
                                  const segmentType = event.target.value as SegmentType;
                                  updateReviewSegment(index, {
                                    segmentType,
                                    speakerId: segmentType === "metadata" ? "" : segment.speakerId,
                                  });
                                }}
                              >
                                <option value="metadata">Metadata</option>
                                <option value="question">Question</option>
                                <option value="answer">Answer</option>
                              </select>
                            </label>
                            {segment.segmentType !== "metadata" && segmentContainsTimestamp(segment) ? (
                              <span className="role-badge role-badge--viewer">Timestamp</span>
                            ) : null}
                            {segment.segmentType !== "metadata" ? (
                              <div className="ai-process-doc-speaker-field">
                                <label className="form-label">
                                  Speaker
                                  <select
                                    className="form-select"
                                    value={isNewSpeaker ? "__new__" : segment.speakerId.trim()}
                                    disabled={!editable}
                                    onChange={(event) => {
                                      const value = event.target.value;
                                      if (value === "__new__") {
                                        setNewSpeakerSegmentKeys((current) => new Set(current).add(segmentKey));
                                        updateReviewSegment(index, { speakerId: "" });
                                        return;
                                      }
                                      setNewSpeakerSegmentKeys((current) => {
                                        const next = new Set(current);
                                        next.delete(segmentKey);
                                        return next;
                                      });
                                      updateReviewSegment(index, { speakerId: value });
                                    }}
                                  >
                                    <option value="" disabled>
                                      Select speaker
                                    </option>
                                    {speakerOptions.map((speaker) => (
                                      <option key={speaker} value={speaker}>
                                        {speaker}
                                      </option>
                                    ))}
                                    <option value="__new__">Enter new speaker...</option>
                                  </select>
                                </label>
                                {isNewSpeaker ? (
                                  <label className="form-label">
                                    New speaker
                                    <input
                                      className="form-input"
                                      value={segment.speakerId}
                                      disabled={!editable}
                                      onChange={(event) => updateReviewSegment(index, { speakerId: event.target.value })}
                                      placeholder="Speaker label"
                                    />
                                  </label>
                                ) : null}
                              </div>
                            ) : null}
                            {segment.segmentType !== "metadata" && segment.timestampText.trim() ? (
                              <div className="ai-process-doc-segment-timestamp">{segment.timestampText.trim()}</div>
                            ) : null}
                          </div>
                          <label className="form-label ai-process-doc-segment-text-field">
                            Text contents
                            <textarea
                              className="form-input ai-process-doc-segment-textarea"
                              value={segment.text}
                              disabled={!editable}
                              onChange={(event) => updateReviewSegment(index, { text: event.target.value })}
                              rows={5}
                            />
                          </label>
                        </div>
                      </article>
                      {index < reviewSegments.length - 1 ? (
                        <div className="ai-process-doc-segment-insert-row" aria-hidden={!editable}>
                          <button
                            type="button"
                            className="ai-process-doc-segment-insert-button"
                            disabled={!editable}
                            onClick={() => insertReviewSegment(index)}
                            title="Add segment here"
                            aria-label="Add segment here"
                          >
                            <PlusIcon className="ai-process-doc-segment-insert-icon" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function splitProcessingChunks(content: string, numCtx: number): Array<{ chunkIndex: number; text: string }> {
  const chunkChars = Math.max((Math.max(0, numCtx - 900)) * 4, 4000);
  const chunks: Array<{ chunkIndex: number; text: string }> = [];
  let remaining = content.trim();
  while (remaining) {
    if (Array.from(remaining).length <= chunkChars) {
      chunks.push({ chunkIndex: chunks.length, text: remaining });
      break;
    }
    let codeUnitLimit = 0;
    let charCount = 0;
    for (const char of remaining) {
      codeUnitLimit += char.length;
      charCount += 1;
      if (charCount >= chunkChars) break;
    }
    const candidate = remaining.slice(0, codeUnitLimit);
    const splitAt = Math.max(
      candidate.lastIndexOf("\n\n") >= 0
        ? candidate.lastIndexOf("\n\n") + 2
        : candidate.lastIndexOf("\n") >= 0
          ? candidate.lastIndexOf("\n") + 1
          : codeUnitLimit,
      1,
    );
    const chunk = remaining.slice(0, splitAt);
    if (chunk.trim()) chunks.push({ chunkIndex: chunks.length, text: chunk });
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function appendChunkAggregate(
  aggregate: ProcessingAggregate,
  response: {
    processedContent: string;
    segments: unknown[];
    properNameCandidates: unknown[];
    chunkIndex: number;
  },
): ProcessingAggregate {
  const baseOffset = aggregate.processedContent ? aggregate.processedContent.length + 2 : 0;
  const segments = (response.segments as Array<Record<string, unknown>>)
    .map((segment, index) => {
      const segmentType: TranscriptProcessingSegment["segmentType"] =
        segment.segmentType === "metadata" || segment.segmentType === "question" ? segment.segmentType : "answer";
      return {
        segmentType,
        speakerId: typeof segment.speakerId === "string" ? segment.speakerId : "",
        timestampText: typeof segment.timestampText === "string" ? segment.timestampText : "",
        startOffset: baseOffset + Number(segment.startOffset ?? 0),
        endOffset: baseOffset + Number(segment.endOffset ?? 0),
        sortOrder: aggregate.segments.length + index,
        text: typeof segment.text === "string" ? segment.text : "",
        chunkIndex: response.chunkIndex,
      };
    })
    .filter((segment) => segment.text.trim()) satisfies TranscriptProcessingSegment[];
  const names = new Map<string, TranscriptNameCandidate>();
  for (const candidate of aggregate.properNameCandidates) {
    if (candidate.text.trim()) names.set(candidate.text.trim().toLowerCase(), candidate);
  }
  for (const candidate of response.properNameCandidates as Array<Record<string, unknown>>) {
    const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
    if (!text) continue;
    names.set(text.toLowerCase(), {
      text,
      sourceType: typeof candidate.sourceType === "string" ? candidate.sourceType : "text",
    });
  }
  return {
    processedContent: aggregate.processedContent
      ? `${aggregate.processedContent}\n\n${response.processedContent}`
      : response.processedContent,
    segments: [...aggregate.segments, ...segments],
    properNameCandidates: [...names.values()],
  };
}

function mergeProcessingSegments(segments: TranscriptProcessingSegment[]): TranscriptProcessingSegment[] {
  const merged: TranscriptProcessingSegment[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const next = { ...segment, text };
    const last = merged[merged.length - 1];
    if (
      last
      && last.chunkIndex !== next.chunkIndex
      && last.segmentType === next.segmentType
      && last.speakerId.trim().toLowerCase() === next.speakerId.trim().toLowerCase()
    ) {
      last.text = `${last.text}\n\n${next.text}`;
      continue;
    }
    merged.push(next);
  }
  let cursor = 0;
  return merged.map((segment, index) => {
    const startOffset = cursor;
    const endOffset = startOffset + segment.text.length;
    cursor = endOffset + 2;
    return { ...segment, startOffset, endOffset, sortOrder: index };
  });
}

function collectProperNameCandidates(
  segments: TranscriptProcessingSegment[],
  existing: TranscriptNameCandidate[],
): TranscriptNameCandidate[] {
  const names = new Map<string, TranscriptNameCandidate>();
  for (const candidate of existing) {
    const text = candidate.text.trim();
    if (text) names.set(text.toLowerCase(), { text, sourceType: candidate.sourceType || "text" });
  }
  for (const segment of segments) {
    const speaker = segment.speakerId.trim();
    if (speaker && !["interviewer", "participant", "moderator"].includes(speaker.toLowerCase())) {
      names.set(speaker.toLowerCase(), { text: speaker, sourceType: "speaker" });
    }
  }
  return [...names.values()].sort((left, right) => left.text.localeCompare(right.text));
}

function isTextProcessableSource(source: PostgresSource): boolean {
  const kind = source.sourceKind.trim().toLowerCase().replace(/_/g, " ");
  return Boolean(source.textContent.trim()) && (kind === "text" || kind === "transcript" || kind === "processed transcript");
}

export function PostgresAiAssistProcessSourcesView({
  projectId,
  canUseAiProcessDocuments,
  canReviewProcessedDocuments,
}: {
  projectId: string;
  canUseAiProcessDocuments: boolean;
  canReviewProcessedDocuments: boolean;
}) {
  const [sources, setSources] = useState<PostgresSource[]>([]);
  const [reviews, setReviews] = useState<PostgresProcessedDocumentReview[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const [reviewWorkspaceOpen, setReviewWorkspaceOpen] = useState(false);
  const [selectedProcessGroup, setSelectedProcessGroup] = useState<ProcessSourceGroup>("raw");
  const [selectedReviewSideTab, setSelectedReviewSideTab] = useState<ProcessReviewSideTab>("speakers");
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [selectedReviewSegments, setSelectedReviewSegments] = useState<TranscriptProcessingSegment[]>([]);
  const [activeReviewSegmentIndex, setActiveReviewSegmentIndex] = useState<number | null>(null);
  const [speakerNavigationPositions, setSpeakerNavigationPositions] = useState<Record<string, number>>({});
  const [editingSpeakerLabel, setEditingSpeakerLabel] = useState("");
  const [editingSpeakerLabelValue, setEditingSpeakerLabelValue] = useState("");
  const [saveReviewBusy, setSaveReviewBusy] = useState(false);
  const [saveReviewError, setSaveReviewError] = useState("");
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportName, setExportName] = useState("");
  const [exportDescription, setExportDescription] = useState("");
  const [copySourceAttributesOnExport, setCopySourceAttributesOnExport] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [reviewLenses, setReviewLenses] = useState<Record<ProcessedDocumentReviewLensId, boolean>>({
    ...DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES,
  });
  const reviewSegmentElementsRef = useRef<Map<number, HTMLElement>>(new Map());

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [nextSources, nextReviews] = await Promise.all([
        listPostgresSources(projectId),
        listPostgresProcessedDocumentReviews(projectId),
      ]);
      setSources(nextSources);
      setReviews(nextReviews);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [projectId]);

  const processableSources = useMemo(
    () => sources.filter(isTextProcessableSource).sort((left, right) => left.title.localeCompare(right.title)),
    [sources],
  );
  const reviewBySourceId = useMemo(
    () => new Map(reviews.map((review) => [review.sourceId, review])),
    [reviews],
  );
  const reviewRecords = useMemo(() => reviews.map(toProcessedSourceReviewRecord), [reviews]);
  const selectedReviewRecord = useMemo(
    () => reviewRecords.find((review) => review.id === selectedReviewId) ?? null,
    [reviewRecords, selectedReviewId],
  );
  const selectedSources = useMemo(
    () => processableSources.filter((source) => selectedSourceIds.includes(source.id)),
    [processableSources, selectedSourceIds],
  );
  const pendingReviewCount = reviews.filter((review) => review.status !== "reviewed").length;
  const processGroupRows = useMemo(
    () => [
      {
        key: "raw" as const,
        label: "Text Sources",
        count: processableSources.length,
      },
      {
        key: "processed" as const,
        label: "Transcripts",
        count: reviewRecords.length,
      },
    ],
    [processableSources.length, reviewRecords.length],
  );
  const selectedReviewSpeakerSummaries = useMemo(
    () => collectSpeakerSummaries(selectedReviewSegments.filter(isNavigableSpeakerSegment)),
    [selectedReviewSegments],
  );
  const selectedReviewSpeakerColorKeys = useMemo(
    () =>
      Array.from(
        new Set(
          selectedReviewSegments
            .filter(isNavigableSpeakerSegment)
            .map((segment) => getReviewSegmentSpeakerId(segment)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [selectedReviewSegments],
  );
  const selectedReviewSpeakerLabelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const segment of selectedReviewSegments) {
      if (!isNavigableSpeakerSegment(segment)) continue;
      const speakerId = getReviewSegmentSpeakerId(segment);
      counts.set(speakerId, (counts.get(speakerId) ?? 0) + 1);
    }
    return Array.from(counts, ([label, count]) => ({ label, count })).sort((left, right) => left.label.localeCompare(right.label));
  }, [selectedReviewSegments]);
  const selectedReviewProperNounCandidates = useMemo(
    () =>
      (selectedReviewRecord?.properNameCandidates ?? [])
        .filter((candidate) => candidate.sourceType !== "speaker" && candidate.text.trim())
        .sort((left, right) => left.text.localeCompare(right.text)),
    [selectedReviewRecord],
  );
  const selectedReviewNavigationSegmentIndices = useMemo(() => {
    const byGroup = new Map<string, number[]>();
    selectedReviewSegments.forEach((segment, index) => {
      const groupId = segment.segmentType === "metadata" ? METADATA_NAVIGATION_ID : getReviewSegmentSpeakerId(segment);
      if (!groupId) return;
      const indices = byGroup.get(groupId) ?? [];
      indices.push(index);
      byGroup.set(groupId, indices);
    });
    return byGroup;
  }, [selectedReviewSegments]);
  const selectedReviewNavigationCards = useMemo<ProcessReviewNavigationCard[]>(() => {
    const metadataCount = selectedReviewNavigationSegmentIndices.get(METADATA_NAVIGATION_ID)?.length ?? 0;
    const metadataCard: ProcessReviewNavigationCard[] =
      metadataCount > 0
        ? [
            {
              id: METADATA_NAVIGATION_ID,
              label: "Metadata",
              detail: `${metadataCount} Metadata Segment${metadataCount === 1 ? "" : "s"}`,
              colorClassName: "ai-process-doc-summary-chip--metadata",
            },
          ]
        : [];
    const speakerCards = selectedReviewSpeakerSummaries.map((speaker) => {
      const speakerColorIndex = Math.max(0, selectedReviewSpeakerColorKeys.indexOf(speaker.id)) % SPEAKER_SEGMENT_COLOR_COUNT;
      return {
        id: speaker.id,
        label: speaker.id,
        detail: `${speaker.questionCount} Questions, ${speaker.answerCount} Answers`,
        colorClassName: `ai-process-doc-summary-chip--speaker-${speakerColorIndex}`,
      };
    });
    return [...metadataCard, ...speakerCards];
  }, [selectedReviewNavigationSegmentIndices, selectedReviewSpeakerColorKeys, selectedReviewSpeakerSummaries]);

  useEffect(() => {
    reviewSegmentElementsRef.current.clear();
    setActiveReviewSegmentIndex(null);
    setSpeakerNavigationPositions({});
    setEditingSpeakerLabel("");
    setEditingSpeakerLabelValue("");
  }, [selectedReviewId]);

  useEffect(() => {
    setSpeakerNavigationPositions((current) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [speakerId, indices] of selectedReviewNavigationSegmentIndices) {
        const boundedPosition = Math.min(Math.max(current[speakerId] ?? 0, 0), Math.max(indices.length - 1, 0));
        next[speakerId] = boundedPosition;
        if (current[speakerId] !== boundedPosition) changed = true;
      }
      if (Object.keys(current).length !== Object.keys(next).length) changed = true;
      return changed ? next : current;
    });
  }, [selectedReviewNavigationSegmentIndices]);

  function registerReviewSegmentElement(index: number, element: HTMLElement | null) {
    if (element) {
      reviewSegmentElementsRef.current.set(index, element);
      return;
    }
    reviewSegmentElementsRef.current.delete(index);
  }

  function setActiveReviewSegment(index: number, shouldScroll: boolean) {
    setActiveReviewSegmentIndex(index);
    const segment = selectedReviewSegments[index];
    const groupId = segment?.segmentType === "metadata" ? METADATA_NAVIGATION_ID : segment ? getReviewSegmentSpeakerId(segment) : "";
    if (groupId) {
      const indices = selectedReviewNavigationSegmentIndices.get(groupId) ?? [];
      const position = indices.indexOf(index);
      if (position >= 0) setSpeakerNavigationPositions((current) => ({ ...current, [groupId]: position }));
    }
    if (shouldScroll) {
      reviewSegmentElementsRef.current.get(index)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function jumpToReviewSegment(index: number) {
    setActiveReviewSegment(index, true);
  }

  function navigateSpeakerSegment(speakerId: string, direction: -1 | 1) {
    const indices = selectedReviewNavigationSegmentIndices.get(speakerId) ?? [];
    if (indices.length === 0) return;
    const currentPosition = speakerNavigationPositions[speakerId] ?? 0;
    const nextPosition = Math.min(Math.max(currentPosition + direction, 0), indices.length - 1);
    setSpeakerNavigationPositions((current) => ({ ...current, [speakerId]: nextPosition }));
    jumpToReviewSegment(indices[nextPosition]);
  }

  function openSpeakerLabelEditor(label: string) {
    setEditingSpeakerLabel(label);
    setEditingSpeakerLabelValue(label);
  }

  function applySpeakerLabelEdit() {
    const previousLabel = editingSpeakerLabel.trim();
    const nextLabel = editingSpeakerLabelValue.trim();
    if (!previousLabel || !nextLabel) return;
    setSelectedReviewSegments((current) =>
      current.map((segment) =>
        segment.segmentType !== "metadata" && segment.speakerId.trim() === previousLabel
          ? { ...segment, speakerId: nextLabel }
          : segment,
      ),
    );
    setEditingSpeakerLabel("");
    setEditingSpeakerLabelValue("");
  }

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) =>
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId],
    );
  }

  function toggleReviewLens(lensId: ProcessedDocumentReviewLensId) {
    setReviewLenses((current) => {
      const enabledCount = Object.values(current).filter(Boolean).length;
      if (current[lensId] && enabledCount === 1) return current;
      return { ...current, [lensId]: !current[lensId] };
    });
  }

  function openReviewRecord(record: ProcessedSourceReviewRecord) {
    setSelectedReviewId(record.id);
    setSelectedReviewSegments(record.segments);
    setSaveReviewError("");
    setExportError("");
  }

  function openReviewWorkspace() {
    if (!canReviewProcessedDocuments || reviewRecords.length === 0) return;
    if (!selectedReviewRecord) openReviewRecord(reviewRecords[0]);
    setReviewWorkspaceOpen(true);
  }

  async function handleSaveReview() {
    if (!selectedReviewRecord || !canReviewProcessedDocuments) return;
    setSaveReviewBusy(true);
    setSaveReviewError("");
    try {
      const updated = await upsertPostgresProcessedDocumentReview({
        projectId,
        sourceId: selectedReviewRecord.sourceId,
        sourceTitle: selectedReviewRecord.sourceTitle,
        storagePath: selectedReviewRecord.storagePath,
        status: "reviewed",
        processingStatus: selectedReviewRecord.processingStatus,
        processingError: selectedReviewRecord.processingError,
        processedChunkCount: selectedReviewRecord.processedChunkCount,
        processedContent: selectedReviewSegments.map((segment) => segment.text.trim()).filter(Boolean).join("\n\n"),
        segmentsJson: JSON.stringify(selectedReviewSegments),
        properNameCandidatesJson: selectedReviewRecord.properNameCandidatesJson,
        enabledReviewLensesJson: selectedReviewRecord.enabledReviewLensesJson,
        model: selectedReviewRecord.model,
        baseUrl: selectedReviewRecord.baseUrl,
        chunkCount: selectedReviewRecord.chunkCount,
        sourceContentHash: selectedReviewRecord.sourceContentHash,
        exportedToProject: selectedReviewRecord.exportedToProject,
      });
      setReviews((current) => current.map((review) => (review.id === updated.id ? updated : review)));
      setSelectedReviewId(updated.id);
    } catch (nextError) {
      setSaveReviewError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaveReviewBusy(false);
    }
  }

  function openExportModal() {
    if (!selectedReviewRecord || !canReviewProcessedDocuments) return;
    setExportName(selectedReviewRecord.sourceTitle || "Processed transcript");
    setExportDescription("");
    setCopySourceAttributesOnExport(false);
    setExportError("");
    setExportModalOpen(true);
  }

  async function copySourceAttributesToExportedSource(
    rawSourceId: string,
    exportedSourceId: string,
  ) {
    const [definitions, values] = await Promise.all([
      listPostgresSourceAttributeDefinitions(projectId),
      listPostgresSourceAttributeValues(projectId),
    ]);
    const definitionById = new Map<string, PostgresSourceAttributeDefinition>(
      definitions.map((definition) => [definition.id, definition]),
    );
    const rawValues = values.filter((value) => value.sourceId === rawSourceId && value.value.trim());

    for (const rawValue of rawValues) {
      const definition = definitionById.get(rawValue.attributeDefinitionId);
      if (!definition) continue;
      const sourceKinds = definition.sourceKinds.length > 0 && !definition.sourceKinds.includes("Transcript")
        ? [...definition.sourceKinds, "Transcript"]
        : definition.sourceKinds;
      await savePostgresSourceAttribute({
        projectId,
        attributeDefinitionId: definition.id,
        name: definition.name,
        dataType: definition.dataType,
        description: definition.description,
        options: definition.options,
        sourceKinds,
        values: [{ sourceId: exportedSourceId, value: rawValue.value }],
        attributeValueChange: {
          aiAssistRelated: true,
          aiAssistAction: "process_source_export_attribute_copy",
          metadata: {
            sourceProcessedReviewId: selectedReviewRecord?.id ?? "",
            copiedFromSourceId: rawSourceId,
          },
        },
      });
    }
  }

  async function handleExportToProject() {
    if (!selectedReviewRecord || !canReviewProcessedDocuments) return;
    const nextName = exportName.trim();
    if (!nextName) {
      setExportError("Enter a source name.");
      return;
    }

    setExportBusy(true);
    setExportError("");
    try {
      const processedTranscript = buildProcessedTranscriptContent(selectedReviewSegments);
      if (!processedTranscript.content.trim()) {
        throw new Error("The reviewed transcript has no text to export.");
      }

      const createdSource = await createPostgresSource({
        projectId,
        sourceKind: "Transcript",
        title: nextName,
        originalFileName: "",
        storagePath: "",
        textContent: processedTranscript.content,
        structuredContentJson: JSON.stringify(processedTranscript.segments),
        notes: exportDescription.trim(),
      });
      if (copySourceAttributesOnExport) {
        await copySourceAttributesToExportedSource(selectedReviewRecord.sourceId, createdSource.id);
      }

      const updated = await upsertPostgresProcessedDocumentReview({
        projectId,
        sourceId: selectedReviewRecord.sourceId,
        sourceTitle: selectedReviewRecord.sourceTitle,
        storagePath: selectedReviewRecord.storagePath,
        status: "reviewed",
        processingStatus: selectedReviewRecord.processingStatus,
        processingError: selectedReviewRecord.processingError,
        processedChunkCount: selectedReviewRecord.processedChunkCount,
        processedContent: processedTranscript.content,
        segmentsJson: JSON.stringify(processedTranscript.segments),
        properNameCandidatesJson: selectedReviewRecord.properNameCandidatesJson,
        enabledReviewLensesJson: selectedReviewRecord.enabledReviewLensesJson,
        model: selectedReviewRecord.model,
        baseUrl: selectedReviewRecord.baseUrl,
        chunkCount: selectedReviewRecord.chunkCount,
        sourceContentHash: selectedReviewRecord.sourceContentHash,
        exportedToProject: true,
      });
      setSelectedReviewSegments(processedTranscript.segments);
      setReviews((current) => current.map((review) => (review.id === updated.id ? updated : review)));
      setSelectedReviewId(updated.id);
      setExportModalOpen(false);
      await refresh();
    } catch (nextError) {
      setExportError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setExportBusy(false);
    }
  }

  async function processSelectedSources(restart: boolean) {
    if (selectedSources.length === 0 || !canUseAiProcessDocuments) return;
    setProcessModalOpen(false);
    setProgress(null);
    setBusy(true);
    setError("");
    setNotice("");
    notifyPostgresDocumentProcessingChanged({
      phase: "running",
      projectId,
      completedDocuments: 0,
      totalDocuments: selectedSources.length,
      currentDocumentName: "",
      message: `Preparing to ${restart ? "restart" : "process"} ${selectedSources.length} source${selectedSources.length === 1 ? "" : "s"}.`,
      failures: [],
    });
    try {
      const settings = readAppSettings();
      const runtime = buildLlmInvokeRequestFields(settings.llm);
      const failures: Array<{ documentName: string; message: string }> = [];
      let processedCount = 0;
      for (let sourceIndex = 0; sourceIndex < selectedSources.length; sourceIndex += 1) {
        const source = selectedSources[sourceIndex];
        const chunks = splitProcessingChunks(source.textContent, settings.llm.ollamaNumCtx);
        if (chunks.length === 0) throw new Error(`${source.title} has no text to process.`);
        const sourceContentHash = await hashContent(source.textContent);
        const existing = reviewBySourceId.get(source.id);
        if (!restart && existing?.processingStatus === "completed" && existing.sourceContentHash === sourceContentHash) {
          continue;
        }
        let aggregate: ProcessingAggregate = { processedContent: "", segments: [], properNameCandidates: [] };
        await upsertPostgresProcessedDocumentReview({
          projectId,
          sourceId: source.id,
          sourceTitle: source.title,
          storagePath: source.storagePath,
          status: restart ? "pending_review" : existing?.status ?? "pending_review",
          processingStatus: "running",
          processingError: "",
          processedChunkCount: 0,
          processedContent: "",
          segmentsJson: "[]",
          properNameCandidatesJson: "[]",
          enabledReviewLensesJson: JSON.stringify(reviewLenses),
          model: runtime.model,
          baseUrl: runtime.connectionMode === "local" ? `${runtime.protocol}://${runtime.host}:${runtime.port}` : "",
          chunkCount: chunks.length,
          sourceContentHash,
          exportedToProject: restart ? false : existing?.exportedToProject ?? false,
        });
        for (const chunk of chunks) {
          setProgress({
            sourceTitle: source.title,
            sourceIndex: sourceIndex + 1,
            sourceTotal: selectedSources.length,
            chunkIndex: chunk.chunkIndex + 1,
            chunkTotal: chunks.length,
          });
          notifyPostgresDocumentProcessingChanged({
            phase: "running",
            projectId,
            completedDocuments: processedCount,
            totalDocuments: selectedSources.length,
            currentDocumentName: source.title,
            message: `${restart ? "Restarting" : "Processing"} ${source.title} (${sourceIndex + 1} of ${selectedSources.length}).`,
            failures: [...failures],
            currentChunkIndex: chunk.chunkIndex + 1,
            currentChunkTotal: chunks.length,
          });
          const response = await invoke<{
            processedContent: string;
            segments: unknown[];
            properNameCandidates: unknown[];
            model: string;
            baseUrl: string;
            chunkIndex: number;
          }>("process_document_chunk_with_ollama", {
            request: {
              chunkText: chunk.text,
              chunkIndex: chunk.chunkIndex,
              ...runtime,
              timeoutSeconds: settings.llm.ollamaDocumentProcessingTimeoutSeconds,
            },
          });
          aggregate = appendChunkAggregate(aggregate, response);
          await upsertPostgresProcessedDocumentReview({
            projectId,
            sourceId: source.id,
            sourceTitle: source.title,
            storagePath: source.storagePath,
            status: existing?.status ?? "pending_review",
            processingStatus: chunk.chunkIndex === chunks.length - 1 ? "completed" : "running",
            processedChunkCount: chunk.chunkIndex + 1,
            processedContent: aggregate.processedContent,
            segmentsJson: JSON.stringify(aggregate.segments),
            properNameCandidatesJson: JSON.stringify(aggregate.properNameCandidates),
            enabledReviewLensesJson: JSON.stringify(reviewLenses),
            model: response.model,
            baseUrl: response.baseUrl,
            chunkCount: chunks.length,
            sourceContentHash,
            exportedToProject: restart ? false : existing?.exportedToProject ?? false,
          });
        }
        const mergedSegments = mergeProcessingSegments(aggregate.segments);
        const finalContent = mergedSegments.map((segment) => segment.text).join("\n\n");
        await upsertPostgresProcessedDocumentReview({
          projectId,
          sourceId: source.id,
          sourceTitle: source.title,
          storagePath: source.storagePath,
          status: existing?.status ?? "pending_review",
          processingStatus: "completed",
          processingError: "",
          processedChunkCount: chunks.length,
          processedContent: finalContent,
          segmentsJson: JSON.stringify(mergedSegments),
          properNameCandidatesJson: JSON.stringify(collectProperNameCandidates(mergedSegments, aggregate.properNameCandidates)),
          enabledReviewLensesJson: JSON.stringify(reviewLenses),
          model: runtime.model,
          chunkCount: chunks.length,
          sourceContentHash,
          exportedToProject: restart ? false : existing?.exportedToProject ?? false,
        });
        processedCount += 1;
      }
      notifyPostgresDocumentProcessingChanged({
        phase: "completed",
        projectId,
        completedDocuments: selectedSources.length,
        totalDocuments: selectedSources.length,
        currentDocumentName: "",
        message: `Processed ${selectedSources.length} source${selectedSources.length === 1 ? "" : "s"} and added ${selectedSources.length === 1 ? "it" : "them"} to the review queue.`,
        failures: [],
      });
      setSelectedSourceIds([]);
      await refresh();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      notifyPostgresDocumentProcessingChanged({
        phase: "error",
        projectId,
        completedDocuments: 0,
        totalDocuments: selectedSources.length,
        currentDocumentName: progress?.sourceTitle ?? "",
        message,
        failures: [],
        error: message,
      });
      setError(message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (reviewWorkspaceOpen) {
    return (
      <div className="view ai-process-doc-view ai-process-doc-view--reviewing">
        <div className="workspace-back-row">
          <button type="button" className="btn" onClick={() => setReviewWorkspaceOpen(false)}>
            Back to Process Sources
          </button>
        </div>
        <header className="view-header">
          <div className="users-title-wrap">
            <h1>Processed Source Review</h1>
            <button
              type="button"
              className="users-help-icon-btn"
              onClick={() => setHelpOpen(true)}
              title="Open help"
              aria-label="Open help"
            >
              <HelpIcon className="users-help-icon" />
            </button>
          </div>
          <div className="view-header-actions">
            <button
              type="button"
              className="btn ai-process-doc-review-save-btn"
              disabled={saveReviewBusy || !canReviewProcessedDocuments || !selectedReviewRecord}
              onClick={() => void handleSaveReview()}
            >
              {saveReviewBusy ? "Saving" : "Save"}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={
                exportBusy
                || !canReviewProcessedDocuments
                || !selectedReviewRecord
                || selectedReviewRecord.processingStatus !== "completed"
              }
              onClick={openExportModal}
              title={
                selectedReviewRecord && selectedReviewRecord.processingStatus !== "completed"
                  ? "Only completed processed sources can be exported."
                  : undefined
              }
            >
              {selectedReviewRecord?.exportedToProject ? "Exported" : "Export to Project"}
            </button>
          </div>
        </header>

        <div className="ai-process-doc-review-shell">
          <div className="doc-detail-layout ai-process-doc-review-layout">
            <div className="doc-detail-left ai-process-doc-review-list-panel">
              <div className="surface-card ai-process-doc-review-list-card">
                {!selectedReviewRecord ? (
                  <div className="empty-state ai-process-doc-review-empty">
                    <p>Select a processed source to review its speakers.</p>
                  </div>
                ) : (
                  <div
                    className="ai-process-doc-review-side-tabs"
                    aria-label="Segment summary"
                  >
                    <div className="segmented-control ai-process-doc-review-side-tablist" role="tablist" aria-label="Review side panel">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={selectedReviewSideTab === "speakers"}
                        className={selectedReviewSideTab === "speakers" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                        onClick={() => setSelectedReviewSideTab("speakers")}
                      >
                        Speakers
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={selectedReviewSideTab === "anonymization"}
                        className={selectedReviewSideTab === "anonymization" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                        onClick={() => setSelectedReviewSideTab("anonymization")}
                      >
                        Anon.
                      </button>
                    </div>

                    {selectedReviewSideTab === "speakers" ? (
                      <div className="ai-process-doc-summary-strip ai-process-doc-review-side-panel" aria-label="Speaker summary">
                        <div className="ai-process-doc-review-summary" style={{ marginBottom: 4 }}>
                          <strong>{selectedReviewNavigationCards.length}</strong>
                          <span>{selectedReviewNavigationCards.length === 1 ? "segment group" : "segment groups"}</span>
                        </div>
                        {selectedReviewNavigationCards.length === 0 ? (
                          <p className="surface-card-description" style={{ margin: 0 }}>No speakers detected.</p>
                        ) : (
                          selectedReviewNavigationCards.map((card) => {
                            const segmentIndices = selectedReviewNavigationSegmentIndices.get(card.id) ?? [];
                            const currentPosition = Math.min(
                              Math.max(speakerNavigationPositions[card.id] ?? 0, 0),
                              Math.max(segmentIndices.length - 1, 0),
                            );
                            const currentSegmentIndex = segmentIndices[currentPosition] ?? null;
                            const isActive = currentSegmentIndex !== null && currentSegmentIndex === activeReviewSegmentIndex;
                            const canNavigateUp = segmentIndices.length > 0 && (currentPosition > 0 || !isActive);
                            const canNavigateDown = segmentIndices.length > 0 && (currentPosition < segmentIndices.length - 1 || !isActive);
                            return (
                              <div
                                key={card.id}
                                className={`ai-process-doc-summary-chip ${card.colorClassName}${isActive ? " ai-process-doc-summary-chip--active" : ""}`}
                              >
                                <div className="ai-process-doc-speaker-nav-header">
                                  <strong>{card.label}</strong>
                                </div>
                                <span className="ai-process-doc-speaker-nav-current">
                                  {segmentIndices.length > 0 ? `${currentPosition + 1} of ${segmentIndices.length}` : "0 of 0"}
                                </span>
                                <small>{card.detail}</small>
                                <div className="ai-process-doc-speaker-nav-actions">
                                  <button
                                    type="button"
                                    className="btn btn--sm"
                                    disabled={!canNavigateUp}
                                    onClick={() => navigateSpeakerSegment(card.id, -1)}
                                    title="Previous segment"
                                    aria-label={`Previous segment for ${card.label}`}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--sm"
                                    disabled={!canNavigateDown}
                                    onClick={() => navigateSpeakerSegment(card.id, 1)}
                                    title="Next segment"
                                    aria-label={`Next segment for ${card.label}`}
                                  >
                                    ↓
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <div className="ai-process-doc-review-side-panel" aria-label="Anonymization candidates">
                        <div className="surface-card-title" style={{ marginBottom: 8 }}>Speakers</div>
                        {selectedReviewSpeakerLabelCounts.length === 0 ? (
                          <p className="surface-card-description" style={{ margin: 0 }}>No speaker labels are currently assigned.</p>
                        ) : (
                          <div className="ai-process-doc-speaker-label-list">
                            {selectedReviewSpeakerLabelCounts.map((speaker) => (
                              <button
                                key={speaker.label}
                                type="button"
                                className="ai-process-doc-speaker-label-item"
                                disabled={!canReviewProcessedDocuments}
                                onClick={() => openSpeakerLabelEditor(speaker.label)}
                              >
                                <span>{speaker.label}</span>
                                <small>{speaker.count} segment{speaker.count === 1 ? "" : "s"}</small>
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="ai-process-doc-side-separator" />
                        <div className="surface-card-title" style={{ marginBottom: 8 }}>Proper nouns</div>
                        {selectedReviewProperNounCandidates.length === 0 ? (
                          <p className="surface-card-description" style={{ margin: 0 }}>No proper nouns were detected.</p>
                        ) : (
                          <div className="ai-process-doc-proper-noun-list">
                            {selectedReviewProperNounCandidates.map((candidate, index) => (
                              <div key={`${candidate.text}-${index}`} className="ai-process-doc-summary-chip ai-process-doc-proper-noun-card">
                                <strong>{candidate.text}</strong>
                                <small>Transcript text</small>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="doc-detail-right ai-process-doc-review-detail-panel">
              <div className="surface-card ai-process-doc-review-detail-card">
                {!selectedReviewRecord ? (
                  <div className="empty-state ai-process-doc-review-empty">
                    <p>Select a processed source to review its segments and named entities.</p>
                  </div>
                ) : (
                  <>
                    <div className="ai-process-doc-review-modal-header ai-process-doc-review-modal-header--with-summary">
                      <div>
                        <h2>{selectedReviewRecord.sourceTitle || "Untitled source"}</h2>
                        <p className="surface-card-description">
                          {selectedReviewRecord.model || "Unknown model"} · {selectedReviewRecord.processedChunkCount}/{selectedReviewRecord.chunkCount} chunks · {formatProcessedReviewDate(selectedReviewRecord.updatedAt)}
                        </p>
                      </div>
                    </div>

                    {saveReviewError ? <div className="form-error project-settings-error">{saveReviewError}</div> : null}
                    {selectedReviewRecord.processingStatus === "partial" ? (
                      <div className="users-permission-note" style={{ marginBottom: 12 }}>
                        Partial run: {selectedReviewRecord.processedChunkCount} of {selectedReviewRecord.chunkCount} chunks completed.
                        {selectedReviewRecord.processingError ? ` ${selectedReviewRecord.processingError}` : ""}
                      </div>
                    ) : null}
                    {selectedReviewRecord.processingStatus === "error" && selectedReviewRecord.processingError ? (
                      <div className="form-error project-settings-error">{selectedReviewRecord.processingError}</div>
                    ) : null}

                    <ReviewResultsPanel
                      reviewSegments={selectedReviewSegments}
                      setReviewSegments={setSelectedReviewSegments}
                      editable={canReviewProcessedDocuments}
                      activeSegmentIndex={activeReviewSegmentIndex}
                      registerReviewSegmentElement={registerReviewSegmentElement}
                      onActivateReviewSegment={(index) => setActiveReviewSegment(index, false)}
                    />

                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {helpOpen ? (
          <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
            <div className="modal modal--help modal--wide" onClick={(event) => event.stopPropagation()}>
              <div className="modal-title-bar">
                <div>
                  <h2>Processed Source Review</h2>
                </div>
                <button type="button" className="modal-icon-close" onClick={() => setHelpOpen(false)} aria-label="Close" title="Close">
                  x
                </button>
              </div>
              <p className="users-guide-copy">
                Choose a processed source, inspect extracted entities and segments, edit Tags, Speakers, and Text, then save the reviewed output.
              </p>
            </div>
          </div>
        ) : null}

        {editingSpeakerLabel ? (
          <div className="modal-overlay" onClick={() => setEditingSpeakerLabel("")}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-title-bar">
                <div>
                  <h2>Edit Speaker Label</h2>
                </div>
                <button
                  type="button"
                  className="modal-icon-close"
                  onClick={() => {
                    setEditingSpeakerLabel("");
                    setEditingSpeakerLabelValue("");
                  }}
                  aria-label="Close"
                  title="Close"
                >
                  x
                </button>
              </div>
              <p className="surface-card-description">
                Rename "{editingSpeakerLabel}" across all matching segments in this processed source.
              </p>
              <label className="form-label">
                Speaker label
                <input
                  className="form-input"
                  value={editingSpeakerLabelValue}
                  onChange={(event) => setEditingSpeakerLabelValue(event.target.value)}
                  autoFocus
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!editingSpeakerLabelValue.trim() || !canReviewProcessedDocuments}
                  onClick={applySpeakerLabelEdit}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {exportModalOpen && selectedReviewRecord ? (
          <div className="modal-overlay" onClick={() => !exportBusy && setExportModalOpen(false)}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <div className="modal-title-bar">
                <div>
                  <h2>Export Processed Source</h2>
                </div>
                <button
                  type="button"
                  className="modal-icon-close"
                  onClick={() => setExportModalOpen(false)}
                  disabled={exportBusy}
                  aria-label="Close"
                  title="Close"
                >
                  x
                </button>
              </div>
              <div className="form">
                <label className="form-label">
                  Name
                  <input
                    className="form-input"
                    value={exportName}
                    onChange={(event) => setExportName(event.target.value)}
                    autoFocus
                  />
                </label>
                <label className="form-label">
                  Description
                  <textarea
                    className="form-input"
                    rows={5}
                    value={exportDescription}
                    onChange={(event) => setExportDescription(event.target.value)}
                  />
                </label>
                <label className="ai-process-doc-lens">
                  <input
                    type="checkbox"
                    checked={copySourceAttributesOnExport}
                    disabled={exportBusy}
                    onChange={(event) => setCopySourceAttributesOnExport(event.target.checked)}
                  />
                  <span>Copy source attributes from the raw text source</span>
                </label>
                {exportError ? <div className="form-error project-settings-error">{exportError}</div> : null}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void handleExportToProject()}
                    disabled={exportBusy || !exportName.trim() || !canReviewProcessedDocuments}
                  >
                    {exportBusy ? "Exporting" : "Export"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="view users-view ai-process-doc-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Transcripts</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Open help"
            aria-label="Open help"
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <div className="view-header-actions">
          {selectedProcessGroup === "processed" ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canReviewProcessedDocuments || reviewRecords.length === 0}
              onClick={openReviewWorkspace}
              title={!canReviewProcessedDocuments ? "You do not have permission to review processed sources for this project." : undefined}
            >
              Open Review
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p className="users-error">{error}</p> : null}
      {notice ? <p className="settings-success">{notice}</p> : null}

      <div
        className="postgres-sources-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)",
          gap: 20,
          alignItems: "center",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          className="home-primary-column"
          style={{
            alignSelf: "center",
            justifyContent: "flex-start",
            gap: 16,
            minHeight: 0,
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 4,
          }}
        >
          <section className="home-project-card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 18,
                borderBottom: "1px solid rgba(53, 80, 112, 0.08)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <h2 style={{ margin: 0, fontSize: 18 }}>Source Types</h2>
                </div>
              </div>
            </div>

            <div>
              <table className="users-table" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th className="users-th" style={{ width: "62%" }}>Group</th>
                    <th className="users-th" style={{ width: "38%" }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {processGroupRows.map((group) => (
                    <tr
                      key={group.key}
                      className="users-row"
                      style={{
                        background: selectedProcessGroup === group.key ? "rgba(53, 80, 112, 0.10)" : undefined,
                        cursor: "pointer",
                      }}
                      onClick={() => setSelectedProcessGroup(group.key)}
                    >
                      <td
                        className="users-td users-td--name"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedProcessGroup(group.key);
                          }
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span>{group.label}</span>
                        </div>
                      </td>
                      <td className="users-td users-td--muted">{group.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section
          className="users-content"
          style={{
            alignItems: "stretch",
            justifyContent: "center",
            gap: 16,
            minHeight: 0,
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 4,
          }}
        >
          <div className="home-project-card ai-process-doc-source-card">
            <div className="ai-process-doc-source-card-header">
              <h2>{selectedProcessGroup === "raw" ? "Text Sources" : "Transcripts"}</h2>
              {selectedProcessGroup === "raw" ? (
                <button
                  type="button"
                  className="btn btn--primary ai-process-doc-process-icon-button"
                  disabled={busy || selectedSourceIds.length === 0 || !canUseAiProcessDocuments}
                  onClick={() => setProcessModalOpen(true)}
                  title={!canUseAiProcessDocuments ? "You do not have permission to process sources for this project." : busy ? "Processing selected sources" : "Process selected sources"}
                  aria-label={busy ? "Processing selected sources" : "Process selected sources"}
                >
                  <ProcessTranscriptIcon className="ai-process-doc-process-icon" />
                </button>
              ) : null}
            </div>
            <div
              className="users-table-wrap"
              style={{
                maxHeight: 34 + (Math.max(loading ? 1 : selectedProcessGroup === "raw" ? processableSources.length : reviewRecords.length, 1) + 2) * 36,
              }}
            >
            <table className="users-table">
              <thead>
                {selectedProcessGroup === "raw" ? (
                  <tr>
                    <th className="users-th" style={{ width: "8%" }} />
                    <th className="users-th" style={{ width: "44%" }}>Source</th>
                    <th className="users-th" style={{ width: "18%" }}>Type</th>
                    <th className="users-th" style={{ width: "14%" }}>Status</th>
                    <th className="users-th" style={{ width: "16%" }}>Updated</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="users-th" style={{ width: "42%" }}>Source</th>
                    <th className="users-th" style={{ width: "18%" }}>Status</th>
                    <th className="users-th" style={{ width: "16%" }}>Chunks</th>
                    <th className="users-th" style={{ width: "24%" }}>Processed</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={selectedProcessGroup === "raw" ? 5 : 4} className="users-td-msg">Loading sources...</td>
                  </tr>
                ) : selectedProcessGroup === "raw" ? (
                  processableSources.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="users-td-msg">No raw text sources available.</td>
                    </tr>
                  ) : (
                    processableSources.map((source) => {
                      const checked = selectedSourceIds.includes(source.id);
                      const review = reviewBySourceId.get(source.id);
                      const status = review
                        ? review.exportedToProject
                          ? "exported"
                          : "processed"
                        : "none";
                      return (
                        <tr
                          key={source.id}
                          className={`users-row case-list-row${checked ? " assoc-doc-row--selected" : ""}`}
                          onClick={() => toggleSource(source.id)}
                          style={{ cursor: "pointer" }}
                        >
                          <td className="users-td">
                            <input
                              className="memo-sel-checkbox"
                              type="checkbox"
                              checked={checked}
                              disabled={busy}
                              onChange={() => toggleSource(source.id)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </td>
                          <td className="users-td users-td--name">{source.title || "Untitled source"}</td>
                          <td className="users-td users-td--muted">{source.sourceKind || "Text"}</td>
                          <td className="users-td users-td--muted">{status}</td>
                          <td className="users-td users-td--muted">{formatProcessedReviewDate(source.updatedAt)}</td>
                        </tr>
                      );
                    })
                  )
                ) : reviewRecords.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="users-td-msg">No processed sources yet.</td>
                  </tr>
                ) : (
                  reviewRecords.map((record) => (
                    <tr
                      key={record.id}
                      className={`users-row case-list-row${selectedReviewRecord?.id === record.id ? " assoc-doc-row--selected" : ""}`}
                      onClick={() => {
                        openReviewRecord(record);
                        setReviewWorkspaceOpen(true);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="users-td users-td--name">{record.sourceTitle || "Untitled source"}</td>
                      <td className="users-td users-td--muted">
                        {record.status === "reviewed"
                          ? "reviewed"
                          : record.processingStatus === "error"
                            ? "failed"
                            : record.processingStatus === "partial"
                              ? "partial"
                              : record.processingStatus === "running"
                                ? "running"
                                : "pending"}
                      </td>
                      <td className="users-td users-td--muted">{record.processedChunkCount}/{record.chunkCount}</td>
                      <td className="users-td users-td--muted">{formatProcessedReviewDate(record.updatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
          {selectedProcessGroup === "raw" && selectedSourceIds.length > 0 ? (
            <div className="ai-process-doc-home-copy" style={{ justifyContent: "flex-end" }}>
              <span>{selectedSourceIds.length} selected</span>
            </div>
          ) : selectedProcessGroup === "processed" ? (
            <div className="ai-process-doc-home-copy" style={{ justifyContent: "flex-end" }}>
              <span>{pendingReviewCount} pending review</span>
            </div>
          ) : null}
        </section>
      </div>

      {helpOpen ? (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help modal--wide" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title-bar">
              <div>
                <h2>Process into Transcript</h2>
              </div>
              <button type="button" className="modal-icon-close" onClick={() => setHelpOpen(false)} aria-label="Close" title="Close">
                x
              </button>
            </div>
            <p className="users-guide-copy">
              Choose text sources, process them with AI Assist, then review extracted transcript structure and names before using those outputs elsewhere in the project.
            </p>
          </div>
        </div>
      ) : null}

      {processModalOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setProcessModalOpen(false)}>
          <div className="modal modal--wide ai-process-doc-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-title-bar">
              <div>
                <h2>Process into Transcript</h2>
              </div>
              <button
                type="button"
                className="modal-icon-close"
                disabled={busy}
                onClick={() => setProcessModalOpen(false)}
                aria-label="Close"
                title="Close"
              >
                x
              </button>
            </div>
            <div className="ai-process-doc-modal-layout">
              <div>
                <div className="surface-card">
                  <div className="surface-card-header">
                    <div>
                      <div className="surface-card-title">Settings</div>
                    </div>
                  </div>
                  <div className="ai-process-doc-lenses">
                    {PROCESSED_DOCUMENT_REVIEW_LENSES.map((lens) => (
                      <div key={lens.id} className="ai-process-doc-lens">
                        <span>
                          <strong>{lens.label}</strong>
                        </span>
                        <div className="segmented-control" role="tablist" aria-label={lens.label}>
                          {([
                            { label: "Disabled", value: false },
                            { label: "Enabled", value: true },
                          ] as const).map((option) => (
                            <button
                              key={option.label}
                              type="button"
                              role="tab"
                              aria-selected={reviewLenses[lens.id] === option.value}
                              className={reviewLenses[lens.id] === option.value ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                              disabled={busy}
                              onClick={() => {
                                if (reviewLenses[lens.id] !== option.value) toggleReviewLens(lens.id);
                              }}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {error ? <div className="form-error project-settings-error">{error}</div> : null}
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || selectedSources.length === 0 || !canUseAiProcessDocuments}
                onClick={() => void processSelectedSources(false)}
              >
                {busy ? "Processing" : "Process"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
