import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Document as DocxDocument,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { jsPDF } from "jspdf";
import { useStore } from "../context/StoreContext";
import { readAppSettings } from "../lib/appSettings";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { readProjectAiAssistSettings } from "../lib/projectAiAssistSettings";
import type { Code, Annotation } from "../types";
import {
  ProcessedTranscriptView,
  getProcessedTranscriptQuestionOutline,
  parseProcessedTranscriptSegments,
} from "../components/ProcessedTranscriptView";
import { FilterIcon } from "../components/FilterIcon";
import helpIcon from "../assets/ic_help_outline_24px.svg";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type RelevantSegment = {
  id: string;
  itemType: string;
  title: string;
  preview: string;
  matchText?: string;
  reason: string;
  similarity: number;
  documentId?: string;
  codeId?: string;
  annotationId?: string;
  startOffset?: number;
  endOffset?: number;
};

type CitationRange = {
  startOffset: number;
  endOffset: number;
  label?: string;
  requestId: number;
};

type CitationOverlayRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type RelevantSegmentsResponse = {
  model: string;
  baseUrl: string;
  searchedItems: number;
  segments: RelevantSegment[];
};

function isWordCharacter(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char);
}

function clampPreviewToWholeWords(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  const slice = compact.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxChars * 0.6)) {
    return `${slice.slice(0, lastSpace).trimEnd()}...`;
  }
  return `${slice.trimEnd()}...`;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Color utilities ──────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(5, Math.min(95, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hueDiff(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

function colorDistance(hex1: string, hex2: string): number {
  try {
    const [h1, s1, l1] = hexToHsl(hex1);
    const [h2, s2, l2] = hexToHsl(hex2);
    return hueDiff(h1, h2) * 0.7 + Math.abs(s1 - s2) * 0.15 + Math.abs(l1 - l2) * 0.15;
  } catch { return 0; }
}

const TOP_LEVEL_PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#ec4899", "#f43f5e", "#10b981", "#0ea5e9", "#a855f7",
  "#64748b",
];

function getTopLevelSuggestions(existingColors: string[], count = 8): string[] {
  return [...TOP_LEVEL_PALETTE]
    .map((c) => ({
      color: c,
      score: existingColors.length === 0
        ? TOP_LEVEL_PALETTE.indexOf(c) * -1
        : Math.min(...existingColors.map((e) => colorDistance(c, e))),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.color);
}

function getChildSuggestions(parentColor: string, count = 8): string[] {
  if (!parentColor?.startsWith("#")) return [];
  const [h, s, l] = hexToHsl(parentColor);
  return [
    hslToHex(h, s, Math.min(l + 22, 85)),
    hslToHex(h, s, Math.max(l - 22, 15)),
    hslToHex(h, Math.min(s + 18, 95), l),
    hslToHex(h, Math.max(s - 18, 25), l),
    hslToHex((h + 18) % 360, s, l),
    hslToHex((h - 18 + 360) % 360, s, l),
    hslToHex((h + 30) % 360, s, Math.min(l + 10, 85)),
    hslToHex((h - 30 + 360) % 360, s, Math.max(l - 10, 15)),
  ].slice(0, count);
}

// ─── ColorSuggestions ────────────────────────────────────────────────────────

function ColorSuggestions({
  suggestions,
  selected,
  onSelect,
}: {
  suggestions: string[];
  selected: string;
  onSelect: (c: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="code-color-suggestions">
      {suggestions.map((c) => (
        <button
          key={c}
          type="button"
          className={`code-suggestion-swatch${selected === c ? " code-suggestion-swatch--active" : ""}`}
          style={{ background: c }}
          onClick={() => onSelect(c)}
          title={c}
        />
      ))}
    </div>
  );
}

// ─── NewCodeModal ─────────────────────────────────────────────────────────────

function NewCodeModal({ onClose }: { onClose: () => void }) {
  const { activeProject, codes, addCode } = useStore();
  const [label,    setLabel]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [color,    setColor]    = useState("#6366f1");
  const [parentId, setParentId] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const parentCode = codes.find((c) => c.id === parentId);

  const colorSuggestions = useMemo(() => {
    if (parentId && parentCode) return getChildSuggestions(parentCode.color);
    return getTopLevelSuggestions(codes.map((c) => c.color));
  }, [parentId, parentCode, codes]);

  useEffect(() => {
    if (colorSuggestions.length > 0) setColor(colorSuggestions[0]);
  }, [parentId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !activeProject) return;
    setLoading(true);
    setError(null);
    try {
      await addCode(label.trim(), color, desc, undefined, parentId || undefined);
      onClose();
    } catch (e) {
      const fieldErrors = (e as { data?: { data?: Record<string, { message?: string }> } }).data?.data;
      if (fieldErrors && Object.keys(fieldErrors).length > 0) {
        setError(Object.entries(fieldErrors).map(([f, v]) => `${f}: ${v?.message ?? "invalid"}`).join(" · "));
      } else {
        setError(e instanceof Error ? (e as Error).message : "Failed to create code.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Code</h2>
        <form className="form" onSubmit={handleSubmit}>
          <label className="form-label">
            Code Name
            <input
              className="form-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Resilience"
              required
              autoFocus
            />
          </label>
          <label className="form-label">
            Description
            <textarea
              className="form-input code-desc-textarea"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional description…"
              rows={3}
            />
          </label>
          <label className="form-label">
            Parent Code
            <select
              className="form-input"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">— Top-level (no parent) —</option>
              {codes.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Color
            <div className="code-color-row" style={{ marginTop: 6 }}>
              <input
                type="color"
                className="code-color-input"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <span className="code-color-hex">{color}</span>
            </div>
            <ColorSuggestions suggestions={colorSuggestions} selected={color} onSelect={setColor} />
            <p className="code-color-hint">
              {parentId ? "Suggested shades of the parent code's color" : "Suggested colors distinct from existing codes"}
            </p>
          </label>
          {error && <p className="auth-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={loading || !label.trim()}>
              {loading ? "Creating…" : "Create Code"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── EditCodeModal ────────────────────────────────────────────────────────────

function EditCodeModal({ code, onClose }: { code: Code; onClose: () => void }) {
  const { codes, updateCode } = useStore();
  const [label,   setLabel]   = useState(code.label);
  const [color,   setColor]   = useState(code.color || "#6366f1");
  const [desc,    setDesc]    = useState(code.description);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const colorSuggestions = useMemo(() => {
    const others = codes.filter((c) => c.id !== code.id).map((c) => c.color);
    return getTopLevelSuggestions(others);
  }, [codes, code.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await updateCode(code.id, { label: label.trim(), color, description: desc });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? (e as Error).message : "Failed to save.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit Code</h2>
        <form className="form" onSubmit={handleSubmit}>
          <label className="form-label">
            Code Name
            <input
              className="form-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="form-label">
            Description
            <textarea
              className="form-input code-desc-textarea"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional description…"
              rows={3}
            />
          </label>
          <label className="form-label">
            Color
            <div className="code-color-row" style={{ marginTop: 6 }}>
              <input
                type="color"
                className="code-color-input"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <span className="code-color-hex">{color}</span>
            </div>
            <ColorSuggestions suggestions={colorSuggestions} selected={color} onSelect={setColor} />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={loading || !label.trim()}>
              {loading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Code tree helpers ────────────────────────────────────────────────────────

interface CodeTreeNode { code: Code; depth: number; hasChildren: boolean; }

/** Returns codes in depth-first order with depth and hasChildren flag. */
function orderedWithDepth(codes: Code[]): CodeTreeNode[] {
  const childrenOf: Record<string, Code[]> = {};
  const roots: Code[] = [];
  for (const c of codes) {
    if (c.parentId) {
      (childrenOf[c.parentId] ??= []).push(c);
    } else {
      roots.push(c);
    }
  }
  const result: CodeTreeNode[] = [];
  function traverse(nodes: Code[], depth: number) {
    for (const node of nodes) {
      result.push({ code: node, depth, hasChildren: !!(childrenOf[node.id]?.length) });
      traverse(childrenOf[node.id] ?? [], depth + 1);
    }
  }
  traverse(roots, 0);
  // Append any orphans (parent deleted) at depth 0
  const seen = new Set(result.map((r) => r.code.id));
  for (const c of codes) {
    if (!seen.has(c.id)) result.push({ code: c, depth: 0, hasChildren: false });
  }
  return result;
}

/** Filters a depth-first node list respecting collapsed parent IDs. */
function visibleNodes(tree: CodeTreeNode[], collapsed: Set<string>): CodeTreeNode[] {
  const result: CodeTreeNode[] = [];
  const collapseStack: number[] = [];
  for (const node of tree) {
    while (collapseStack.length > 0 && node.depth <= collapseStack[collapseStack.length - 1]) {
      collapseStack.pop();
    }
    if (collapseStack.length > 0) continue;
    result.push(node);
    if (node.hasChildren && collapsed.has(node.code.id)) {
      collapseStack.push(node.depth);
    }
  }
  return result;
}

// ─── CodebookPanel ────────────────────────────────────────────────────────────

interface PendingSelection { start: number; end: number; quote: string; }

function getPocketBaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? error.message : "Failed to create annotation.";
  }

  const maybe = error as {
    message?: string;
    response?: { message?: string; data?: Record<string, { message?: string; code?: string }> };
  };
  const details = maybe.response?.data
    ? Object.entries(maybe.response.data)
        .map(([field, detail]) => `${field}: ${detail.message || detail.code || "invalid value"}`)
        .join("; ")
    : "";
  return details || maybe.response?.message || maybe.message || "Failed to create annotation.";
}

const CODEBOOK_HEADER_H = 37;  // .annotate-card-header height
const CODE_ITEM_H       = 34;  // .code-item: 7px top + 7px bottom + 13px text × 1.5

function CodebookPanel({
  pendingSelection,
  pendingSelectionRef,
  onClearSelection,
  onAnnotationApplied,
  hiddenUserIds,
  hiddenCodeIds,
  maxHeight,
  selectedCodeId,
  onSelectCode,
  annotationCountOverride,
}: {
  pendingSelection: PendingSelection | null;
  pendingSelectionRef: React.RefObject<PendingSelection | null>;
  onClearSelection: () => void;
  onAnnotationApplied: () => void;
  hiddenUserIds: Set<string>;
  hiddenCodeIds: Set<string>;
  maxHeight: number;
  selectedCodeId: string | null;
  onSelectCode: (codeId: string) => void;
  annotationCountOverride?: Record<string, number>;
}) {
  const { codes, annotations, canCurrentUser, deleteCode, addAnnotation, activeDocument } = useStore();
  const canCreateCodes = canCurrentUser("createCode");
  const canEditCodes = canCurrentUser("editCode");
  const canDeleteCodes = canCurrentUser("deleteCode");
  const canCreateAnnotations = canCurrentUser("createAnnotations");

  const annCountByCode = useMemo(() => {
    if (annotationCountOverride) return annotationCountOverride;
    const counts: Record<string, number> = {};
    for (const ann of annotations) {
      if (hiddenUserIds.size > 0 && hiddenUserIds.has(ann.createdById)) continue;
      if (hiddenCodeIds.size > 0 && hiddenCodeIds.has(ann.codeId)) continue;
      counts[ann.codeId] = (counts[ann.codeId] ?? 0) + 1;
    }
    return counts;
  }, [annotations, hiddenUserIds, hiddenCodeIds, annotationCountOverride]);

  const tree         = useMemo(() => orderedWithDepth(codes), [codes]);
  const [collapsed,          setCollapsed]          = useState<Set<string>>(new Set());
  const visible      = useMemo(() => visibleNodes(tree, collapsed), [tree, collapsed]);

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const [showNewCode,        setShowNewCode]        = useState(false);
  const [editCode,           setEditCode]           = useState<Code | null>(null);
  const [confirmDeleteCode,  setConfirmDeleteCode]  = useState<Code | null>(null);
  const [deletingCode,       setDeletingCode]       = useState(false);
  const [contextMenu,        setContextMenu]        = useState<{ x: number; y: number; code: Code } | null>(null);
  const [annotationError,    setAnnotationError]    = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  // ── Dynamic card height ─────────────────────────────────────────────────────
  const listRef        = useRef<HTMLUListElement>(null);
  const [listScrollH,  setListScrollH] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      // Sum item offsetHeights — avoids the flex:1 feedback loop where
      // scrollHeight reflects the stretched container, not item content.
      let h = 12; // .code-list padding-top (6px) + padding-bottom (6px)
      for (const child of el.children) {
        h += (child as HTMLElement).offsetHeight;
      }
      setListScrollH(h);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const naturalH  = CODEBOOK_HEADER_H + listScrollH + CODE_ITEM_H * 2;
  const cardH     = maxHeight > 0 ? Math.min(naturalH, maxHeight) : naturalH;

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") setContextMenu(null); }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function handleDeleteCode() {
    if (!confirmDeleteCode) return;
    setDeletingCode(true);
    try {
      await deleteCode(confirmDeleteCode.id);
      setConfirmDeleteCode(null);
    } finally {
      setDeletingCode(false);
    }
  }

  async function handleAnnotateWithCode(code: Code) {
    const sel = pendingSelectionRef.current;
    if (sel && activeDocument && canCreateAnnotations) {
      setAnnotationError(null);
      try {
        await addAnnotation(
          activeDocument.id,
          code.id,
          sel.start,
          sel.end,
          sel.quote,
        );
        window.getSelection()?.removeAllRanges();
        onClearSelection();
        onAnnotationApplied();
      } catch (error) {
        setAnnotationError(getPocketBaseErrorMessage(error));
      }
    }
  }

  async function handleCodeClick(code: Code) {
    if (pendingSelectionRef.current) {
      await handleAnnotateWithCode(code);
      return;
    }
    setAnnotationError(null);
    onSelectCode(code.id);
  }

  return (
    <div className="annotate-card" style={{ height: cardH, flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">Codebook</span>
        {canCreateCodes && (
          <button className="btn btn--small btn--primary" onClick={() => setShowNewCode(true)}>
            + Code
          </button>
        )}
      </div>

      {pendingSelection && (
        <div className="codebook-selection-hint">
          Click a code to annotate
        </div>
      )}
      {annotationError && (
        <div className="form-error" style={{ margin: "0 12px 10px" }}>
          {annotationError}
        </div>
      )}

      <ul ref={listRef} className="code-list">
        {codes.length === 0 && (
          <li className="code-list-empty">No codes yet.</li>
        )}
        {visible.map(({ code, depth, hasChildren }) => (
          <li
            key={code.id}
            className={`code-item${pendingSelection ? " code-item--annotatable" : ""}${selectedCodeId === code.id ? " code-item--selected" : ""}`}
            style={{ paddingLeft: 6 + depth * 16 }}
            onMouseDown={(e) => {
              if (!pendingSelectionRef.current) return;
              e.preventDefault();
            }}
            onClick={() => handleCodeClick(code)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, code });
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                className="code-collapse-btn"
                onClick={(e) => { e.stopPropagation(); toggleCollapse(code.id); }}
                title={collapsed.has(code.id) ? "Expand" : "Collapse"}
              >
                {collapsed.has(code.id) ? "▶" : "▼"}
              </button>
            ) : (
              <span className="code-collapse-spacer" />
            )}
            <span className="code-swatch" style={{ background: code.color }} />
            <span className="code-label">{code.label}</span>
            {code.shortcut && <kbd className="code-shortcut">{code.shortcut}</kbd>}
            <span className="code-ann-count">{annCountByCode[code.id] ?? 0}</span>
          </li>
        ))}
      </ul>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={contextMenuStyle}
        >
          <button className="context-menu-item" onClick={() => setContextMenu(null)}>
            Memo About Code
          </button>
          {canEditCodes && (
            <button
              className="context-menu-item"
              onClick={() => { setEditCode(contextMenu.code); setContextMenu(null); }}
            >
              Edit Code
            </button>
          )}
          {canDeleteCodes && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDeleteCode(contextMenu.code); setContextMenu(null); }}
            >
              Delete Code
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteCode && (
        <div className="modal-overlay" onClick={() => !deletingCode && setConfirmDeleteCode(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Code</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to delete <strong>{confirmDeleteCode.label}</strong>?
            </p>
            <p className="modal-warning-text">
              All annotations made with this code will be permanently deleted. This cannot be undone.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDeleteCode(null)} disabled={deletingCode}>Cancel</button>
              <button className="btn btn--danger" onClick={handleDeleteCode} disabled={deletingCode}>
                {deletingCode ? "Deleting…" : "Delete Code"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New code modal */}
      {showNewCode && <NewCodeModal onClose={() => setShowNewCode(false)} />}

      {/* Edit code modal */}
      {editCode && <EditCodeModal code={editCode} onClose={() => setEditCode(null)} />}
    </div>
  );
}

// ─── AnnotationDetailsPanel ───────────────────────────────────────────────────

export function AnnotationDetailsPanel({
  selectedQuote,
  onScrollTo,
  selectedAnnId,
  onSelectAnn,
  hiddenUserIds,
}: {
  selectedQuote: string;
  onScrollTo: (annId: string) => void;
  selectedAnnId: string | null;
  onSelectAnn: (annId: string) => void;
  hiddenUserIds: Set<string>;
}) {
  const { annotations: allAnnotations, codes, deleteAnnotation, updateAnnotationNote, canCurrentUser } = useStore();
  const canEditAnnotationNotes = canCurrentUser("editAnnotationNotes");
  const canDeleteAnnotations = canCurrentUser("deleteAnnotations");
  const annotations = useMemo(
    () => hiddenUserIds.size > 0
      ? allAnnotations.filter((a) => !hiddenUserIds.has(a.createdById))
      : allAnnotations,
    [allAnnotations, hiddenUserIds],
  );
  const selectedItemRef = useRef<HTMLLIElement>(null);
  const [contextMenu,       setContextMenu]       = useState<{ x: number; y: number; ann: Annotation } | null>(null);
  const [confirmDeleteAnn,  setConfirmDeleteAnn]  = useState<Annotation | null>(null);
  const [deletingAnn,       setDeletingAnn]       = useState(false);
  const [editingNoteAnn,    setEditingNoteAnn]    = useState<Annotation | null>(null);
  const [noteDraft,         setNoteDraft]         = useState("");
  const [savingNote,        setSavingNote]        = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  const codeMap = Object.fromEntries(codes.map((c) => [c.id, c]));

  async function handleSaveNote() {
    if (!editingNoteAnn) return;
    setSavingNote(true);
    try {
      await updateAnnotationNote(editingNoteAnn.id, noteDraft.trim());
      setEditingNoteAnn(null);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingNote(false);
    }
  }

  // Scroll selected annotation into view in the panel
  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedAnnId]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") setContextMenu(null); }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  async function handleDeleteAnn() {
    if (!confirmDeleteAnn) return;
    setDeletingAnn(true);
    try {
      await deleteAnnotation(confirmDeleteAnn.id);
      setConfirmDeleteAnn(null);
    } finally {
      setDeletingAnn(false);
    }
  }

  return (
    <div className="annotate-card annotate-card--grow">
      <div className="annotate-card-header">
        <span className="annotate-card-title">Annotations ({annotations.length})</span>
      </div>

      {selectedQuote && (
        <div className="ann-selected-quote">
          <span className="ann-selected-label">Selected</span>
          <span className="ann-selected-text">"{selectedQuote}"</span>
        </div>
      )}

      <ul className="annotation-list">
        {annotations.length === 0 && (
          <li className="annotation-list-empty">
            Select text in the document and choose a code.
          </li>
        )}
        {annotations.map((a: Annotation) => {
          const code = codeMap[a.codeId];
          const isSelected = selectedAnnId === a.id;
          return (
            <li
              key={a.id}
              ref={isSelected ? (selectedItemRef as React.RefObject<HTMLLIElement>) : null}
              className={`annotation-item annotation-item--clickable${isSelected ? " annotation-item--selected" : ""}`}
              onClick={() => { onScrollTo(a.id); onSelectAnn(a.id); }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, ann: a });
              }}
            >
              <div className="annotation-item-header">
                {code && (
                  <span
                    className="annotation-code-badge"
                    style={{ background: code.color }}
                  >
                    {code.label}
                  </span>
                )}
              </div>
              <blockquote className="annotation-quote">"{a.quote}"</blockquote>
              {editingNoteAnn?.id === a.id ? (
                <div style={{ padding: "4px 0 2px" }}>
                  <textarea
                    className="form-input"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Add a note…"
                    autoFocus
                    rows={2}
                    style={{ width: "100%", resize: "vertical", fontSize: 12 }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingNoteAnn(null);
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSaveNote();
                    }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button className="btn btn--primary" style={{ fontSize: 11, padding: "2px 8px" }} onClick={handleSaveNote} disabled={savingNote}>
                      {savingNote ? "Saving…" : "Save"}
                    </button>
                    <button className="btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setEditingNoteAnn(null)} disabled={savingNote}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                a.note && <p className="annotation-note">{a.note}</p>
              )}
              <p className="annotation-meta">
                {a.createdBy && <span>{a.createdBy}</span>}
                {a.createdBy && a.createdAt && <span className="annotation-meta-sep">·</span>}
                {a.createdAt && <span>{fmtDate(a.createdAt)}</span>}
              </p>
            </li>
          );
        })}
      </ul>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={contextMenuStyle}
        >
          {canEditAnnotationNotes && (
            <button
              className="context-menu-item"
              onClick={() => {
                setNoteDraft(contextMenu.ann.note ?? "");
                setEditingNoteAnn(contextMenu.ann);
                setContextMenu(null);
              }}
            >
              {contextMenu.ann.note ? "Edit Note" : "Add Note"}
            </button>
          )}
          {canEditAnnotationNotes && contextMenu.ann.note && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { updateAnnotationNote(contextMenu.ann.id, ""); setContextMenu(null); }}
            >
              Delete Note
            </button>
          )}
          <button className="context-menu-item" onClick={() => setContextMenu(null)}>
            Memo About Annotation
          </button>
          {canDeleteAnnotations && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDeleteAnn(contextMenu.ann); setContextMenu(null); }}
            >
              Delete Annotation
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteAnn && (
        <div className="modal-overlay" onClick={() => !deletingAnn && setConfirmDeleteAnn(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Annotation</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to delete this annotation?
            </p>
            <blockquote className="annotation-quote" style={{ margin: "0 0 16px" }}>
              "{confirmDeleteAnn.quote}"
            </blockquote>
            <p className="modal-warning-text">This cannot be undone.</p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDeleteAnn(null)} disabled={deletingAnn}>Cancel</button>
              <button className="btn btn--danger" onClick={handleDeleteAnn} disabled={deletingAnn}>
                {deletingAnn ? "Deleting…" : "Delete Annotation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── UsersPanel ──────────────────────────────────────────────────────────────

function RelevantSegmentsPanel({
  selectedCode,
  selectedQuote,
  activeSegmentId,
  onOpenSegment,
  onClearActiveSegment,
}: {
  selectedCode: Code | null;
  selectedQuote: string;
  activeSegmentId: string | null;
  onOpenSegment: (segment: RelevantSegment) => void;
  onClearActiveSegment: () => void;
}) {
  const { activeProject, activeDocument } = useStore();
  const llmSettings = useMemo(() => readAppSettings().llm, []);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const [results, setResults] = useState<RelevantSegment[]>([]);
  const [lastModel, setLastModel] = useState("");
  const [lockedCode, setLockedCode] = useState<Code | null>(null);

  useEffect(() => {
    if (lockedCode) return;
    setResults([]);
    setSearchError("");
    setSearchNotice("");
    setLastModel("");
    onClearActiveSegment();
  }, [selectedCode?.id, lockedCode]);

  const effectiveCode = lockedCode ?? selectedCode;

  function clearSearch() {
    setLockedCode(null);
    setResults([]);
    setSearchError("");
    setSearchNotice("");
    setLastModel("");
    onClearActiveSegment();
  }

  async function handleStartSearch() {
    if (!activeProject) {
      setSearchError("Open a project before searching for relevant segments.");
      return;
    }
    const codeForSearch = lockedCode ?? selectedCode;
    if (!codeForSearch) {
      setSearchError("Select a single code in the codebook first.");
      return;
    }
    if (!activeDocument) {
      setSearchError("Open a document before searching for relevant segments.");
      return;
    }
    if (!llmSettings.ollamaEnabled) {
      setSearchError("Enable Ollama in App Settings before searching for relevant segments.");
      return;
    }
    if (!llmSettings.ollamaSelectedModel) {
      setSearchError("Choose an Ollama model in App Settings before searching for relevant segments.");
      return;
    }

    setSearching(true);
    setLockedCode(codeForSearch);
    setSearchError("");
    setSearchNotice(`Ollama is reviewing indexed segments from the open document for "${codeForSearch.label}".`);
    try {
      const response = await invoke<RelevantSegmentsResponse>("find_relevant_project_segments_with_ollama", {
        request: {
          projectId: activeProject.id,
          activeDocumentId: activeDocument.id,
          codeId: codeForSearch.id,
          codeLabel: codeForSearch.label,
          codeDescription: codeForSearch.description || null,
          protocol: llmSettings.ollamaProtocol,
          host: llmSettings.ollamaHost,
          port: llmSettings.ollamaPort,
          model: llmSettings.ollamaSelectedModel,
          timeoutSeconds: llmSettings.ollamaRequestTimeoutSeconds,
          temperature: llmSettings.ollamaTemperature,
          numCtx: llmSettings.ollamaNumCtx,
          keepAliveMinutes: llmSettings.ollamaKeepAliveMinutes,
          candidateLimit: llmSettings.ollamaRelevantSegmentsCandidateLimit,
          maxResults: llmSettings.ollamaRelevantSegmentsMaxResults,
          prefixQueries: llmSettings.prefixQueries,
        },
      });
      setResults(
        response.segments.map((segment) =>
          normalizeRelevantSegmentForDocument(activeDocument.content, segment),
        ),
      );
      setLastModel(response.model);
      setSearchNotice(
        response.segments.length > 0
          ? `Ollama reviewed ${response.searchedItems} indexed candidates and returned ${response.segments.length} relevant segments.`
          : `Ollama reviewed ${response.searchedItems} indexed candidates but did not identify any strong matches yet.`,
      );
    } catch (error) {
      console.error("Relevant segment search failed:", error);
      setResults([]);
      setSearchError(error instanceof Error ? error.message : "Could not search for relevant segments.");
      setSearchNotice("");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="annotate-card annotate-card--grow">
      <div className="annotate-card-header">
        <span className="annotate-card-title">Relevant Segments</span>
        <div className="ai-segments-header-actions">
          {(lockedCode || results.length > 0 || searchError || searchNotice) && (
            <button
              type="button"
              className="btn btn--small"
              onClick={clearSearch}
              disabled={searching}
            >
              Clear
            </button>
          )}
          <button
            className="btn btn--small btn--primary"
            onClick={() => void handleStartSearch()}
            disabled={!effectiveCode || searching}
          >
            {searching ? "Searching" : results.length > 0 ? "Run Again" : "Search"}
          </button>
        </div>
      </div>

      <div className="ai-segments-summary">
        {effectiveCode ? (
          <>
            <span className="ai-segments-summary-label">
              {lockedCode ? "Search locked to code" : "Selected code"}
            </span>
            <span className="ai-segments-summary-value">{effectiveCode.label}</span>
            {lockedCode && (
              <span className="ai-segments-summary-hint">
                Search results will stay pinned to this code until you clear the search.
              </span>
            )}
          </>
        ) : (
          <span className="annotation-list-empty">Select one code in the codebook to search for relevant segments.</span>
        )}
      </div>

      {selectedQuote && (
        <div className="ann-selected-quote">
          <span className="ann-selected-label">Current selection</span>
          <span className="ann-selected-text">"{selectedQuote}"</span>
        </div>
      )}

      {searching && (
        <div className="ai-segments-search-state">
          <div className="ai-segments-progress" aria-hidden="true">
            <span className="ai-segments-progress-bar" />
          </div>
        </div>
      )}

      {searchError && <div className="form-error project-settings-error">{searchError}</div>}
      {searchNotice && !searchError && <div className="settings-success project-settings-success">{searchNotice}</div>}

      {lastModel && !searching && (
        <p className="ai-segments-model-note">
          Latest search model: <code>{lastModel}</code>
        </p>
      )}

      <ul className="annotation-list">
        {!searching && results.length === 0 && effectiveCode && !searchError && (
          <li className="annotation-list-empty">
            Start a search to ask Ollama which indexed project segments look most relevant to this code.
          </li>
        )}
        {results.map((segment) => (
          <li key={segment.id} className="annotation-item ai-segments-item">
            <button
              type="button"
              className={`ai-segments-result-button${activeSegmentId === segment.id ? " ai-segments-result-button--active" : ""}`}
              data-search-result-button="true"
              onClick={() => {
                setSearchNotice(`Opening "${segment.title}" in the text viewer.`);
                console.log("[ai-assisted-coding] clicked relevant segment", segment);
                onOpenSegment(segment);
              }}
            >
              <div className="annotation-item-header">
                <span className="annotation-code-badge ai-segments-badge">
                  {segment.itemType === "annotation" ? "Annotation" : "Text"}
                </span>
                <span className="ai-segments-score">{Math.round(segment.similarity * 100)}%</span>
              </div>
              <p className="ai-segments-title">{segment.title}</p>
              <blockquote className="annotation-quote">"{segment.preview}"</blockquote>
              <p className="annotation-note">{segment.reason}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LANE_W   = 3;
const LANE_GAP = 2;

interface StripeBar {
  color: string;
  column: number;
  top: number;
  height: number;
  label: string;
  quote: string;
}

interface StripeHover {
  x: number;
  y: number;
  label: string;
  quote: string;
  color: string;
}

function getStripeTooltipStyle(x: number, y: number) {
  const offset = 12;
  const tooltipWidth = 280;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const prefersLeft = x + offset + tooltipWidth > viewportWidth - 16;
  return {
    left: prefersLeft ? Math.max(16, x - offset) : x + offset,
    top: Math.max(16, Math.min(y - 8, viewportHeight - 120)),
    transform: prefersLeft ? "translateX(-100%)" : undefined,
  };
}

function resolveTextRangeInContainer(
  container: HTMLElement,
  startOffset: number,
  endOffset: number,
): Range | null {
  if (endOffset <= startOffset) return null;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();
  let consumed = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startInNode = 0;
  let endInNode = 0;

  while (currentNode) {
    const textNode = currentNode as Text;
    const length = textNode.textContent?.length ?? 0;
    const nextConsumed = consumed + length;

    if (!startNode && startOffset >= consumed && startOffset <= nextConsumed) {
      startNode = textNode;
      startInNode = Math.max(0, startOffset - consumed);
    }
    if (!endNode && endOffset >= consumed && endOffset <= nextConsumed) {
      endNode = textNode;
      endInNode = Math.max(0, endOffset - consumed);
      break;
    }

    consumed = nextConsumed;
    currentNode = walker.nextNode();
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, Math.min(startInNode, startNode.length));
  range.setEnd(endNode, Math.min(endInNode, endNode.length));
  return range;
}

function getCitationOverlayRects(
  container: HTMLElement,
  startOffset: number,
  endOffset: number,
): CitationOverlayRect[] {
  const range = resolveTextRangeInContainer(container, startOffset, endOffset);
  if (!range) return [];

  const containerRect = container.getBoundingClientRect();
  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      top: rect.top - containerRect.top + container.scrollTop,
      left: rect.left - containerRect.left + container.scrollLeft,
      width: rect.width,
      height: rect.height,
    }));
}

function resolveRelevantSegmentRange(
  documentText: string,
  segment: RelevantSegment,
): { startOffset: number; endOffset: number } | null {
  const rawMatchText = segment.matchText?.trim();
  if (rawMatchText) {
    const exactIndex = documentText.indexOf(rawMatchText);
    if (exactIndex >= 0) {
      return {
        startOffset: exactIndex,
        endOffset: exactIndex + rawMatchText.length,
      };
    }

    const compactMatch = rawMatchText.replace(/\s+/g, " ").trim();
    if (compactMatch) {
      const sample = compactMatch.slice(0, Math.min(compactMatch.length, 160));
      const normalizedDoc = documentText.replace(/\s+/g, " ");
      const normalizedIndex = normalizedDoc.indexOf(sample);
      if (normalizedIndex >= 0) {
        const exactFromSample = documentText.indexOf(sample);
        if (exactFromSample >= 0) {
          return {
            startOffset: exactFromSample,
            endOffset: exactFromSample + sample.length,
          };
        }
      }
    }
  }

  if (
    typeof segment.startOffset === "number"
    && typeof segment.endOffset === "number"
    && segment.endOffset > segment.startOffset
  ) {
    return {
      startOffset: segment.startOffset,
      endOffset: segment.endOffset,
    };
  }

  return null;
}

function expandRangeToWholeWords(
  documentText: string,
  startOffset: number,
  endOffset: number,
): { startOffset: number; endOffset: number } | null {
  let start = Math.max(0, startOffset);
  let end = Math.min(documentText.length, endOffset);
  if (end <= start) return null;

  while (start > 0 && isWordCharacter(documentText[start - 1] ?? "")) {
    start -= 1;
  }
  while (end < documentText.length && isWordCharacter(documentText[end] ?? "")) {
    end += 1;
  }

  return end > start ? { startOffset: start, endOffset: end } : null;
}

function normalizeRelevantSegmentForDocument(
  documentText: string,
  segment: RelevantSegment,
): RelevantSegment {
  const resolvedRange = resolveRelevantSegmentRange(documentText, segment);
  if (!resolvedRange) return segment;

  const expandedRange = expandRangeToWholeWords(
    documentText,
    resolvedRange.startOffset,
    resolvedRange.endOffset,
  ) ?? resolvedRange;
  const matchText = documentText.slice(expandedRange.startOffset, expandedRange.endOffset).trim();
  if (!matchText) return segment;

  return {
    ...segment,
    matchText,
    preview: clampPreviewToWholeWords(matchText, 180),
    startOffset: expandedRange.startOffset,
    endOffset: expandedRange.endOffset,
  };
}

function DocumentViewer({
  onSelectionChange,
  onPendingSelection,
  scrollToAnnId,
  scrollToCitationRange,
  onScrollDone,
  selectedAnnId,
  onAnnotationClick,
  hiddenUserIds,
  hiddenCodeIds,
  onOpenFilters,
}: {
  onSelectionChange: (quote: string) => void;
  onPendingSelection: (sel: PendingSelection | null) => void;
  scrollToAnnId: string | null;
  scrollToCitationRange: CitationRange | null;
  onScrollDone: () => void;
  selectedAnnId: string | null;
  onAnnotationClick: (annId: string) => void;
  hiddenUserIds: Set<string>;
  hiddenCodeIds: Set<string>;
  onOpenFilters: () => void;
}) {
  const {
    activeDocument,
    addDocument,
    codes,
    annotations: allAnnotations,
    activeProject,
    canCurrentUser,
  } = useStore();
  const canImportDocuments = canCurrentUser("createDocument") || canCurrentUser("uploadDocument");
  const canCreateAnnotations = canCurrentUser("createAnnotations");
  const annotations = useMemo(
    () => allAnnotations.filter((a) => {
      if (hiddenUserIds.size > 0 && hiddenUserIds.has(a.createdById)) return false;
      if (hiddenCodeIds.size > 0 && hiddenCodeIds.has(a.codeId)) return false;
      return true;
    }),
    [allAnnotations, hiddenUserIds, hiddenCodeIds],
  );
  const [stripeBars,  setStripeBars]  = useState<StripeBar[]>([]);
  const [stripeHover, setStripeHover] = useState<StripeHover | null>(null);
  const [citationOverlayRects, setCitationOverlayRects] = useState<CitationOverlayRect[]>([]);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [selectedOutlineSortOrder, setSelectedOutlineSortOrder] = useState<number | null>(null);


  async function handleImport() {
    const file = await open({
      title: "Import text document",
      filters: [{ name: "Text files", extensions: ["txt", "md", "csv"] }],
    });
    if (!file) return;
    const path = Array.isArray(file) ? file[0] : file;
    const content = await invoke<string>("read_text_file", { path });
    const name = path.split(/[\\/]/).pop() ?? path;
    addDocument(name, path, content);
  }

  // ── Scroll to annotation ────────────────────────────────────────────────────

  useEffect(() => {
    if (!scrollToAnnId || !viewerRef.current) return;
    const el = viewerRef.current.querySelector<HTMLElement>(`[data-anns~="${scrollToAnnId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("annotation-flash");
      setTimeout(() => el.classList.remove("annotation-flash"), 1500);
    }
    onScrollDone();
  }, [scrollToAnnId, onScrollDone]);

  useEffect(() => {
    if (!scrollToCitationRange || !viewerRef.current) return;
    const matches = viewerRef.current.querySelectorAll<HTMLElement>("[data-citation-highlight='true']");
    const overlayRects = getCitationOverlayRects(
      viewerRef.current,
      scrollToCitationRange.startOffset,
      scrollToCitationRange.endOffset,
    );
    setCitationOverlayRects(overlayRects);
    console.debug("[ai-assisted-coding] citation highlight lookup", {
      range: scrollToCitationRange,
      matches: matches.length,
      overlayRects: overlayRects.length,
    });
    const el = matches[0];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("annotation-flash");
      setTimeout(() => el.classList.remove("annotation-flash"), 1500);
      return;
    }
    if (overlayRects[0]) {
      viewerRef.current.scrollTo({
        top: Math.max(0, overlayRects[0].top - 96),
        behavior: "smooth",
      });
    }
  }, [scrollToCitationRange]);

  useEffect(() => {
    if (selectedOutlineSortOrder == null || !viewerRef.current) return;
    const el = viewerRef.current.querySelector<HTMLElement>(
      `[data-transcript-sort-order="${selectedOutlineSortOrder}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("annotation-flash");
    const timer = setTimeout(() => el.classList.remove("annotation-flash"), 1400);
    return () => clearTimeout(timer);
  }, [selectedOutlineSortOrder]);

  useEffect(() => {
    if (!scrollToCitationRange) {
      setCitationOverlayRects([]);
    }
  }, [scrollToCitationRange]);

  // ── Stripe measurement ──────────────────────────────────────────────────────

  const measureStripes = useCallback(() => {
    const container = viewerRef.current;
    if (!container || annotations.length === 0) { setStripeBars([]); return; }

    const containerRect = container.getBoundingClientRect();
    const bars: StripeBar[] = [];

    for (const ann of annotations) {
      const code = codes.find((c) => c.id === ann.codeId);
      if (!code) continue;
      const column = codes.findIndex((c) => c.id === ann.codeId);

      const els = container.querySelectorAll<HTMLElement>(`[data-anns~="${ann.id}"]`);
      let minTop = Infinity, maxBottom = -Infinity;
      for (const el of Array.from(els)) {
        for (const rect of Array.from(el.getClientRects())) {
          if (rect.height === 0) continue;
          const top    = rect.top    - containerRect.top + container.scrollTop;
          const bottom = rect.bottom - containerRect.top + container.scrollTop;
          if (top    < minTop)    minTop    = top;
          if (bottom > maxBottom) maxBottom = bottom;
        }
      }
      if (minTop === Infinity) continue;
      bars.push({
        color:  code.color,
        column,
        top:    minTop,
        height: maxBottom - minTop,
        label:  code.label,
        quote:  ann.quote,
      });
    }
    setStripeBars(bars);
  }, [annotations, codes]);

  useEffect(() => {
    const raf = requestAnimationFrame(measureStripes);
    return () => cancelAnimationFrame(raf);
  }, [measureStripes]);

  useEffect(() => {
    const container = viewerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => requestAnimationFrame(measureStripes));
    obs.observe(container);
    return () => obs.disconnect();
  }, [measureStripes]);

  const handleMouseUp = useCallback(() => {
    if (!canCreateAnnotations) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !viewerRef.current) return;

    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(viewerRef.current);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + range.toString().length;
    const quote = range.toString();

    if (quote.trim().length === 0) return;

    onPendingSelection({ start, end, quote });
    onSelectionChange(quote);
  }, [canCreateAnnotations, onPendingSelection, onSelectionChange]);

  // Clear pending selection when the browser deselects text
  useEffect(() => {
    function handleSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        onPendingSelection(null);
        onSelectionChange("");
      }
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [onPendingSelection, onSelectionChange]);

  function renderContent() {
    if (!activeDocument) return null;
    const text = activeDocument.content;
    const processedTranscriptSegments =
      activeDocument.type === "Processed Transcript"
        ? parseProcessedTranscriptSegments(activeDocument.structuredContentJson)
        : [];
    const codeMap = Object.fromEntries(codes.map((c) => [c.id, c]));
    function renderSpans(rangeStart: number, rangeEnd: number): React.ReactNode[] {
      const parts: React.ReactNode[] = [];
      const bs = new Set<number>([rangeStart, rangeEnd]);
      for (const ann of annotations) {
        if (ann.startOffset > rangeStart && ann.startOffset < rangeEnd) bs.add(ann.startOffset);
        if (ann.endOffset > rangeStart && ann.endOffset < rangeEnd) bs.add(ann.endOffset);
      }
      if (scrollToCitationRange) {
        if (scrollToCitationRange.startOffset > rangeStart && scrollToCitationRange.startOffset < rangeEnd) {
          bs.add(scrollToCitationRange.startOffset);
        }
        if (scrollToCitationRange.endOffset > rangeStart && scrollToCitationRange.endOffset < rangeEnd) {
          bs.add(scrollToCitationRange.endOffset);
        }
      }
      const boundaries = [...bs].sort((a, b) => a - b);

      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i];
        const end = boundaries[i + 1];
        const seg = text.slice(start, end);
        const isCitationSegment = !!scrollToCitationRange
          && start >= scrollToCitationRange.startOffset
          && end <= scrollToCitationRange.endOffset;
        const covering = annotations.filter((ann) => ann.startOffset <= start && ann.endOffset >= end);

        if (covering.length === 0) {
          if (isCitationSegment) {
            parts.push(
              <mark
                key={start}
                data-citation-highlight="true"
                className="citation-highlight"
                title={scrollToCitationRange?.label ?? "Cited project text"}
              >
                {seg}
              </mark>,
            );
          } else {
            parts.push(<span key={start}>{seg}</span>);
          }
        } else if (covering.length === 1) {
          const ann = covering[0];
          const code = codeMap[ann.codeId];
          const label = code?.label ?? "Annotation";
          const title = `${label}${ann.note ? `: ${ann.note}` : ""}`;
          const isSelected = selectedAnnId === ann.id;
          parts.push(
            <mark
              key={start}
              data-anns={ann.id}
              data-citation-highlight={isCitationSegment ? "true" : undefined}
              className={`annotation-highlight${isSelected ? " annotation-highlight--selected" : ""}${isCitationSegment ? " citation-highlight" : ""}`}
              style={{
                background: isCitationSegment
                  ? "transparent"
                  : code
                    ? `${code.color}${isSelected ? "88" : "44"}`
                    : "#ffff0044",
              }}
              title={isCitationSegment ? (scrollToCitationRange?.label ?? title) : title}
              onClick={() => onAnnotationClick(ann.id)}
            >
              {seg}
            </mark>,
          );
        } else {
          const codelist = covering.map((ann) => codeMap[ann.codeId]).filter(Boolean);
          const title = codelist.map((code) => code.label).join(", ");
          const firstId = covering[0].id;
          const isSelected = covering.some((ann) => ann.id === selectedAnnId);
          parts.push(
            <mark
              key={start}
              data-anns={covering.map((ann) => ann.id).join(" ")}
              data-citation-highlight={isCitationSegment ? "true" : undefined}
              className={`annotation-highlight annotation-highlight--multi${isSelected ? " annotation-highlight--selected" : ""}${isCitationSegment ? " citation-highlight" : ""}`}
              style={{
                background: isCitationSegment
                  ? "transparent"
                  : isSelected
                    ? "rgba(0,0,0,0.14)"
                    : "rgba(0,0,0,0.07)",
              }}
              title={isCitationSegment ? (scrollToCitationRange?.label ?? title) : title}
              onClick={() => onAnnotationClick(firstId)}
            >
              {seg}
            </mark>,
          );
        }
      }

      return parts;
    }

    if (processedTranscriptSegments.length > 0) {
      return (
        <ProcessedTranscriptView
          segments={processedTranscriptSegments}
          renderSegmentText={(segment) => <>{renderSpans(segment.startOffset, segment.endOffset)}</>}
          selectedSortOrder={selectedOutlineSortOrder}
        />
      );
    }

    return <>{renderSpans(0, text.length)}</>;
  }

  const processedTranscriptSegments =
    activeDocument?.type === "Processed Transcript"
      ? parseProcessedTranscriptSegments(activeDocument.structuredContentJson)
      : [];
  const questionOutline = getProcessedTranscriptQuestionOutline(processedTranscriptSegments);

  if (!activeProject) {
    return (
      <div className="annotate-card annotate-card--grow doc-viewer--empty">
        <p>Open a project first.</p>
      </div>
    );
  }

  if (!activeDocument) {
    return (
      <div className="annotate-card annotate-card--grow doc-viewer--empty">
        {canImportDocuments ? (
          <>
            <button className="btn btn--primary btn--large" onClick={handleImport}>
              Import Document
            </button>
            <p className="doc-import-hint">Supports .txt, .md, .csv</p>
          </>
        ) : (
          <p className="doc-import-hint">No document imported yet.</p>
        )}
      </div>
    );
  }

  return (
    <div className="annotate-card annotate-card--grow">
      <div className="doc-viewer-toolbar">
        <span className="doc-name">
          {activeDocument.name}
          {questionOutline.length > 0 && (
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
              {outlineOpen && (
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
              )}
            </span>
          )}
        </span>
        <div className="doc-toolbar-actions">
          <button
            type="button"
            className="doc-toolbar-filter-btn"
            onClick={onOpenFilters}
            aria-label="Filter visible annotations"
            title="Filter visible annotations"
          >
            <FilterIcon className="filter-icon-svg" />
          </button>
        </div>
      </div>

      <div
        ref={viewerRef}
        className="doc-text"
        style={{
          paddingRight: codes.length > 0
            ? Math.max(48, codes.length * (LANE_W + LANE_GAP) + 20)
            : 48,
        }}
        onMouseUp={handleMouseUp}
      >
        {renderContent()}
        {citationOverlayRects.map((rect, index) => (
          <div
            key={`${scrollToCitationRange?.requestId ?? "citation"}-${index}`}
            className="citation-overlay-highlight"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }}
          />
        ))}
        {stripeBars.map((bar, i) => (
          <div
            key={i}
            className="doc-stripe-bar"
            style={{
              top:        bar.top,
              height:     bar.height,
              right:      4 + (codes.length - 1 - bar.column) * (LANE_W + LANE_GAP),
              width:      LANE_W,
              background: bar.color,
            }}
            onMouseEnter={(e) =>
              setStripeHover({ x: e.clientX, y: e.clientY, label: bar.label, quote: bar.quote, color: bar.color })
            }
            onMouseMove={(e) =>
              setStripeHover((h) => h ? { ...h, x: e.clientX, y: e.clientY } : null)
            }
            onMouseLeave={() => setStripeHover(null)}
          />
        ))}
      </div>

      {stripeHover && (
        <div
          className="stripe-tooltip"
          style={getStripeTooltipStyle(stripeHover.x, stripeHover.y)}
        >
          <div className="stripe-tooltip-code">
            <span
              className="stripe-tooltip-swatch"
              style={{ background: stripeHover.color }}
            />
            {stripeHover.label}
          </div>
          <div className="stripe-tooltip-quote">"{stripeHover.quote}"</div>
        </div>
      )}
    </div>
  );
}

function AnnotationVisibilityModal({
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
  const { annotations, codes } = useStore();

  const users = useMemo(() => {
    const map: Record<string, { name: string; count: number }> = {};
    for (const ann of annotations) {
      const id = ann.createdById || ann.createdBy || "";
      if (!id) continue;
      if (!map[id]) map[id] = { name: ann.createdBy || id, count: 0 };
      map[id].count++;
    }
    return Object.entries(map)
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [annotations]);

  const codeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ann of annotations) {
      counts[ann.codeId] = (counts[ann.codeId] ?? 0) + 1;
    }
    return counts;
  }, [annotations]);

  const visibleCodes = useMemo(
    () => {
      const codeIdsWithAnnotations = new Set(
        Object.entries(codeCounts)
          .filter(([, count]) => count > 0)
          .map(([codeId]) => codeId),
      );
      return orderedWithDepth(codes).filter(({ code }) => codeIdsWithAnnotations.has(code.id));
    },
    [codes, codeCounts],
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide annotation-filter-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Filter Visible Annotations</h2>
        <p style={{ marginBottom: 16, lineHeight: 1.5 }}>
          Choose which annotations remain visible in the document viewer. By default, all annotations are shown.
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
                      <span
                        className="annotation-filter-code-row"
                        style={{ paddingLeft: `${depth * 16}px` }}
                      >
                        <span className="annotation-filter-swatch" style={{ background: code.color }} />
                        <span className="annotation-filter-name">{code.label}</span>
                      </span>
                      <span className="users-filter-count">{codeCounts[code.id] ?? 0}</span>
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
                {users.map(({ id, name, count }) => (
                  <li key={id} className="annotation-filter-item">
                    <label className="annotation-filter-label">
                      <input
                        type="checkbox"
                        className="users-filter-checkbox"
                        checked={!hiddenUserIds.has(id)}
                        onChange={() => onToggleUser(id)}
                      />
                      <span className="annotation-filter-name">{name}</span>
                      <span className="users-filter-count">{count}</span>
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

// ─── AnalysisPanel ────────────────────────────────────────────────────────────

type SummaryAnnotationRef = {
  id: string;
  quote: string;
  documentId: string;
  documentName: string;
};

type ConceptualSummaryResult = {
  summary: string;
  insights: string[];
  model: string;
  codeId: string;
  annotationRefs: SummaryAnnotationRef[];
};

type ConceptualSummaryState = {
  busy: boolean;
  result: ConceptualSummaryResult | null;
  error: string;
};

function parseConceptualSummary(text: string): { summary: string; insights: string[] } {
  const summaryMatch = /##\s*Summary\s*([\s\S]*?)(?=##|$)/i.exec(text);
  const insightsMatch = /##\s*Key Insights\s*([\s\S]*?)(?=##|$)/i.exec(text);
  const summary = summaryMatch?.[1]?.trim() ?? text.trim();
  const insightsBlock = insightsMatch?.[1]?.trim() ?? "";
  const insights = insightsBlock
    .split(/\n/)
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  return { summary, insights };
}

type CitationTooltip = { x: number; y: number; ref: SummaryAnnotationRef } | null;

function CitationLink({
  citationNum,
  annRef,
  onHover,
  onLeave,
  onClick,
}: {
  citationNum: number;
  annRef: SummaryAnnotationRef;
  onHover: (e: React.MouseEvent, ref: SummaryAnnotationRef) => void;
  onLeave: () => void;
  onClick: (ref: SummaryAnnotationRef) => void;
}) {
  return (
    <button
      type="button"
      className="ai-analyze-citation-link"
      onMouseEnter={(e) => onHover(e, annRef)}
      onMouseMove={(e) => onHover(e, annRef)}
      onMouseLeave={onLeave}
      onClick={() => onClick(annRef)}
    >
      [{citationNum}]
    </button>
  );
}

function renderWithCitations(
  text: string,
  annotationRefs: SummaryAnnotationRef[],
  onHover: (e: React.MouseEvent, ref: SummaryAnnotationRef) => void,
  onLeave: () => void,
  onClick: (ref: SummaryAnnotationRef) => void,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;
  while ((match = regex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    const ref = annotationRefs[num - 1];
    if (!ref) continue;
    if (match.index > lastIndex) {
      parts.push(<span key={keyCounter++}>{text.slice(lastIndex, match.index)}</span>);
    }
    parts.push(
      <CitationLink
        key={keyCounter++}
        citationNum={num}
        annRef={ref}
        onHover={onHover}
        onLeave={onLeave}
        onClick={onClick}
      />,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={keyCounter++}>{text.slice(lastIndex)}</span>);
  }
  return <>{parts}</>;
}

type AnalysisId = "conceptual-summary" | "most-typical-annotation" | "decomposition" | "position" | "most-unique-annotation";

type MostTypicalAnnotationResult = {
  annotationRef: SummaryAnnotationRef;
  reasoning: string;
  model: string;
  codeId: string;
};

type MostTypicalAnnotationState = {
  busy: boolean;
  result: MostTypicalAnnotationResult | null;
  error: string;
};

type DecompositionResult = {
  analysis: string;
  outliers: string;
  model: string;
  codeId: string;
  annotationRefs: SummaryAnnotationRef[];
};

type DecompositionState = { busy: boolean; result: DecompositionResult | null; error: string };

type PositionResult = {
  analysis: string;
  suggestions: string[];
  model: string;
  codeId: string;
};

type PositionState = { busy: boolean; result: PositionResult | null; error: string };

type UniqueAnnotationsResult = {
  items: { annotationRef: SummaryAnnotationRef; reasoning: string }[];
  model: string;
  codeId: string;
};

type UniqueAnnotationsState = { busy: boolean; result: UniqueAnnotationsResult | null; error: string };

function AnalyzeExportModal({
  onClose,
  onExportHTML,
  onExportPDF,
  onExportDOCX,
  exportingFormat,
}: {
  onClose: () => void;
  onExportHTML: () => void;
  onExportPDF: () => void;
  onExportDOCX: () => void;
  exportingFormat: string | null;
}) {
  const options = [
    {
      key: "html",
      label: "HTML",
      description: "Can be opened in a web browser and is closest to what you see in the app.",
      onClick: onExportHTML,
    },
    {
      key: "pdf",
      label: "PDF",
      description: "Uses a simpler layout and is the best for sharing.",
      onClick: onExportPDF,
    },
    {
      key: "docx",
      label: "DOCX",
      description: "Uses a simpler layout and is the best for further editing.",
      onClick: onExportDOCX,
    },
  ] as const;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: "var(--color-bg)", padding: 24, borderRadius: 8, minWidth: 320, maxWidth: 760, width: "min(760px, calc(100vw - 32px))" }}>
        <h2 style={{ marginTop: 0, marginBottom: 16 }}>Export Analysis Results</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
            alignItems: "stretch",
          }}
        >
          {options.map((option) => (
            <button
              key={option.key}
              className={`btn export-option-card${exportingFormat === option.key ? " export-option-card--active" : ""}`}
              onClick={option.onClick}
              disabled={!!exportingFormat}
              style={{
                minHeight: 220,
                padding: 18,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "space-between",
                textAlign: "center",
                whiteSpace: "normal",
                color: exportingFormat === option.key ? "#fff" : "var(--color-text)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{option.label}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: exportingFormat === option.key ? "rgba(255,255,255,0.9)" : "var(--color-text-muted)" }}>
                  {option.description}
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {exportingFormat === option.key ? "Exporting..." : `Export as ${option.label}`}
              </div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button className="btn" onClick={onClose} disabled={!!exportingFormat}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function parseDecomposition(text: string): { analysis: string; outliers: string } {
  const analysisMatch = /##\s*Decomposition Analysis\s*([\s\S]*?)(?=##|$)/i.exec(text);
  const outliersMatch = /##\s*Outliers[^#]*([\s\S]*?)(?=##|$)/i.exec(text);
  return {
    analysis: analysisMatch?.[1]?.trim() ?? text.trim(),
    outliers: outliersMatch?.[1]?.trim() ?? "",
  };
}

function parsePosition(text: string): { analysis: string; suggestions: string[] } {
  const analysisMatch = /##\s*Position Analysis\s*([\s\S]*?)(?=##|$)/i.exec(text);
  const suggestionsMatch = /##\s*Suggestions\s*([\s\S]*?)(?=##|$)/i.exec(text);
  const suggestions = (suggestionsMatch?.[1]?.trim() ?? "")
    .split(/\n/)
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  return {
    analysis: analysisMatch?.[1]?.trim() ?? text.trim(),
    suggestions,
  };
}

const ANALYSIS_OPTIONS: { id: AnalysisId; title: string; description: string }[] = [
  {
    id: "conceptual-summary",
    title: "Conceptual Summary",
    description: "Narrative synthesis of what this code means across its annotations, plus up to 5 standout insights.",
  },
  {
    id: "most-typical-annotation",
    title: "Most Typical Annotation",
    description: "The single annotation that best exemplifies the core meaning of this code.",
  },
  {
    id: "decomposition",
    title: "Decomposition",
    description: "Are there annotations, or groups of annotations, that do not fit the rest?",
  },
  {
    id: "position",
    title: "Position",
    description: "Could this code belong somewhere else in the code hierarchy?",
  },
  {
    id: "most-unique-annotation",
    title: "Most Unique Annotations",
    description: "The top 3 annotations that are semantically most distinct from all others.",
  },
];

function AnalysisPanel({
  selectedCodeId,
  selectedCodeAnnotationCount,
  summaryState,
  typicalAnnotationState,
  decompositionState,
  positionState,
  uniqueAnnotationsState,
  onRun,
}: {
  selectedCodeId: string | null;
  selectedCodeAnnotationCount: number;
  summaryState: ConceptualSummaryState;
  typicalAnnotationState: MostTypicalAnnotationState;
  decompositionState: DecompositionState;
  positionState: PositionState;
  uniqueAnnotationsState: UniqueAnnotationsState;
  onRun: (selected: Set<AnalysisId>) => void;
}) {
  const { codes } = useStore();
  const [selectedAnalyses, setSelectedAnalyses] = useState<Set<AnalysisId>>(new Set());
  const selectedCode = codes.find((c) => c.id === selectedCodeId) ?? null;
  const isBusy = summaryState.busy || typicalAnnotationState.busy || decompositionState.busy || positionState.busy || uniqueAnnotationsState.busy;
  const hasAnnotations = selectedCodeAnnotationCount > 0;

  function toggleAnalysis(id: AnalysisId) {
    setSelectedAnalyses((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function getOptionStatus(id: AnalysisId): "idle" | "busy" | "done" | "error" {
    const stateMap: Record<AnalysisId, { busy: boolean; result: unknown; error: string }> = {
      "conceptual-summary": summaryState,
      "most-typical-annotation": typicalAnnotationState,
      "decomposition": decompositionState,
      "position": positionState,
      "most-unique-annotation": uniqueAnnotationsState,
    };
    const state = stateMap[id];
    if (state.busy) return "busy";
    if (state.result) return "done";
    if (state.error) return "error";
    return "idle";
  }

  return (
    <div className="annotate-card annotate-card--grow">
      <div className="annotate-card-header">
        <span className="annotate-card-title">Analyze</span>
        <button
          type="button"
          className="btn btn--small btn--primary"
          onClick={() => onRun(selectedAnalyses)}
          disabled={!selectedCode || !hasAnnotations || selectedAnalyses.size === 0 || isBusy}
        >
          {isBusy ? "Running…" : "Run"}
        </button>
      </div>
      {!selectedCode ? (
        <div className="ai-attribute-placeholder">
          <p>Select a code from the codebook to see available analyses.</p>
        </div>
      ) : !hasAnnotations ? (
        <div className="ai-attribute-placeholder">
          <p>This code has no annotations yet.</p>
        </div>
      ) : (
        <div className="ai-analyze-options">
          {ANALYSIS_OPTIONS.map((option) => {
            const isSelected = selectedAnalyses.has(option.id);
            const status = getOptionStatus(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={`ai-analyze-option${isSelected ? " ai-analyze-option--selected" : ""}`}
                onClick={() => toggleAnalysis(option.id)}
              >
                <span className="ai-analyze-option-check" aria-hidden="true" />
                <div className="ai-analyze-option-body">
                  <strong className="ai-analyze-option-title">{option.title}</strong>
                  <p className="ai-analyze-option-desc">{option.description}</p>
                </div>
                {status !== "idle" && (
                  <span className={`ai-analyze-option-status ai-analyze-option-status--${status}`}>
                    {status === "busy" ? "Running…" : status === "done" ? "Done" : "Error"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── AnalysisResultPanel ──────────────────────────────────────────────────────

function AnalysisResultPanel({
  selectedCodeId,
  summaryState,
  typicalAnnotationState,
  decompositionState,
  positionState,
  uniqueAnnotationsState,
}: {
  selectedCodeId: string | null;
  summaryState: ConceptualSummaryState;
  typicalAnnotationState: MostTypicalAnnotationState;
  decompositionState: DecompositionState;
  positionState: PositionState;
  uniqueAnnotationsState: UniqueAnnotationsState;
}) {
  const { codes, documents, setActiveDocument, setPendingAnnId, setView } = useStore();
  const [tooltip, setTooltip] = useState<CitationTooltip>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const selectedCode = codes.find((c) => c.id === selectedCodeId) ?? null;
  const summaryResult = summaryState.result;
  const summaryResultCode = summaryResult ? codes.find((c) => c.id === summaryResult.codeId) ?? null : null;
  const typicalResult = typicalAnnotationState.result;
  const decompositionResult = decompositionState.result;
  const positionResult = positionState.result;
  const uniqueResult = uniqueAnnotationsState.result;

  const hasAnyActivity =
    summaryState.busy || summaryState.result || summaryState.error ||
    typicalAnnotationState.busy || typicalAnnotationState.result || typicalAnnotationState.error ||
    decompositionState.busy || decompositionState.result || decompositionState.error ||
    positionState.busy || positionState.result || positionState.error ||
    uniqueAnnotationsState.busy || uniqueAnnotationsState.result || uniqueAnnotationsState.error;

  const exportTitle = selectedCode?.label ? `${selectedCode.label} Analysis Results` : "Analysis Results";

  const exportSections = useMemo(() => {
    const sections: Array<{ title: string; blocks: string[]; citations?: SummaryAnnotationRef[] }> = [];

    if (summaryResult) {
      const blocks = [summaryResult.summary];
      if (summaryResult.insights.length > 0) {
        blocks.push("Key Insights:");
        blocks.push(...summaryResult.insights.map((insight, index) => `${index + 1}. ${insight}`));
      }
      blocks.push(`Generated with ${summaryResult.model}`);
      sections.push({
        title: "Conceptual Summary",
        blocks,
        citations: summaryResult.annotationRefs,
      });
    }

    if (typicalResult) {
      const blocks = [
        `Document: ${typicalResult.annotationRef.documentName}`,
        `Annotation: "${typicalResult.annotationRef.quote}"`,
      ];
      if (typicalResult.reasoning) blocks.push(typicalResult.reasoning);
      blocks.push(`Generated with ${typicalResult.model}`);
      sections.push({
        title: "Most Typical Annotation",
        blocks,
        citations: [typicalResult.annotationRef],
      });
    }

    if (decompositionResult) {
      const blocks = [decompositionResult.analysis];
      if (decompositionResult.outliers) {
        blocks.push("Outliers or Sub-clusters:");
        blocks.push(decompositionResult.outliers);
      }
      blocks.push(`Generated with ${decompositionResult.model}`);
      sections.push({
        title: "Decomposition",
        blocks,
        citations: decompositionResult.annotationRefs,
      });
    }

    if (positionResult) {
      const blocks = [positionResult.analysis];
      if (positionResult.suggestions.length > 0) {
        blocks.push("Suggestions:");
        blocks.push(...positionResult.suggestions.map((suggestion, index) => `${index + 1}. ${suggestion}`));
      }
      blocks.push(`Generated with ${positionResult.model}`);
      sections.push({
        title: "Position",
        blocks,
      });
    }

    if (uniqueResult) {
      const blocks = uniqueResult.items.flatMap(({ annotationRef, reasoning }, index) => {
        const itemBlocks = [
          `${index + 1}. ${annotationRef.documentName}`,
          `"${annotationRef.quote}"`,
        ];
        if (reasoning) itemBlocks.push(reasoning);
        return itemBlocks;
      });
      blocks.push(`Generated with ${uniqueResult.model}`);
      sections.push({
        title: "Most Unique Annotations",
        blocks,
        citations: uniqueResult.items.map((item) => item.annotationRef),
      });
    }

    return sections;
  }, [decompositionResult, positionResult, summaryResult, typicalResult, uniqueResult]);

  function handleCitationHover(e: React.MouseEvent, ref: SummaryAnnotationRef) {
    setTooltip({ x: e.clientX, y: e.clientY, ref });
  }

  function handleCitationClick(ref: SummaryAnnotationRef) {
    const doc = documents.find((d) => d.id === ref.documentId);
    if (doc) setActiveDocument(doc);
    setPendingAnnId(ref.id);
    setView("code-text");
  }

  function getExportHtml(): string {
    const sectionsHtml = exportSections.map((section) => {
      const blocksHtml = section.blocks
        .filter((block) => block.trim())
        .map((block) => `<p>${escHtml(block)}</p>`)
        .join("");
      const citationsHtml = section.citations && section.citations.length > 0
        ? `<div class="analysis-citations"><h4>Citations</h4><ol>${section.citations.map((ref, index) => `<li>[${index + 1}] <strong>${escHtml(ref.documentName)}</strong>: ${escHtml(ref.quote)}</li>`).join("")}</ol></div>`
        : "";
      return `<section><h2>${escHtml(section.title)}</h2>${blocksHtml}${citationsHtml}</section>`;
    }).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(exportTitle)}</title>
<style>
  body { font-family: sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #222; }
  h1 { margin-bottom: 6px; }
  h2 { font-size: 1.05rem; margin: 28px 0 10px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h4 { margin: 18px 0 6px; font-size: 0.9rem; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  p { line-height: 1.65; margin: 0 0 10px; white-space: pre-wrap; }
  ol { margin: 0; padding-left: 20px; }
  li { margin: 4px 0; line-height: 1.5; }
  .meta { color: #666; font-size: .9rem; margin-bottom: 22px; }
  .analysis-citations { margin-top: 10px; }
</style>
</head>
<body>
<h1>${escHtml(exportTitle)}</h1>
<p class="meta">Exported ${escHtml(fmtDate(new Date().toISOString()))}</p>
${sectionsHtml || "<p>No analysis results available.</p>"}
</body>
</html>`;
  }

  async function handleExportHTML() {
    try {
      setExportingFormat("html");
      const path = await save({ defaultPath: `${exportTitle}.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
      if (!path) return;
      await writeTextFile(path, getExportHtml());
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportPDF() {
    try {
      setExportingFormat("pdf");
      const path = await save({ defaultPath: `${exportTitle}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!path) return;

      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const margin = 54;
      const pageH = pdf.internal.pageSize.getHeight();
      const contentWidth = pdf.internal.pageSize.getWidth() - margin * 2;
      let y = margin;

      const ensureSpace = (height: number) => {
        if (y + height > pageH - margin) {
          pdf.addPage();
          y = margin;
        }
      };

      const addText = (text: string, size = 10, style: "normal" | "bold" | "italic" = "normal", gap = 8) => {
        pdf.setFont("helvetica", style);
        pdf.setFontSize(size);
        const lines = pdf.splitTextToSize(text || "", contentWidth) as string[];
        const lineHeight = size * 1.35;
        ensureSpace(lines.length * lineHeight + gap);
        pdf.text(lines, margin, y);
        y += lines.length * lineHeight + gap;
      };

      addText(exportTitle, 20, "bold", 10);
      addText(`Exported ${fmtDate(new Date().toISOString())}`, 10, "normal", 18);

      for (const section of exportSections) {
        addText(section.title, 12, "bold", 6);
        for (const block of section.blocks.filter((item) => item.trim())) {
          addText(block, 10, "normal", 6);
        }
        if (section.citations && section.citations.length > 0) {
          addText("Citations", 9, "bold", 4);
          section.citations.forEach((ref, index) => {
            addText(`[${index + 1}] ${ref.documentName}`, 9, "bold", 2);
            addText(ref.quote, 9, "italic", 6);
          });
        }
        y += 6;
      }

      const pdfBytes = pdf.output("arraybuffer");
      await writeFile(path, new Uint8Array(pdfBytes));
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  async function handleExportDOCX() {
    try {
      setExportingFormat("docx");
      const path = await save({ defaultPath: `${exportTitle}.docx`, filters: [{ name: "Word Document", extensions: ["docx"] }] });
      if (!path) return;

      const doc = new DocxDocument({
        sections: [{
          children: [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: exportTitle })] }),
            new Paragraph({ children: [new TextRun({ text: `Exported ${fmtDate(new Date().toISOString())}`, color: "666666" })] }),
            new Paragraph({ children: [] }),
            ...exportSections.flatMap((section) => ([
              new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: section.title })] }),
              ...section.blocks.filter((block) => block.trim()).map((block) => new Paragraph({ children: [new TextRun({ text: block })] })),
              ...(section.citations && section.citations.length > 0 ? [
                new Paragraph({ children: [new TextRun({ text: "Citations", bold: true })] }),
                ...section.citations.flatMap((ref, index) => [
                  new Paragraph({ children: [new TextRun({ text: `[${index + 1}] ${ref.documentName}`, bold: true })] }),
                  new Paragraph({ children: [new TextRun({ text: ref.quote, italics: true })] }),
                ]),
              ] : []),
              new Paragraph({ children: [] }),
            ])),
          ],
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      await writeFile(path, new Uint8Array(buffer));
    } finally {
      setExportingFormat(null);
      setShowExportModal(false);
    }
  }

  return (
    <div className="annotate-card annotate-card--grow">
      <div className="annotate-card-header">
        <span className="annotate-card-title">Analysis Results</span>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => setShowExportModal(true)}
          disabled={exportSections.length === 0 || !!exportingFormat}
          title={exportSections.length === 0 ? "Run at least one analysis before exporting" : "Export Analysis Results"}
        >
          Export
        </button>
      </div>

      {!hasAnyActivity && (
        <div className="ai-attribute-placeholder">
          <p>Select analyses from the panel on the left and click Run.</p>
        </div>
      )}

      {hasAnyActivity && (
        <div className="ai-analyze-result">

          {/* ── Conceptual Summary ── */}
          {(summaryState.busy || summaryState.result || summaryState.error) && (
            <div className="ai-analyze-result-section">
              <h3 className="ai-analyze-result-heading">
                Conceptual Summary
                {summaryResultCode && (
                  <span className="ai-analyze-result-code-badge" style={{ background: summaryResultCode.color }}>
                    {summaryResultCode.label}
                  </span>
                )}
              </h3>
              {summaryState.busy && (
                <div className="ai-segments-search-state ai-analyze-inline-progress">
                  <div className="ai-segments-progress" aria-hidden="true">
                    <span className="ai-segments-progress-bar" />
                  </div>
                  <div className="ai-segments-search-copy">
                    Generating{selectedCode ? ` for "${selectedCode.label}"` : ""}…
                  </div>
                </div>
              )}
              {summaryState.error && (
                <div className="form-error project-settings-error">{summaryState.error}</div>
              )}
              {summaryResult && (
                <>
                  <p className="ai-analyze-result-body">
                    {renderWithCitations(summaryResult.summary, summaryResult.annotationRefs, handleCitationHover, () => setTooltip(null), handleCitationClick)}
                  </p>
                  {summaryResult.insights.length > 0 && (
                    <>
                      <strong className="ai-analyze-result-subheading">Key Insights</strong>
                      <ol className="ai-analyze-insights-list">
                        {summaryResult.insights.map((insight, i) => (
                          <li key={i} className="ai-analyze-insight-item">
                            {renderWithCitations(insight, summaryResult.annotationRefs, handleCitationHover, () => setTooltip(null), handleCitationClick)}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  <p className="backup-field-hint ai-analyze-result-meta">Generated with {summaryResult.model}</p>
                </>
              )}
            </div>
          )}

          {/* ── Most Typical Annotation ── */}
          {(typicalAnnotationState.busy || typicalAnnotationState.result || typicalAnnotationState.error) && (
            <div className="ai-analyze-result-section">
              <h3 className="ai-analyze-result-heading">Most Typical Annotation</h3>
              {typicalAnnotationState.busy && (
                <div className="ai-segments-search-state ai-analyze-inline-progress">
                  <div className="ai-segments-progress" aria-hidden="true"><span className="ai-segments-progress-bar" /></div>
                  <div className="ai-segments-search-copy">Identifying most typical annotation{selectedCode ? ` for "${selectedCode.label}"` : ""}…</div>
                </div>
              )}
              {typicalAnnotationState.error && <div className="form-error project-settings-error">{typicalAnnotationState.error}</div>}
              {typicalResult && (
                <>
                  <div className="ai-analyze-typical-card">
                    <p className="ai-analyze-typical-doc">{typicalResult.annotationRef.documentName}</p>
                    <blockquote className="ai-analyze-typical-quote">"{typicalResult.annotationRef.quote}"</blockquote>
                    <button type="button" className="btn btn--small ai-analyze-typical-link" onClick={() => handleCitationClick(typicalResult.annotationRef)}>View in Code Text →</button>
                  </div>
                  {typicalResult.reasoning && <p className="ai-analyze-result-body">{typicalResult.reasoning}</p>}
                  <p className="backup-field-hint ai-analyze-result-meta">Generated with {typicalResult.model}</p>
                </>
              )}
            </div>
          )}

          {/* ── Decomposition ── */}
          {(decompositionState.busy || decompositionState.result || decompositionState.error) && (
            <div className="ai-analyze-result-section">
              <h3 className="ai-analyze-result-heading">Decomposition</h3>
              {decompositionState.busy && (
                <div className="ai-segments-search-state ai-analyze-inline-progress">
                  <div className="ai-segments-progress" aria-hidden="true"><span className="ai-segments-progress-bar" /></div>
                  <div className="ai-segments-search-copy">Analysing cohesion{selectedCode ? ` of "${selectedCode.label}"` : ""}…</div>
                </div>
              )}
              {decompositionState.error && <div className="form-error project-settings-error">{decompositionState.error}</div>}
              {decompositionResult && (
                <>
                  <p className="ai-analyze-result-body">
                    {renderWithCitations(decompositionResult.analysis, decompositionResult.annotationRefs, handleCitationHover, () => setTooltip(null), handleCitationClick)}
                  </p>
                  {decompositionResult.outliers && (
                    <>
                      <strong className="ai-analyze-result-subheading">Outliers or Sub-clusters</strong>
                      <p className="ai-analyze-result-body">
                        {renderWithCitations(decompositionResult.outliers, decompositionResult.annotationRefs, handleCitationHover, () => setTooltip(null), handleCitationClick)}
                      </p>
                    </>
                  )}
                  <p className="backup-field-hint ai-analyze-result-meta">Generated with {decompositionResult.model}</p>
                </>
              )}
            </div>
          )}

          {/* ── Position ── */}
          {(positionState.busy || positionState.result || positionState.error) && (
            <div className="ai-analyze-result-section">
              <h3 className="ai-analyze-result-heading">Position</h3>
              {positionState.busy && (
                <div className="ai-segments-search-state ai-analyze-inline-progress">
                  <div className="ai-segments-progress" aria-hidden="true"><span className="ai-segments-progress-bar" /></div>
                  <div className="ai-segments-search-copy">Analysing position of "{selectedCode?.label ?? "code"}" in the hierarchy…</div>
                </div>
              )}
              {positionState.error && <div className="form-error project-settings-error">{positionState.error}</div>}
              {positionResult && (
                <>
                  <p className="ai-analyze-result-body">{positionResult.analysis}</p>
                  {positionResult.suggestions.length > 0 && (
                    <>
                      <strong className="ai-analyze-result-subheading">Suggestions</strong>
                      <ol className="ai-analyze-insights-list">
                        {positionResult.suggestions.map((s, i) => (
                          <li key={i} className="ai-analyze-insight-item">{s}</li>
                        ))}
                      </ol>
                    </>
                  )}
                  <p className="backup-field-hint ai-analyze-result-meta">Generated with {positionResult.model}</p>
                </>
              )}
            </div>
          )}

          {/* ── Most Unique Annotations ── */}
          {(uniqueAnnotationsState.busy || uniqueAnnotationsState.result || uniqueAnnotationsState.error) && (
            <div className="ai-analyze-result-section">
              <h3 className="ai-analyze-result-heading">Most Unique Annotations</h3>
              {uniqueAnnotationsState.busy && (
                <div className="ai-segments-search-state ai-analyze-inline-progress">
                  <div className="ai-segments-progress" aria-hidden="true"><span className="ai-segments-progress-bar" /></div>
                  <div className="ai-segments-search-copy">Finding most unique annotations{selectedCode ? ` for "${selectedCode.label}"` : ""}…</div>
                </div>
              )}
              {uniqueAnnotationsState.error && <div className="form-error project-settings-error">{uniqueAnnotationsState.error}</div>}
              {uniqueResult && (
                <>
                  <div className="ai-analyze-unique-list">
                    {uniqueResult.items.map(({ annotationRef, reasoning }, i) => (
                      <div key={i} className="ai-analyze-typical-card">
                        <p className="ai-analyze-typical-doc">{annotationRef.documentName}</p>
                        <blockquote className="ai-analyze-typical-quote">"{annotationRef.quote}"</blockquote>
                        {reasoning && <p className="ai-analyze-result-body" style={{ margin: 0 }}>{reasoning}</p>}
                        <button type="button" className="btn btn--small ai-analyze-typical-link" onClick={() => handleCitationClick(annotationRef)}>View in Code Text →</button>
                      </div>
                    ))}
                  </div>
                  <p className="backup-field-hint ai-analyze-result-meta">Generated with {uniqueResult.model}</p>
                </>
              )}
            </div>
          )}

        </div>
      )}

      {tooltip && (
        <div
          className="ai-analyze-citation-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          <div className="ai-analyze-citation-tooltip-doc">{tooltip.ref.documentName}</div>
          <blockquote className="ai-analyze-citation-tooltip-quote">"{tooltip.ref.quote}"</blockquote>
        </div>
      )}

      {showExportModal && (
        <AnalyzeExportModal
          onClose={() => setShowExportModal(false)}
          onExportHTML={() => void handleExportHTML()}
          onExportPDF={() => void handleExportPDF()}
          onExportDOCX={() => void handleExportDOCX()}
          exportingFormat={exportingFormat}
        />
      )}
    </div>
  );
}

// ─── Analyze view ─────────────────────────────────────────────────────────────

type ProjectAnnotationSummary = {
  id: string;
  codeId: string;
  documentId: string;
  quote: string;
};

export function AIAnalyzeView() {
  const { activeProject, pb, codes, documents, canCurrentUser } = useStore();
  const canUseAiAnalyzeTools = canCurrentUser("useAiAnalyzeTools");
  const aiAssistEnabledForProject = activeProject ? readProjectAiAssistSettings(activeProject.id).enabled : false;
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingSelectionRef = useRef<PendingSelection | null>(null);
  const codebookCardRef = useRef<HTMLDivElement>(null);
  const analysisCardRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutH, setLayoutH] = useState(0);
  const [analyzeDividerHeight, setAnalyzeDividerHeight] = useState(0);
  const [summaryState, setSummaryState] = useState<ConceptualSummaryState>({ busy: false, result: null, error: "" });
  const [typicalAnnotationState, setTypicalAnnotationState] = useState<MostTypicalAnnotationState>({ busy: false, result: null, error: "" });
  const [decompositionState, setDecompositionState] = useState<DecompositionState>({ busy: false, result: null, error: "" });
  const [positionState, setPositionState] = useState<PositionState>({ busy: false, result: null, error: "" });
  const [uniqueAnnotationsState, setUniqueAnnotationsState] = useState<UniqueAnnotationsState>({ busy: false, result: null, error: "" });
  const [projectAnnotations, setProjectAnnotations] = useState<ProjectAnnotationSummary[]>([]);

  useEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setLayoutH(el.clientHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const codebookEl = codebookCardRef.current;
    const analysisEl = analysisCardRef.current;
    if (!codebookEl || !analysisEl) return;

    const measure = () => {
      setAnalyzeDividerHeight(Math.max(codebookEl.offsetHeight, analysisEl.offsetHeight));
    };

    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(codebookEl);
    obs.observe(analysisEl);
    return () => obs.disconnect();
  }, [selectedCodeId, projectAnnotations.length]);

  useEffect(() => {
    if (!activeProject) { setProjectAnnotations([]); return; }
    pb.collection("annotations")
      .getFullList({ filter: `document.project="${activeProject.id}"&&deleted_at=""`, fields: "id,document,code,quote" })
      .then((records) => setProjectAnnotations(records.map((r) => ({
        id: r.id,
        codeId: String(r.code ?? ""),
        documentId: String(r.document ?? ""),
        quote: String(r.quote ?? ""),
      }))))
      .catch(console.error);
  }, [activeProject?.id, pb]);

  useEffect(() => {
    setSummaryState({ busy: false, result: null, error: "" });
    setTypicalAnnotationState({ busy: false, result: null, error: "" });
    setDecompositionState({ busy: false, result: null, error: "" });
    setPositionState({ busy: false, result: null, error: "" });
    setUniqueAnnotationsState({ busy: false, result: null, error: "" });
  }, [selectedCodeId]);

  const annotationCountsByCode = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ann of projectAnnotations) {
      if (ann.codeId) counts[ann.codeId] = (counts[ann.codeId] ?? 0) + 1;
    }
    return counts;
  }, [projectAnnotations]);

  const maxCodebookH = layoutH > 0 ? (layoutH - 24) / 2 : 0;

  async function handleRun(selected: Set<AnalysisId>) {
    if (!selectedCodeId || selected.size === 0) return;
    const code = codes.find((c) => c.id === selectedCodeId);
    if (!code) return;

    const llmSettings = readAppSettings().llm;
    const ollamaError = !llmSettings.ollamaEnabled
      ? "Enable Ollama in App Settings before running analyses."
      : !llmSettings.ollamaSelectedModel
        ? "Choose an Ollama model in App Settings before running analyses."
        : null;

    if (ollamaError) {
      if (selected.has("conceptual-summary")) setSummaryState({ busy: false, result: null, error: ollamaError });
      if (selected.has("most-typical-annotation")) setTypicalAnnotationState({ busy: false, result: null, error: ollamaError });
      if (selected.has("decomposition")) setDecompositionState({ busy: false, result: null, error: ollamaError });
      if (selected.has("position")) setPositionState({ busy: false, result: null, error: ollamaError });
      if (selected.has("most-unique-annotation")) setUniqueAnnotationsState({ busy: false, result: null, error: ollamaError });
      return;
    }

    const codeAnnotations = projectAnnotations.filter((a) => a.codeId === selectedCodeId);
    const annotationRefs: SummaryAnnotationRef[] = codeAnnotations.map((a) => ({
      id: a.id,
      quote: a.quote,
      documentId: a.documentId,
      documentName: documents.find((d) => d.id === a.documentId)?.name ?? "Unknown document",
    }));
    const annotationInputs = annotationRefs.map((r) => ({ quote: r.quote, documentName: r.documentName }));
    const baseRequest = {
      codeLabel: code.label,
      codeDescription: code.description || null,
      annotations: annotationInputs,
      protocol: llmSettings.ollamaProtocol,
      host: llmSettings.ollamaHost,
      port: llmSettings.ollamaPort,
      model: llmSettings.ollamaSelectedModel,
      timeoutSeconds: llmSettings.ollamaRequestTimeoutSeconds,
      temperature: llmSettings.ollamaTemperature,
      numCtx: llmSettings.ollamaNumCtx,
      keepAliveMinutes: llmSettings.ollamaKeepAliveMinutes,
    };

    const promises: Promise<void>[] = [];

    if (selected.has("conceptual-summary")) {
      setSummaryState({ busy: true, result: null, error: "" });
      promises.push(
        invoke<{ content: string; model: string; baseUrl: string }>(
          "generate_code_conceptual_summary_with_ollama",
          { request: baseRequest },
        ).then((response) => {
          const parsed = parseConceptualSummary(response.content);
          setSummaryState({ busy: false, result: { ...parsed, model: response.model, codeId: selectedCodeId, annotationRefs }, error: "" });
        }).catch((err) => {
          setSummaryState({ busy: false, result: null, error: err instanceof Error ? err.message : "Could not generate conceptual summary." });
        }),
      );
    }

    if (selected.has("most-typical-annotation")) {
      setTypicalAnnotationState({ busy: true, result: null, error: "" });
      promises.push(
        invoke<{ annotationIndex: number; reasoning: string; model: string }>(
          "generate_most_typical_annotation_with_ollama",
          { request: baseRequest },
        ).then((response) => {
          const ref = annotationRefs[response.annotationIndex - 1];
          if (!ref) throw new Error("Ollama returned an invalid annotation index.");
          setTypicalAnnotationState({ busy: false, result: { annotationRef: ref, reasoning: response.reasoning, model: response.model, codeId: selectedCodeId }, error: "" });
        }).catch((err) => {
          setTypicalAnnotationState({ busy: false, result: null, error: err instanceof Error ? err.message : "Could not identify most typical annotation." });
        }),
      );
    }

    if (selected.has("decomposition")) {
      setDecompositionState({ busy: true, result: null, error: "" });
      promises.push(
        invoke<{ content: string; model: string }>(
          "generate_code_decomposition_with_ollama",
          { request: baseRequest },
        ).then((response) => {
          const parsed = parseDecomposition(response.content);
          setDecompositionState({ busy: false, result: { ...parsed, model: response.model, codeId: selectedCodeId, annotationRefs }, error: "" });
        }).catch((err) => {
          setDecompositionState({ busy: false, result: null, error: err instanceof Error ? err.message : "Could not run decomposition analysis." });
        }),
      );
    }

    if (selected.has("position")) {
      setPositionState({ busy: true, result: null, error: "" });
      const codebook = codes.map((c) => ({
        label: c.label,
        description: c.description || null,
        parentLabel: c.parentId ? (codes.find((p) => p.id === c.parentId)?.label ?? null) : null,
      }));
      promises.push(
        invoke<{ content: string; model: string }>(
          "generate_code_position_with_ollama",
          { request: { ...baseRequest, codebook } },
        ).then((response) => {
          const parsed = parsePosition(response.content);
          setPositionState({ busy: false, result: { ...parsed, model: response.model, codeId: selectedCodeId }, error: "" });
        }).catch((err) => {
          setPositionState({ busy: false, result: null, error: err instanceof Error ? err.message : "Could not run position analysis." });
        }),
      );
    }

    if (selected.has("most-unique-annotation")) {
      setUniqueAnnotationsState({ busy: true, result: null, error: "" });
      promises.push(
        invoke<{ annotations: { annotationIndex: number; reasoning: string }[]; model: string }>(
          "generate_code_unique_annotations_with_ollama",
          { request: baseRequest },
        ).then((response) => {
          const items = response.annotations
            .map(({ annotationIndex, reasoning }) => {
              const ref = annotationRefs[annotationIndex - 1];
              return ref ? { annotationRef: ref, reasoning } : null;
            })
            .filter((item): item is { annotationRef: SummaryAnnotationRef; reasoning: string } => item !== null);
          setUniqueAnnotationsState({ busy: false, result: { items, model: response.model, codeId: selectedCodeId }, error: "" });
        }).catch((err) => {
          setUniqueAnnotationsState({ busy: false, result: null, error: err instanceof Error ? err.message : "Could not identify most unique annotations." });
        }),
      );
    }

    await Promise.all(promises);
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header"><h1>Analyze</h1></header>
        <div className="empty-state"><p>Open a project first.</p></div>
      </div>
    );
  }

  if (!canUseAiAnalyzeTools) {
    return (
      <div className="view">
        <header className="view-header"><h1>Analyze</h1></header>
        <div className="empty-state"><p>You do not have permission to use AI Assist analyze tools for this project.</p></div>
      </div>
    );
  }

  if (!aiAssistEnabledForProject) {
    return (
      <div className="view">
        <header className="view-header"><h1>Analyze</h1></header>
        <div className="empty-state"><p>Enable AI Assist in Project Settings before using AI analysis tools.</p></div>
      </div>
    );
  }

  return (
      <div className="view annotate-view ai-assisted-coding-annotate-view">
        <div className="annotate-back-bar">
          <div className="users-title-wrap">
            <h1>Analyze</h1>
            <button
              type="button"
              className="users-help-icon-btn"
              onClick={() => setHelpOpen(true)}
              title="Show Help"
              aria-label="Show Help"
            >
              <img src={helpIcon} alt="" className="users-help-icon" />
            </button>
          </div>
        </div>
        {helpOpen && (
          <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>Analyze Help</h2>
              <p className="users-guide-copy">
                Select a code from the left column, choose one or more analyses in the middle panel, and run them to generate grounded AI interpretations.
              </p>
              <p className="users-guide-copy">
                Results on the right include citations back to source annotations so you can inspect the evidence in Code Text.
              </p>
              <div className="form-actions" style={{ marginTop: 24 }}>
                <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        <div
          className="annotate-layout ai-assisted-coding-annotate-layout ai-assisted-coding-analyze-layout"
          ref={layoutRef}
          style={{ ["--ai-analyze-divider-height" as string]: `${analyzeDividerHeight}px` }}
        >
        <div className="annotate-left">
          <div ref={codebookCardRef} className="ai-coding-column-card">
            <CodebookPanel
              pendingSelection={null}
              pendingSelectionRef={pendingSelectionRef}
              onClearSelection={() => {}}
              onAnnotationApplied={() => {}}
              hiddenUserIds={new Set()}
              hiddenCodeIds={new Set()}
              maxHeight={maxCodebookH}
              selectedCodeId={selectedCodeId}
              onSelectCode={setSelectedCodeId}
              annotationCountOverride={annotationCountsByCode}
            />
          </div>
        </div>
        <div className="annotate-right">
          <div ref={analysisCardRef} className="ai-coding-column-card">
            <AnalysisPanel
              selectedCodeId={selectedCodeId}
              selectedCodeAnnotationCount={selectedCodeId ? (annotationCountsByCode[selectedCodeId] ?? 0) : 0}
              summaryState={summaryState}
              typicalAnnotationState={typicalAnnotationState}
              decompositionState={decompositionState}
              positionState={positionState}
              uniqueAnnotationsState={uniqueAnnotationsState}
              onRun={(selected) => void handleRun(selected)}
            />
          </div>
        </div>
        <div className="annotate-main">
          <AnalysisResultPanel
            selectedCodeId={selectedCodeId}
            summaryState={summaryState}
            typicalAnnotationState={typicalAnnotationState}
            decompositionState={decompositionState}
            positionState={positionState}
            uniqueAnnotationsState={uniqueAnnotationsState}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function AIAssistedCodingAnnotateView({ onBack }: { onBack?: () => void } = {}) {
  const {
    pendingAnnId,
    setPendingAnnId,
    pendingTextCitation,
    setPendingTextCitation,
    annotations,
    codes,
    activeDocument,
    setActiveDocument,
    documentLockConflict,
    clearDocumentLockConflict,
  } = useStore();
  const [selectedQuote,    setSelectedQuote]    = useState("");
  const [scrollToAnnId,    setScrollToAnnId]    = useState<string | null>(() => pendingAnnId);
  const [scrollToCitationRange, setScrollToCitationRange] = useState<CitationRange | null>(() => (
    pendingTextCitation ? {
      startOffset: pendingTextCitation.startOffset,
      endOffset: pendingTextCitation.endOffset,
      label: pendingTextCitation.label,
      requestId: 0,
    } : null
  ));
  const [selectedAnnId,    setSelectedAnnId]    = useState<string | null>(() => pendingAnnId);

  useEffect(() => {
    if (pendingAnnId) setPendingAnnId(null);
    if (pendingTextCitation) setPendingTextCitation(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [hiddenUserIds,    setHiddenUserIds]    = useState<Set<string>>(new Set());
  const [hiddenCodeIds,    setHiddenCodeIds]    = useState<Set<string>>(new Set());
  const [showFilters,      setShowFilters]      = useState(false);
  const [pendingSelection, setPendingSelectionState] = useState<PendingSelection | null>(null);
  const [selectedCodeId,   setSelectedCodeId]   = useState<string | null>(null);
  const [activeRelevantSegmentId, setActiveRelevantSegmentId] = useState<string | null>(null);
  const pendingSelectionRef = useRef<PendingSelection | null>(null);
  const codebookCardRef = useRef<HTMLDivElement>(null);
  const relevantSegmentsCardRef = useRef<HTMLDivElement>(null);

  // ── Layout height for codebook max-height calculation ──────────────────────
  const layoutRef    = useRef<HTMLDivElement>(null);
  const [layoutH, setLayoutH] = useState(0);
  const [columnDividerHeight, setColumnDividerHeight] = useState(0);

  useEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setLayoutH(el.clientHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const codebookEl = codebookCardRef.current;
    const relevantEl = relevantSegmentsCardRef.current;
    if (!codebookEl || !relevantEl) return;

    const measure = () => {
      setColumnDividerHeight(Math.max(codebookEl.offsetHeight, relevantEl.offsetHeight));
    };

    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(codebookEl);
    obs.observe(relevantEl);
    return () => obs.disconnect();
  }, []);

  // Half the column height (layout minus 12px top + 12px bottom padding)
  const maxCodebookH = layoutH > 0 ? (layoutH - 24) / 2 : 0;
  const selectedCode = useMemo(
    () => codes.find((code) => code.id === selectedCodeId) ?? null,
    [codes, selectedCodeId],
  );

  function setPendingSelection(sel: PendingSelection | null) {
    pendingSelectionRef.current = sel;
    setPendingSelectionState(sel);
  }

  function clearDocumentSelection() {
    setPendingSelection(null);
    setSelectedQuote("");
  }

  function toggleUser(userId: string) {
    setHiddenUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  function toggleCode(codeId: string) {
    setHiddenCodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(codeId)) next.delete(codeId); else next.add(codeId);
      return next;
    });
  }

  function handleOpenRelevantSegment(segment: RelevantSegment) {
    console.debug("[ai-assisted-coding] open relevant segment requested", segment);
    if (!activeDocument?.content) {
      return;
    }
    const resolvedRange = resolveRelevantSegmentRange(activeDocument.content, segment);
    if (!resolvedRange) {
      console.debug("[ai-assisted-coding] segment missing usable resolved range", segment);
      return;
    }
    const expandedRange = expandRangeToWholeWords(
      activeDocument.content,
      resolvedRange.startOffset,
      resolvedRange.endOffset,
    ) ?? resolvedRange;
    const quote = activeDocument.content.slice(
      expandedRange.startOffset,
      expandedRange.endOffset,
    );
    if (quote) {
      setPendingSelection({
        start: expandedRange.startOffset,
        end: expandedRange.endOffset,
        quote,
      });
      setSelectedQuote(quote);
    }
    setActiveRelevantSegmentId(segment.id);
    setScrollToAnnId(null);
    setSelectedAnnId(segment.annotationId ?? null);
    setScrollToCitationRange(null);
    requestAnimationFrame(() => {
      console.debug("[ai-assisted-coding] setting citation range", {
        startOffset: expandedRange.startOffset,
        endOffset: expandedRange.endOffset,
        label: segment.title,
      });
      setScrollToCitationRange({
        startOffset: expandedRange.startOffset,
        endOffset: expandedRange.endOffset,
        label: segment.title,
        requestId: Date.now(),
      });
    });
  }

  function clearRelevantSegmentHighlight() {
    setActiveRelevantSegmentId(null);
    setScrollToCitationRange(null);
    const selection = window.getSelection();
    selection?.removeAllRanges();
  }

  useEffect(() => {
    if (!scrollToCitationRange && !activeRelevantSegmentId) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-search-result-button='true']")) return;
      if (target.closest(".annotate-left")) return;
      clearRelevantSegmentHighlight();
    }

    document.addEventListener("mousedown", handlePointerDown, true);
    return () => document.removeEventListener("mousedown", handlePointerDown, true);
  }, [scrollToCitationRange, activeRelevantSegmentId]);

  return (
    <div className="view annotate-view ai-assisted-coding-annotate-view">
      <div className="annotate-back-bar">
        <h1>AI Assist Coding View</h1>
        {onBack && (
          <button className="btn" onClick={onBack}>← Code Documents</button>
        )}
      </div>
      <div
        className="annotate-layout ai-assisted-coding-annotate-layout ai-assisted-coding-document-layout"
        ref={layoutRef}
        style={{ ["--ai-coding-divider-height" as string]: `${columnDividerHeight}px` }}
      >
        <div className="annotate-left">
          <div ref={codebookCardRef} className="ai-coding-column-card">
            <CodebookPanel
              pendingSelection={pendingSelection}
              pendingSelectionRef={pendingSelectionRef}
              onClearSelection={clearDocumentSelection}
              onAnnotationApplied={clearRelevantSegmentHighlight}
              hiddenUserIds={hiddenUserIds}
              hiddenCodeIds={hiddenCodeIds}
              maxHeight={maxCodebookH}
              selectedCodeId={selectedCodeId}
              onSelectCode={setSelectedCodeId}
            />
          </div>
        </div>
        <div className="annotate-right">
          <div ref={relevantSegmentsCardRef} className="ai-coding-column-card">
            <RelevantSegmentsPanel
              selectedCode={selectedCode}
              selectedQuote={selectedQuote}
              activeSegmentId={activeRelevantSegmentId}
              onOpenSegment={handleOpenRelevantSegment}
              onClearActiveSegment={() => setActiveRelevantSegmentId(null)}
            />
          </div>
        </div>
        <div className="annotate-main">
          <DocumentViewer
            onSelectionChange={setSelectedQuote}
            onPendingSelection={setPendingSelection}
            scrollToAnnId={scrollToAnnId}
            scrollToCitationRange={scrollToCitationRange}
            onScrollDone={() => setScrollToAnnId(null)}
            selectedAnnId={selectedAnnId}
            onAnnotationClick={setSelectedAnnId}
            hiddenUserIds={hiddenUserIds}
            hiddenCodeIds={hiddenCodeIds}
            onOpenFilters={() => setShowFilters(true)}
          />
        </div>
      </div>

      {showFilters && (
        <AnnotationVisibilityModal
          hiddenUserIds={hiddenUserIds}
          hiddenCodeIds={hiddenCodeIds}
          onToggleUser={toggleUser}
          onToggleCode={toggleCode}
          onSelectAllUsers={() => setHiddenUserIds(new Set())}
          onClearUsers={() => {
            const nextUserIds = new Set<string>();
            for (const ann of annotations) {
              const id = ann.createdById || ann.createdBy || "";
              if (id) nextUserIds.add(id);
            }
            setHiddenUserIds(nextUserIds);
          }}
          onSelectAllCodes={() => setHiddenCodeIds(new Set())}
          onClearCodes={() => setHiddenCodeIds(new Set(codes.map((code) => code.id)))}
          onClose={() => setShowFilters(false)}
        />
      )}

      {documentLockConflict && (
        <div className="modal-overlay" onClick={() => {}}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{documentLockConflict.reason === "kicked" ? "Removed From Document" : "Document Locked"}</h2>
            {documentLockConflict.reason === "kicked" ? (
              <>
                <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                  <strong>{documentLockConflict.userName || "A project owner"}</strong> removed you from this document.
                </p>
                <p className="modal-warning-text">
                  Kanqual is using a strict document lock across coding workspaces, so you will need to return to the AI Assisted Coding document list before you can annotate again.
                </p>
              </>
            ) : (
              <>
                <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                  <strong>{documentLockConflict.userName || "Another user"}</strong> is currently annotating this document.
                </p>
                <p className="modal-warning-text">
                  Kanqual is using a strict document lock across coding workspaces, so only one user can annotate a document at a time.
                </p>
              </>
            )}
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button
                className="btn btn--primary"
                onClick={() => {
                  clearDocumentLockConflict();
                  setActiveDocument(null);
                }}
              >
                Back to AI Assisted Coding
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

