import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { MemoEditorView } from "./MemosView";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CodeRow {
  id: string;
  label: string;
  color: string;
  description: string;
  parentId: string;
  parentLabel: string;
  createdByName: string;
  createdAt: string;
  casesCount: number;
  docsCount: number;
}

interface CodeNode extends CodeRow {
  depth: number;
  hasChildren: boolean;
}

interface AnnotationRow {
  id: string;
  quote: string;
  note: string;
  documentName: string;
  documentId: string;
  createdByName: string;
  createdAt: string;
}

type SortCol = "label" | "color" | "createdByName" | "createdAt" | "casesCount" | "docsCount";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
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
        ? TOP_LEVEL_PALETTE.indexOf(c) * -1   // preserve palette order
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

// ─── Tree helpers ─────────────────────────────────────────────────────────────

function buildTree(rows: CodeRow[], sortCol: SortCol, sortDir: SortDir): CodeNode[] {
  const childrenOf: Record<string, CodeRow[]> = {};
  const roots: CodeRow[] = [];

  for (const row of rows) {
    if (row.parentId) {
      if (!childrenOf[row.parentId]) childrenOf[row.parentId] = [];
      childrenOf[row.parentId].push(row);
    } else {
      roots.push(row);
    }
  }

  function sortGroup(group: CodeRow[]) {
    group.sort((a, b) => {
      const aVal = String((a as unknown as Record<string, unknown>)[sortCol] ?? "");
      const bVal = String((b as unknown as Record<string, unknown>)[sortCol] ?? "");
      const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: "base", numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  sortGroup(roots);
  Object.values(childrenOf).forEach(sortGroup);

  const result: CodeNode[] = [];
  function traverse(nodes: CodeRow[], depth: number) {
    for (const node of nodes) {
      result.push({ ...node, depth, hasChildren: !!(childrenOf[node.id]?.length) });
      traverse(childrenOf[node.id] ?? [], depth + 1);
    }
  }
  traverse(roots, 0);
  return result;
}

function getVisibleNodes(tree: CodeNode[], collapsed: Set<string>): CodeNode[] {
  const result: CodeNode[] = [];
  // Stack of depths at which a collapse was triggered
  const collapseStack: number[] = [];

  for (const node of tree) {
    // Pop stack entries for scopes we've exited (depth came back up)
    while (collapseStack.length > 0 && node.depth <= collapseStack[collapseStack.length - 1]) {
      collapseStack.pop();
    }
    // If any ancestor is collapsed, this node is hidden
    if (collapseStack.length > 0) continue;

    result.push(node);

    // If this node is collapsed, hide everything deeper
    if (node.hasChildren && collapsed.has(node.id)) {
      collapseStack.push(node.depth);
    }
  }
  return result;
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "label",         label: "Name",       width: "34%" },
  { key: "createdByName", label: "Created By", width: "22%" },
  { key: "createdAt",     label: "Created",    width: "22%" },
  { key: "casesCount",    label: "Cases",      width: "11%" },
  { key: "docsCount",     label: "Documents",  width: "11%" },
];

// ─── Color swatch ─────────────────────────────────────────────────────────────

function ColorSwatch({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <span
      className="code-color-swatch"
      style={{ background: color || "#ccc", width: size, height: size }}
      title={color}
    />
  );
}

// ─── Color suggestion picker ──────────────────────────────────────────────────

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

// ─── Code Detail sub-view ─────────────────────────────────────────────────────

function CodeDetail({
  row: initialRow,
  allCodes,
  pb,
  startEditing,
  canEdit,
  onBack,
}: {
  row: CodeRow;
  allCodes: CodeRow[];
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  startEditing: boolean;
  canEdit: boolean;
  onBack: () => void;
}) {
  const [row,       setRow]      = useState(initialRow);
  const [editing,   setEditing]  = useState(startEditing);
  const [label,     setLabel]    = useState(initialRow.label);
  const [color,     setColor]    = useState(initialRow.color || "#6366f1");
  const [desc,      setDesc]     = useState(initialRow.description);
  const [parentId,  setParentId] = useState(initialRow.parentId);
  const [saving,    setSaving]   = useState(false);
  const [error,     setError]    = useState<string | null>(null);
  const [annotations,  setAnnotations] = useState<AnnotationRow[]>([]);
  const [loadingAnn,   setLoadingAnn]  = useState(true);

  const parentCandidates = allCodes.filter((c) => c.id !== row.id);
  const parentCode = allCodes.find((c) => c.id === parentId);
  const siblings   = allCodes.filter((c) => c.parentId === parentId && c.id !== row.id);

  const colorSuggestions = useMemo(() => {
    if (parentId && parentCode) {
      return getChildSuggestions(parentCode.color);
    }
    const existingColors = allCodes.filter((c) => !c.parentId && c.id !== row.id).map((c) => c.color);
    return getTopLevelSuggestions([...existingColors, ...siblings.map((c) => c.color)]);
  }, [parentId, parentCode, allCodes, row.id, siblings]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingAnn(true);
      try {
        const anns = await pb.collection("annotations").getFullList({
          filter: `code="${row.id}"`,
          expand: "document,created_by",
          sort:   "-created",
        });
        if (!cancelled) {
          setAnnotations(
            anns.map((a) => ({
              id:            a.id,
              quote:         a.quote ?? "",
              note:          a.note  ?? "",
              documentName:  a.expand?.document?.name || "—",
              documentId:    a.document ?? "",
              createdByName: a.expand?.created_by?.name || a.expand?.created_by?.email || "—",
              createdAt:     a.created,
            })),
          );
        }
      } finally {
        if (!cancelled) setLoadingAnn(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [pb, row.id]);

  function handleToggleEdit(on: boolean) {
    if (!on) {
      setLabel(row.label);
      setColor(row.color || "#6366f1");
      setDesc(row.description);
      setParentId(row.parentId);
      setError(null);
    }
    setEditing(on);
  }

  async function handleSave() {
    if (!label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await pb.collection("codes").update(row.id, {
        label: label.trim(), color, description: desc, parent: parentId || null,
      });
      const newParentLabel = allCodes.find((c) => c.id === parentId)?.label ?? "";
      setRow({ ...row, label: label.trim(), color, description: desc, parentId, parentLabel: newParentLabel });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view doc-detail-view">
      <div className="case-detail-topbar">
        <button className="btn" onClick={onBack}>← Back to Codebook</button>
        {canEdit && (
          <label className="toggle-switch" title={editing ? "Cancel editing" : "Edit code"}>
            <input
              type="checkbox"
              checked={editing}
              onChange={(e) => handleToggleEdit(e.target.checked)}
            />
            <span className="toggle-track"><span className="toggle-thumb" /></span>
            <span className="toggle-label">{editing ? "Editing" : "Edit"}</span>
          </label>
        )}
      </div>

      <div className="doc-detail-layout">
        {/* Left column (1/3) */}
        <div className="doc-detail-left">

          <div className="case-card">
            <h3 className="case-card-title">Code</h3>
            {editing ? (
              <input
                className="form-input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
              />
            ) : (
              <p className="case-card-value" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <ColorSwatch color={row.color} size={18} />
                {row.label}
              </p>
            )}
          </div>

          <dl className="user-detail-meta case-detail-meta">
            <dt>Created By</dt> <dd>{row.createdByName}</dd>
            <dt>Created</dt>    <dd>{fmtDate(row.createdAt)}</dd>
            <dt>Parent</dt>     <dd>{row.parentLabel || "—"}</dd>
          </dl>

          <div className="case-card">
            <h3 className="case-card-title">Color</h3>
            {editing ? (
              <>
                <div className="code-color-row">
                  <input
                    type="color"
                    className="code-color-input"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                  <span className="code-color-hex">{color}</span>
                </div>
                <ColorSuggestions
                  suggestions={colorSuggestions}
                  selected={color}
                  onSelect={setColor}
                />
              </>
            ) : (
              <div className="code-color-row">
                <ColorSwatch color={row.color} size={18} />
                <span className="code-color-hex">{row.color || "—"}</span>
              </div>
            )}
          </div>

          <div className="case-card">
            <h3 className="case-card-title">Description</h3>
            {editing ? (
              <textarea
                className="form-input code-desc-textarea"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={4}
                placeholder="Optional description…"
              />
            ) : desc ? (
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>{desc}</p>
            ) : (
              <p className="case-card-empty">No description.</p>
            )}
          </div>

          {editing && (
            <div className="case-card">
              <h3 className="case-card-title">Parent Code</h3>
              <select
                className="form-input"
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                <option value="">— Top-level (no parent) —</option>
                {parentCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parentLabel ? `${c.parentLabel} › ${c.label}` : c.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {editing && (
            <div className="case-detail-actions">
              {error && <p className="auth-error">{error}</p>}
              <button className="btn" onClick={() => handleToggleEdit(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={handleSave} disabled={saving || !label.trim()}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          )}

        </div>

        {/* Right column (2/3) — annotations */}
        <div className="doc-detail-right">
          <div className="case-card doc-content-card">
            <h3 className="case-card-title">
              Annotations{annotations.length > 0 ? ` (${annotations.length})` : ""}
            </h3>
            {loadingAnn ? (
              <p className="case-card-empty">Loading annotations…</p>
            ) : annotations.length === 0 ? (
              <p className="case-card-empty">No annotations with this code yet.</p>
            ) : (
              <ul className="code-ann-list">
                {annotations.map((a) => (
                  <li key={a.id} className="code-ann-item">
                    <div className="code-ann-doc">{a.documentName}</div>
                    <blockquote className="code-ann-quote">"{a.quote}"</blockquote>
                    {a.note && <p className="code-ann-note">{a.note}</p>}
                    <div className="code-ann-meta">{fmtDate(a.createdAt)} · {a.createdByName}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── New Code modal ───────────────────────────────────────────────────────────

function NewCodeModal({
  projectId,
  allCodes,
  pb,
  currentUserId,
  onDone,
  onClose,
}: {
  projectId: string;
  allCodes: CodeRow[];
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  currentUserId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [label,    setLabel]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [color,    setColor]    = useState("#6366f1");
  const [parentId, setParentId] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const parentCode = allCodes.find((c) => c.id === parentId);

  const colorSuggestions = useMemo(() => {
    if (parentId && parentCode) {
      return getChildSuggestions(parentCode.color);
    }
    const topLevelColors = allCodes.filter((c) => !c.parentId).map((c) => c.color);
    return getTopLevelSuggestions(topLevelColors);
  }, [parentId, parentCode, allCodes]);

  // When parent changes, auto-suggest the first color
  useEffect(() => {
    if (colorSuggestions.length > 0) setColor(colorSuggestions[0]);
  }, [parentId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        project: projectId, label: label.trim(), color, description: desc,
        parent: parentId || null,
      };
      if (currentUserId) payload.created_by = currentUserId;
      await pb.collection("codes").create(payload);
      onDone();
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
              {allCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentLabel ? `${c.parentLabel} › ${c.label}` : c.label}
                </option>
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
            <ColorSuggestions
              suggestions={colorSuggestions}
              selected={color}
              onSelect={setColor}
            />
            <p className="code-color-hint">
              {parentId
                ? "Suggested shades of the parent code's color"
                : "Suggested colors distinct from existing codes"}
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

// ─── Main view ────────────────────────────────────────────────────────────────

export function CodebookView() {
  const { activeProject, pb, canEdit } = useStore();
  const { user: currentUser } = useAuth();

  const [rows,    setRows]    = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("label");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Collapsed node IDs
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [contextMenu,   setContextMenu]   = useState<{ x: number; y: number; row: CodeRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [confirmDelete, setConfirmDelete] = useState<CodeRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [newCodeOpen,   setNewCodeOpen]   = useState(false);
  const [selectedRow,   setSelectedRow]   = useState<CodeRow | null>(null);
  const [editStartRow,  setEditStartRow]  = useState<CodeRow | null>(null);
  const [memoForCode,   setMemoForCode]   = useState<CodeRow | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadCodes = useCallback(async () => {
    if (!activeProject || !pb) return;
    setLoading(true);
    setError(null);
    try {
      const codeRecords = await pb.collection("codes").getFullList({
        filter: `project="${activeProject.id}"`,
        expand: "created_by,parent",
        sort:   "label",
      });

      const allAnnotations = codeRecords.length > 0
        ? await pb.collection("annotations").getFullList({
            filter: codeRecords.map((c) => `code="${c.id}"`).join(" || "),
            fields: "id,code,document",
          })
        : [];

      const docsByCode: Record<string, Set<string>> = {};
      for (const ann of allAnnotations) {
        if (!docsByCode[ann.code]) docsByCode[ann.code] = new Set();
        docsByCode[ann.code].add(ann.document);
      }

      const allDocIds = [...new Set(allAnnotations.map((a) => a.document))];
      const caseDocs = allDocIds.length > 0
        ? await pb.collection("case_documents").getFullList({
            filter: allDocIds.map((id) => `document="${id}"`).join(" || "),
            fields: "case,document",
          })
        : [];

      const casesByDoc: Record<string, Set<string>> = {};
      for (const cd of caseDocs) {
        if (!casesByDoc[cd.document]) casesByDoc[cd.document] = new Set();
        casesByDoc[cd.document].add(cd.case);
      }

      const casesByCode: Record<string, Set<string>> = {};
      for (const [codeId, docSet] of Object.entries(docsByCode)) {
        const caseSet = new Set<string>();
        for (const docId of docSet) {
          const cs = casesByDoc[docId];
          if (cs) for (const c of cs) caseSet.add(c);
        }
        casesByCode[codeId] = caseSet;
      }

      setRows(
        codeRecords.map((r) => {
          const cb = r.expand?.created_by;
          const parentId = r.parent ?? "";
          return {
            id:            r.id,
            label:         r.label,
            color:         r.color ?? "",
            description:   r.description ?? "",
            parentId,
            parentLabel:   r.expand?.parent?.label ?? "",
            createdByName: cb?.name || cb?.email || "—",
            createdAt:     r.created,
            casesCount:    casesByCode[r.id]?.size ?? 0,
            docsCount:     docsByCode[r.id]?.size  ?? 0,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load codes.");
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

  useEffect(() => { loadCodes(); }, [loadCodes]);

  // ── Close context menu on outside click / Escape ──────────────────────────

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

  // ── Tree + visible rows ───────────────────────────────────────────────────

  const tree    = useMemo(() => buildTree(rows, sortCol, sortDir), [rows, sortCol, sortDir]);
  const visible = useMemo(() => getVisibleNodes(tree, collapsed), [tree, collapsed]);

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirmDelete || !pb) return;
    setDeleteLoading(true);
    try {
      const anns = await pb.collection("annotations").getFullList({
        filter: `code="${confirmDelete.id}"`,
        fields: "id",
      });
      await Promise.all(anns.map((a) => pb.collection("annotations").delete(a.id)));
      await pb.collection("codes").delete(confirmDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete code.");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Detail / edit ─────────────────────────────────────────────────────────

  if (memoForCode) {
    return (
      <MemoEditorView
        preselectedCodeIds={[memoForCode.id]}
        backLabel="← Back to Codebook"
        onSaved={() => setMemoForCode(null)}
        onBack={() => setMemoForCode(null)}
      />
    );
  }

  const detailRow = selectedRow ?? editStartRow;
  if (detailRow && pb) {
    return (
      <CodeDetail
        row={detailRow}
        allCodes={rows}
        pb={pb}
        startEditing={editStartRow !== null}
        canEdit={canEdit}
        onBack={() => { setSelectedRow(null); setEditStartRow(null); loadCodes(); }}
      />
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      <header className="view-header">
        <h1>Codebook</h1>
        {canEdit && (
          <button className="btn btn--primary" onClick={() => setNewCodeOpen(true)}>
            + New Code
          </button>
        )}
      </header>

      {error && <p className="users-error">{error}</p>}

      <div
        className="users-table-wrap"
        style={{
          maxHeight: 34 + (Math.max(loading || visible.length === 0 ? 1 : visible.length, 1) + 2) * 36,
        }}
      >
        <table className="users-table">
          <thead>
            <tr>
              {COLS.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={`users-th${sortCol === col.key ? " users-th--sorted" : ""}`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  <span className="users-sort-icon">
                    {sortCol === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="users-td-msg">Loading…</td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={5} className="users-td-msg">No codes yet.</td></tr>
            )}
            {!loading && visible.map((node) => (
              <tr
                key={node.id}
                className="users-row"
                onClick={() => setSelectedRow(node)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, row: node });
                }}
              >
                {/* Name cell with indentation + collapse toggle */}
                <td className="users-td users-td--name">
                  <span
                    className="code-tree-cell"
                    style={{ paddingLeft: node.depth * 20 }}
                  >
                    {node.hasChildren ? (
                      <button
                        type="button"
                        className="code-collapse-btn"
                        onClick={(e) => { e.stopPropagation(); toggleCollapse(node.id); }}
                        title={collapsed.has(node.id) ? "Expand" : "Collapse"}
                      >
                        {collapsed.has(node.id) ? "▶" : "▼"}
                      </button>
                    ) : (
                      <span className="code-collapse-spacer" />
                    )}
                    <ColorSwatch color={node.color} />
                    <span>{node.label}</span>
                  </span>
                </td>
                <td className="users-td users-td--muted">{node.createdByName}</td>
                <td className="users-td users-td--muted">{fmtDate(node.createdAt)}</td>
                <td className="users-td users-td--muted">{node.casesCount}</td>
                <td className="users-td users-td--muted">{node.docsCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => { setMemoForCode(contextMenu.row); setContextMenu(null); }}
          >
            Memo About Code
          </button>
          <button
            className="context-menu-item"
            onClick={() => { setEditStartRow(contextMenu.row); setContextMenu(null); }}
          >
            Edit Code
          </button>
          {canEdit && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}
            >
              Delete Code
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleteLoading && setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Code</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete <strong>{confirmDelete.label}</strong>?
            </p>
            <p className="modal-warning-text">
              All annotations made with this code will be permanently deleted. Child
              codes will not be deleted but will become top-level codes. This cannot
              be undone.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
                {deleteLoading ? "Deleting…" : "Delete Code"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Code modal */}
      {newCodeOpen && pb && activeProject && (
        <NewCodeModal
          projectId={activeProject.id}
          allCodes={rows}
          pb={pb}
          currentUserId={currentUser?.id ?? ""}
          onDone={() => { setNewCodeOpen(false); loadCodes(); }}
          onClose={() => setNewCodeOpen(false)}
        />
      )}
    </div>
  );
}
