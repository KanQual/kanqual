import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import type {
  PostgresExperimentCode,
  PostgresExperimentSourceLock,
} from "../lib/postgresExperiment";
import type {
  CodeOption,
  PendingSelection,
  SourceAnnotationRow,
  SourceRow,
} from "./Postgres_Sources_View";

type CodeTreeNode = {
  code: PostgresExperimentCode;
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

export type PostgresSourceCodingViewProps = {
  row: SourceRow;
  codes: PostgresExperimentCode[];
  annotations: SourceAnnotationRow[];
  codeOptions: CodeOption[];
  currentUserId: string;
  sourceLock: PostgresExperimentSourceLock | null;
  sourceLockConflict: PostgresExperimentSourceLock | null;
  lockSyncing: boolean;
  canKickSourceLocks: boolean;
  canManageAnnotations: boolean;
  canManageMemos: boolean;
  initialSelectedAnnotationId: string | null;
  saving: boolean;
  error: string | null;
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
  onKickSourceLock: (lock: PostgresExperimentSourceLock) => Promise<void>;
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

export function orderedCodesWithDepth(codes: PostgresExperimentCode[]): CodeTreeNode[] {
  const children = new Map<string | null, PostgresExperimentCode[]>();
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
    <div className="modal-overlay" onClick={() => !saving && onCancel()}>
      <div className="modal modal--wide assoc-doc-modal" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
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
        <div className="form-actions">
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
      </div>
    </div>
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
  codes: PostgresExperimentCode[];
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide annotation-filter-modal" onClick={(event) => event.stopPropagation()}>
        <h2>Filters</h2>
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
        <div className="form-actions" style={{ marginTop: 20 }}>
          <button type="button" className="btn btn--primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
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
  codesById: Map<string, PostgresExperimentCode>;
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
            const primaryCode = annotation.codeIds[0] ? codesById.get(annotation.codeIds[0]) : null;
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
                  {primaryCode ? (
                    <span className="annotation-code-badge" style={{ background: primaryCode.color }}>
                      {primaryCode.label}
                    </span>
                  ) : null}
                </div>
                <blockquote className="annotation-quote">"{annotation.quote}"</blockquote>
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
