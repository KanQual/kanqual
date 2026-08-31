import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { SettingsModal } from "../components/SettingsModal";
import type {
  PostgresCode,
  PostgresSourceLock,
} from "../lib/postgres";
import {
  getPostgresUserPreferences,
  savePostgresUserPreferences,
} from "../lib/postgres";
import type {
  CodeOption,
  PendingSelection,
  SourceAnnotationRow,
  SourceRow,
} from "./Postgres_Sources_View";

export type CodeTreeNode = {
  code: PostgresCode;
  depth: number;
  hasChildren: boolean;
};

export type StripeBar = {
  annotationId: string;
  color: string;
  column: number;
  top: number;
  height: number;
  label: string;
  quote: string;
};

export type StripeHover = {
  x: number;
  y: number;
  label: string;
  quote: string;
  color: string;
};

export type AnnotationHover = {
  x: number;
  y: number;
  items: Array<{
    annotationId: string;
    label: string;
    color: string;
    quote: string;
  }>;
};

export type AnnotationContextMenuState = {
  x: number;
  y: number;
  annotation: SourceAnnotationRow;
};

export const SOURCE_TEXT_SIZE_DEFAULT_PX = 15;
export const SOURCE_TEXT_SIZE_MIN_PX = 12;
export const SOURCE_TEXT_SIZE_MAX_PX = 24;
export const SOURCE_TEXT_SIZE_STEP_PX = 1;

export function normalizeSourceTextSizePx(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return SOURCE_TEXT_SIZE_DEFAULT_PX;
  return Math.max(SOURCE_TEXT_SIZE_MIN_PX, Math.min(SOURCE_TEXT_SIZE_MAX_PX, Math.round(value)));
}

export function usePostgresSourceTextSizePreference() {
  const [textSizePx, setTextSizePx] = useState(SOURCE_TEXT_SIZE_DEFAULT_PX);

  useEffect(() => {
    let cancelled = false;
    async function loadTextSizePreference() {
      try {
        const preferences = await getPostgresUserPreferences();
        if (!cancelled) setTextSizePx(normalizeSourceTextSizePx(preferences.sourceTextSizePx));
      } catch (error) {
        console.warn("[kanqual] Could not load source text size preference.", error);
      }
    }
    void loadTextSizePreference();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistTextSizePx = useCallback(async (nextValue: number) => {
    const nextTextSizePx = normalizeSourceTextSizePx(nextValue);
    setTextSizePx(nextTextSizePx);
    try {
      const preferences = await getPostgresUserPreferences();
      const saved = await savePostgresUserPreferences({
        ...preferences,
        sourceTextSizePx: nextTextSizePx,
      });
      setTextSizePx(normalizeSourceTextSizePx(saved.sourceTextSizePx));
    } catch (error) {
      console.warn("[kanqual] Could not save source text size preference.", error);
    }
  }, []);

  const decreaseTextSize = useCallback(() => {
    setTextSizePx((current) => {
      const nextValue = normalizeSourceTextSizePx(current - SOURCE_TEXT_SIZE_STEP_PX);
      void persistTextSizePx(nextValue);
      return nextValue;
    });
  }, [persistTextSizePx]);

  const increaseTextSize = useCallback(() => {
    setTextSizePx((current) => {
      const nextValue = normalizeSourceTextSizePx(current + SOURCE_TEXT_SIZE_STEP_PX);
      void persistTextSizePx(nextValue);
      return nextValue;
    });
  }, [persistTextSizePx]);

  return {
    textSizePx,
    setTextSizePx: persistTextSizePx,
    decreaseTextSize,
    increaseTextSize,
  };
}

export type PostgresSourceCodingViewProps = {
  projectId: string;
  row: SourceRow;
  codes: PostgresCode[];
  annotations: SourceAnnotationRow[];
  codeOptions: CodeOption[];
  currentUserId: string;
  sourceLock: PostgresSourceLock | null;
  sourceLockConflict: PostgresSourceLock | null;
  lockSyncing: boolean;
  canKickSourceLocks: boolean;
  canManageAnnotations: boolean;
  canManageMemos: boolean;
  canCreateCodes?: boolean;
  initialSelectedAnnotationId: string | null;
  initialTextSegment: { startOffset: number; endOffset: number } | null;
  saving: boolean;
  error: string | null;
  onCreateCode?: (payload: { label: string; color: string; description: string; parentCodeId?: string | null }) => Promise<PostgresCode>;
  onUpdateCode?: (codeId: string, payload: { label: string; color: string; description: string; parentCodeId?: string | null }) => Promise<PostgresCode>;
  onDeleteCode?: (codeId: string) => Promise<void>;
  onCreateAnnotation: (sourceId: string, selection: PendingSelection, payload: { codeIds: string[]; note: string }) => Promise<void>;
  onUpdateAnnotation: (
    annotation: SourceAnnotationRow,
    payload: {
      codeIds: string[];
      note: string;
      startOffset?: number | null;
      endOffset?: number | null;
      timeStartMs?: number | null;
      timeEndMs?: number | null;
      quote?: string;
      anchorKind?: string;
      imageRegion?: PendingSelection["imageRegion"];
    },
  ) => Promise<void>;
  onDeleteAnnotation: (annotationId: string) => Promise<void>;
  onKickSourceLock: (lock: PostgresSourceLock) => Promise<void>;
  onOpenMemoDraft: (payload: { sourceIds?: string[]; annotationIds?: string[]; codeIds?: string[] }) => void;
  onUpdateSourceWaveform: (sourceId: string, waveformPeaksJson: string) => Promise<void>;
  onUpdateSourceVideoFrameIndex?: (sourceId: string, videoFrameIndexJson: string) => Promise<void>;
  onExtractVideoFrame?: (payload: { file: File; title: string; extractedFromVideoSourceId: string; extractedFromVideoTimeMs: number }) => Promise<void>;
  onBack: () => void;
};

export function TextSizeControls({
  fontSizePx,
  onDecrease,
  onIncrease,
}: {
  fontSizePx: number;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="text-size-controls" aria-label="Text size">
      <button
        type="button"
        className="text-size-control-btn text-size-control-btn--decrease"
        onClick={onDecrease}
        disabled={fontSizePx <= SOURCE_TEXT_SIZE_MIN_PX}
        aria-label="Decrease text size"
        title="Decrease text size"
      >
        A
      </button>
      <span className="text-size-control-value" aria-live="polite">
        {fontSizePx}px
      </span>
      <button
        type="button"
        className="text-size-control-btn text-size-control-btn--increase"
        onClick={onIncrease}
        disabled={fontSizePx >= SOURCE_TEXT_SIZE_MAX_PX}
        aria-label="Increase text size"
        title="Increase text size"
      >
        A
      </button>
    </div>
  );
}

function withHexAlpha(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

export function buildMultiAnnotationBackground(colors: string[], isSelected: boolean): string {
  const uniqueColors = [...new Set(colors.filter(Boolean))];
  if (uniqueColors.length === 0) {
    return isSelected ? "rgba(53, 80, 112, 0.18)" : "rgba(53, 80, 112, 0.10)";
  }
  if (uniqueColors.length === 1) {
    return withHexAlpha(uniqueColors[0], isSelected ? "55" : "33");
  }
  const alpha = isSelected ? "88" : "55";
  const stripeWidth = 10;
  const stops = uniqueColors.flatMap((color, index) => {
    const start = index * stripeWidth;
    const end = start + stripeWidth;
    const tinted = withHexAlpha(color, alpha);
    return [`${tinted} ${start}px`, `${tinted} ${end}px`];
  });
  return `repeating-linear-gradient(135deg, ${stops.join(", ")})`;
}

export function orderedCodesWithDepth(codes: PostgresCode[]): CodeTreeNode[] {
  const children = new Map<string | null, PostgresCode[]>();
  codes.forEach((code) => {
    const parentId = code.parentCodeId || null;
    const list = children.get(parentId) ?? [];
    list.push(code);
    children.set(parentId, list);
  });
  children.forEach((list) => list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })));

  const ordered: CodeTreeNode[] = [];
  function walk(parentId: string | null, depth: number) {
    const list = children.get(parentId) ?? [];
    list.forEach((code) => {
      const hasChildren = (children.get(code.id)?.length ?? 0) > 0;
      ordered.push({ code, depth, hasChildren });
      walk(code.id, depth + 1);
    });
  }
  walk(null, 0);
  return ordered;
}

export function visibleCodeNodes(tree: CodeTreeNode[], collapsed: Set<string>): CodeTreeNode[] {
  const hiddenAncestors = new Set<string>();
  const visible: CodeTreeNode[] = [];
  tree.forEach((node) => {
    if (!hiddenAncestors.has(node.code.parentCodeId || "")) {
      visible.push(node);
    }
    if (collapsed.has(node.code.id)) {
      hiddenAncestors.add(node.code.id);
    }
  });
  return visible;
}

export function PostgresSourceCodebookCard({
  codes,
  selectedCodeId,
  annotationCountByCodeId,
  canCreateCodes = false,
  canManageMemos = false,
  canSelectCodes = true,
  isAnnotatable = false,
  selectionHint,
  saving = false,
  className = "annotate-card",
  style,
  onSelectCode,
  onNewCode,
  onEditCode,
  onAddChildCode,
  onDeleteCode,
  onOpenMemoDraft,
}: {
  codes: PostgresCode[];
  selectedCodeId: string | null;
  annotationCountByCodeId: Map<string, number>;
  canCreateCodes?: boolean;
  canManageMemos?: boolean;
  canSelectCodes?: boolean;
  isAnnotatable?: boolean;
  selectionHint?: string | null;
  saving?: boolean;
  className?: string;
  style?: CSSProperties;
  onSelectCode: (codeId: string) => void | Promise<void>;
  onNewCode?: () => void;
  onEditCode?: (codeId: string) => void;
  onAddChildCode?: (codeId: string) => void;
  onDeleteCode?: (codeId: string) => void;
  onOpenMemoDraft?: (payload: { codeIds?: string[] }) => void;
}) {
  const [collapsedCodeIds, setCollapsedCodeIds] = useState<Set<string>>(new Set());
  const [codeContextMenu, setCodeContextMenu] = useState<{ x: number; y: number; code: PostgresCode } | null>(null);
  const codeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const codeContextMenuStyle = useViewportContextMenuStyle(codeContextMenu, codeContextMenuRef);
  const codeTree = useMemo(() => orderedCodesWithDepth(codes), [codes]);
  const visibleCodes = useMemo(() => visibleCodeNodes(codeTree, collapsedCodeIds), [collapsedCodeIds, codeTree]);
  const hasContextMenu = (canCreateCodes && (onEditCode || onAddChildCode || onDeleteCode)) || (canManageMemos && onOpenMemoDraft);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (codeContextMenuRef.current && !codeContextMenuRef.current.contains(event.target as Node)) {
        setCodeContextMenu(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCodeContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function toggleCollapsedCode(codeId: string) {
    setCollapsedCodeIds((current) => {
      const next = new Set(current);
      if (next.has(codeId)) next.delete(codeId);
      else next.add(codeId);
      return next;
    });
  }

  return (
    <>
      <div className={className} style={style}>
        <div className="annotate-card-header">
          <span className="annotate-card-title">Codebook</span>
          {onNewCode ? (
            <button
              type="button"
              className="codebook-icon-action"
              onClick={onNewCode}
              disabled={!canCreateCodes || saving}
              aria-label="New code"
              title={canCreateCodes ? "New code" : "You do not have permission to create codes."}
            >
              +
            </button>
          ) : null}
        </div>
        {selectionHint ? <div className="codebook-selection-hint">{selectionHint}</div> : null}
        <ul className="code-list">
          {codes.length === 0 ? (
            <li className="code-list-empty">No codes yet.</li>
          ) : (
            visibleCodes.map(({ code, depth, hasChildren }) => (
              <li
                key={code.id}
                className={`code-item${isAnnotatable ? " code-item--annotatable" : ""}${selectedCodeId === code.id ? " code-item--selected" : ""}`}
                style={{ paddingLeft: 6 + depth * 16 }}
                onMouseDown={(event) => {
                  if (isAnnotatable) event.preventDefault();
                }}
                onClick={() => {
                  if (!canSelectCodes) return;
                  void onSelectCode(code.id);
                }}
                onContextMenu={(event) => {
                  if (!hasContextMenu) return;
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

      {codeContextMenu ? (
        <div ref={codeContextMenuRef} className="context-menu" style={codeContextMenuStyle}>
          {canCreateCodes && onEditCode ? (
            <button
              className="context-menu-item"
              onClick={() => {
                onEditCode(codeContextMenu.code.id);
                setCodeContextMenu(null);
              }}
            >
              Edit code
            </button>
          ) : null}
          {canManageMemos && onOpenMemoDraft ? (
            <button
              className="context-menu-item"
              onClick={() => {
                onOpenMemoDraft({ codeIds: [codeContextMenu.code.id] });
                setCodeContextMenu(null);
              }}
            >
              Memo about code
            </button>
          ) : null}
          {canCreateCodes && onAddChildCode ? (
            <button
              className="context-menu-item"
              onClick={() => {
                onAddChildCode(codeContextMenu.code.id);
                setCodeContextMenu(null);
              }}
            >
              Add child code
            </button>
          ) : null}
          {canCreateCodes && onDeleteCode ? (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => {
                onDeleteCode(codeContextMenu.code.id);
                setCodeContextMenu(null);
              }}
            >
              Delete code
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function getFloatingTooltipStyle(x: number, y: number, tooltipWidth = 280, tooltipHeight = 180) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.min(x + 16, viewportWidth - tooltipWidth - 16);
  const top = Math.min(y + 16, viewportHeight - tooltipHeight - 16);
  return {
    left: Math.max(16, left),
    top: Math.max(16, top),
  };
}

export function tooltipExcerpt(value: string, limit = 90): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function fmtDate(iso: string): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "-";
  }
}

export function AnnotationEditorModal({
  title,
  codeOptions,
  selection,
  initialAnnotation,
  saving,
  error,
  onCancel,
  onSave,
  onDelete,
}: {
  title: string;
  codeOptions: CodeOption[];
  selection: PendingSelection;
  initialAnnotation?: SourceAnnotationRow | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (payload: { codeIds: string[]; note: string }) => void;
  onDelete?: () => void;
}) {
  const [selectedCodeIds, setSelectedCodeIds] = useState<string[]>(initialAnnotation?.codeIds ?? []);
  const [note, setNote] = useState(initialAnnotation?.note ?? "");

  function toggleCode(codeId: string) {
    setSelectedCodeIds((current) => (
      current.includes(codeId)
        ? current.filter((entry) => entry !== codeId)
        : [...current, codeId]
    ));
  }

  return (
    <SettingsModal title={title} onClose={onCancel} closeDisabled={saving} modalClassName="modal--wide assoc-doc-modal">
      <div className="app-settings-modal-body">
        <p className="users-guide-copy" style={{ marginBottom: selection.quote ? 12 : 16 }}>
          {selection.displayLabel ?? `${selection.startOffset}-${selection.endOffset}`}
        </p>
        {selection.quote ? (
          <blockquote className="annotation-quote" style={{ margin: "0 0 16px" }}>
            "{selection.quote}"
          </blockquote>
        ) : null}
        <div className="form">
          <label className="form-label">
            Codes
            <div
              style={{
                maxHeight: 240,
                overflow: "auto",
                border: "1px solid var(--color-border, rgba(53, 80, 112, 0.14))",
                borderRadius: 12,
                padding: 10,
                background: "rgba(255,255,255,0.92)",
              }}
            >
              {codeOptions.length === 0 ? (
                <p className="users-guide-copy" style={{ margin: 0 }}>Create a code before annotating this source.</p>
              ) : (
                codeOptions.map((code) => (
                  <label
                    key={code.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCodeIds.includes(code.id)}
                      onChange={() => toggleCode(code.id)}
                    />
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: code.color || "#888888",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ whiteSpace: "pre-wrap" }}>{code.label}</span>
                  </label>
                ))
              )}
            </div>
          </label>
          <label className="form-label">
            Note
            <textarea className="form-input" rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
        {error && <p className="auth-error">{error}</p>}
      </div>
      <div className="app-settings-modal-footer">
          {initialAnnotation && onDelete ? (
            <button className="btn btn--danger" onClick={onDelete} disabled={saving}>
              {saving ? "Deleting..." : "Delete"}
            </button>
          ) : null}
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({ codeIds: selectedCodeIds, note })}
            disabled={saving || selectedCodeIds.length === 0}
          >
            {saving ? "Saving..." : "Save Annotation"}
          </button>
      </div>
    </SettingsModal>
  );
}

export function PostgresSourceCodingFiltersModal({
  codes,
  annotations,
  hiddenUserIds,
  hiddenCodeIds,
  onToggleUser,
  onToggleCode,
  onSelectAllUsers,
  onClearUsers,
  onSelectAllCodes,
  onClearCodes,
  onClose,
}: {
  codes: PostgresCode[];
  annotations: SourceAnnotationRow[];
  hiddenUserIds: Set<string>;
  hiddenCodeIds: Set<string>;
  onToggleUser: (userId: string) => void;
  onToggleCode: (codeId: string) => void;
  onSelectAllUsers: () => void;
  onClearUsers: () => void;
  onSelectAllCodes: () => void;
  onClearCodes: () => void;
  onClose: () => void;
}) {
  const users = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      const key = annotation.createdByName || "Unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, name: id, count }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [annotations]);

  const codeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      for (const codeId of annotation.codeIds) {
        counts.set(codeId, (counts.get(codeId) ?? 0) + 1);
      }
    }
    return counts;
  }, [annotations]);

  const visibleCodes = useMemo(
    () => orderedCodesWithDepth(codes).filter(({ code }) => (codeCounts.get(code.id) ?? 0) > 0),
    [codeCounts, codes],
  );

  return (
    <SettingsModal title="Filters" onClose={onClose} modalClassName="modal--wide annotation-filter-modal">
      <div className="app-settings-modal-body">
        <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
          Choose which coded annotations stay visible in this workspace.
        </p>
        <div className="annotation-filter-modal-grid">
          <div className="annotation-filter-group">
            <div className="annotation-filter-title-row">
              <div className="annotation-filter-title">Codes</div>
              <div className="annotation-filter-actions">
                <button type="button" className="btn btn--small" onClick={onSelectAllCodes}>Select All</button>
                <button type="button" className="btn btn--small" onClick={onClearCodes}>Clear</button>
              </div>
            </div>
            {visibleCodes.length === 0 ? (
              <p className="annotation-filter-empty">No coded annotations yet.</p>
            ) : (
              <ul className="annotation-filter-list">
                {visibleCodes.map(({ code, depth }) => (
                  <li key={code.id} className="annotation-filter-item">
                    <label className="annotation-filter-label">
                      <input
                        type="checkbox"
                        className="users-filter-checkbox"
                        checked={!hiddenCodeIds.has(code.id)}
                        onChange={() => onToggleCode(code.id)}
                      />
                      <span className="annotation-filter-code-row" style={{ paddingLeft: `${depth * 16}px` }}>
                        <span className="annotation-filter-swatch" style={{ background: code.color }} />
                        <span className="annotation-filter-name">{code.label}</span>
                      </span>
                      <span className="users-filter-count">{codeCounts.get(code.id) ?? 0}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="annotation-filter-group">
            <div className="annotation-filter-title-row">
              <div className="annotation-filter-title">Users</div>
              <div className="annotation-filter-actions">
                <button type="button" className="btn btn--small" onClick={onSelectAllUsers}>Select All</button>
                <button type="button" className="btn btn--small" onClick={onClearUsers}>Clear</button>
              </div>
            </div>
            {users.length === 0 ? (
              <p className="annotation-filter-empty">No annotators yet.</p>
            ) : (
              <ul className="annotation-filter-list">
                {users.map((user) => (
                  <li key={user.id} className="annotation-filter-item">
                    <label className="annotation-filter-label">
                      <input
                        type="checkbox"
                        className="users-filter-checkbox"
                        checked={!hiddenUserIds.has(user.id)}
                        onChange={() => onToggleUser(user.id)}
                      />
                      <span className="annotation-filter-name">{user.name}</span>
                      <span className="users-filter-count">{user.count}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
      </div>
    </SettingsModal>
  );
}

export function PostgresSourceAnnotationPanel({
  annotations,
  selectedAnnotationId,
  codesById,
  renderAnnotationExcerpt,
  onSelectAnnotation,
  onDeleteAnnotation,
  onOpenMemoDraft,
  canManageMemos,
  canDeleteAnnotations,
}: {
  annotations: SourceAnnotationRow[];
  selectedAnnotationId: string | null;
  codesById: Map<string, PostgresCode>;
  renderAnnotationExcerpt?: (annotation: SourceAnnotationRow) => ReactNode;
  onSelectAnnotation: (annotationId: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onOpenMemoDraft: (payload: { annotationIds?: string[]; codeIds?: string[] }) => void;
  canManageMemos: boolean;
  canDeleteAnnotations: boolean;
}) {
  const selectedItemRef = useRef<HTMLLIElement | null>(null);
  const [contextMenu, setContextMenu] = useState<AnnotationContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedAnnotationId]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="annotate-card annotate-card--grow">
      <div className="annotate-card-header">
        <span className="annotate-card-title">Annotations ({annotations.length})</span>
      </div>
      <ul className="annotation-list">
        {annotations.length === 0 ? (
          <li className="annotation-list-empty">No annotations yet.</li>
        ) : (
          annotations.map((annotation) => {
            const selected = annotation.id === selectedAnnotationId;
            const annotationCodes = annotation.codeIds
              .map((codeId) => codesById.get(codeId))
              .filter((code): code is PostgresCode => Boolean(code));
            const showQuote = !(annotation.anchorKind === "time_range" && annotation.quote.trim().startsWith("Clip "));
            return (
              <li
                key={annotation.id}
                ref={selected ? selectedItemRef : null}
                className={`annotation-item annotation-item--clickable${selected ? " annotation-item--selected" : ""}`}
                onClick={() => onSelectAnnotation(annotation.id)}
                onContextMenu={(event) => {
                  if (!canManageMemos && !canDeleteAnnotations) return;
                  event.preventDefault();
                  setContextMenu({ x: event.clientX, y: event.clientY, annotation });
                }}
              >
                <div className="annotation-item-header">
                  {annotationCodes.map((code) => (
                    <span key={code.id} className="annotation-code-badge" style={{ background: code.color }}>
                      {code.label}
                    </span>
                  ))}
                </div>
                {showQuote ? <blockquote className="annotation-quote">"{annotation.quote}"</blockquote> : null}
                {renderAnnotationExcerpt ? renderAnnotationExcerpt(annotation) : null}
                {annotation.note ? <p className="annotation-note">{annotation.note}</p> : null}
                <p className="annotation-meta">
                  <span>{annotation.createdByName || "Unknown"}</span>
                  <span className="annotation-meta-sep">·</span>
                  <span>{fmtDate(annotation.createdAt)}</span>
                </p>
              </li>
            );
          })
        )}
      </ul>
      <PostgresSourceAnnotationContextMenu
        contextMenu={contextMenu}
        contextMenuRef={contextMenuRef}
        contextMenuStyle={contextMenuStyle}
        onClose={() => setContextMenu(null)}
        onDeleteAnnotation={onDeleteAnnotation}
        onOpenMemoDraft={onOpenMemoDraft}
        canManageMemos={canManageMemos}
        canDeleteAnnotations={canDeleteAnnotations}
      />
    </div>
  );
}

export function PostgresSourceAnnotationContextMenu({
  contextMenu,
  contextMenuRef,
  contextMenuStyle,
  onClose,
  onDeleteAnnotation,
  onOpenMemoDraft,
  canManageMemos,
  canDeleteAnnotations,
}: {
  contextMenu: AnnotationContextMenuState | null;
  contextMenuRef: React.RefObject<HTMLDivElement | null>;
  contextMenuStyle: React.CSSProperties | undefined;
  onClose: () => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onOpenMemoDraft: (payload: { annotationIds?: string[]; codeIds?: string[] }) => void;
  canManageMemos: boolean;
  canDeleteAnnotations: boolean;
}) {
  if (!contextMenu) return null;

  return (
    <div ref={contextMenuRef} className="context-menu" style={contextMenuStyle}>
      {canManageMemos ? (
        <button
          className="context-menu-item"
          onClick={() => {
            onOpenMemoDraft({ annotationIds: [contextMenu.annotation.id] });
            onClose();
          }}
        >
          Memo about annotation
        </button>
      ) : null}
      {canDeleteAnnotations ? (
        <button
          className="context-menu-item context-menu-item--danger"
          onClick={() => {
            onDeleteAnnotation(contextMenu.annotation.id);
            onClose();
          }}
        >
          Delete annotation
        </button>
      ) : null}
    </div>
  );
}
