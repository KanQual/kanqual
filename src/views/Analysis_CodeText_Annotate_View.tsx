import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../context/StoreContext";
import type { Code, Annotation } from "../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
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

const CODEBOOK_HEADER_H = 37;  // .annotate-card-header height
const CODE_ITEM_H       = 34;  // .code-item: 7px top + 7px bottom + 13px text × 1.5

function CodebookPanel({ pendingSelection, pendingSelectionRef, onClearSelection, hiddenUserIds, maxHeight }: {
  pendingSelection: PendingSelection | null;
  pendingSelectionRef: React.RefObject<PendingSelection | null>;
  onClearSelection: () => void;
  hiddenUserIds: Set<string>;
  maxHeight: number;
}) {
  const { codes, annotations, canEdit, deleteCode, addAnnotation, activeDocument } = useStore();

  const annCountByCode = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ann of annotations) {
      if (hiddenUserIds.size > 0 && hiddenUserIds.has(ann.createdById)) continue;
      counts[ann.codeId] = (counts[ann.codeId] ?? 0) + 1;
    }
    return counts;
  }, [annotations, hiddenUserIds]);

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
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  async function handleCodeClick(code: Code) {
    const sel = pendingSelectionRef.current;
    if (sel && activeDocument) {
      await addAnnotation(
        activeDocument.id,
        code.id,
        sel.start,
        sel.end,
        sel.quote,
      );
      window.getSelection()?.removeAllRanges();
      onClearSelection();
    }
  }

  return (
    <div className="annotate-card" style={{ height: cardH, flexShrink: 0 }}>
      <div className="annotate-card-header">
        <span className="annotate-card-title">Codebook</span>
        {canEdit && (
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

      <ul ref={listRef} className="code-list">
        {codes.length === 0 && (
          <li className="code-list-empty">No codes yet.</li>
        )}
        {visible.map(({ code, depth, hasChildren }) => (
          <li
            key={code.id}
            className={`code-item${pendingSelection ? " code-item--annotatable" : ""}`}
            style={{ paddingLeft: 6 + depth * 16 }}
            onMouseDown={(e) => { if (pendingSelectionRef.current) e.preventDefault(); }}
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
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="context-menu-item" onClick={() => setContextMenu(null)}>
            Memo About Code
          </button>
          {canEdit && (
            <button
              className="context-menu-item"
              onClick={() => { setEditCode(contextMenu.code); setContextMenu(null); }}
            >
              Edit Code
            </button>
          )}
          {canEdit && (
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

function AnnotationDetailsPanel({
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
  const { annotations: allAnnotations, codes, deleteAnnotation, canEdit } = useStore();
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
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const codeMap = Object.fromEntries(codes.map((c) => [c.id, c]));

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
              {a.note && (
                <p className="annotation-note">{a.note}</p>
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
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="context-menu-item" onClick={() => setContextMenu(null)}>
            Memo About Annotation
          </button>
          {canEdit && (
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

function UsersPanel({ hiddenUserIds, onToggle }: {
  hiddenUserIds: Set<string>;
  onToggle: (userId: string) => void;
}) {
  const { annotations } = useStore();

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

  if (users.length === 0) return null;

  return (
    <div className="annotate-card">
      <div className="annotate-card-header">
        <span className="annotate-card-title">Coders</span>
      </div>
      <ul className="users-filter-list">
        {users.map(({ id, name, count }) => (
          <li key={id} className="users-filter-item">
            <label className="users-filter-label">
              <input
                type="checkbox"
                className="users-filter-checkbox"
                checked={!hiddenUserIds.has(id)}
                onChange={() => onToggle(id)}
              />
              <span className="users-filter-name">{name}</span>
              <span className="users-filter-count">{count}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Document viewer ──────────────────────────────────────────────────────────

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

function DocumentViewer({
  onSelectionChange,
  onPendingSelection,
  scrollToAnnId,
  onScrollDone,
  selectedAnnId,
  onAnnotationClick,
  hiddenUserIds,
}: {
  onSelectionChange: (quote: string) => void;
  onPendingSelection: (sel: PendingSelection | null) => void;
  scrollToAnnId: string | null;
  onScrollDone: () => void;
  selectedAnnId: string | null;
  onAnnotationClick: (annId: string) => void;
  hiddenUserIds: Set<string>;
}) {
  const {
    activeDocument,
    addDocument,
    codes,
    annotations: allAnnotations,
    activeProject,
    canEdit,
  } = useStore();
  const annotations = useMemo(
    () => hiddenUserIds.size > 0
      ? allAnnotations.filter((a) => !hiddenUserIds.has(a.createdById))
      : allAnnotations,
    [allAnnotations, hiddenUserIds],
  );
  const [stripeBars,  setStripeBars]  = useState<StripeBar[]>([]);
  const [stripeHover, setStripeHover] = useState<StripeHover | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

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
    if (!canEdit) return;
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
  }, [canEdit, onPendingSelection, onSelectionChange]);

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
    if (annotations.length === 0) return <span>{text}</span>;

    const codeMap = Object.fromEntries(codes.map((c) => [c.id, c]));

    const boundarySet = new Set<number>([0, text.length]);
    for (const ann of annotations) {
      boundarySet.add(ann.startOffset);
      boundarySet.add(ann.endOffset);
    }
    const boundaries = [...boundarySet].sort((a, b) => a - b);

    const parts: React.ReactNode[] = [];

    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end   = boundaries[i + 1];
      const seg   = text.slice(start, end);

      const covering = annotations.filter(
        (ann) => ann.startOffset <= start && ann.endOffset >= end,
      );

      if (covering.length === 0) {
        parts.push(<span key={start}>{seg}</span>);
      } else if (covering.length === 1) {
        const ann   = covering[0];
        const code  = codeMap[ann.codeId];
        const label = code?.label ?? "Annotation";
        const title = `${label}${ann.note ? ": " + ann.note : ""}`;
        const isSelected = selectedAnnId === ann.id;
        parts.push(
          <mark
            key={start}
            data-anns={ann.id}
            className={`annotation-highlight${isSelected ? " annotation-highlight--selected" : ""}`}
            style={{ background: code ? `${code.color}${isSelected ? "88" : "44"}` : "#ffff0044" }}
            title={title}
            onClick={() => onAnnotationClick(ann.id)}
          >
            {seg}
          </mark>
        );
      } else {
        const codelist  = covering.map((a) => codeMap[a.codeId]).filter(Boolean);
        const title     = codelist.map((c) => c.label).join(", ");
        const firstId   = covering[0].id;
        const isSelected = covering.some((a) => a.id === selectedAnnId);
        parts.push(
          <mark
            key={start}
            data-anns={covering.map((a) => a.id).join(" ")}
            className={`annotation-highlight annotation-highlight--multi${isSelected ? " annotation-highlight--selected" : ""}`}
            style={{ background: isSelected ? "rgba(0,0,0,0.14)" : "rgba(0,0,0,0.07)" }}
            title={title}
            onClick={() => onAnnotationClick(firstId)}
          >
            {seg}
          </mark>
        );
      }
    }

    return <>{parts}</>;
  }

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
        {canEdit ? (
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
        <span className="doc-name">{activeDocument.name}</span>
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
          style={{ left: stripeHover.x + 12, top: stripeHover.y - 8 }}
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

// ─── Main view ────────────────────────────────────────────────────────────────

export function AnnotateView({ onBack }: { onBack?: () => void } = {}) {
  useStore();
  const [selectedQuote,    setSelectedQuote]    = useState("");
  const [scrollToAnnId,    setScrollToAnnId]    = useState<string | null>(null);
  const [selectedAnnId,    setSelectedAnnId]    = useState<string | null>(null);
  const [hiddenUserIds,    setHiddenUserIds]    = useState<Set<string>>(new Set());
  const [pendingSelection, setPendingSelectionState] = useState<PendingSelection | null>(null);
  const pendingSelectionRef = useRef<PendingSelection | null>(null);

  // ── Layout height for codebook max-height calculation ──────────────────────
  const layoutRef    = useRef<HTMLDivElement>(null);
  const [layoutH, setLayoutH] = useState(0);

  useEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setLayoutH(el.clientHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Half the column height (layout minus 12px top + 12px bottom padding)
  const maxCodebookH = layoutH > 0 ? (layoutH - 24) / 2 : 0;

  function setPendingSelection(sel: PendingSelection | null) {
    pendingSelectionRef.current = sel;
    setPendingSelectionState(sel);
  }

  function toggleUser(userId: string) {
    setHiddenUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  return (
    <div className="view annotate-view">
      <div className="annotate-back-bar">
        <h1 className="annotate-title">Coding View</h1>
        {onBack && (
          <button className="btn" onClick={onBack}>← Code Documents</button>
        )}
      </div>
      <div className="annotate-layout" ref={layoutRef}>
        <div className="annotate-left">
          <CodebookPanel
            pendingSelection={pendingSelection}
            pendingSelectionRef={pendingSelectionRef}
            onClearSelection={() => { setPendingSelection(null); setSelectedQuote(""); }}
            hiddenUserIds={hiddenUserIds}
            maxHeight={maxCodebookH}
          />
          <UsersPanel hiddenUserIds={hiddenUserIds} onToggle={toggleUser} />
        </div>
        <div className="annotate-main">
          <DocumentViewer
            onSelectionChange={setSelectedQuote}
            onPendingSelection={setPendingSelection}
            scrollToAnnId={scrollToAnnId}
            onScrollDone={() => setScrollToAnnId(null)}
            selectedAnnId={selectedAnnId}
            onAnnotationClick={setSelectedAnnId}
            hiddenUserIds={hiddenUserIds}
          />
        </div>
        <div className="annotate-right">
          <AnnotationDetailsPanel
            selectedQuote={selectedQuote}
            onScrollTo={setScrollToAnnId}
            selectedAnnId={selectedAnnId}
            onSelectAnn={setSelectedAnnId}
            hiddenUserIds={hiddenUserIds}
          />
        </div>
      </div>
    </div>
  );
}
