import type { ReactNode } from "react";

export type ProcessedTranscriptSegmentType = "metadata" | "question" | "answer";

export type ProcessedTranscriptSegment = {
  segmentType: ProcessedTranscriptSegmentType;
  speakerId: string;
  timestampText: string;
  startOffset: number;
  endOffset: number;
  sortOrder: number;
  text: string;
  chunkIndex: number;
};

function normalizeSegmentType(value: unknown): ProcessedTranscriptSegmentType {
  const lowered = String(value ?? "").trim().toLowerCase();
  if (lowered === "metadata" || lowered === "question") return lowered;
  return "answer";
}

export function parseProcessedTranscriptSegments(value: unknown): ProcessedTranscriptSegment[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((segment, index) => {
        if (!segment || typeof segment !== "object") return null;
        const record = segment as Record<string, unknown>;
        const text = String(record.text ?? "").trim();
        if (!text) return null;
        return {
          segmentType: normalizeSegmentType(record.segmentType),
          speakerId: String(record.speakerId ?? "").trim(),
          timestampText: String(record.timestampText ?? "").trim(),
          startOffset: Number(record.startOffset ?? 0),
          endOffset: Number(record.endOffset ?? 0),
          sortOrder: Number(record.sortOrder ?? index),
          text,
          chunkIndex: Number(record.chunkIndex ?? 0),
        } satisfies ProcessedTranscriptSegment;
      })
      .filter((segment): segment is ProcessedTranscriptSegment => Boolean(segment))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.startOffset - right.startOffset);
  } catch {
    return [];
  }
}

export function buildProcessedTranscriptContent(
  inputSegments: ProcessedTranscriptSegment[],
): { content: string; segments: ProcessedTranscriptSegment[] } {
  let content = "";
  const segments = inputSegments
    .map((segment, index) => ({
      ...segment,
      segmentType: normalizeSegmentType(segment.segmentType),
      speakerId: String(segment.speakerId ?? "").trim(),
      timestampText: String(segment.timestampText ?? "").trim(),
      text: String(segment.text ?? "").trim(),
      sortOrder: index,
      chunkIndex: Number(segment.chunkIndex ?? 0),
    }))
    .filter((segment) => segment.text.length > 0)
    .map((segment, index) => {
      if (content) content += "\n\n";
      const startOffset = content.length;
      content += segment.text;
      return {
        ...segment,
        sortOrder: index,
        startOffset,
        endOffset: content.length,
      };
    });

  return { content, segments };
}

export function getProcessedTranscriptQuestionOutline(
  segments: ProcessedTranscriptSegment[],
): Array<{ sortOrder: number; label: string }> {
  return segments
    .filter((segment) => segment.segmentType === "question")
    .map((segment) => ({
      sortOrder: segment.sortOrder,
      label: segment.text.replace(/\s+/g, " ").trim() || "Untitled question",
    }));
}

export function ProcessedTranscriptView({
  segments,
  renderSegmentText,
  selectedSortOrder,
}: {
  segments: ProcessedTranscriptSegment[];
  renderSegmentText: (segment: ProcessedTranscriptSegment) => ReactNode;
  selectedSortOrder?: number | null;
}) {
  return (
    <div className="processed-transcript-view">
      {segments.map((segment, index) => {
        const speakerLabel = segment.speakerId.trim() || (segment.segmentType === "metadata" ? "Metadata" : "Unlabeled");
        return (
          <section
            key={`${segment.sortOrder}-${segment.startOffset}-${index}`}
            className={`processed-transcript-segment processed-transcript-segment--${segment.segmentType}${
              selectedSortOrder === segment.sortOrder ? " processed-transcript-segment--outline-active" : ""
            }`}
            data-transcript-sort-order={segment.sortOrder}
          >
            <div
              className="processed-transcript-speaker"
              data-speaker={speakerLabel}
              aria-hidden="true"
            />
            <div className="processed-transcript-body">
              {segment.timestampText.trim() && (
                <div className="processed-transcript-timestamp">
                  {segment.timestampText.trim()}
                </div>
              )}
              <div className="processed-transcript-text">
                {renderSegmentText(segment)}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
