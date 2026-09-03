import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, HelpIcon, ZoomIcon } from "../components/AppIcons";
import { FilterIcon } from "../components/FilterIcon";
import { GettingStartedGuideCallout } from "../components/GettingStartedGuideCallout";
import { SettingsModal } from "../components/SettingsModal";
import {
  ProcessedTranscriptView,
  parseProcessedTranscriptSegments,
} from "../components/ProcessedTranscriptView";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { useI18n } from "../i18n/provider";
import { NewCodeModal, type CodeRow } from "../components/NewCodeModal";
import type { SourceAnnotationRow } from "./Postgres_Sources_View";
import {
  AnnotationEditorModal,
  buildMultiAnnotationBackground,
  getFloatingTooltipStyle,
  PostgresSourceAnnotationContextMenu,
  type AnnotationContextMenuState,
  type PostgresSourceCodingViewProps,
  PostgresSourceAnnotationPanel,
  PostgresSourceCodingFiltersModal,
  TextSizeControls,
  orderedCodesWithDepth,
  tooltipExcerpt,
  type AnnotationHover,
  type StripeBar,
  type StripeHover,
  usePostgresSourceTextSizePreference,
  visibleCodeNodes,
} from "./Postgres_Source_Coding_Shared";

const STRIPE_LANE_WIDTH = 8;
const STRIPE_GUTTER_BASE = 24;
const TRANSCRIPT_OUTLINE_PREVIEW_LIMIT = 88;

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

export function PostgresSourceTextCodingView({
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
  gettingStartedState,
  onGettingStartedStateChange,
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
  const [newCodeOpen, setNewCodeOpen] = useState(false);
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null);
  const [childCodeParentId, setChildCodeParentId] = useState<string | null>(null);
  const [deletingCodeId, setDeletingCodeId] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState(false);
  const [deleteCodeError, setDeleteCodeError] = useState("");
  const [collapsedCodeIds, setCollapsedCodeIds] = useState<Set<string>>(new Set());
  const [hiddenUserIds, setHiddenUserIds] = useState<Set<string>>(new Set());
  const [hiddenCodeIds, setHiddenCodeIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { textSizePx, decreaseTextSize, increaseTextSize } = usePostgresSourceTextSizePreference();
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const [textSearchQuery, setTextSearchQuery] = useState("");
  const [activeTextSearchIndex, setActiveTextSearchIndex] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stripeBars, setStripeBars] = useState<StripeBar[]>([]);
  const [stripeHover, setStripeHover] = useState<StripeHover | null>(null);
  const [annotationHover, setAnnotationHover] = useState<AnnotationHover | null>(null);
  const [annotationContextMenu, setAnnotationContextMenu] = useState<AnnotationContextMenuState | null>(null);
  const [codeContextMenu, setCodeContextMenu] = useState<{ x: number; y: number; code: (typeof codes)[number] } | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const contentSelectionRef = useRef<HTMLDivElement | null>(null);
  const textSearchInputRef = useRef<HTMLInputElement | null>(null);
  const annotationContextMenuRef = useRef<HTMLDivElement | null>(null);
  const codeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const annotationContextMenuStyle = useViewportContextMenuStyle(annotationContextMenu, annotationContextMenuRef);
  const codeContextMenuStyle = useViewportContextMenuStyle(codeContextMenu, codeContextMenuRef);
  const gettingStartedActive =
    !!gettingStartedState
    && !gettingStartedState.dismissed
    && !gettingStartedState.completed
    && (!gettingStartedState.sourceId || gettingStartedState.sourceId === row.id);
  const gettingStartedCreateCodeActive =
    gettingStartedActive && gettingStartedState?.step === "createCode";
  const gettingStartedCreateCodeModalActive =
    gettingStartedCreateCodeActive && newCodeOpen;
  const gettingStartedAssignCodeActive =
    gettingStartedActive && gettingStartedState?.step === "assignCode";
  const gettingStartedAssignCodeId = gettingStartedState?.codeId ?? "";
  const gettingStartedCompletedActive =
    !!gettingStartedState
    && !gettingStartedState.dismissed
    && !gettingStartedState.completed
    && gettingStartedState.step === "completed";

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
  const activeTextSearchQuery = textSearchOpen ? textSearchQuery.trim() : "";
  const textSearchMatches = useMemo(() => {
    if (!activeTextSearchQuery) return [];
    const matches: Array<{ startOffset: number; endOffset: number }> = [];
    const wildcardPattern = activeTextSearchQuery.replace(/\*/g, "")
      ? activeTextSearchQuery
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\S*?")
      : "\\S+";
    const searchRegex = new RegExp(wildcardPattern, "giu");
    let match: RegExpExecArray | null;
    while ((match = searchRegex.exec(row.content)) != null) {
      const startOffset = match.index;
      const endOffset = startOffset + match[0].length;
      matches.push({ startOffset, endOffset });
      if (match[0].length === 0) {
        searchRegex.lastIndex += 1;
      }
    }
    return matches;
  }, [activeTextSearchQuery, row.content]);
  const canEditAnnotations = canManageAnnotations && !!sourceLock && sourceLock.userId === currentUserId && !sourceLockConflict;
  const codeTree = useMemo(() => orderedCodesWithDepth(codes), [codes]);
  const visibleCodes = useMemo(() => visibleCodeNodes(codeTree, collapsedCodeIds), [collapsedCodeIds, codeTree]);
  const gettingStartedAssignTargetCodeId = useMemo(() => {
    if (!gettingStartedAssignCodeActive) return "";
    if (gettingStartedAssignCodeId && visibleCodes.some(({ code }) => code.id === gettingStartedAssignCodeId)) {
      return gettingStartedAssignCodeId;
    }
    return visibleCodes.length === 1 ? visibleCodes[0].code.id : "";
  }, [gettingStartedAssignCodeActive, gettingStartedAssignCodeId, visibleCodes]);
  const codesById = useMemo(() => new Map(codes.map((code) => [code.id, code])), [codes]);
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
      const userKey = annotation.createdByName || t("sourceCoding.common.unknown");
      if (hiddenUserIds.has(userKey)) return false;
      if (annotation.codeIds.some((codeId) => hiddenCodeIds.has(codeId))) return false;
      return true;
    }),
    [annotations, hiddenCodeIds, hiddenUserIds, t],
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
      if (codeContextMenuRef.current && !codeContextMenuRef.current.contains(event.target as Node)) {
        setCodeContextMenu(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAnnotationContextMenu(null);
        setCodeContextMenu(null);
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
    if (textSearchOpen) {
      window.setTimeout(() => textSearchInputRef.current?.focus(), 0);
    }
  }, [textSearchOpen]);

  useEffect(() => {
    if (textSearchMatches.length === 0) {
      setActiveTextSearchIndex(null);
      return;
    }
    setActiveTextSearchIndex(0);
  }, [activeTextSearchQuery, row.id, textSearchMatches.length]);

  useEffect(() => {
    if (activeTextSearchIndex == null || !viewerRef.current) return;
    const target = viewerRef.current.querySelector<HTMLElement>("[data-source-search-active='true']");
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("source-search-match-flash");
    const timer = window.setTimeout(() => target.classList.remove("source-search-match-flash"), 1100);
    return () => window.clearTimeout(timer);
  }, [activeTextSearchIndex, textSearchMatches]);

  useEffect(() => {
    if (selectedOutlineSortOrder == null || !viewerRef.current) return;
    const target = viewerRef.current.querySelector<HTMLElement>(`[data-transcript-sort-order="${selectedOutlineSortOrder}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedOutlineSortOrder]);

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

  function toggleCollapsedCode(codeId: string) {
    setCollapsedCodeIds((current) => {
      const next = new Set(current);
      if (next.has(codeId)) next.delete(codeId);
      else next.add(codeId);
      return next;
    });
  }

  function goToPreviousTextSearchMatch() {
    if (textSearchMatches.length === 0) return;
    setActiveTextSearchIndex((current) => {
      const currentIndex = current ?? 0;
      return (currentIndex - 1 + textSearchMatches.length) % textSearchMatches.length;
    });
  }

  function goToNextTextSearchMatch() {
    if (textSearchMatches.length === 0) return;
    setActiveTextSearchIndex((current) => {
      const currentIndex = current ?? -1;
      return (currentIndex + 1) % textSearchMatches.length;
    });
  }

  async function handleQuickCode(codeId: string) {
    if (!pendingSelection || !canEditAnnotations || saving) return;
    await onCreateAnnotation(row.id, pendingSelection, { codeIds: [codeId], note: "" });
    if (gettingStartedActive && gettingStartedState?.step === "assignCode") {
      await onGettingStartedStateChange?.({
        codeId,
        step: "completed",
      });
    }
    setPendingSelection(null);
  }

  async function handleConfirmDeleteCode() {
    if (!deletingCodeId || !onDeleteCode) return;
    setDeletingCode(true);
    setDeleteCodeError("");
    try {
      await onDeleteCode(deletingCodeId);
      setDeletingCodeId(null);
    } catch (deleteError) {
      setDeleteCodeError(deleteError instanceof Error ? deleteError.message : "Failed to delete code.");
    } finally {
      setDeletingCode(false);
    }
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
    const overlappingSearchMatches = textSearchMatches
      .map((match, index) => ({ ...match, index }))
      .filter((match) => match.startOffset < absoluteEndOffset && match.endOffset > absoluteStartOffset);
    for (const match of overlappingSearchMatches) {
      if (match.startOffset > absoluteStartOffset && match.startOffset < absoluteEndOffset) {
        boundaries.add(match.startOffset);
      }
      if (match.endOffset > absoluteStartOffset && match.endOffset < absoluteEndOffset) {
        boundaries.add(match.endOffset);
      }
    }

    const orderedBoundaries = [...boundaries].sort((left, right) => left - right);

    return orderedBoundaries.slice(0, -1).map((start, index) => {
      const end = orderedBoundaries[index + 1];
      const rangeText = text.slice(start - absoluteStartOffset, end - absoluteStartOffset);
      const covering = rangedAnnotations.filter((annotation) => annotation.startOffset < end && annotation.endOffset > start);
      const searchMatch = overlappingSearchMatches.find((match) => match.startOffset <= start && match.endOffset >= end) ?? null;
      const isSearchMatch = searchMatch != null;
      const isActiveSearchMatch = searchMatch?.index === activeTextSearchIndex;
      const isTextSegmentSelected = selectedTextSegment != null
        && selectedTextSegment.startOffset < end
        && selectedTextSegment.endOffset > start;
      const isTextSegmentStart = isTextSegmentSelected && selectedTextSegment != null && start === selectedTextSegment.startOffset;
      const isTextSegmentEnd = isTextSegmentSelected && selectedTextSegment != null && end === selectedTextSegment.endOffset;
      if (covering.length === 0) {
        if (isSearchMatch) {
          return (
            <mark
              key={`${keyPrefix}-${start}-${end}`}
              data-source-search-active={isActiveSearchMatch ? "true" : undefined}
              data-text-segment-citation={isTextSegmentSelected ? "true" : undefined}
              className={`source-search-match${isActiveSearchMatch ? " source-search-match--active" : ""}${isTextSegmentSelected ? " text-segment-citation-highlight" : ""}`}
              style={{
                borderTopLeftRadius: isTextSegmentStart ? 4 : undefined,
                borderBottomLeftRadius: isTextSegmentStart ? 4 : undefined,
                borderTopRightRadius: isTextSegmentEnd ? 4 : undefined,
                borderBottomRightRadius: isTextSegmentEnd ? 4 : undefined,
              }}
            >
              {rangeText}
            </mark>
          );
        }
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
      const searchOutlineParts = isSearchMatch
        ? [
            "inset 0 2px 0 0 #f59e0b",
            "inset 0 -2px 0 0 #f59e0b",
            searchMatch.startOffset === start ? "inset 2px 0 0 0 #f59e0b" : null,
            searchMatch.endOffset === end ? "inset -2px 0 0 0 #f59e0b" : null,
            isActiveSearchMatch ? "0 0 0 2px color-mix(in srgb, #f59e0b 38%, transparent)" : null,
          ].filter((part): part is string => part != null)
        : [];
      const shadowParts = [...selectionOutlineParts, ...searchOutlineParts];
      return (
        <mark
          key={`${keyPrefix}-${start}-${end}`}
          data-anns={covering.map((annotation) => annotation.id).join(" ")}
          data-source-search-active={isActiveSearchMatch ? "true" : undefined}
          data-text-segment-citation={isTextSegmentSelected ? "true" : undefined}
          className={`annotation-highlight${covering.length > 1 ? " annotation-highlight--multi" : ""}${isSelected ? " annotation-highlight--selected" : ""}${isSearchMatch ? " annotation-highlight--search-match" : ""}${isActiveSearchMatch ? " annotation-highlight--search-active" : ""}${isTextSegmentSelected ? " text-segment-citation-highlight" : ""}`}
          style={{
            background: buildMultiAnnotationBackground(covering.flatMap((annotation) => annotation.codeColors), isSelected),
            boxShadow: shadowParts.length > 0 ? shadowParts.join(", ") : undefined,
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
      <header className="view-header">
        <div className="users-title-wrap code-text-title-wrap">
          <button
            type="button"
            className="code-text-header-back-button"
            onClick={onBack}
            title={t("common.back")}
            aria-label={t("common.back")}
          >
            <ArrowLeftIcon className="code-text-header-back-icon" />
          </button>
          <h1>{t("sourceCoding.text.title")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("sourceCoding.text.openHelp")}
            aria-label={t("sourceCoding.text.openHelp")}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {gettingStartedCreateCodeActive ? (
        <>
          <div className="getting-started-spotlight-overlay" aria-hidden="true" />
          <GettingStartedGuideCallout title={t("app.gettingStarted.createCodeTitle")}>
            {newCodeOpen ? (
              <p>{t("app.gettingStarted.createCodeModalBody")}</p>
            ) : (
              <p>{t("app.gettingStarted.createCodeButtonBody")}</p>
            )}
          </GettingStartedGuideCallout>
        </>
      ) : null}

      {gettingStartedAssignCodeActive ? (
        <>
          <div className="getting-started-spotlight-overlay" aria-hidden="true" />
          <GettingStartedGuideCallout title={t("app.gettingStarted.assignCodeTitle")}>
            {pendingSelection ? (
              <p>{t("app.gettingStarted.applyCodeBody")}</p>
            ) : (
              <p>{t("app.gettingStarted.selectTextBody")}</p>
            )}
          </GettingStartedGuideCallout>
        </>
      ) : null}

      {gettingStartedCompletedActive ? (
        <>
          <div className="getting-started-spotlight-overlay" aria-hidden="true" />
          <GettingStartedGuideCallout
            title={t("app.gettingStarted.completeTitle")}
            spotlight
            actions={(
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void onGettingStartedStateChange?.({ completed: true, step: "completed" })}
              >
                {t("app.gettingStarted.finishGuide")}
              </button>
            )}
          >
            <p>{t("app.gettingStarted.completeBody")}</p>
          </GettingStartedGuideCallout>
        </>
      ) : null}

      <div className="annotate-layout code-text-annotate-layout" style={{ minHeight: 0 }}>
        <div className="annotate-left" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">{t("sourceCoding.common.codebook")}</span>
              <button
                type="button"
                className={`codebook-icon-action${gettingStartedCreateCodeActive && !newCodeOpen ? " getting-started-spotlight-target codebook-icon-action--getting-started" : ""}`}
                onClick={() => {
                  setNewCodeOpen(true);
                }}
                disabled={!canCreateCodes || !onCreateCode || saving}
                aria-label={t("sourceCoding.common.newCode")}
                title={canCreateCodes && onCreateCode ? t("sourceCoding.common.newCode") : t("sourceCoding.common.noCodeCreatePermission")}
              >
                +
              </button>
            </div>
            {pendingSelection ? (
              <div className="codebook-selection-hint">
                {t("sourceCoding.text.selectCodeHint")}
              </div>
            ) : null}
            <ul className="code-list">
              {codes.length === 0 ? (
                <li className="code-list-empty">{t("sourceCoding.common.noCodesYet")}</li>
              ) : (
                visibleCodes.map(({ code, depth, hasChildren }) => (
                  <li
                    key={code.id}
                    className={`code-item${pendingSelection && canEditAnnotations ? " code-item--annotatable" : ""}${gettingStartedAssignCodeActive && pendingSelection && code.id === gettingStartedAssignTargetCodeId ? " getting-started-spotlight-target code-item--getting-started" : ""}`}
                    style={{ paddingLeft: 6 + depth * 16 }}
                    onMouseDown={(event) => {
                      if (pendingSelection) event.preventDefault();
                    }}
                    onClick={() => void handleQuickCode(code.id)}
                    onContextMenu={(event) => {
                      if (!canManageMemos && !canCreateCodes && !onUpdateCode && !onDeleteCode) return;
                      event.preventDefault();
                      setCodeContextMenu({ x: event.clientX, y: event.clientY, code });
                    }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        className="code-collapse-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCollapsedCode(code.id);
                        }}
                        title={collapsedCodeIds.has(code.id) ? t("sourceCoding.common.expand") : t("sourceCoding.common.collapse")}
                      >
                        {collapsedCodeIds.has(code.id) ? "\u25b6" : "\u25bc"}
                      </button>
                    ) : (
                      <span className="code-collapse-spacer" />
                    )}
                    <span className="code-swatch" style={{ background: code.color }} />
                    <span className="code-label">{code.label}</span>
                    <span className="code-ann-count">{annotationCountByCodeId.get(code.id) ?? 0}</span>
                  </li>
                ))
              )}
            </ul>
          </div>

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
          <div className={`annotate-card annotate-card--grow${gettingStartedAssignCodeActive && !pendingSelection ? " getting-started-spotlight-target annotate-card--getting-started" : ""}`}>
            <div className="doc-viewer-toolbar">
              <span className="doc-name">
                {row.name}
                {transcriptOutlineItems.length > 0 ? (
                  <span className="processed-transcript-outline-wrap">
                    <button
                      type="button"
                      className="processed-transcript-outline-btn"
                      aria-label={t("sourceCoding.text.showTranscriptOutline")}
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
                <div className="source-content-search">
                  {textSearchOpen ? (
                    <>
                      <input
                        ref={textSearchInputRef}
                        className="source-content-search-input"
                        value={textSearchQuery}
                        onChange={(event) => setTextSearchQuery(event.target.value)}
                        placeholder={t("sourceCoding.text.searchText")}
                        aria-label={t("sourceCoding.text.searchSourceText")}
                      />
                      <span className="source-content-search-count">
                        {activeTextSearchQuery
                          ? textSearchMatches.length > 0 && activeTextSearchIndex != null
                            ? `${activeTextSearchIndex + 1}/${textSearchMatches.length}`
                            : "0/0"
                          : ""}
                      </span>
                      <button
                        type="button"
                        className="btn btn--small source-content-search-nav"
                        onClick={goToPreviousTextSearchMatch}
                        disabled={textSearchMatches.length === 0}
                        aria-label={t("sourceCoding.text.previousSearchMatch")}
                        title={t("sourceCoding.text.previous")}
                      >
                        {"\u2191"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--small source-content-search-nav"
                        onClick={goToNextTextSearchMatch}
                        disabled={textSearchMatches.length === 0}
                        aria-label={t("sourceCoding.text.nextSearchMatch")}
                        title={t("sourceCoding.text.next")}
                      >
                        {"\u2193"}
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--small source-content-search-toggle"
                    onClick={() => setTextSearchOpen((open) => !open)}
                    aria-label={textSearchOpen ? t("sourceCoding.text.closeTextSearch") : t("sourceCoding.text.searchSourceText")}
                    title={textSearchOpen ? t("sourceCoding.text.closeSearch") : t("sourceCoding.text.search")}
                  >
                    <ZoomIcon />
                  </button>
                </div>
                <TextSizeControls
                  fontSizePx={textSizePx}
                  onDecrease={decreaseTextSize}
                  onIncrease={increaseTextSize}
                />
                <button
                  type="button"
                  className="doc-toolbar-filter-btn"
                  onClick={() => setFiltersOpen(true)}
                  aria-label={t("sourceCoding.common.filters")}
                  title={t("sourceCoding.common.filters")}
                >
                  <FilterIcon className="filter-icon-svg" />
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12, marginBottom: 12 }}>
              {sourceLockConflict?.reason === "kicked" ? (
                <p className="users-guide-copy" style={{ margin: 0 }}>
                  {t("sourceCoding.common.sourceLockRemoved", { userName: sourceLockConflict.userName || t("sourceCoding.common.projectEditor") })}
                </p>
              ) : sourceLockConflict?.reason === "locked" ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    {t("sourceCoding.common.sourceLockHeld", { userName: sourceLockConflict.userName || t("sourceCoding.common.anotherUser") })}
                  </p>
                  {canKickSourceLocks ? (
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => void onKickSourceLock(sourceLockConflict)}
                      disabled={saving || lockSyncing}
                    >
                      {lockSyncing ? t("sourceCoding.common.updating") : t("sourceCoding.common.takeLock")}
                    </button>
                  ) : null}
                </div>
              ) : canEditAnnotations ? null : (
                <p className="users-guide-copy" style={{ margin: 0 }}>
                  {lockSyncing ? t("sourceCoding.common.claimingSourceLock") : t("sourceCoding.common.readOnlyWorkspace")}
                </p>
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

      {codeContextMenu ? (
        <div ref={codeContextMenuRef} className="context-menu" style={codeContextMenuStyle}>
          {canCreateCodes && onUpdateCode ? (
            <button
              className="context-menu-item"
              onClick={() => {
                setEditingCodeId(codeContextMenu.code.id);
                setNewCodeOpen(false);
                setChildCodeParentId(null);
                setCodeContextMenu(null);
              }}
            >
              {t("sourceCoding.common.editCode")}
            </button>
          ) : null}
          {canManageMemos ? (
          <button
            className="context-menu-item"
            onClick={() => {
              onOpenMemoDraft({ codeIds: [codeContextMenu.code.id] });
              setCodeContextMenu(null);
            }}
          >
            {t("sourceCoding.common.memoAboutCode")}
          </button>
          ) : null}
          {canCreateCodes && onCreateCode ? (
            <button
              className="context-menu-item"
              onClick={() => {
                setChildCodeParentId(codeContextMenu.code.id);
                setNewCodeOpen(false);
                setEditingCodeId(null);
                setCodeContextMenu(null);
              }}
            >
              {t("sourceCoding.common.addChildCode")}
            </button>
          ) : null}
          {canCreateCodes && onDeleteCode ? (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => {
                setDeletingCodeId(codeContextMenu.code.id);
                setDeleteCodeError("");
                setCodeContextMenu(null);
              }}
          >
            {t("sourceCoding.common.deleteCode")}
          </button>
          ) : null}
        </div>
      ) : null}

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
          onClearUsers={() => setHiddenUserIds(new Set(annotations.map((annotation) => annotation.createdByName || t("sourceCoding.common.unknown"))))}
          onSelectAllCodes={() => setHiddenCodeIds(new Set())}
          onClearCodes={() => setHiddenCodeIds(new Set(codes.map((code) => code.id)))}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}

      {helpOpen ? (
        <SettingsModal title={t("sourceCoding.text.helpTitle")} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("sourceCoding.text.helpLine1")}
            </p>
            <p className="users-guide-copy">
              {t("sourceCoding.text.helpLine2")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
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
            if (gettingStartedActive && gettingStartedState?.step === "createCode") {
              await onGettingStartedStateChange?.({
                codeId: createdCode.id,
                step: "assignCode",
              });
            }
          }}
          onDone={() => setNewCodeOpen(false)}
          onClose={() => setNewCodeOpen(false)}
          gettingStartedActive={gettingStartedCreateCodeModalActive}
        />
      ) : null}

      {childCodeParentRow ? (
        <NewCodeModal
          allCodes={codebookRows}
          title={t("sourceCoding.common.addChildCodeTitle")}
          submitLabel={t("sourceCoding.common.createCode")}
          initialParentId={childCodeParentRow.id}
          onSubmit={async (payload) => {
            if (!onCreateCode || !canCreateCodes) return;
            await onCreateCode({
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? childCodeParentRow.id,
            });
          }}
          onDone={() => setChildCodeParentId(null)}
          onClose={() => setChildCodeParentId(null)}
        />
      ) : null}

      {editingCodeRow ? (
        <NewCodeModal
          allCodes={codebookRows}
          title={t("sourceCoding.common.editCodeTitle")}
          submitLabel={t("sourceCoding.common.saveChanges")}
          initialLabel={editingCodeRow.label}
          initialDescription={editingCodeRow.description}
          initialColor={editingCodeRow.color}
          initialParentId={editingCodeRow.parentId}
          excludeCodeId={editingCodeRow.id}
          onSubmit={async (payload) => {
            if (!onUpdateCode || !canCreateCodes) return;
            await onUpdateCode(editingCodeRow.id, {
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? null,
            });
          }}
          onDone={() => setEditingCodeId(null)}
          onClose={() => setEditingCodeId(null)}
        />
      ) : null}

      {deletingCodeRow ? (
        <SettingsModal title={t("sourceCoding.common.deleteCodeTitle")} onClose={() => setDeletingCodeId(null)} closeDisabled={deletingCode}>
          <div className="app-settings-modal-body">
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("common.delete")} <strong>{deletingCodeRow.label}</strong>?
            </p>
            <p className="modal-warning-text">
              {t("sourceCoding.common.deleteCodeWarning")}
            </p>
            {deleteCodeError ? <p className="auth-error">{deleteCodeError}</p> : null}
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn" onClick={() => setDeletingCodeId(null)} disabled={deletingCode}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn--danger" onClick={() => void handleConfirmDeleteCode()} disabled={deletingCode}>
              {deletingCode ? t("sourceCoding.common.deleting") : t("sourceCoding.common.deleteCodeTitle")}
            </button>
          </div>
        </SettingsModal>
      ) : null}

      {editingAnnotation && canEditAnnotations ? (
        <AnnotationEditorModal
          title={t("sourceCoding.common.editAnnotation")}
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
