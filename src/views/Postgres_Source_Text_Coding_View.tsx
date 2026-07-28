import { useEffect, useMemo, useRef, useState } from "react";
import { FilterIcon } from "../components/FilterIcon";
import {
  ProcessedTranscriptView,
  getProcessedTranscriptQuestionOutline,
  parseProcessedTranscriptSegments,
} from "../components/ProcessedTranscriptView";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { useI18n } from "../i18n/provider";
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
  SOURCE_TEXT_SIZE_DEFAULT_PX,
  SOURCE_TEXT_SIZE_MAX_PX,
  SOURCE_TEXT_SIZE_MIN_PX,
  SOURCE_TEXT_SIZE_STEP_PX,
  TextSizeControls,
  orderedCodesWithDepth,
  tooltipExcerpt,
  type AnnotationHover,
  type StripeBar,
  type StripeHover,
  visibleCodeNodes,
} from "./Postgres_Source_Coding_Shared";

const STRIPE_LANE_WIDTH = 8;
const STRIPE_GUTTER_BASE = 24;

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
  initialSelectedAnnotationId,
  saving,
  error,
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
  const [collapsedCodeIds, setCollapsedCodeIds] = useState<Set<string>>(new Set());
  const [hiddenUserIds, setHiddenUserIds] = useState<Set<string>>(new Set());
  const [hiddenCodeIds, setHiddenCodeIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [textSizePx, setTextSizePx] = useState(SOURCE_TEXT_SIZE_DEFAULT_PX);
  const [stripeBars, setStripeBars] = useState<StripeBar[]>([]);
  const [stripeHover, setStripeHover] = useState<StripeHover | null>(null);
  const [annotationHover, setAnnotationHover] = useState<AnnotationHover | null>(null);
  const [annotationContextMenu, setAnnotationContextMenu] = useState<AnnotationContextMenuState | null>(null);
  const [codeContextMenu, setCodeContextMenu] = useState<{ x: number; y: number; code: (typeof codes)[number] } | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const contentSelectionRef = useRef<HTMLDivElement | null>(null);
  const annotationContextMenuRef = useRef<HTMLDivElement | null>(null);
  const codeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const annotationContextMenuStyle = useViewportContextMenuStyle(annotationContextMenu, annotationContextMenuRef);
  const codeContextMenuStyle = useViewportContextMenuStyle(codeContextMenu, codeContextMenuRef);

  const processedTranscriptSegments =
    row.type === "Processed Transcript"
      ? parseProcessedTranscriptSegments(row.structuredContentJson)
      : [];
  const questionOutline = getProcessedTranscriptQuestionOutline(processedTranscriptSegments);
  const canEditAnnotations = canManageAnnotations && !!sourceLock && sourceLock.userId === currentUserId && !sourceLockConflict;
  const codeTree = useMemo(() => orderedCodesWithDepth(codes), [codes]);
  const visibleCodes = useMemo(() => visibleCodeNodes(codeTree, collapsedCodeIds), [collapsedCodeIds, codeTree]);
  const codesById = useMemo(() => new Map(codes.map((code) => [code.id, code])), [codes]);
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

  useEffect(() => {
    if (!initialSelectedAnnotationId) return;
    if (!filteredAnnotations.some((annotation) => annotation.id === initialSelectedAnnotationId)) return;
    setSelectedAnnotationId(initialSelectedAnnotationId);
    setScrollToAnnotationId(initialSelectedAnnotationId);
  }, [filteredAnnotations, initialSelectedAnnotationId]);

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
    if (selectedOutlineSortOrder == null || !viewerRef.current) return;
    const target = viewerRef.current.querySelector<HTMLElement>(`[data-transcript-sort-order="${selectedOutlineSortOrder}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedOutlineSortOrder]);

  useEffect(() => {
    if (!scrollToAnnotationId || !viewerRef.current) return;
    const target = viewerRef.current.querySelector<HTMLElement>(`[data-anns~="${scrollToAnnotationId}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("annotation-flash");
    const timer = window.setTimeout(() => target.classList.remove("annotation-flash"), 1500);
    setScrollToAnnotationId(null);
    return () => window.clearTimeout(timer);
  }, [scrollToAnnotationId]);

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

  function decreaseTextSize() {
    setTextSizePx((current) => Math.max(SOURCE_TEXT_SIZE_MIN_PX, current - SOURCE_TEXT_SIZE_STEP_PX));
  }

  function increaseTextSize() {
    setTextSizePx((current) => Math.min(SOURCE_TEXT_SIZE_MAX_PX, current + SOURCE_TEXT_SIZE_STEP_PX));
  }

  async function handleQuickCode(codeId: string) {
    if (!pendingSelection || !canEditAnnotations || saving) return;
    await onCreateAnnotation(row.id, pendingSelection, { codeIds: [codeId], note: "" });
    setPendingSelection(null);
  }

  function renderCodingContent() {
    if (row.type === "Processed Transcript" && processedTranscriptSegments.length > 0) {
      return (
        <div className="text-source-content-sized" style={{ fontSize: textSizePx }}>
          <ProcessedTranscriptView
            segments={processedTranscriptSegments}
            renderSegmentText={(segment) => segment.text}
            selectedSortOrder={selectedOutlineSortOrder}
          />
        </div>
      );
    }

    const selectedAnnotation = selectedAnnotationId
      ? rangedAnnotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null
      : null;

    const boundaries = new Set<number>([0, row.content.length]);
    for (const annotation of rangedAnnotations) {
      boundaries.add(annotation.startOffset);
      boundaries.add(annotation.endOffset);
    }
    const orderedBoundaries = [...boundaries].sort((left, right) => left - right);

    return (
      <pre className="doc-content-body" style={{ fontSize: textSizePx, whiteSpace: "pre-wrap" }}>
        {orderedBoundaries.slice(0, -1).map((start, index) => {
          const end = orderedBoundaries[index + 1];
          const text = row.content.slice(start, end);
          const covering = rangedAnnotations.filter((annotation) => annotation.startOffset < end && annotation.endOffset > start);
          if (covering.length === 0) {
            return <span key={`${start}-${end}`}>{text}</span>;
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
              key={`${start}-${end}`}
              data-anns={covering.map((annotation) => annotation.id).join(" ")}
              className={`annotation-highlight${covering.length > 1 ? " annotation-highlight--multi" : ""}`}
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
              {text}
            </mark>
          );
        })}
      </pre>
    );
  }

  return (
    <div className="view doc-detail-view">
      <div className="workspace-back-row workspace-back-row--split">
        <button className="btn" onClick={onBack}>{t("projectDocuments.detail.backToDocuments")}</button>
        <p className="users-guide-copy" style={{ margin: 0 }}>
          PostgreSQL code text workspace
        </p>
      </div>

      <div className="annotate-layout code-text-annotate-layout" style={{ minHeight: 0 }}>
        <div className="annotate-left" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Codebook</span>
            </div>
            {pendingSelection ? (
              <div className="codebook-selection-hint">
                Select a code to apply it to the current text selection.
              </div>
            ) : null}
            <ul className="code-list">
              {codes.length === 0 ? (
                <li className="code-list-empty">No codes yet.</li>
              ) : (
                visibleCodes.map(({ code, depth, hasChildren }) => (
                  <li
                    key={code.id}
                    className={`code-item${pendingSelection && canEditAnnotations ? " code-item--annotatable" : ""}`}
                    style={{ paddingLeft: 6 + depth * 16 }}
                    onMouseDown={(event) => {
                      if (pendingSelection) event.preventDefault();
                    }}
                    onClick={() => void handleQuickCode(code.id)}
                    onContextMenu={(event) => {
                      if (!canManageMemos) return;
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
                        title={collapsedCodeIds.has(code.id) ? "Expand" : "Collapse"}
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
                {questionOutline.length > 0 ? (
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
                        {questionOutline.map((item, index) => (
                          <button
                            key={`${item.sortOrder}-${index}`}
                            type="button"
                            className="processed-transcript-outline-item"
                            onClick={() => {
                              setSelectedOutlineSortOrder(item.sortOrder);
                              setOutlineOpen(false);
                            }}
                            title={item.label}
                          >
                            {item.label}
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

      {codeContextMenu && canManageMemos ? (
        <div ref={codeContextMenuRef} className="context-menu" style={codeContextMenuStyle}>
          <button
            className="context-menu-item"
            onClick={() => {
              onOpenMemoDraft({ codeIds: [codeContextMenu.code.id] });
              setCodeContextMenu(null);
            }}
          >
            Memo about code
          </button>
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
          onClearUsers={() => setHiddenUserIds(new Set(annotations.map((annotation) => annotation.createdByName || "Unknown")))}
          onSelectAllCodes={() => setHiddenCodeIds(new Set())}
          onClearCodes={() => setHiddenCodeIds(new Set(codes.map((code) => code.id)))}
          onClose={() => setFiltersOpen(false)}
        />
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
