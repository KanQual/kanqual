import type { RecordModel } from "pocketbase";

export const PROCESSED_DOCUMENT_REVIEW_COLLECTION = "processed_document_reviews";

export type TranscriptProcessingSegment = {
  segmentType: "metadata" | "question" | "answer";
  speakerId: string;
  timestampText: string;
  startOffset: number;
  endOffset: number;
  sortOrder: number;
  text: string;
  chunkIndex: number;
};

export type TranscriptNameCandidate = {
  text: string;
  sourceType: string;
};

export type ProcessedDocumentReviewLensId = "speaker-segmentation" | "named-entity-extraction";

export type ProcessedDocumentReviewLens = {
  id: ProcessedDocumentReviewLensId;
  label: string;
  description: string;
};

export type SpeakerSummary = {
  id: string;
  turnCount: number;
  questionCount: number;
  answerCount: number;
};

export type ProcessedDocumentReviewRecord = {
  id: string;
  projectId: string;
  documentId: string;
  documentName: string;
  filePath: string;
  status: "pending_review" | "reviewed";
  processingStatus: "idle" | "running" | "partial" | "completed" | "error";
  processingError: string;
  processedChunkCount: number;
  processedContent: string;
  segments: TranscriptProcessingSegment[];
  properNameCandidates: TranscriptNameCandidate[];
  enabledReviewLenses: Record<ProcessedDocumentReviewLensId, boolean>;
  model: string;
  baseUrl: string;
  chunkCount: number;
  exportedToProject: boolean;
  createdAt: string;
  updatedAt: string;
};

export const PROCESSED_DOCUMENT_REVIEW_LENSES: ProcessedDocumentReviewLens[] = [
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

export const DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES: Record<ProcessedDocumentReviewLensId, boolean> = {
  "speaker-segmentation": true,
  "named-entity-extraction": true,
};

function parseJsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
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
  const fallback = DEFAULT_PROCESSED_DOCUMENT_REVIEW_LENSES;
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

export function formatProcessedReviewDate(iso: string): string {
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

export function segmentContainsTimestamp(segment: TranscriptProcessingSegment): boolean {
  if (segment.timestampText.trim()) return true;
  const patterns = [
    /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
    /\[\d{1,2}:\d{2}(?::\d{2})?\]/g,
    /\[\d{1,2}:\d{2}(?::\d{2})?\s*-\s*\d{1,2}:\d{2}(?::\d{2})?\]/g,
    /\b\d{1,2}\.\d{2}(?::\d{2})?\b/g,
  ];
  return patterns.some((pattern) => pattern.test(segment.text));
}

export function collectSpeakerSummaries(segments: TranscriptProcessingSegment[]): SpeakerSummary[] {
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

export function getFirstEnabledProcessedReviewLens(
  enabledReviewLenses: Record<ProcessedDocumentReviewLensId, boolean>,
): ProcessedDocumentReviewLensId {
  return PROCESSED_DOCUMENT_REVIEW_LENSES.find((lens) => enabledReviewLenses[lens.id])?.id ?? "speaker-segmentation";
}

export function toProcessedReviewRecord(record: RecordModel): ProcessedDocumentReviewRecord {
  return {
    id: record.id,
    projectId: String(record.project ?? ""),
    documentId: String(record.document ?? ""),
    documentName: String(record.document_name ?? ""),
    filePath: String(record.file_path ?? ""),
    status: record.status === "reviewed" ? "reviewed" : "pending_review",
    processingStatus:
      record.processing_status === "running"
        ? "running"
        : record.processing_status === "partial"
          ? "partial"
          : record.processing_status === "completed"
            ? "completed"
            : record.processing_status === "error"
              ? "error"
              : "idle",
    processingError: String(record.processing_error ?? ""),
    processedChunkCount: Number(record.processed_chunk_count ?? 0),
    processedContent: String(record.processed_content ?? ""),
    segments: normalizeTranscriptSegments(parseJsonValue<unknown[]>(record.segments_json, [])),
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
