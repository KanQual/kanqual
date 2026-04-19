import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore } from "../context/StoreContext";
import { useAuth } from "../context/AuthContext";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReportRow {
  id: string;
  name: string;
  createdByName: string;
  createdAt: string;
  caseIds: string[];
  documentIds: string[];
  codeIds: string[];
}

interface AnnItem {
  id: string;
  quote: string;
  note: string;
  documentId: string;
  documentName: string;
  codeId: string;
  codeName: string;
  codeColor: string;
  startOffset: number;
  endOffset: number;
  createdById: string;
}

interface CaseItem { id: string; name: string; }
interface UserItem { id: string; name: string; }

type SortCol = "name" | "createdByName" | "createdAt";
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function toArr<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "name",          label: "Name",       width: "40%" },
  { key: "createdByName", label: "Created By", width: "28%" },
  { key: "createdAt",     label: "Created",    width: "32%" },
];

// ─── Report page (create / view / edit) ───────────────────────────────────────

function ReportPage({
  row,
  isNew,
  canEdit,
  onSaved,
  onBack,
}: {
  row?: ReportRow;
  isNew?: boolean;
  canEdit: boolean;
  onSaved: () => void;
  onBack: () => void;
}) {
  const { pb, activeProject, documents: storeDocs, codes: storeCodes } = useStore();
  const { user: currentUser } = useAuth();

  // Edit state
  const [name,    setName]    = useState(row?.name ?? "");
  const [editing, setEditing] = useState(isNew ?? false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Filter selections
  const [selCaseIds,  setSelCaseIds]  = useState<Set<string>>(() => new Set(row?.caseIds  ?? []));
  const [selDocIds,   setSelDocIds]   = useState<Set<string>>(() => new Set(row?.documentIds ?? []));
  const [selCodeIds,  setSelCodeIds]  = useState<Set<string>>(() => new Set(row?.codeIds  ?? []));
  const [selUserIds,  setSelUserIds]  = useState<Set<string>>(new Set());
  const [collapsed,   setCollapsed]   = useState<Set<string>>(new Set());

  // Report options
  const [showContext,     setShowContext]     = useState(false);
  const [contextChars,    setContextChars]    = useState(100);
  const [showCoverage,    setShowCoverage]    = useState(false);
  const [showDescription, setShowDescription] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit],
    editorProps: {
      attributes: { class: "report-description-editor" },
    },
  });

  // Loaded data
  const [caseItems,     setCaseItems]     = useState<CaseItem[]>([]);
  const [userItems,     setUserItems]     = useState<UserItem[]>([]);
  const [caseDocLinks,  setCaseDocLinks]  = useState<{ caseId: string; documentId: string }[]>([]);
  const [allAnns,       setAllAnns]       = useState<AnnItem[]>([]);
  const [docContentMap, setDocContentMap] = useState<Map<string, string>>(new Map());
  const [dataLoading,   setDataLoading]   = useState(true);

  useEffect(() => {
    if (!pb || !activeProject) return;
    setDataLoading(true);
    (async () => {
      try {
        // Cases
        const caseRecs = await pb.collection("cases").getFullList({
          filter: `project="${activeProject.id}"`,
          sort: "name",
        });
        setCaseItems(caseRecs.map((r) => ({ id: r.id, name: r.name })));

        // Project members (users)
        const memberRecs = await pb.collection("project_members").getFullList({
          filter: `project="${activeProject.id}"`,
          expand: "user",
        });
        setUserItems(
          memberRecs
            .map((r) => {
              const u = r.expand?.user;
              return u ? { id: u.id, name: u.name || u.email || "Unknown" } : null;
            })
            .filter(Boolean) as UserItem[],
        );

        // Case → document links
        if (caseRecs.length > 0) {
          const cdRecs = await pb.collection("case_documents").getFullList({
            filter: caseRecs.map((c) => `case="${c.id}"`).join(" || "),
          });
          setCaseDocLinks(cdRecs.map((r) => ({ caseId: r.case, documentId: r.document })));
        }

        // All annotations across all project documents
        if (storeDocs.length > 0) {
          const annRecs = await pb.collection("annotations").getFullList({
            filter: storeDocs.map((d) => `document="${d.id}"`).join(" || "),
            expand: "code,document,created_by",
          });
          // Build document content map from expanded records
          const contentMap = new Map<string, string>();
          for (const r of annRecs) {
            const doc = r.expand?.document;
            if (doc && typeof doc.content === "string" && !contentMap.has(doc.id)) {
              contentMap.set(doc.id, doc.content);
            }
          }
          setDocContentMap(contentMap);
          setAllAnns(
            annRecs.map((r) => ({
              id:           r.id,
              quote:        r.quote,
              note:         r.note ?? "",
              documentId:   r.document,
              documentName: r.expand?.document?.name ?? "—",
              codeId:       r.code,
              codeName:     r.expand?.code?.label ?? "—",
              codeColor:    r.expand?.code?.color ?? "#888888",
              startOffset:  r.start_offset ?? 0,
              endOffset:    r.end_offset   ?? 0,
              createdById:  r.created_by   ?? "",
            })),
          );
        }
      } catch (e) {
        console.error(e);
      } finally {
        setDataLoading(false);
      }
    })();
  }, [pb, activeProject, storeDocs]);

  // caseId → Set<documentId>
  const caseDocMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { caseId, documentId } of caseDocLinks) {
      if (!map.has(caseId)) map.set(caseId, new Set());
      map.get(caseId)!.add(documentId);
    }
    return map;
  }, [caseDocLinks]);

  // Document IDs reachable via selected cases (null = no case filter)
  const caseFilterDocIds = useMemo(() => {
    if (selCaseIds.size === 0) return null;
    const ids = new Set<string>();
    for (const cId of selCaseIds)
      for (const dId of (caseDocMap.get(cId) ?? [])) ids.add(dId);
    return ids;
  }, [selCaseIds, caseDocMap]);

  // Filtered annotations
  const filteredAnns = useMemo(() => {
    return allAnns.filter((ann) => {
      if (caseFilterDocIds !== null && !caseFilterDocIds.has(ann.documentId)) return false;
      if (selDocIds.size  > 0 && !selDocIds.has(ann.documentId))  return false;
      if (selCodeIds.size > 0 && !selCodeIds.has(ann.codeId))     return false;
      if (selUserIds.size > 0 && !selUserIds.has(ann.createdById)) return false;
      return true;
    });
  }, [allAnns, caseFilterDocIds, selDocIds, selCodeIds, selUserIds]);

  // Code coverage statistics
  const coverageStats = useMemo(() => {
    const empty = { rows: [] as { codeName: string; codeColor: string; chars: number; pct: number }[], totalChars: 0 };
    if (!showCoverage) return empty;

    // Total characters across selected (or all) documents
    const activeDocs = selDocIds.size > 0
      ? storeDocs.filter((d) => selDocIds.has(d.id))
      : storeDocs;
    const totalChars = activeDocs.reduce(
      (sum, d) => sum + (docContentMap.get(d.id)?.length ?? 0),
      0,
    );
    if (totalChars === 0) return empty;

    // Seed with visible codes so codes with 0 coverage show up
    const visibleCodes = selCodeIds.size > 0
      ? storeCodes.filter((c) => selCodeIds.has(c.id))
      : storeCodes;
    const byCode = new Map<string, { codeName: string; codeColor: string; chars: number }>();
    for (const c of visibleCodes) {
      byCode.set(c.id, { codeName: c.label, codeColor: c.color, chars: 0 });
    }

    for (const ann of filteredAnns) {
      const entry = byCode.get(ann.codeId);
      if (entry) entry.chars += Math.max(0, ann.endOffset - ann.startOffset);
    }

    const rows = Array.from(byCode.values())
      .map(({ codeName, codeColor, chars }) => ({
        codeName,
        codeColor,
        chars,
        pct: (chars / totalChars) * 100,
      }))
      .filter((r) => r.pct > 0)
      .sort((a, b) => b.pct - a.pct);

    return { rows, totalChars };
  }, [showCoverage, filteredAnns, selDocIds, selCodeIds, storeDocs, storeCodes, docContentMap]);

  function togglePanel(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggle(
    set: Set<string>,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  }

  async function handleSave() {
    if (!pb || !activeProject || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const data = {
        name:      name.trim(),
        cases:     [...selCaseIds],
        documents: [...selDocIds],
        codes:     [...selCodeIds],
      };
      if (row) {
        await pb.collection("code_reports").update(row.id, data);
      } else {
        await pb.collection("code_reports").create({
          ...data,
          project:    activeProject.id,
          created_by: currentUser?.id ?? "",
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save report.");
      setSaving(false);
    }
  }

  const showEditControls = isNew || editing;

  // Summary counts: selected count if any filters active, else total
  const caseCount = selCaseIds.size  > 0 ? selCaseIds.size  : caseItems.length;
  const docCount  = selDocIds.size   > 0 ? selDocIds.size   : storeDocs.length;
  const codeCount = selCodeIds.size  > 0 ? selCodeIds.size  : storeCodes.length;
  const userCount = selUserIds.size  > 0 ? selUserIds.size  : userItems.length;

  return (
    <div className="annotate-view">

      {/* ── Top bar ── */}
      <div className="annotate-back-bar" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 10 }}>
        <button className="btn" onClick={onBack}>← Back to Reports</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {error && <span style={{ fontSize: 12, color: "var(--color-danger)" }}>{error}</span>}
          {!isNew && canEdit && (
            <label className="toggle-switch">
              <input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
              <span>Edit</span>
            </label>
          )}
          {showEditControls && (
            <button
              className="btn btn--primary"
              onClick={handleSave}
              disabled={saving || !name.trim()}
            >
              {saving ? "Saving…" : "Save Report"}
            </button>
          )}
        </div>
      </div>

      {/* ── 3-column layout ── */}
      <div className="annotate-layout">

        {/* Left: filter panels */}
        <div className="annotate-left">

          {/* Cases */}
          <div className="annotate-card">
            <button
              className="annotate-card-header"
              style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }}
              onClick={() => togglePanel("cases")}
            >
              <span className="annotate-card-title">
                Cases{selCaseIds.size > 0 ? ` (${selCaseIds.size})` : ""}
              </span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                {collapsed.has("cases") ? "▸" : "▾"}
              </span>
            </button>
            {!collapsed.has("cases") && (
              <ul className="code-list">
                {dataLoading
                  ? <li className="code-list-empty">Loading…</li>
                  : caseItems.length === 0
                    ? <li className="code-list-empty">No cases.</li>
                    : caseItems.map((c) => (
                        <li
                          key={c.id}
                          className="code-item"
                          style={{ cursor: "pointer" }}
                          onClick={() => toggle(selCaseIds, setSelCaseIds, c.id)}
                        >
                          <input
                            type="checkbox"
                            className="memo-sel-checkbox"
                            checked={selCaseIds.has(c.id)}
                            onChange={(e) => { e.stopPropagation(); toggle(selCaseIds, setSelCaseIds, c.id); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="code-label">{c.name}</span>
                        </li>
                      ))
                }
              </ul>
            )}
          </div>

          {/* Documents */}
          <div className="annotate-card">
            <button
              className="annotate-card-header"
              style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }}
              onClick={() => togglePanel("documents")}
            >
              <span className="annotate-card-title">
                Documents{selDocIds.size > 0 ? ` (${selDocIds.size})` : ""}
              </span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                {collapsed.has("documents") ? "▸" : "▾"}
              </span>
            </button>
            {!collapsed.has("documents") && (
              <ul className="code-list">
                {storeDocs.length === 0
                  ? <li className="code-list-empty">No documents.</li>
                  : storeDocs.map((d) => (
                      <li
                        key={d.id}
                        className="code-item"
                        style={{ cursor: "pointer" }}
                        onClick={() => toggle(selDocIds, setSelDocIds, d.id)}
                      >
                        <input
                          type="checkbox"
                          className="memo-sel-checkbox"
                          checked={selDocIds.has(d.id)}
                          onChange={(e) => { e.stopPropagation(); toggle(selDocIds, setSelDocIds, d.id); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="code-label">{d.name}</span>
                      </li>
                    ))
                }
              </ul>
            )}
          </div>

          {/* Codes */}
          <div className="annotate-card">
            <button
              className="annotate-card-header"
              style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }}
              onClick={() => togglePanel("codes")}
            >
              <span className="annotate-card-title">
                Codes{selCodeIds.size > 0 ? ` (${selCodeIds.size})` : ""}
              </span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                {collapsed.has("codes") ? "▸" : "▾"}
              </span>
            </button>
            {!collapsed.has("codes") && (
              <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                {storeCodes.length === 0
                  ? <li className="code-list-empty">No codes.</li>
                  : storeCodes.map((c) => (
                      <li
                        key={c.id}
                        className="code-item"
                        style={{ cursor: "pointer" }}
                        onClick={() => toggle(selCodeIds, setSelCodeIds, c.id)}
                      >
                        <input
                          type="checkbox"
                          className="memo-sel-checkbox"
                          checked={selCodeIds.has(c.id)}
                          onChange={(e) => { e.stopPropagation(); toggle(selCodeIds, setSelCodeIds, c.id); }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="code-swatch" style={{ background: c.color }} />
                        <span className="code-label">{c.label}</span>
                      </li>
                    ))
                }
              </ul>
            )}
          </div>

          {/* Users */}
          <div className="annotate-card annotate-card--grow">
            <button
              className="annotate-card-header"
              style={{ width: "100%", cursor: "pointer", background: "none", border: "none" }}
              onClick={() => togglePanel("users")}
            >
              <span className="annotate-card-title">
                Users{selUserIds.size > 0 ? ` (${selUserIds.size})` : ""}
              </span>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                {collapsed.has("users") ? "▸" : "▾"}
              </span>
            </button>
            {!collapsed.has("users") && (
              <ul className="code-list" style={{ overflowY: "auto", flex: 1 }}>
                {dataLoading
                  ? <li className="code-list-empty">Loading…</li>
                  : userItems.length === 0
                    ? <li className="code-list-empty">No users.</li>
                    : userItems.map((u) => (
                        <li
                          key={u.id}
                          className="code-item"
                          style={{ cursor: "pointer" }}
                          onClick={() => toggle(selUserIds, setSelUserIds, u.id)}
                        >
                          <input
                            type="checkbox"
                            className="memo-sel-checkbox"
                            checked={selUserIds.has(u.id)}
                            onChange={(e) => { e.stopPropagation(); toggle(selUserIds, setSelUserIds, u.id); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="code-label">{u.name}</span>
                        </li>
                      ))
                }
              </ul>
            )}
          </div>

        </div>

        {/* Middle: report content */}
        <div
          className="annotate-main"
          style={{ overflowY: "auto", gap: 10, flexDirection: "column", display: "flex", padding: "2px 0" }}
        >

          {/* Title */}
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Report Title</span>
            </div>
            <div style={{ padding: "10px 14px" }}>
              {showEditControls ? (
                <input
                  className="form-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Report name…"
                  autoFocus={isNew}
                />
              ) : (
                <p className="case-card-value">{name || "Untitled Report"}</p>
              )}
            </div>
          </div>

          {/* Created by / date */}
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Details</span>
            </div>
            <div style={{ display: "flex", gap: 24, padding: "10px 14px", fontSize: 13 }}>
              <span>
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Created By</span>
                {" "}
                <span style={{ color: "var(--color-text)" }}>
                  {row ? row.createdByName : (currentUser?.name || currentUser?.email || "—")}
                </span>
              </span>
              <span>
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>Created</span>
                {" "}
                <span style={{ color: "var(--color-text)" }}>{row ? fmtDate(row.createdAt) : "—"}</span>
              </span>
            </div>
          </div>

          {/* Description */}
          {showDescription && (
            <div className="annotate-card" style={{ flexShrink: 0 }}>
              <div className="annotate-card-header">
                <span className="annotate-card-title">Description</span>
                {editor && (
                  <div className="report-description-toolbar">
                    <button
                      className={`rte-btn${editor.isActive("bold")        ? " rte-btn--active" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
                      title="Bold"
                    >B</button>
                    <button
                      className={`rte-btn${editor.isActive("italic")      ? " rte-btn--active" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
                      title="Italic"
                    ><em>I</em></button>
                    <button
                      className={`rte-btn${editor.isActive("strike")      ? " rte-btn--active" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run(); }}
                      title="Strikethrough"
                    ><s>S</s></button>
                    <span className="rte-divider" />
                    <button
                      className={`rte-btn${editor.isActive("bulletList")  ? " rte-btn--active" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run(); }}
                      title="Bullet list"
                    >≡</button>
                    <button
                      className={`rte-btn${editor.isActive("orderedList") ? " rte-btn--active" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run(); }}
                      title="Numbered list"
                    >1.</button>
                    <span className="rte-divider" />
                    <button
                      className={`rte-btn${editor.isActive("blockquote")  ? " rte-btn--active" : ""}`}
                      onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }}
                      title="Blockquote"
                    >"</button>
                  </div>
                )}
              </div>
              <EditorContent editor={editor} />
            </div>
          )}

          {/* Summary counts */}
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            {[
              { label: "Cases",     value: caseCount  },
              { label: "Documents", value: docCount   },
              { label: "Codes",     value: codeCount  },
              { label: "Users",     value: userCount  },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="annotate-card"
                style={{ flex: 1, padding: "14px 10px", textAlign: "center", flexShrink: 0 }}
              >
                <div className="summary-card-value">{value}</div>
                <div className="summary-card-label">{label}</div>
              </div>
            ))}
          </div>

          {/* Statistics */}
          {showCoverage && (
            <div className="annotate-card" style={{ flexShrink: 0 }}>
              <div className="annotate-card-header">
                <span className="annotate-card-title">Statistics</span>
              </div>
              <div style={{ padding: "12px 14px" }}>
                {dataLoading ? (
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Loading…</p>
                ) : coverageStats.rows.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    No coverage data for the current filters.
                  </p>
                ) : (() => {
                  const maxPct = coverageStats.rows[0].pct; // sorted desc, first is tallest
                  const scale  = maxPct + 5;                // tallest bar + 5 pp of breathing room
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {/* Title + subtitle */}
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                          Code Coverage
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                          % of {coverageStats.totalChars.toLocaleString()} characters
                        </div>
                      </div>
                      {/* Bars */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {coverageStats.rows.map((row) => (
                          <div key={row.codeName} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {/* Code name */}
                            <span style={{
                              fontSize: 12,
                              width: 110,
                              flexShrink: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "var(--color-text)",
                            }}>
                              {row.codeName}
                            </span>
                            {/* Bar — no track background, just the colored fill */}
                            <div style={{ flex: 1, height: 12, position: "relative" }}>
                              <div style={{
                                width: `${(row.pct / scale) * 100}%`,
                                height: "100%",
                                background: row.codeColor,
                                borderRadius: 6,
                                transition: "width 0.3s ease",
                              }} />
                            </div>
                            {/* Percentage */}
                            <span style={{
                              fontSize: 12,
                              width: 42,
                              flexShrink: 0,
                              textAlign: "right",
                              color: "var(--color-text-muted)",
                            }}>
                              {row.pct < 0.1 ? "<0.1" : row.pct.toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Annotations */}
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">
                Annotations
                {filteredAnns.length > 0 ? ` (${filteredAnns.length})` : ""}
              </span>
            </div>
            {dataLoading ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>
                Loading…
              </div>
            ) : filteredAnns.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--color-text-muted)" }}>
                {allAnns.length === 0
                  ? "No annotations in this project yet."
                  : "No annotations match the current filters."}
              </div>
            ) : (
              <ul className="annotation-list">
                {filteredAnns.map((ann) => {
                  const docContent = docContentMap.get(ann.documentId) ?? "";
                  const ctxBefore = showContext && docContent
                    ? docContent.slice(Math.max(0, ann.startOffset - contextChars), ann.startOffset)
                    : null;
                  const ctxAfter = showContext && docContent
                    ? docContent.slice(ann.endOffset, ann.endOffset + contextChars)
                    : null;
                  return (
                    <li key={ann.id} className="annotation-item">
                      <div className="annotation-item-header">
                        <span
                          className="annotation-code-badge"
                          style={{ background: ann.codeColor }}
                        >
                          {ann.codeName}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          {ann.documentName}
                        </span>
                      </div>
                      <p className="annotation-quote">
                        {ctxBefore != null && (
                          <span className="annotation-context annotation-context--before">
                            {ann.startOffset > contextChars ? "…" : ""}{ctxBefore}
                          </span>
                        )}
                        <span className="annotation-quote-text">"{ann.quote}"</span>
                        {ctxAfter != null && (
                          <span className="annotation-context annotation-context--after">
                            {ctxAfter}{ann.endOffset + contextChars < docContent.length ? "…" : ""}
                          </span>
                        )}
                      </p>
                      {ann.note && <p className="annotation-note">{ann.note}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

        </div>

        {/* Right: report options */}
        <div className="annotate-right">
          <div className="annotate-card annotate-card--grow">
            <div className="annotate-card-header">
              <span className="annotate-card-title">Report Options</span>
            </div>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label className="toggle-switch" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={showContext}
                    onChange={(e) => setShowContext(e.target.checked)}
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span style={{ fontSize: 13 }}>Additional context</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={9999}
                  value={contextChars}
                  onChange={(e) => setContextChars(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  style={{
                    width: 60,
                    padding: "3px 6px",
                    fontSize: 13,
                    border: "var(--border-width) solid var(--color-border)",
                    borderRadius: "calc(var(--radius) * 0.5px)",
                    background: "var(--color-bg)",
                    color: "var(--color-text)",
                    textAlign: "right",
                  }}
                />
                <span style={{ fontSize: 13, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                  characters
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label className="toggle-switch" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={showCoverage}
                    onChange={(e) => setShowCoverage(e.target.checked)}
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span style={{ fontSize: 13 }}>Code coverage statistics</span>
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label className="toggle-switch" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={showDescription}
                    onChange={(e) => setShowDescription(e.target.checked)}
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span style={{ fontSize: 13 }}>Write a description</span>
                </label>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function CodeReportsView() {
  const { activeProject, pb, canEdit } = useStore();

  const [rows,    setRows]    = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [contextMenu,   setContextMenu]   = useState<{ x: number; y: number; row: ReportRow } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [confirmDelete, setConfirmDelete] = useState<ReportRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [openRow,    setOpenRow]    = useState<ReportRow | null>(null);
  const [showNew,    setShowNew]    = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadReports = useCallback(async () => {
    if (!activeProject || !pb) return;
    setLoading(true);
    setError(null);
    try {
      const records = await pb.collection("code_reports").getFullList({
        filter: `project="${activeProject.id}"`,
        expand: "created_by",
        sort: "-created",
      });

      setRows(
        records.map((r) => {
          const cb = r.expand?.created_by;
          return {
            id:            r.id,
            name:          r.name,
            createdByName: cb?.name || cb?.email || "—",
            createdAt:     r.created,
            caseIds:       toArr<string>(r.cases),
            documentIds:   toArr<string>(r.documents),
            codeIds:       toArr<string>(r.codes),
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb]);

  useEffect(() => { loadReports(); }, [loadReports]);

  // ── Close context menu ────────────────────────────────────────────────────

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown",     onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown",     onKeyDown);
    };
  }, []);

  // ── Sort ──────────────────────────────────────────────────────────────────

  const sorted = [...rows].sort((a, b) => {
    const cmp = String(a[sortCol]).localeCompare(String(b[sortCol]), undefined, { sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirmDelete || !pb) return;
    setDeleteLoading(true);
    try {
      await pb.collection("code_reports").delete(confirmDelete.id);
      setRows((prev) => prev.filter((r) => r.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete report.");
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  // ── Sub-views ─────────────────────────────────────────────────────────────

  if (showNew) {
    return (
      <ReportPage
        isNew
        canEdit={canEdit}
        onSaved={() => { setShowNew(false); loadReports(); }}
        onBack={() => setShowNew(false)}
      />
    );
  }

  if (openRow) {
    return (
      <ReportPage
        row={openRow}
        canEdit={canEdit}
        onSaved={() => { setOpenRow(null); loadReports(); }}
        onBack={() => setOpenRow(null)}
      />
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────

  return (
    <div className="view users-view">
      <header className="view-header">
        <h1>Code Reports</h1>
        {canEdit && (
          <button className="btn btn--primary" onClick={() => setShowNew(true)}>
            + New Report
          </button>
        )}
      </header>

      {error && <p className="users-error">{error}</p>}

      <div
        className="users-table-wrap"
        style={{
          maxHeight:
            34 + (Math.max(loading || sorted.length === 0 ? 1 : sorted.length, 1) + 2) * 36,
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
              <tr><td colSpan={3} className="users-td-msg">Loading…</td></tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan={3} className="users-td-msg">No reports yet.</td></tr>
            )}
            {!loading && sorted.map((row) => (
              <tr
                key={row.id}
                className="users-row"
                onClick={() => setOpenRow(row)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, row });
                }}
              >
                <td className="users-td users-td--name">{row.name}</td>
                <td className="users-td users-td--muted">{row.createdByName}</td>
                <td className="users-td users-td--muted">{fmtDate(row.createdAt)}</td>
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
            onClick={() => { setOpenRow(contextMenu.row); setContextMenu(null); }}
          >
            Open Report
          </button>
          {canEdit && (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}
            >
              Delete Report
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="modal-overlay"
          onClick={() => !deleteLoading && setConfirmDelete(null)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Report</h2>
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              Are you sure you want to permanently delete{" "}
              <strong>{confirmDelete.name}</strong>?
            </p>
            <p className="modal-warning-text">
              This report will be permanently deleted and cannot be recovered.
            </p>
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
                {deleteLoading ? "Deleting…" : "Delete Report"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
