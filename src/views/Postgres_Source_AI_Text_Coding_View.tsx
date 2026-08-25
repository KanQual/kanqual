import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FilterIcon } from "../components/FilterIcon";
import { SettingsModal } from "../components/SettingsModal";
import {
  ProcessedTranscriptView,
  parseProcessedTranscriptSegments,
} from "../components/ProcessedTranscriptView";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { useI18n } from "../i18n/provider";
import { readAppSettings } from "../lib/appSettings";
import type { RelevantSegmentsAiJobResult } from "../lib/aiJobs";
import { buildLlmInvokeRequestFields } from "../lib/llmRuntime";
import { NewCodeModal, type CodeRow } from "./Project_Codebook_View";
import type { SourceAnnotationRow } from "./Postgres_Sources_View";
import {
  AnnotationEditorModal,
  buildMultiAnnotationBackground,
  getFloatingTooltipStyle,
  PostgresSourceAnnotationContextMenu,
  type AnnotationContextMenuState,
  PostgresSourceCodebookCard,
  type PostgresSourceCodingViewProps,
  PostgresSourceAnnotationPanel,
  PostgresSourceCodingFiltersModal,
  SOURCE_TEXT_SIZE_DEFAULT_PX,
  SOURCE_TEXT_SIZE_MAX_PX,
  SOURCE_TEXT_SIZE_MIN_PX,
  SOURCE_TEXT_SIZE_STEP_PX,
  TextSizeControls,
  tooltipExcerpt,
  type AnnotationHover,
  type StripeBar,
  type StripeHover,
} from "./Postgres_Source_Coding_Shared";

const STRIPE_LANE_WIDTH = 8;
const STRIPE_GUTTER_BASE = 24;
const TRANSCRIPT_OUTLINE_PREVIEW_LIMIT = 88;
const RELEVANT_SEGMENTS_SEARCH_TIMEOUT_MS = 60 * 1000;

type PostgresRelevantSegment = RelevantSegmentsAiJobResult["segments"][number];

function resolveRelevantSegmentRange(
  documentText: string,
  segment: PostgresRelevantSegment,
): { startOffset: number; endOffset: number; quote: string } | null {
  const startOffset = typeof segment.startOffset === "number" ? segment.startOffset : null;
  const endOffset = typeof segment.endOffset === "number" ? segment.endOffset : null;
  if (startOffset != null && endOffset != null && endOffset > startOffset) {
    const start = Math.max(0, Math.min(startOffset, documentText.length));
    const end = Math.max(start, Math.min(endOffset, documentText.length));
    if (end > start) return { startOffset: start, endOffset: end, quote: documentText.slice(start, end) };
  }

  const matchText = (segment.matchText || segment.preview || "").trim();
  if (!matchText) return null;
  const index = documentText.indexOf(matchText);
  if (index === -1) return null;
  return { startOffset: index, endOffset: index + matchText.length, quote: matchText };
}

function formatRuntime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function scrollViewerTargetToStart(viewer: HTMLElement, target: HTMLElement) {
  const viewerRect = viewer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetTop = targetRect.top - viewerRect.top + viewer.scrollTop;
  viewer.scrollTo({
    top: Math.max(0, targetTop - 16),
    behavior: "smooth",
  });
}

function formatTranscriptSegmentTag(segmentType: string): string {
  const normalized = segmentType.trim().toLowerCase();
  if (normalized === "metadata") return "Metadata";
  if (normalized === "question") return "Question";
  return "Answer";
}

function truncateTranscriptOutlineText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= TRANSCRIPT_OUTLINE_PREVIEW_LIMIT) return normalized;
  return `${normalized.slice(0, TRANSCRIPT_OUTLINE_PREVIEW_LIMIT - 1).trimEnd()}...`;
}

export function PostgresSourceAiTextCodingView({
  projectId,
  row,
  codes,
  annotations,
  codeOptions,
  currentUserId,
  sourceLock,
  sourceLockConflict,
  lockSyncing,
  canKickSourceLocks,
  canManageAnnotations,
  canManageMemos,
  canCreateCodes,
  initialSelectedAnnotationId,
  initialTextSegment,
  saving,
  error,
  onCreateCode,
  onUpdateCode,
  onDeleteCode,
  onCreateAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onKickSourceLock,
  onOpenMemoDraft,
  onBack,
}: PostgresSourceCodingViewProps) {
  const { t } = useI18n();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [selectedOutlineSortOrder, setSelectedOutlineSortOrder] = useState<number | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    startOffset: number;
    endOffset: number;
    quote: string;
  } | null>(null);
  const [editingAnnotation, setEditingAnnotation] = useState<SourceAnnotationRow | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [scrollToAnnotationId, setScrollToAnnotationId] = useState<string | null>(null);
  const [selectedTextSegment, setSelectedTextSegment] = useState<{ startOffset: number; endOffset: number } | null>(null);
  const [scrollToTextSegment, setScrollToTextSegment] = useState(false);
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const [newCodeOpen, setNewCodeOpen] = useState(false);
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null);
  const [childCodeParentId, setChildCodeParentId] = useState<string | null>(null);
  const [deletingCodeId, setDeletingCodeId] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState(false);
  const [deleteCodeError, setDeleteCodeError] = useState("");
  const [relevantSegmentsOpen, setRelevantSegmentsOpen] = useState(false);
  const [relevantSegmentsSearching, setRelevantSegmentsSearching] = useState(false);
  const [relevantSegmentsStartedAt, setRelevantSegmentsStartedAt] = useState<number | null>(null);
  const [relevantSegmentsRuntimeMs, setRelevantSegmentsRuntimeMs] = useState(0);
  const [relevantSegmentsError, setRelevantSegmentsError] = useState("");
  const [relevantSegmentsNotice, setRelevantSegmentsNotice] = useState("");
  const [relevantSegmentsModel, setRelevantSegmentsModel] = useState("");
  const [relevantSegments, setRelevantSegments] = useState<PostgresRelevantSegment[]>([]);
  const [activeRelevantSegmentId, setActiveRelevantSegmentId] = useState<string | null>(null);
  const [hiddenUserIds, setHiddenUserIds] = useState<Set<string>>(new Set());
  const [hiddenCodeIds, setHiddenCodeIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [textSizePx, setTextSizePx] = useState(SOURCE_TEXT_SIZE_DEFAULT_PX);
  const [stripeBars, setStripeBars] = useState<StripeBar[]>([]);
  const [stripeHover, setStripeHover] = useState<StripeHover | null>(null);
  const [annotationHover, setAnnotationHover] = useState<AnnotationHover | null>(null);
  const [annotationContextMenu, setAnnotationContextMenu] = useState<AnnotationContextMenuState | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const contentSelectionRef = useRef<HTMLDivElement | null>(null);
  const annotationContextMenuRef = useRef<HTMLDivElement | null>(null);
  const annotationContextMenuStyle = useViewportContextMenuStyle(annotationContextMenu, annotationContextMenuRef);

  const normalizedSourceType = row.type.trim().toLowerCase().replace(/_/g, " ");
  const isProcessedTranscriptSource = normalizedSourceType === "processed transcript"
    || normalizedSourceType === "transcript";
  const processedTranscriptSegments =
    isProcessedTranscriptSource
      ? parseProcessedTranscriptSegments(row.structuredContentJson)
      : [];
  const transcriptOutlineItems = useMemo(
    () => processedTranscriptSegments.map((segment, index) => ({
      sortOrder: segment.sortOrder,
      tag: formatTranscriptSegmentTag(segment.segmentType),
      speaker: segment.speakerId.trim() || (segment.segmentType === "metadata" ? "Metadata" : "Unlabeled"),
      label: truncateTranscriptOutlineText(segment.text) || `Segment ${index + 1}`,
      title: segment.text.replace(/\s+/g, " ").trim(),
    })),
    [processedTranscriptSegments],
  );
  const canEditAnnotations = canManageAnnotations && !!sourceLock && sourceLock.userId === currentUserId && !sourceLockConflict;
  const codesById = useMemo(() => new Map(codes.map((code) => [code.id, code])), [codes]);
  const selectedCode = selectedCodeId ? codesById.get(selectedCodeId) ?? null : null;
  const codebookRows = useMemo<CodeRow[]>(() => codes.map((code) => {
    const parentCode = code.parentCodeId ? codesById.get(code.parentCodeId) : null;
    return {
      id: code.id,
      label: code.label,
      color: code.color,
      description: code.description,
      parentId: code.parentCodeId,
      parentLabel: parentCode?.label ?? "",
      createdByName: "",
      createdAt: code.createdAt,
      sourcesCount: 0,
    };
  }), [codes, codesById]);
  const editingCodeRow = editingCodeId ? codebookRows.find((code) => code.id === editingCodeId) ?? null : null;
  const childCodeParentRow = childCodeParentId ? codebookRows.find((code) => code.id === childCodeParentId) ?? null : null;
  const deletingCodeRow = deletingCodeId ? codebookRows.find((code) => code.id === deletingCodeId) ?? null : null;
  const filteredAnnotations = useMemo(
    () => annotations.filter((annotation) => {
      const userKey = annotation.createdByName || "Unknown";
      if (hiddenUserIds.has(userKey)) return false;
      if (annotation.codeIds.some((codeId) => hiddenCodeIds.has(codeId))) return false;
      return true;
    }),
    [annotations, hiddenCodeIds, hiddenUserIds],
  );
  const annotationCountByCodeId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of filteredAnnotations) {
      for (const codeId of annotation.codeIds) {
        counts.set(codeId, (counts.get(codeId) ?? 0) + 1);
      }
    }
    return counts;
  }, [filteredAnnotations]);
  const rangedAnnotations = useMemo(
    () => filteredAnnotations
      .filter((annotation) => annotation.startOffset != null && annotation.endOffset != null && (annotation.endOffset ?? 0) > (annotation.startOffset ?? 0))
      .map((annotation) => ({
        ...annotation,
        startOffset: annotation.startOffset as number,
        endOffset: annotation.endOffset as number,
      }))
      .filter((annotation) => annotation.startOffset >= 0 && annotation.endOffset <= row.content.length)
      .sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset),
    [filteredAnnotations, row.content.length],
  );
  const { annotationLaneById, annotationLaneCount } = useMemo(() => {
    const laneEnds: number[] = [];
    const laneById = new Map<string, number>();
    for (const annotation of rangedAnnotations) {
      let laneIndex = laneEnds.findIndex((endOffset) => annotation.startOffset >= endOffset);
      if (laneIndex === -1) {
        laneIndex = laneEnds.length;
        laneEnds.push(annotation.endOffset);
      } else {
        laneEnds[laneIndex] = annotation.endOffset;
      }
      laneById.set(annotation.id, laneIndex);
    }
    return {
      annotationLaneById: laneById,
      annotationLaneCount: laneEnds.length,
    };
  }, [rangedAnnotations]);

  useLayoutEffect(() => {
    if (!initialSelectedAnnotationId) return;
    if (!filteredAnnotations.some((annotation) => annotation.id === initialSelectedAnnotationId)) return;
    setSelectedAnnotationId(initialSelectedAnnotationId);
    setSelectedTextSegment(null);
    setScrollToAnnotationId(initialSelectedAnnotationId);
  }, [filteredAnnotations, initialSelectedAnnotationId]);

  useLayoutEffect(() => {
    if (!initialTextSegment) return;
    const startOffset = Math.max(0, Math.min(initialTextSegment.startOffset, row.content.length));
    const endOffset = Math.max(startOffset, Math.min(initialTextSegment.endOffset, row.content.length));
    if (endOffset <= startOffset) return;
    setSelectedAnnotationId(null);
    setSelectedTextSegment({ startOffset, endOffset });
    setScrollToTextSegment(true);
  }, [initialTextSegment, row.content.length]);

  useEffect(() => {
    if (selectedAnnotationId && !filteredAnnotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
  }, [filteredAnnotations, selectedAnnotationId]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (annotationContextMenuRef.current && !annotationContextMenuRef.current.contains(event.target as Node)) {
        setAnnotationContextMenu(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAnnotationContextMenu(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (selectedOutlineSortOrder == null || !viewerRef.current) return;
    const target = viewerRef.current.querySelector<HTMLElement>(`[data-transcript-sort-order="${selectedOutlineSortOrder}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedOutlineSortOrder]);

  useEffect(() => {
    if (!relevantSegmentsSearching || relevantSegmentsStartedAt == null) return;
    setRelevantSegmentsRuntimeMs(Date.now() - relevantSegmentsStartedAt);
    const timer = window.setInterval(() => {
      setRelevantSegmentsRuntimeMs(Date.now() - relevantSegmentsStartedAt);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [relevantSegmentsSearching, relevantSegmentsStartedAt]);

  useEffect(() => {
    if (!scrollToAnnotationId || !viewerRef.current) return;
    const target = viewerRef.current.querySelector<HTMLElement>(`[data-anns~="${scrollToAnnotationId}"]`);
    if (!target) return;
    scrollViewerTargetToStart(viewerRef.current, target);
    target.classList.add("annotation-flash");
    const timer = window.setTimeout(() => target.classList.remove("annotation-flash"), 1500);
    setScrollToAnnotationId(null);
    return () => window.clearTimeout(timer);
  }, [scrollToAnnotationId]);

  useEffect(() => {
    if (!scrollToTextSegment || !viewerRef.current) return;
    const target = viewerRef.current.querySelector<HTMLElement>("[data-text-segment-citation='true']");
    if (!target) return;
    scrollViewerTargetToStart(viewerRef.current, target);
    target.classList.add("text-segment-citation-flash");
    const timer = window.setTimeout(() => target.classList.remove("text-segment-citation-flash"), 1500);
    setScrollToTextSegment(false);
    return () => window.clearTimeout(timer);
  }, [scrollToTextSegment, selectedTextSegment]);

  useEffect(() => {
    const container = viewerRef.current;
    if (!container || rangedAnnotations.length === 0) {
      setStripeBars([]);
      return;
    }
    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const nextBars: StripeBar[] = [];
      for (const annotation of rangedAnnotations) {
        const spans = container.querySelectorAll<HTMLElement>(`[data-anns~="${annotation.id}"]`);
        let minTop = Number.POSITIVE_INFINITY;
        let maxBottom = Number.NEGATIVE_INFINITY;
        spans.forEach((span) => {
          Array.from(span.getClientRects()).forEach((rect) => {
            if (rect.height <= 0) return;
            const top = rect.top - containerRect.top + container.scrollTop;
            const bottom = rect.bottom - containerRect.top + container.scrollTop;
            minTop = Math.min(minTop, top);
            maxBottom = Math.max(maxBottom, bottom);
          });
        });
        if (!Number.isFinite(minTop) || !Number.isFinite(maxBottom)) continue;
        nextBars.push({
          annotationId: annotation.id,
          color: annotation.codeColors[0] || "#355070",
          column: annotationLaneById.get(annotation.id) ?? 0,
          top: minTop,
          height: Math.max(6, maxBottom - minTop),
          label: annotation.codeLabels.join(", ") || "Annotation",
          quote: annotation.quote,
        });
      }
      setStripeBars(nextBars);
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [annotationLaneById, rangedAnnotations]);

  useEffect(() => {
    function handleSelectionChange() {
      if (!pendingSelection || !contentSelectionRef.current) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setPendingSelection(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!contentSelectionRef.current.contains(range.commonAncestorContainer)) {
        setPendingSelection(null);
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [pendingSelection]);

  function handleMouseUp() {
    if (!canEditAnnotations || !contentSelectionRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setPendingSelection(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!contentSelectionRef.current.contains(range.commonAncestorContainer)) {
      setPendingSelection(null);
      return;
    }
    const quote = selection.toString();
    if (!quote.trim()) {
      setPendingSelection(null);
      return;
    }
    const preRange = document.createRange();
    preRange.selectNodeContents(contentSelectionRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const endOffset = startOffset + quote.length;
    setPendingSelection({ startOffset, endOffset, quote });
  }

  function decreaseTextSize() {
    setTextSizePx((current) => Math.max(SOURCE_TEXT_SIZE_MIN_PX, current - SOURCE_TEXT_SIZE_STEP_PX));
  }

  function increaseTextSize() {
    setTextSizePx((current) => Math.min(SOURCE_TEXT_SIZE_MAX_PX, current + SOURCE_TEXT_SIZE_STEP_PX));
  }

  async function handleQuickCode(codeId: string) {
    setSelectedCodeId(codeId);
    if (!pendingSelection || !canEditAnnotations || saving) return;
    await onCreateAnnotation(row.id, pendingSelection, { codeIds: [codeId], note: "" });
    setPendingSelection(null);
    setActiveRelevantSegmentId(null);
  }

  async function handleConfirmDeleteCode() {
    if (!deletingCodeId || !onDeleteCode) return;
    setDeletingCode(true);
    setDeleteCodeError("");
    try {
      await onDeleteCode(deletingCodeId);
      if (selectedCodeId === deletingCodeId) setSelectedCodeId(null);
      setDeletingCodeId(null);
    } catch (deleteError) {
      setDeleteCodeError(deleteError instanceof Error ? deleteError.message : "Failed to delete code.");
    } finally {
      setDeletingCode(false);
    }
  }

  function openRelevantSegment(segment: PostgresRelevantSegment) {
    setActiveRelevantSegmentId(segment.id);
    if (segment.annotationId) {
      const annotation = filteredAnnotations.find((entry) => entry.id === segment.annotationId);
      if (annotation) {
        setSelectedAnnotationId(annotation.id);
        setSelectedTextSegment(null);
        setScrollToAnnotationId(annotation.id);
        return;
      }
    }
    const range = resolveRelevantSegmentRange(row.content, segment);
    if (!range) return;
    setSelectedAnnotationId(null);
    setSelectedTextSegment({ startOffset: range.startOffset, endOffset: range.endOffset });
    setScrollToTextSegment(true);
  }

  async function applyRelevantSegment(segment: PostgresRelevantSegment) {
    if (!selectedCode || !canEditAnnotations || saving) return;
    const range = resolveRelevantSegmentRange(row.content, segment);
    if (!range) {
      setRelevantSegmentsError("Could not locate this segment in the current source.");
      return;
    }
    await onCreateAnnotation(row.id, range, { codeIds: [selectedCode.id], note: "" });
    setActiveRelevantSegmentId(null);
    setSelectedTextSegment(null);
  }

  async function searchRelevantSegments() {
    if (!selectedCode) {
      setRelevantSegmentsError("Select one code before searching.");
      return;
    }
    setRelevantSegmentsOpen(true);
    setRelevantSegmentsSearching(true);
    const startedAt = Date.now();
    setRelevantSegmentsStartedAt(startedAt);
    setRelevantSegmentsRuntimeMs(0);
    setRelevantSegmentsError("");
    setRelevantSegmentsNotice("");
    try {
      const llmSettings = readAppSettings().llm;
      const result = await invoke<RelevantSegmentsAiJobResult>("find_relevant_project_segments_with_ollama", {
        request: {
          projectId,
          activeDocumentId: row.id,
          codeId: selectedCode.id,
          codeLabel: selectedCode.label,
          codeDescription: selectedCode.description || null,
          ...buildLlmInvokeRequestFields(llmSettings),
          timeoutSeconds: Math.floor(RELEVANT_SEGMENTS_SEARCH_TIMEOUT_MS / 1000),
          candidateLimit: llmSettings.ollamaRelevantSegmentsCandidateLimit,
          maxResults: llmSettings.ollamaRelevantSegmentsMaxResults,
          prefixQueries: llmSettings.prefixQueries,
        },
      });
      const sourceSegments = result.segments.filter((segment) => (segment.sourceId ?? segment.documentId ?? row.id) === row.id);
      setRelevantSegments(sourceSegments);
      setRelevantSegmentsModel(result.model);
      setRelevantSegmentsNotice(
        sourceSegments.length === 0
          ? `${result.model} reviewed ${result.searchedItems} indexed candidates but did not identify any strong matches yet.`
          : "",
      );
    } catch (error) {
      console.error("PostgreSQL relevant segment search failed:", error);
      setRelevantSegmentsError(error instanceof Error ? error.message : "Relevant segment search failed.");
    } finally {
      setRelevantSegmentsSearching(false);
    }
  }

  function clearRelevantSegments() {
    setRelevantSegments([]);
    setRelevantSegmentsError("");
    setRelevantSegmentsNotice("");
    setRelevantSegmentsModel("");
    setRelevantSegmentsStartedAt(null);
    setRelevantSegmentsRuntimeMs(0);
    setActiveRelevantSegmentId(null);
    setSelectedTextSegment(null);
  }

  function renderAnnotatedTextRange(
    text: string,
    absoluteStartOffset: number,
    absoluteEndOffset: number,
    keyPrefix: string,
  ) {
    const selectedAnnotation = selectedAnnotationId
      ? rangedAnnotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null
      : null;

    const boundaries = new Set<number>([absoluteStartOffset, absoluteEndOffset]);
    for (const annotation of rangedAnnotations) {
      if (annotation.startOffset > absoluteStartOffset && annotation.startOffset < absoluteEndOffset) {
        boundaries.add(annotation.startOffset);
      }
      if (annotation.endOffset > absoluteStartOffset && annotation.endOffset < absoluteEndOffset) {
        boundaries.add(annotation.endOffset);
      }
    }
    if (selectedTextSegment) {
      if (selectedTextSegment.startOffset > absoluteStartOffset && selectedTextSegment.startOffset < absoluteEndOffset) {
        boundaries.add(selectedTextSegment.startOffset);
      }
      if (selectedTextSegment.endOffset > absoluteStartOffset && selectedTextSegment.endOffset < absoluteEndOffset) {
        boundaries.add(selectedTextSegment.endOffset);
      }
    }

    const orderedBoundaries = [...boundaries].sort((left, right) => left - right);

    return orderedBoundaries.slice(0, -1).map((start, index) => {
          const end = orderedBoundaries[index + 1];
          const rangeText = text.slice(start - absoluteStartOffset, end - absoluteStartOffset);
          const covering = rangedAnnotations.filter((annotation) => annotation.startOffset < end && annotation.endOffset > start);
          const isTextSegmentSelected = selectedTextSegment != null
            && selectedTextSegment.startOffset < end
            && selectedTextSegment.endOffset > start;
          const isTextSegmentStart = isTextSegmentSelected && selectedTextSegment != null && start === selectedTextSegment.startOffset;
          const isTextSegmentEnd = isTextSegmentSelected && selectedTextSegment != null && end === selectedTextSegment.endOffset;
          if (covering.length === 0) {
            return (
              <span
                key={`${keyPrefix}-${start}-${end}`}
                data-text-segment-citation={isTextSegmentSelected ? "true" : undefined}
                className={isTextSegmentSelected ? "text-segment-citation-highlight" : undefined}
                style={{
                  borderTopLeftRadius: isTextSegmentStart ? 4 : undefined,
                  borderBottomLeftRadius: isTextSegmentStart ? 4 : undefined,
                  borderTopRightRadius: isTextSegmentEnd ? 4 : undefined,
                  borderBottomRightRadius: isTextSegmentEnd ? 4 : undefined,
                }}
              >
                {rangeText}
              </span>
            );
          }
          const isSelected = selectedAnnotation != null
            && selectedAnnotation.startOffset < end
            && selectedAnnotation.endOffset > start;
          const isSelectedStart = isSelected && selectedAnnotation != null && start === selectedAnnotation.startOffset;
          const isSelectedEnd = isSelected && selectedAnnotation != null && end === selectedAnnotation.endOffset;
          const firstId = covering[0].id;
          const selectionOutlineParts = isSelected
            ? [
                "inset 0 2px 0 0 currentColor",
                "inset 0 -2px 0 0 currentColor",
                isSelectedStart ? "inset 2px 0 0 0 currentColor" : null,
                isSelectedEnd ? "inset -2px 0 0 0 currentColor" : null,
              ].filter((part): part is string => part != null)
            : [];
          return (
            <mark
              key={`${keyPrefix}-${start}-${end}`}
              data-anns={covering.map((annotation) => annotation.id).join(" ")}
              data-text-segment-citation={isTextSegmentSelected ? "true" : undefined}
              className={`annotation-highlight${covering.length > 1 ? " annotation-highlight--multi" : ""}${isSelected ? " annotation-highlight--selected" : ""}${isTextSegmentSelected ? " text-segment-citation-highlight" : ""}`}
              style={{
                background: buildMultiAnnotationBackground(covering.flatMap((annotation) => annotation.codeColors), isSelected),
                boxShadow: selectionOutlineParts.length > 0 ? selectionOutlineParts.join(", ") : undefined,
                borderRadius: isSelected ? 0 : undefined,
                borderTopLeftRadius: isSelectedStart ? 4 : undefined,
                borderBottomLeftRadius: isSelectedStart ? 4 : undefined,
                borderTopRightRadius: isSelectedEnd ? 4 : undefined,
                borderBottomRightRadius: isSelectedEnd ? 4 : undefined,
              }}
              onClick={() => {
                setSelectedAnnotationId(firstId);
                setSelectedTextSegment(null);
                setScrollToAnnotationId(firstId);
              }}
              onDoubleClick={() => {
                const annotation = filteredAnnotations.find((entry) => entry.id === firstId) ?? null;
                if (annotation && canEditAnnotations) setEditingAnnotation(annotation);
              }}
              onContextMenu={(event) => {
                if (!canManageMemos && !canEditAnnotations) return;
                const annotation = filteredAnnotations.find((entry) => entry.id === firstId) ?? null;
                if (!annotation) return;
                event.preventDefault();
                setSelectedAnnotationId(annotation.id);
                setAnnotationHover(null);
                setAnnotationContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  annotation,
                });
              }}
              onMouseEnter={(event) => {
                if (annotationContextMenu) return;
                setAnnotationHover({
                  x: event.clientX,
                  y: event.clientY,
                  items: covering.map((annotation) => ({
                    annotationId: annotation.id,
                    label: annotation.codeLabels.join(", ") || "Annotation",
                    color: annotation.codeColors[0] || "#355070",
                    quote: annotation.quote,
                  })),
                });
              }}
              onMouseMove={(event) => {
                if (annotationContextMenu) return;
                setAnnotationHover((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
              }}
              onMouseLeave={() => setAnnotationHover(null)}
            >
              {rangeText}
            </mark>
          );
        });
  }

  function renderCodingContent() {
    if (isProcessedTranscriptSource && processedTranscriptSegments.length > 0) {
      return (
        <div className="text-source-content-sized" style={{ fontSize: textSizePx }}>
          <ProcessedTranscriptView
            segments={processedTranscriptSegments}
            renderSegmentText={(segment) => renderAnnotatedTextRange(
              segment.text,
              segment.startOffset,
              segment.endOffset,
              `transcript-${segment.sortOrder}`,
            )}
            selectedSortOrder={selectedOutlineSortOrder}
          />
        </div>
      );
    }

    return (
      <pre className="doc-content-body" style={{ fontSize: textSizePx, whiteSpace: "pre-wrap" }}>
        {renderAnnotatedTextRange(row.content, 0, row.content.length, "text")}
      </pre>
    );
  }

  return (
    <div className="view doc-detail-view">
      <div className="workspace-back-row workspace-back-row--text-coding">
        <button className="btn" onClick={onBack}>Back</button>
      </div>

      <div className="annotate-layout code-text-annotate-layout" style={{ minHeight: 0 }}>
        <div className="annotate-left" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          <PostgresSourceCodebookCard
            codes={codes}
            selectedCodeId={selectedCodeId}
            annotationCountByCodeId={annotationCountByCodeId}
            canCreateCodes={canCreateCodes && !!onCreateCode}
            canManageMemos={canManageMemos}
            isAnnotatable={!!pendingSelection && canEditAnnotations}
            selectionHint={pendingSelection ? "Select a code to apply it to the current text selection." : null}
            saving={saving}
            style={{ flexShrink: 0 }}
            onSelectCode={handleQuickCode}
            onNewCode={() => setNewCodeOpen(true)}
            onEditCode={onUpdateCode ? (codeId) => {
              setEditingCodeId(codeId);
              setNewCodeOpen(false);
              setChildCodeParentId(null);
            } : undefined}
            onOpenMemoDraft={onOpenMemoDraft}
            onAddChildCode={onCreateCode ? (codeId) => {
              setChildCodeParentId(codeId);
              setNewCodeOpen(false);
              setEditingCodeId(null);
            } : undefined}
            onDeleteCode={onDeleteCode ? (codeId) => {
              setDeletingCodeId(codeId);
              setDeleteCodeError("");
            } : undefined}
          />

          <PostgresSourceAnnotationPanel
            annotations={filteredAnnotations}
            selectedAnnotationId={selectedAnnotationId}
            codesById={codesById}
          onSelectAnnotation={(annotationId) => {
            setSelectedAnnotationId(annotationId);
            setSelectedTextSegment(null);
            setScrollToAnnotationId(annotationId);
          }}
            onDeleteAnnotation={(annotationId) => {
              void onDeleteAnnotation(annotationId);
            }}
            onOpenMemoDraft={onOpenMemoDraft}
            canManageMemos={canManageMemos}
            canDeleteAnnotations={canEditAnnotations}
          />

        </div>

        <div className="annotate-main">
          <div className="annotate-card annotate-card--grow">
            <div className="doc-viewer-toolbar">
              <span className="doc-name">
                {row.name}
                {transcriptOutlineItems.length > 0 ? (
                  <span className="processed-transcript-outline-wrap">
                    <button
                      type="button"
                      className="processed-transcript-outline-btn"
                      aria-label="Show transcript outline"
                      aria-expanded={outlineOpen}
                      onClick={() => setOutlineOpen((open) => !open)}
                    >
                      ≡
                    </button>
                    {outlineOpen ? (
                      <div className="processed-transcript-outline-menu">
                        {transcriptOutlineItems.map((item, index) => (
                          <button
                            key={`${item.sortOrder}-${index}`}
                            type="button"
                            className="processed-transcript-outline-item"
                            onClick={() => {
                              setSelectedOutlineSortOrder(item.sortOrder);
                              setOutlineOpen(false);
                            }}
                            title={item.title || item.label}
                          >
                            <span className="processed-transcript-outline-meta">
                              <span className={`processed-transcript-outline-tag processed-transcript-outline-tag--${item.tag.toLowerCase()}`}>
                                {item.tag}
                              </span>
                              <span className="processed-transcript-outline-speaker">{item.speaker}</span>
                            </span>
                            <span className="processed-transcript-outline-label">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </span>
                ) : null}
              </span>
              <div className="doc-toolbar-actions">
                <TextSizeControls
                  fontSizePx={textSizePx}
                  onDecrease={decreaseTextSize}
                  onIncrease={increaseTextSize}
                />
                <button
                  type="button"
                  className="doc-toolbar-filter-btn"
                  onClick={() => setFiltersOpen(true)}
                  aria-label="Filters"
                  title="Filters"
                >
                  <FilterIcon className="filter-icon-svg" />
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12, marginBottom: 12 }}>
              {sourceLockConflict?.reason === "kicked" ? (
                <p className="users-guide-copy" style={{ margin: 0 }}>
                  {sourceLockConflict.userName || "A project editor"} removed your source lock. Return to the source list or reacquire access before annotating again.
                </p>
              ) : sourceLockConflict?.reason === "locked" ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    {sourceLockConflict.userName || "Another user"} is currently annotating this source.
                  </p>
                  {canKickSourceLocks ? (
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => void onKickSourceLock(sourceLockConflict)}
                      disabled={saving || lockSyncing}
                    >
                      {lockSyncing ? "Updating..." : "Take Lock"}
                    </button>
                  ) : null}
                </div>
              ) : canEditAnnotations ? null : (
                <p className="users-guide-copy" style={{ margin: 0 }}>
                  {lockSyncing ? "Claiming the source lock for annotation..." : "This source is currently read-only in the coding workspace."}
                </p>
              )}
            </div>

            <div className="doc-viewer-inline-section ai-segments-embedded">
              <div className="doc-inline-section-header">
                <button
                  type="button"
                  className={`doc-inline-disclosure${relevantSegmentsOpen ? " doc-inline-disclosure--open" : ""}`}
                  aria-expanded={relevantSegmentsOpen}
                  onClick={() => setRelevantSegmentsOpen((open) => !open)}
                >
                  <span className="doc-inline-disclosure-chevron" aria-hidden="true">
                    {relevantSegmentsOpen ? "\u25be" : "\u25b8"}
                  </span>
                  <span className="doc-inline-disclosure-label">Relevant Segments</span>
                  <span className="ai-segments-inline-badge">AI Suggested</span>
                </button>
                <div className="ai-segments-header-actions">
                  {(relevantSegments.length > 0 || relevantSegmentsError || relevantSegmentsNotice) && (
                    <button type="button" className="btn btn--small" onClick={clearRelevantSegments} disabled={relevantSegmentsSearching}>
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => void searchRelevantSegments()}
                    disabled={!selectedCode || relevantSegmentsSearching}
                  >
                    {relevantSegmentsSearching ? "Searching" : relevantSegments.length > 0 ? "Run Again" : "Search"}
                  </button>
                </div>
              </div>
              {relevantSegmentsOpen && (
                <div className="doc-viewer-inline-section-body" style={{ maxHeight: 260 }}>
                  <div className="ai-segments-summary">
                    {selectedCode ? (
                      <>
                        <span className="ai-segments-summary-label">Selected code</span>
                        <span className="ai-segments-summary-value">{selectedCode.label}</span>
                      </>
                    ) : (
                      <span className="annotation-list-empty">Select one code before searching.</span>
                    )}
                  </div>
                  {relevantSegmentsSearching && (
                    <div className="ai-segments-search-state">
                      <div className="ai-segments-progress" aria-hidden="true">
                        <span className="ai-segments-progress-bar" />
                      </div>
                      <div className="ai-segments-runtime">Runtime: {formatRuntime(relevantSegmentsRuntimeMs)}</div>
                      <div className="ai-segments-search-copy">Searching project text for relevant segments...</div>
                    </div>
                  )}
                  {relevantSegmentsError && <div className="form-error project-settings-error">{relevantSegmentsError}</div>}
                  {relevantSegmentsNotice && !relevantSegmentsError && <div className="settings-success project-settings-success">{relevantSegmentsNotice}</div>}
                  {relevantSegmentsModel && !relevantSegmentsSearching && (
                    <p className="ai-segments-model-note">Latest search model: <code>{relevantSegmentsModel}</code></p>
                  )}
                  <ul className="annotation-list">
                    {!relevantSegmentsSearching && relevantSegments.length === 0 && selectedCode && !relevantSegmentsError && (
                      <li className="annotation-list-empty">Run a search to find project text that may fit this code.</li>
                    )}
                    {relevantSegments.map((segment) => (
                      <li key={segment.id} className="annotation-item ai-segments-item">
                        <button
                          type="button"
                          className={`ai-segments-result-button${activeRelevantSegmentId === segment.id ? " ai-segments-result-button--active" : ""}`}
                          onClick={() => openRelevantSegment(segment)}
                        >
                          <div className="annotation-item-header">
                            <span className="annotation-code-badge ai-segments-badge">
                              {segment.itemType === "annotation" ? "Annotation" : "Text Segment"}
                            </span>
                            <span className="ai-segments-score">{Math.round(segment.similarity * 100)}%</span>
                          </div>
                          <p className="ai-segments-title">{segment.title}</p>
                          <blockquote className="annotation-quote">"{segment.preview}"</blockquote>
                          {segment.reason && <p className="annotation-note">{segment.reason}</p>}
                        </button>
                        {canEditAnnotations && selectedCode && (
                          <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => void applyRelevantSegment(segment)}
                            disabled={saving}
                          >
                            Apply Code
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div
              ref={viewerRef}
              className="doc-text"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                paddingLeft: annotationLaneCount > 0 ? Math.max(48, annotationLaneCount * STRIPE_LANE_WIDTH + STRIPE_GUTTER_BASE) : 48,
              }}
            >
              {row.content ? (
                <div ref={contentSelectionRef} onMouseUp={handleMouseUp}>
                  {renderCodingContent()}
                </div>
              ) : (
                <p className="case-card-empty">{t("projectDocuments.detail.noContent")}</p>
              )}
              {stripeBars.map((bar) => (
                <div
                  key={bar.annotationId}
                  className={`doc-stripe-bar${selectedAnnotationId === bar.annotationId ? " doc-stripe-bar--selected" : ""}`}
                  style={{
                    top: bar.top,
                    height: bar.height,
                    left: 4 + bar.column * STRIPE_LANE_WIDTH,
                    width: 4,
                    background: bar.color,
                  }}
                  onClick={() => {
                    setSelectedAnnotationId(bar.annotationId);
                    setSelectedTextSegment(null);
                    setScrollToAnnotationId(bar.annotationId);
                  }}
                  onMouseEnter={(event) => setStripeHover({
                    x: event.clientX,
                    y: event.clientY,
                    label: bar.label,
                    quote: bar.quote,
                    color: bar.color,
                  })}
                  onMouseMove={(event) => setStripeHover((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current)}
                  onMouseLeave={() => setStripeHover(null)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <PostgresSourceAnnotationContextMenu
        contextMenu={annotationContextMenu}
        contextMenuRef={annotationContextMenuRef}
        contextMenuStyle={annotationContextMenuStyle}
        onClose={() => setAnnotationContextMenu(null)}
        onDeleteAnnotation={(annotationId) => {
          void onDeleteAnnotation(annotationId);
        }}
        onOpenMemoDraft={onOpenMemoDraft}
        canManageMemos={canManageMemos}
        canDeleteAnnotations={canEditAnnotations}
      />

      {filtersOpen ? (
        <PostgresSourceCodingFiltersModal
          codes={codes}
          annotations={annotations}
          hiddenUserIds={hiddenUserIds}
          hiddenCodeIds={hiddenCodeIds}
          onToggleUser={(userId) => {
            setHiddenUserIds((current) => {
              const next = new Set(current);
              if (next.has(userId)) next.delete(userId);
              else next.add(userId);
              return next;
            });
          }}
          onToggleCode={(codeId) => {
            setHiddenCodeIds((current) => {
              const next = new Set(current);
              if (next.has(codeId)) next.delete(codeId);
              else next.add(codeId);
              return next;
            });
          }}
          onSelectAllUsers={() => setHiddenUserIds(new Set())}
          onClearUsers={() => setHiddenUserIds(new Set(annotations.map((annotation) => annotation.createdByName || "Unknown")))}
          onSelectAllCodes={() => setHiddenCodeIds(new Set())}
          onClearCodes={() => setHiddenCodeIds(new Set(codes.map((code) => code.id)))}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}

      {newCodeOpen ? (
        <NewCodeModal
          allCodes={codebookRows}
          onSubmit={async (payload) => {
            if (!onCreateCode || !canCreateCodes) return;
            const createdCode = await onCreateCode({
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? null,
            });
            setSelectedCodeId(createdCode.id);
          }}
          onDone={() => setNewCodeOpen(false)}
          onClose={() => setNewCodeOpen(false)}
        />
      ) : null}

      {childCodeParentRow ? (
        <NewCodeModal
          allCodes={codebookRows}
          title="Add Child Code"
          submitLabel="Create Code"
          initialParentId={childCodeParentRow.id}
          onSubmit={async (payload) => {
            if (!onCreateCode || !canCreateCodes) return;
            const createdCode = await onCreateCode({
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? childCodeParentRow.id,
            });
            setSelectedCodeId(createdCode.id);
          }}
          onDone={() => setChildCodeParentId(null)}
          onClose={() => setChildCodeParentId(null)}
        />
      ) : null}

      {editingCodeRow ? (
        <NewCodeModal
          allCodes={codebookRows}
          title="Edit Code"
          submitLabel="Save Changes"
          initialLabel={editingCodeRow.label}
          initialDescription={editingCodeRow.description}
          initialColor={editingCodeRow.color}
          initialParentId={editingCodeRow.parentId}
          excludeCodeId={editingCodeRow.id}
          onSubmit={async (payload) => {
            if (!onUpdateCode || !canCreateCodes) return;
            const updatedCode = await onUpdateCode(editingCodeRow.id, {
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? null,
            });
            setSelectedCodeId(updatedCode.id);
          }}
          onDone={() => setEditingCodeId(null)}
          onClose={() => setEditingCodeId(null)}
        />
      ) : null}

      {deletingCodeRow ? (
        <SettingsModal title="Delete Code" onClose={() => setDeletingCodeId(null)} closeDisabled={deletingCode}>
          <div className="app-settings-modal-body">
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Delete <strong>{deletingCodeRow.label}</strong>?
            </p>
            <p className="modal-warning-text">
              This removes the code from the codebook and clears it from existing annotations.
            </p>
            {deleteCodeError ? <p className="auth-error">{deleteCodeError}</p> : null}
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn" onClick={() => setDeletingCodeId(null)} disabled={deletingCode}>
              Cancel
            </button>
            <button type="button" className="btn btn--danger" onClick={() => void handleConfirmDeleteCode()} disabled={deletingCode}>
              {deletingCode ? "Deleting..." : "Delete Code"}
            </button>
          </div>
        </SettingsModal>
      ) : null}

      {editingAnnotation && canEditAnnotations ? (
        <AnnotationEditorModal
          title="Edit Annotation"
          codeOptions={codeOptions}
          selection={{
            startOffset: editingAnnotation.startOffset ?? 0,
            endOffset: editingAnnotation.endOffset ?? editingAnnotation.quote.length,
            quote: editingAnnotation.quote,
          }}
          initialAnnotation={editingAnnotation}
          saving={saving}
          error={error}
          onCancel={() => {
            if (saving) return;
            setEditingAnnotation(null);
          }}
          onDelete={async () => {
            await onDeleteAnnotation(editingAnnotation.id);
            setEditingAnnotation(null);
          }}
          onSave={async (payload) => {
            await onUpdateAnnotation(editingAnnotation, payload);
            setEditingAnnotation(null);
          }}
        />
      ) : null}

      {stripeHover ? (
        <div className="stripe-tooltip" style={getFloatingTooltipStyle(stripeHover.x, stripeHover.y, 280, 160)}>
          <div className="stripe-tooltip-code">
            <span className="stripe-tooltip-swatch" style={{ background: stripeHover.color }} />
            {stripeHover.label}
          </div>
          <div className="stripe-tooltip-quote">"{tooltipExcerpt(stripeHover.quote)}"</div>
        </div>
      ) : null}

      {annotationHover && !annotationContextMenu ? (
        <div
          className="annotation-hover-tooltip"
          style={getFloatingTooltipStyle(
            annotationHover.x,
            annotationHover.y,
            340,
            Math.min(420, 48 + annotationHover.items.length * 104),
          )}
        >
          {annotationHover.items.map((item) => (
            <div key={item.annotationId} className="annotation-hover-tooltip-section">
              <div className="annotation-hover-tooltip-code">
                <span className="annotation-hover-tooltip-swatch" style={{ background: item.color }} />
                {item.label}
              </div>
              <div className="annotation-hover-tooltip-quote">"{tooltipExcerpt(item.quote)}"</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
