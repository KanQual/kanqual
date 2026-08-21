import { formatCurrentDateTime } from "../i18n/formatters";

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

export function formatProcessedReviewDate(iso: string): string {
  if (!iso) return "-";
  try {
    return formatCurrentDateTime(iso, {
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
