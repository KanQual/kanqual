import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useOptionalStore, useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { MemoEditorView } from "./Analysis_Memos_View";
import { HelpIcon } from "../components/AppIcons";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";
import {
  createPostgresExperimentCode,
  deletePostgresExperimentCode,
  type PostgresExperimentAnnotationSummary,
  type PostgresExperimentSource,
  updatePostgresExperimentCode,
} from "../lib/postgresExperiment";

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
    return formatCurrentDateTime(iso, {
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
  canEditCode,
  canDeleteCode,
  onBack,
  onRequestDelete,
}: {
  row: CodeRow;
  allCodes: CodeRow[];
  pb: NonNullable<ReturnType<typeof useStore>["pb"]>;
  startEditing: boolean;
  canEditCode: boolean;
  canDeleteCode: boolean;
  onBack: () => void;
  onRequestDelete: (row: CodeRow) => void;
}) {
  const { updateCode, documents, setActiveDocument, setPendingAnnId, setView } = useStore();
  const { t } = useI18n();
  const [row,       setRow]      = useState(initialRow);
  const [showEditModal, setShowEditModal] = useState(startEditing);
  const [saving,    setSaving]   = useState(false);
  const [annotations,  setAnnotations] = useState<AnnotationRow[]>([]);
  const [loadingAnn,   setLoadingAnn]  = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingAnn(true);
      try {
        const anns = await pb.collection("annotations").getFullList({
          filter: `code="${row.id}"&&deleted_at=""`,
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

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  async function handleSaveFromModal(payload: {
    label: string;
    color: string;
    description: string;
    parentId?: string;
  }) {
    setSaving(true);
    try {
      await updateCode(row.id, {
        label: payload.label,
        color: payload.color,
        description: payload.description,
        parentId: payload.parentId,
      });
      const nextParentId = payload.parentId ?? "";
      const newParentLabel = allCodes.find((c) => c.id === nextParentId)?.label ?? "";
      setRow((prev) => ({
        ...prev,
        label: payload.label,
        color: payload.color,
        description: payload.description,
        parentId: nextParentId,
        parentLabel: newParentLabel,
      }));
      setShowEditModal(false);
    } catch (e) {
      throw e;
    } finally {
      setSaving(false);
    }
  }

  function jumpToAnnotation(annotation: AnnotationRow) {
    const document = documents.find((item) => item.id === annotation.documentId);
    if (!document) return;
    setActiveDocument(document);
    setPendingAnnId(annotation.id);
    setView("code-text");
  }

  return (
    <div className="view doc-detail-view">
      <div className="workspace-back-row workspace-back-row--split">
        <button className="btn" onClick={onBack}>{t("projectCodebook.actions.backToCodebook")}</button>
        {(canEditCode || canDeleteCode) && (
          <div className="workspace-back-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setShowEditModal(true)}
              disabled={!canEditCode}
              title={!canEditCode ? t("projectCodebook.permissions.cannotEditCodes") : undefined}
            >
              {t("projectCodebook.actions.editCode")}
            </button>
            <div className="user-detail-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="btn"
                aria-label={t("projectCodebook.actions.codeActions")}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {t("projectCodebook.actions.actions")}
              </button>
              {menuOpen && (
                <div className="context-menu user-detail-menu" role="menu">
                  {canDeleteCode ? (
                    <button
                      type="button"
                      className="context-menu-item context-menu-item--danger"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onRequestDelete(row);
                      }}
                    >
                      {t("projectCodebook.actions.deleteCode")}
                    </button>
                  ) : (
                    <div className="context-menu-item context-menu-item--disabled" title={t("projectCodebook.permissions.cannotDeleteCodes")}>
                      {t("projectCodebook.actions.deleteCode")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="doc-detail-layout">
        {/* Left column (1/3) */}
        <div className="doc-detail-left">

          <div className="case-card">
            <h3 className="case-card-title">{t("projectCodebook.detail.code")}</h3>
            <p className="case-card-value" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ColorSwatch color={row.color} size={18} />
              {row.label}
            </p>
          </div>

          <dl className="user-detail-meta case-detail-meta">
            <dt>{t("projectCodebook.table.createdBy")}</dt> <dd>{row.createdByName}</dd>
            <dt>{t("projectCodebook.table.created")}</dt>    <dd>{fmtDate(row.createdAt)}</dd>
            <dt>{t("projectCodebook.detail.parent")}</dt>     <dd>{row.parentLabel || "—"}</dd>
          </dl>

          <div className="case-card">
            <h3 className="case-card-title">{t("projectCodebook.detail.color")}</h3>
            <div className="code-color-row">
              <ColorSwatch color={row.color} size={18} />
              <span className="code-color-hex">{row.color || "-"}</span>
            </div>
          </div>

          <div className="case-card">
            <h3 className="case-card-title">{t("projectCodebook.detail.description")}</h3>
            {row.description ? (
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>{row.description}</p>
            ) : (
              <p className="case-card-empty">{t("projectCodebook.detail.noDescription")}</p>
            )}
          </div>

        </div>

        {/* Right column (2/3) — annotations */}
        <div className="doc-detail-right">
          <div className="case-card doc-content-card">
            <h3 className="case-card-title">
              {t("projectCodebook.detail.annotations")}{annotations.length > 0 ? ` (${annotations.length})` : ""}
            </h3>
            {loadingAnn ? (
              <p className="case-card-empty">{t("projectCodebook.detail.loadingAnnotations")}</p>
            ) : annotations.length === 0 ? (
              <p className="case-card-empty">{t("projectCodebook.detail.noAnnotations")}</p>
            ) : (
              <ul className="code-ann-list">
                {annotations.map((a) => (
                  <li
                    key={a.id}
                    className="code-ann-item"
                    onClick={() => jumpToAnnotation(a)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        jumpToAnnotation(a);
                      }
                    }}
                  >
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

      {showEditModal && (
        <NewCodeModal
          allCodes={allCodes}
          title={t("projectCodebook.modal.editTitle")}
          submitLabel={t("projectCodebook.modal.saveChanges")}
          initialLabel={row.label}
          initialDescription={row.description}
          initialColor={row.color || "#6366f1"}
          initialParentId={row.parentId}
          excludeCodeId={row.id}
          onSubmit={handleSaveFromModal}
          onDone={() => {}}
          onClose={() => {
            if (saving) return;
            setShowEditModal(false);
          }}
        />
      )}
    </div>
  );
}

// ─── New Code modal ───────────────────────────────────────────────────────────

function NewCodeModal({
  allCodes,
  title,
  submitLabel,
  initialLabel = "",
  initialDescription = "",
  initialColor = "#6366f1",
  initialParentId = "",
  excludeCodeId,
  onSubmit,
  onDone,
  onClose,
}: {
  allCodes: CodeRow[];
  title?: string;
  submitLabel?: string;
  initialLabel?: string;
  initialDescription?: string;
  initialColor?: string;
  initialParentId?: string;
  excludeCodeId?: string;
  onSubmit?: (payload: { label: string; color: string; description: string; parentId?: string }) => Promise<void>;
  onDone: () => void;
  onClose: () => void;
}) {
  const store = useOptionalStore();
  const { t } = useI18n();
  const { user: currentUser } = useAuth();
  const resolvedTitle = title ?? t("projectCodebook.modal.newTitle");
  const resolvedSubmitLabel = submitLabel ?? t("projectCodebook.modal.createCode");
  const [label,    setLabel]    = useState(initialLabel);
  const [desc,     setDesc]     = useState(initialDescription);
  const [color,    setColor]    = useState(initialColor);
  const [parentId, setParentId] = useState(initialParentId);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const availableCodes = allCodes.filter((c) => c.id !== excludeCodeId);
  const parentCode = allCodes.find((c) => c.id === parentId);

  const colorSuggestions = useMemo(() => {
    if (parentId && parentCode) {
      return getChildSuggestions(parentCode.color);
    }
    const topLevelColors = availableCodes.filter((c) => !c.parentId).map((c) => c.color);
    return getTopLevelSuggestions(topLevelColors);
  }, [parentId, parentCode, availableCodes]);

  function handleParentChange(nextParentId: string) {
    setParentId(nextParentId);

    const nextParentCode = allCodes.find((c) => c.id === nextParentId);
    const nextSuggestions = nextParentId && nextParentCode
      ? getChildSuggestions(nextParentCode.color)
      : getTopLevelSuggestions(availableCodes.filter((c) => !c.parentId).map((c) => c.color));

    if (nextSuggestions.length > 0) {
      setColor(nextSuggestions[0]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setLoading(true);
    setError(null);
    try {
      if (onSubmit) {
        await onSubmit({
          label: label.trim(),
          color,
          description: desc,
          parentId: parentId || undefined,
        });
      } else {
        if (!store) throw new Error("Code creation requires the project store in PocketBase mode.");
        await store.addCode(label.trim(), color, desc, undefined, parentId || undefined, currentUser?.id);
      }
      onDone();
    } catch (e) {
      const fieldErrors = (e as { data?: { data?: Record<string, { message?: string }> } }).data?.data;
      if (fieldErrors && Object.keys(fieldErrors).length > 0) {
        setError(Object.entries(fieldErrors).map(([f, v]) => `${f}: ${v?.message ?? t("projectCodebook.errors.invalidField")}`).join(" · "));
      } else {
        setError(e instanceof Error ? (e as Error).message : t("projectCodebook.errors.createFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{resolvedTitle}</h2>
        <form className="form" onSubmit={handleSubmit}>

          <label className="form-label">
            {t("projectCodebook.modal.codeName")}
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
            {t("projectCodebook.detail.description")}
            <textarea
              className="form-input code-desc-textarea"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t("projectCodebook.modal.optionalDescription")}
              rows={3}
            />
          </label>

          <label className="form-label">
            {t("projectCodebook.modal.parentCode")}
            <select
              className="form-input"
              value={parentId}
              onChange={(e) => handleParentChange(e.target.value)}
            >
              <option value="">{t("projectCodebook.modal.topLevelOption")}</option>
              {availableCodes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentLabel ? `${c.parentLabel} › ${c.label}` : c.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-label">
            {t("projectCodebook.detail.color")}
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
                ? t("projectCodebook.modal.parentColorHint")
                : t("projectCodebook.modal.distinctColorHint")}
            </p>
          </label>

          {error && <p className="auth-error">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="btn btn--primary" disabled={loading || !label.trim()}>
              {loading ? t("projectCodebook.statuses.saving") : resolvedSubmitLabel}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export type CodebookViewProps = {
  postgresProjectId?: string | null;
  postgresCanCreateCodes?: boolean;
  postgresCanEditCodes?: boolean;
  postgresCanDeleteCodes?: boolean;
  postgresCanMemoAboutCodes?: boolean;
  onOpenPostgresSourceAnnotation?: (payload: { sourceId: string; annotationId: string }) => void;
  onOpenPostgresMemoForCode?: (payload: { codeId: string }) => void;
};

export function CodebookView({
  postgresProjectId,
  postgresCanCreateCodes,
  postgresCanEditCodes,
  postgresCanDeleteCodes,
  postgresCanMemoAboutCodes,
  onOpenPostgresSourceAnnotation,
  onOpenPostgresMemoForCode,
}: CodebookViewProps = {}) {
  const store = useOptionalStore();
  const { t } = useI18n();
  const activeProject = store?.activeProject ?? (postgresProjectId ? { id: postgresProjectId } : null);
  const activeProjectId = store?.activeProject?.id ?? postgresProjectId ?? null;
  const pb = store?.pb ?? null;
  const deleteCode = store?.deleteCode;
  const pendingCodeId = store?.pendingCodeId ?? null;
  const setPendingCodeId = store?.setPendingCodeId ?? (() => {});
  const postgresMode = !store && !!postgresProjectId;
  const canCreateCodes = store
    ? store.canCurrentUser("createCode")
    : !!postgresCanCreateCodes;
  const canEditCodes = store
    ? store.canCurrentUser("editCode")
    : !!postgresCanEditCodes;
  const canDeleteCodes = store
    ? store.canCurrentUser("deleteCode")
    : !!postgresCanDeleteCodes;
  const canMemoAboutCodes = store
    ? store.canCurrentUser("createMemo") && store.canCurrentUser("associateMemoObjects")
    : !!postgresCanMemoAboutCodes;

  const [rows,    setRows]    = useState<CodeRow[]>([]);
  const [postgresSources, setPostgresSources] = useState<PostgresExperimentSource[]>([]);
  const [postgresAnnotations, setPostgresAnnotations] = useState<PostgresExperimentAnnotationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("label");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Collapsed node IDs
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [contextMenu,   setContextMenu]   = useState<{ x: number; y: number; row: CodeRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuStyle = useViewportContextMenuStyle(contextMenu, contextMenuRef);

  const [confirmDelete, setConfirmDelete] = useState<CodeRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [newCodeOpen,   setNewCodeOpen]   = useState(false);
  const [newCodeParentId, setNewCodeParentId] = useState("");
  const [editingRow, setEditingRow] = useState<CodeRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedRow,   setSelectedRow]   = useState<CodeRow | null>(null);
  const [editStartRow,  setEditStartRow]  = useState<CodeRow | null>(null);
  const [memoForCode,   setMemoForCode]   = useState<CodeRow | null>(null);
  const localizedCols = [
    { ...COLS[0], label: t("projectCodebook.table.name") },
    { ...COLS[1], label: t("projectCodebook.table.createdBy") },
    { ...COLS[2], label: t("projectCodebook.table.created") },
    { ...COLS[3], label: t("projectCodebook.table.cases") },
    { ...COLS[4], label: t("projectCodebook.table.documents") },
  ];

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadCodes = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    setError(null);
    try {
      if (!pb) {
        const snapshot = await loadPostgresProjectWorkspaceSnapshot(activeProjectId);
        setPostgresSources(snapshot.sources);
        setPostgresAnnotations(snapshot.annotations);
        const docsByCode: Record<string, Set<string>> = {};
        for (const annotation of snapshot.annotations) {
          for (const codeId of annotation.codeIds) {
            if (!docsByCode[codeId]) docsByCode[codeId] = new Set();
            docsByCode[codeId].add(annotation.sourceId);
          }
        }

        const codeLabelById = Object.fromEntries(snapshot.codes.map((code) => [code.id, code.label]));
        setRows(
          snapshot.codes.map((code) => ({
            id: code.id,
            label: code.label,
            color: code.color ?? "",
            description: code.description ?? "",
            parentId: code.parentCodeId ?? "",
            parentLabel: code.parentCodeId ? codeLabelById[code.parentCodeId] ?? "" : "",
            createdByName: "—",
            createdAt: code.createdAt,
            casesCount: 0,
            docsCount: docsByCode[code.id]?.size ?? 0,
          })),
        );
        return;
      }

      const codeRecords = await pb.collection("codes").getFullList({
        filter: `project="${activeProjectId}"&&deleted_at=""`,
        expand: "created_by,parent",
        sort:   "label",
      });

      const allAnnotations = codeRecords.length > 0
        ? await pb.collection("annotations").getFullList({
            filter: `(${codeRecords.map((c) => `code="${c.id}"`).join(" || ")})&&deleted_at=""`,
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
      setError(e instanceof Error ? e.message : t("projectCodebook.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, pb, t]);

  useEffect(() => { loadCodes(); }, [loadCodes]);

  useEffect(() => {
    if (!pendingCodeId || rows.length === 0) return;
    const match = rows.find((row) => row.id === pendingCodeId);
    if (!match) return;
    setSelectedRow(match);
    setEditStartRow(null);
    setPendingCodeId(null);
  }, [rows, pendingCodeId, setPendingCodeId]);

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
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      if (pb) {
        if (!deleteCode) throw new Error("Code deletion requires the project store in PocketBase mode.");
        await deleteCode(confirmDelete.id);
      } else if (activeProjectId) {
        await deletePostgresExperimentCode(activeProjectId, confirmDelete.id);
      }
      setRows((prev) => prev
        .filter((r) => r.id !== confirmDelete.id)
        .map((r) => (r.parentId === confirmDelete.id ? { ...r, parentId: "", parentLabel: "" } : r)));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projectCodebook.errors.deleteFailed"));
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handlePostgresCodeSave(payload: {
    label: string;
    color: string;
    description: string;
    parentId?: string;
  }) {
    if (!activeProjectId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (editingRow) {
        await updatePostgresExperimentCode({
          projectId: activeProjectId,
          codeId: editingRow.id,
          label: payload.label,
          color: payload.color,
          description: payload.description,
          parentCodeId: payload.parentId ?? "",
          shortcut: "",
        });
      } else {
        await createPostgresExperimentCode({
          projectId: activeProjectId,
          label: payload.label,
          color: payload.color,
          description: payload.description,
          parentCodeId: payload.parentId ?? "",
          shortcut: "",
        });
      }
      setEditingRow(null);
      setNewCodeOpen(false);
      setNewCodeParentId("");
      await loadCodes();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t("projectCodebook.errors.createFailed"));
      throw e;
    } finally {
      setSubmitting(false);
    }
  }

  // ── Detail / edit ─────────────────────────────────────────────────────────

  const postgresSourceNameById = useMemo(
    () => Object.fromEntries(postgresSources.map((source) => [source.id, source.title])),
    [postgresSources],
  );

  const postgresDetailAnnotations = useMemo(() => {
    if (!selectedRow) return [];
    return postgresAnnotations
      .filter((annotation) => annotation.codeIds.includes(selectedRow.id))
      .map((annotation) => ({
        id: annotation.id,
        quote: annotation.quote ?? "",
        note: annotation.note ?? "",
        documentName: postgresSourceNameById[annotation.sourceId] ?? "—",
        documentId: annotation.sourceId,
        createdByName: annotation.createdByName || "—",
        createdAt: annotation.createdAt,
      }));
  }, [postgresAnnotations, postgresSourceNameById, selectedRow]);

  if (memoForCode) {
    return (
      <MemoEditorView
        preselectedCodeIds={[memoForCode.id]}
        backLabel={t("projectCodebook.actions.backToCodebook")}
        onSaved={() => setMemoForCode(null)}
        onBack={() => setMemoForCode(null)}
      />
    );
  }

  const detailRow = selectedRow ?? editStartRow;
  if (detailRow && postgresMode) {
    return (
      <>
        <PostgresCodeDetail
          row={detailRow}
          allCodes={rows}
          annotations={postgresDetailAnnotations}
          startEditing={editStartRow !== null && canEditCodes}
          canEditCode={canEditCodes}
          canDeleteCode={canDeleteCodes}
          onBack={() => {
            setSelectedRow(null);
            setEditStartRow(null);
            void loadCodes();
          }}
          onRequestDelete={(row) => setConfirmDelete(row)}
          onOpenAnnotation={(annotation) => {
            if (!onOpenPostgresSourceAnnotation) return;
            onOpenPostgresSourceAnnotation({
              sourceId: annotation.documentId,
              annotationId: annotation.id,
            });
          }}
          onSave={handlePostgresCodeSave}
        />
        {confirmDelete && (
          <div className="modal-overlay" onClick={() => !deleteLoading && setConfirmDelete(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>{t("projectCodebook.deleteModal.title")}</h2>
              <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                {t("projectCodebook.deleteModal.body", { label: confirmDelete.label })}
              </p>
              <p className="modal-warning-text">
                {t("projectCodebook.deleteModal.warning")}
              </p>
              <div className="form-actions" style={{ marginTop: 24 }}>
                <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>
                  {t("common.cancel")}
                </button>
                <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
                  {deleteLoading ? t("projectCodebook.statuses.deleting") : t("projectCodebook.actions.deleteCode")}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
  if (detailRow && pb) {
    return (
      <>
        <CodeDetail
          row={detailRow}
          allCodes={rows}
          pb={pb}
          startEditing={editStartRow !== null && canEditCodes}
          canEditCode={canEditCodes}
          canDeleteCode={canDeleteCodes}
          onBack={() => { setSelectedRow(null); setEditStartRow(null); loadCodes(); }}
          onRequestDelete={(row) => setConfirmDelete(row)}
        />
        {confirmDelete && (
          <div className="modal-overlay" onClick={() => !deleteLoading && setConfirmDelete(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>{t("projectCodebook.deleteModal.title")}</h2>
              <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                {t("projectCodebook.deleteModal.body", { label: confirmDelete.label })}
              </p>
              <p className="modal-warning-text">
                {t("projectCodebook.deleteModal.warning")}
              </p>
              <div className="form-actions" style={{ marginTop: 24 }}>
                <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>
                  {t("common.cancel")}
                </button>
                <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
                  {deleteLoading ? t("projectCodebook.statuses.deleting") : t("projectCodebook.actions.deleteCode")}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("projectCodebook.pageTitle")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("projectCodebook.showHelp")}
            aria-label={t("projectCodebook.showHelp")}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => {
            setNewCodeParentId("");
            setSubmitError(null);
            setNewCodeOpen(true);
          }}
          disabled={!canCreateCodes}
          title={
            !canCreateCodes
              ? t("projectCodebook.permissions.cannotCreateCodes")
              : undefined
          }
        >
          {t("projectCodebook.actions.newCode")}
        </button>
      </header>

      {error && <p className="users-error">{error}</p>}
      <div className="users-content">
      <div
        className="users-table-wrap"
        style={{
          maxHeight: 34 + (Math.max(loading || visible.length === 0 ? 1 : visible.length, 1) + 2) * 36,
        }}
      >
        <table className="users-table">
          <thead>
            <tr>
              {localizedCols.map((col) => (
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
              <tr><td colSpan={5} className="users-td-msg">{t("projectCodebook.statuses.loading")}</td></tr>
            )}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={5} className="users-td-msg">{t("projectCodebook.empty.noCodes")}</td></tr>
            )}
            {!loading && visible.map((node) => (
              <tr
                key={node.id}
                className="users-row codebook-list-row"
                onClick={() => {
                  setSelectedRow(node);
                }}
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
                        title={collapsed.has(node.id) ? t("projectCodebook.actions.expand") : t("projectCodebook.actions.collapse")}
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
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectCodebook.help.title")}</h2>
            <p className="users-guide-copy">
              {t("projectCodebook.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("projectCodebook.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("projectCodebook.help.line3")}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={contextMenuStyle}
        >
          {canMemoAboutCodes ? (
            <button
              className="context-menu-item"
              onClick={() => {
                if (postgresMode) {
                  onOpenPostgresMemoForCode?.({
                    codeId: contextMenu.row.id,
                  });
                } else {
                  setMemoForCode(contextMenu.row);
                }
                setContextMenu(null);
              }}
            >
              {t("projectCodebook.actions.memoAboutCode")}
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title={t("projectCodebook.permissions.cannotMemoAboutCode")}>
              {t("projectCodebook.actions.memoAboutCode")}
            </div>
          )}
          {canEditCodes ? (
            <button
              className="context-menu-item"
              onClick={() => {
                if (postgresMode) {
                  setEditingRow(contextMenu.row);
                  setSubmitError(null);
                } else {
                  setEditStartRow(contextMenu.row);
                }
                setContextMenu(null);
              }}
            >
              {t("projectCodebook.actions.editCode")}
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title={t("projectCodebook.permissions.cannotEditCodes")}>
              {t("projectCodebook.actions.editCode")}
            </div>
          )}
          {canCreateCodes ? (
            <button
              className="context-menu-item"
              onClick={() => {
                setNewCodeParentId(contextMenu.row.id);
                setNewCodeOpen(true);
                setContextMenu(null);
              }}
            >
              {t("projectCodebook.actions.createChildCode")}
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title={t("projectCodebook.permissions.cannotCreateChildCodes")}>
              {t("projectCodebook.actions.createChildCode")}
            </div>
          )}
          {canDeleteCodes ? (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}
            >
              {t("projectCodebook.actions.deleteCode")}
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled" title={t("projectCodebook.permissions.cannotDeleteCodes")}>
              {t("projectCodebook.actions.deleteCode")}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleteLoading && setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectCodebook.deleteModal.title")}</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("projectCodebook.deleteModal.body", { label: confirmDelete.label })}
            </p>
            <p className="modal-warning-text">
              {t("projectCodebook.deleteModal.warning")}
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>
                {t("common.cancel")}
              </button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
                {deleteLoading ? t("projectCodebook.statuses.deleting") : t("projectCodebook.actions.deleteCode")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Code modal */}
      {newCodeOpen && activeProject && (
        <NewCodeModal
          allCodes={rows}
          initialParentId={newCodeParentId}
          onSubmit={postgresMode ? handlePostgresCodeSave : undefined}
          onDone={() => {
            setNewCodeOpen(false);
            setNewCodeParentId("");
            loadCodes();
          }}
          onClose={() => {
            setNewCodeOpen(false);
            setNewCodeParentId("");
          }}
        />
      )}
      {editingRow && postgresMode && activeProject && (
        <NewCodeModal
          allCodes={rows}
          title={t("projectCodebook.modal.editTitle")}
          submitLabel={t("projectCodebook.modal.saveChanges")}
          initialLabel={editingRow.label}
          initialDescription={editingRow.description}
          initialColor={editingRow.color || "#6366f1"}
          initialParentId={editingRow.parentId}
          excludeCodeId={editingRow.id}
          onSubmit={handlePostgresCodeSave}
          onDone={() => {
            setEditingRow(null);
            loadCodes();
          }}
          onClose={() => {
            if (submitting) return;
            setEditingRow(null);
            setSubmitError(null);
          }}
        />
      )}
      {submitError && postgresMode && !editingRow && !newCodeOpen && (
        <p className="users-error" style={{ marginTop: 12 }}>{submitError}</p>
      )}
    </div>
  );
}

function PostgresCodeDetail({
  row: initialRow,
  allCodes,
  annotations,
  startEditing,
  canEditCode,
  canDeleteCode,
  onBack,
  onRequestDelete,
  onOpenAnnotation,
  onSave,
}: {
  row: CodeRow;
  allCodes: CodeRow[];
  annotations: AnnotationRow[];
  startEditing: boolean;
  canEditCode: boolean;
  canDeleteCode: boolean;
  onBack: () => void;
  onRequestDelete: (row: CodeRow) => void;
  onOpenAnnotation: (annotation: AnnotationRow) => void;
  onSave: (payload: {
    label: string;
    color: string;
    description: string;
    parentId?: string;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [row, setRow] = useState(initialRow);
  const [showEditModal, setShowEditModal] = useState(startEditing);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRow(initialRow);
  }, [initialRow]);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  async function handleSaveFromModal(payload: {
    label: string;
    color: string;
    description: string;
    parentId?: string;
  }) {
    setSaving(true);
    try {
      await onSave(payload);
      const nextParentId = payload.parentId ?? "";
      const newParentLabel = allCodes.find((c) => c.id === nextParentId)?.label ?? "";
      setRow((prev) => ({
        ...prev,
        label: payload.label,
        color: payload.color,
        description: payload.description,
        parentId: nextParentId,
        parentLabel: newParentLabel,
      }));
      setShowEditModal(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view doc-detail-view">
      <div className="workspace-back-row workspace-back-row--split">
        <button className="btn" onClick={onBack}>{t("projectCodebook.actions.backToCodebook")}</button>
        {(canEditCode || canDeleteCode) && (
          <div className="workspace-back-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setShowEditModal(true)}
              disabled={!canEditCode}
              title={!canEditCode ? t("projectCodebook.permissions.cannotEditCodes") : undefined}
            >
              {t("projectCodebook.actions.editCode")}
            </button>
            <div className="user-detail-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="btn"
                aria-label={t("projectCodebook.actions.codeActions")}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {t("projectCodebook.actions.actions")}
              </button>
              {menuOpen && (
                <div className="context-menu user-detail-menu" role="menu">
                  {canDeleteCode ? (
                    <button
                      type="button"
                      className="context-menu-item context-menu-item--danger"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onRequestDelete(row);
                      }}
                    >
                      {t("projectCodebook.actions.deleteCode")}
                    </button>
                  ) : (
                    <div className="context-menu-item context-menu-item--disabled" title={t("projectCodebook.permissions.cannotDeleteCodes")}>
                      {t("projectCodebook.actions.deleteCode")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="doc-detail-layout">
        <div className="doc-detail-left">
          <div className="case-card">
            <h3 className="case-card-title">{t("projectCodebook.detail.code")}</h3>
            <p className="case-card-value" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ColorSwatch color={row.color} size={18} />
              {row.label}
            </p>
          </div>

          <dl className="user-detail-meta case-detail-meta">
            <dt>{t("projectCodebook.table.createdBy")}</dt> <dd>{row.createdByName}</dd>
            <dt>{t("projectCodebook.table.created")}</dt> <dd>{fmtDate(row.createdAt)}</dd>
            <dt>{t("projectCodebook.detail.parent")}</dt> <dd>{row.parentLabel || "—"}</dd>
          </dl>

          <div className="case-card">
            <h3 className="case-card-title">{t("projectCodebook.detail.color")}</h3>
            <div className="code-color-row">
              <ColorSwatch color={row.color} size={18} />
              <span className="code-color-hex">{row.color || "-"}</span>
            </div>
          </div>

          <div className="case-card">
            <h3 className="case-card-title">{t("projectCodebook.detail.description")}</h3>
            {row.description ? (
              <p style={{ fontSize: 14, lineHeight: 1.6 }}>{row.description}</p>
            ) : (
              <p className="case-card-empty">{t("projectCodebook.detail.noDescription")}</p>
            )}
          </div>
        </div>

        <div className="doc-detail-right">
          <div className="case-card doc-content-card">
            <h3 className="case-card-title">
              {t("projectCodebook.detail.annotations")}{annotations.length > 0 ? ` (${annotations.length})` : ""}
            </h3>
            {annotations.length === 0 ? (
              <p className="case-card-empty">{t("projectCodebook.detail.noAnnotations")}</p>
            ) : (
              <ul className="code-ann-list">
                {annotations.map((annotation) => (
                  <li
                    key={annotation.id}
                    className="code-ann-item"
                    onClick={() => onOpenAnnotation(annotation)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenAnnotation(annotation);
                      }
                    }}
                  >
                    <div className="code-ann-doc">{annotation.documentName}</div>
                    <blockquote className="code-ann-quote">"{annotation.quote}"</blockquote>
                    {annotation.note && <p className="code-ann-note">{annotation.note}</p>}
                    <div className="code-ann-meta">{fmtDate(annotation.createdAt)} · {annotation.createdByName}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {showEditModal && (
        <NewCodeModal
          allCodes={allCodes}
          title={t("projectCodebook.modal.editTitle")}
          submitLabel={t("projectCodebook.modal.saveChanges")}
          initialLabel={row.label}
          initialDescription={row.description}
          initialColor={row.color || "#6366f1"}
          initialParentId={row.parentId}
          excludeCodeId={row.id}
          onSubmit={handleSaveFromModal}
          onDone={() => {}}
          onClose={() => {
            if (saving) return;
            setShowEditModal(false);
          }}
        />
      )}
    </div>
  );
}



