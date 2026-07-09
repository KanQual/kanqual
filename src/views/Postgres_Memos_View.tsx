import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  POSTGRES_PROJECT_CHANGED_EVENT,
  createPostgresExperimentMemo,
  deletePostgresExperimentMemo,
  listPostgresExperimentMemos,
  type PostgresExperimentAnnotationSummary,
  type PostgresExperimentCode,
  type PostgresExperimentMemo,
  type PostgresExperimentObject,
  type PostgresExperimentProjectChangeEvent,
  type PostgresExperimentSource,
  updatePostgresExperimentMemo,
} from "../lib/postgresExperiment";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";
import { formatCurrentDateTime } from "../i18n/formatters";

function formatMemoDate(value: string): string {
  if (!value) return "-";
  try {
    return formatCurrentDateTime(value, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function excerpt(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "No memo text yet.";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3).trimEnd()}...`;
}

type MemoEditorDraft = {
  memoId: string | null;
  title: string;
  body: string;
  sourceIds: Set<string>;
  annotationIds: Set<string>;
  codeIds: Set<string>;
  objectIds: Set<string>;
};

function createEmptyDraft(): MemoEditorDraft {
  return {
    memoId: null,
    title: "",
    body: "",
    sourceIds: new Set(),
    annotationIds: new Set(),
    codeIds: new Set(),
    objectIds: new Set(),
  };
}

function draftFromMemo(memo: PostgresExperimentMemo): MemoEditorDraft {
  return {
    memoId: memo.id,
    title: memo.title,
    body: memo.body,
    sourceIds: new Set(memo.sourceIds),
    annotationIds: new Set(memo.annotationIds),
    codeIds: new Set(memo.codeIds),
    objectIds: new Set(memo.objectIds),
  };
}

function toggleInSet(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function PostgresMemosView({
  projectId,
  canManageMemos,
  initialSourceIds,
  initialAnnotationIds,
  initialCodeIds,
  onInitialDraftHandled,
}: {
  projectId: string;
  canManageMemos: boolean;
  initialSourceIds?: string[] | null;
  initialAnnotationIds?: string[] | null;
  initialCodeIds?: string[] | null;
  onInitialDraftHandled?: () => void;
}) {
  const [memos, setMemos] = useState<PostgresExperimentMemo[]>([]);
  const [sources, setSources] = useState<PostgresExperimentSource[]>([]);
  const [codes, setCodes] = useState<PostgresExperimentCode[]>([]);
  const [annotations, setAnnotations] = useState<PostgresExperimentAnnotationSummary[]>([]);
  const [objects, setObjects] = useState<PostgresExperimentObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<MemoEditorDraft | null>(null);
  const [deleteMemoId, setDeleteMemoId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapshot, memoRows] = await Promise.all([
        loadPostgresProjectWorkspaceSnapshot(projectId),
        listPostgresExperimentMemos(projectId),
      ]);
      setSources(snapshot.sources);
      setCodes(snapshot.codes);
      setAnnotations(snapshot.annotations);
      setObjects(snapshot.objects);
      setMemos(memoRows);
      setSelectedMemoId((current) => {
        if (current && memoRows.some((memo) => memo.id === current)) return current;
        return memoRows[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load memos.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManageMemos) return;
    if (
      (!initialSourceIds || initialSourceIds.length === 0)
      && (!initialAnnotationIds || initialAnnotationIds.length === 0)
      && (!initialCodeIds || initialCodeIds.length === 0)
    ) return;
    setError(null);
    setNotice(null);
    setEditorDraft((current) => {
      if (current) return current;
      return {
        ...createEmptyDraft(),
        sourceIds: new Set(initialSourceIds ?? []),
        annotationIds: new Set(initialAnnotationIds ?? []),
        codeIds: new Set(initialCodeIds ?? []),
      };
    });
    onInitialDraftHandled?.();
  }, [canManageMemos, initialAnnotationIds, initialCodeIds, initialSourceIds, onInitialDraftHandled]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function subscribe() {
      unlisten = await listen<PostgresExperimentProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
        if (disposed) return;
        if (event.payload.projectId !== projectId) return;
        if (!["memo", "source", "annotation", "code", "object"].includes(event.payload.entityType)) return;
        void load();
      });
    }

    void subscribe();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [load, projectId]);

  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );
  const codeById = useMemo(
    () => new Map(codes.map((code) => [code.id, code])),
    [codes],
  );
  const objectById = useMemo(
    () => new Map(objects.map((object) => [object.id, object])),
    [objects],
  );
  const annotationById = useMemo(
    () => new Map(annotations.map((annotation) => [annotation.id, annotation])),
    [annotations],
  );

  const selectedMemo = memos.find((memo) => memo.id === selectedMemoId) ?? null;

  async function handleSaveMemo() {
    if (!editorDraft) return;
    const title = editorDraft.title.trim();
    if (!title) {
      setError("Enter a memo title.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        projectId,
        title,
        body: editorDraft.body,
        sourceIds: [...editorDraft.sourceIds],
        annotationIds: [...editorDraft.annotationIds],
        codeIds: [...editorDraft.codeIds],
        objectIds: [...editorDraft.objectIds],
      };
      const saved = editorDraft.memoId
        ? await updatePostgresExperimentMemo({
            ...payload,
            memoId: editorDraft.memoId,
          })
        : await createPostgresExperimentMemo(payload);
      setEditorDraft(null);
      setSelectedMemoId(saved.id);
      setNotice(editorDraft.memoId ? `Updated "${saved.title}".` : `Created "${saved.title}".`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save memo.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteMemo() {
    if (!deleteMemoId) return;
    const memo = memos.find((entry) => entry.id === deleteMemoId);
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await deletePostgresExperimentMemo(projectId, deleteMemoId);
      setDeleteMemoId(null);
      setSelectedMemoId((current) => (current === deleteMemoId ? null : current));
      setNotice(memo ? `Deleted "${memo.title}".` : "Deleted memo.");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete memo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Memos</h1>
          <p className="view-subtitle">
            PostgreSQL memos can now connect sources, annotations, codes, and objects in the same project workspace.
          </p>
        </div>
        {canManageMemos ? (
          <div className="view-header-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setError(null);
                setNotice(null);
                setEditorDraft(createEmptyDraft());
              }}
            >
              New memo
            </button>
          </div>
        ) : null}
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 440px) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        <section className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th className="users-th">Title</th>
                <th className="users-th">Links</th>
                <th className="users-th">Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="users-td" colSpan={3}>Loading memos...</td>
                </tr>
              ) : memos.length === 0 ? (
                <tr>
                  <td className="users-td" colSpan={3}>No PostgreSQL memos yet.</td>
                </tr>
              ) : (
                memos.map((memo) => {
                  const isSelected = memo.id === selectedMemoId;
                  const linkCount = memo.sourceIds.length + memo.annotationIds.length + memo.codeIds.length + memo.objectIds.length;
                  return (
                    <tr
                      key={memo.id}
                      className="users-row"
                      onClick={() => setSelectedMemoId(memo.id)}
                      style={{ cursor: "pointer", background: isSelected ? "rgba(53, 80, 112, 0.08)" : undefined }}
                    >
                      <td className="users-td">
                        <strong>{memo.title}</strong>
                        <div style={{ color: "var(--text-secondary, #667085)", fontSize: 13, marginTop: 4 }}>
                          {excerpt(memo.body, 90)}
                        </div>
                      </td>
                      <td className="users-td">{linkCount}</td>
                      <td className="users-td">{formatMemoDate(memo.updatedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        <section className="case-card">
          {selectedMemo ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div>
                  <h2 style={{ marginTop: 0 }}>{selectedMemo.title}</h2>
                  <p style={{ marginTop: 0, color: "var(--text-secondary, #667085)" }}>
                    {selectedMemo.createdByName || "Unknown author"} · {formatMemoDate(selectedMemo.createdAt)}
                  </p>
                </div>
                {canManageMemos ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn" onClick={() => setEditorDraft(draftFromMemo(selectedMemo))}>
                      Edit
                    </button>
                    <button type="button" className="btn btn--danger" onClick={() => setDeleteMemoId(selectedMemo.id)}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>

              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, marginBottom: 20 }}>
                {selectedMemo.body.trim() || "No memo text yet."}
              </div>

              <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 20 }}>
                <div>
                  <h3>Sources</h3>
                  {selectedMemo.sourceIds.length === 0 ? <p className="case-card-empty">No linked sources.</p> : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {selectedMemo.sourceIds.map((sourceId) => (
                        <li key={sourceId}>{sourceById.get(sourceId)?.title ?? sourceId}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3>Objects</h3>
                  {selectedMemo.objectIds.length === 0 ? <p className="case-card-empty">No linked objects.</p> : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {selectedMemo.objectIds.map((objectId) => (
                        <li key={objectId}>{objectById.get(objectId)?.title ?? objectId}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3>Codes</h3>
                  {selectedMemo.codeIds.length === 0 ? <p className="case-card-empty">No linked codes.</p> : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {selectedMemo.codeIds.map((codeId) => (
                        <li key={codeId}>{codeById.get(codeId)?.label ?? codeId}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3>Annotations</h3>
                  {selectedMemo.annotationIds.length === 0 ? <p className="case-card-empty">No linked annotations.</p> : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {selectedMemo.annotationIds.map((annotationId) => {
                        const annotation = annotationById.get(annotationId);
                        return (
                          <li key={annotationId}>
                            {annotation
                              ? `${sourceById.get(annotation.sourceId)?.title ?? "Source"}: ${excerpt(annotation.quote, 80)}`
                              : annotationId}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="case-card-empty">Select a memo to inspect it.</p>
          )}
        </section>
      </div>

      {editorDraft ? (
        <div className="modal-overlay" onClick={() => !submitting && setEditorDraft(null)}>
          <div className="modal" style={{ width: "min(1100px, 92vw)", maxHeight: "90vh", overflow: "auto" }} onClick={(event) => event.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>{editorDraft.memoId ? "Edit Memo" : "New Memo"}</h2>
            <div className="form-grid" style={{ gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
              <div style={{ display: "grid", gap: 16 }}>
                <label className="form-field">
                  <span>Title</span>
                  <input
                    value={editorDraft.title}
                    onChange={(event) => setEditorDraft((current) => current ? { ...current, title: event.target.value } : current)}
                    placeholder="Memo title"
                  />
                </label>
                <label className="form-field">
                  <span>Memo text</span>
                  <textarea
                    value={editorDraft.body}
                    onChange={(event) => setEditorDraft((current) => current ? { ...current, body: event.target.value } : current)}
                    rows={16}
                    placeholder="Write your analytic memo here..."
                  />
                </label>
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                <div className="case-card" style={{ padding: 16 }}>
                  <h3 style={{ marginTop: 0 }}>Sources</h3>
                  <div style={{ display: "grid", gap: 8, maxHeight: 150, overflow: "auto" }}>
                    {sources.map((source) => (
                      <label key={source.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={editorDraft.sourceIds.has(source.id)}
                          onChange={() => setEditorDraft((current) => current ? { ...current, sourceIds: toggleInSet(current.sourceIds, source.id) } : current)}
                        />
                        <span>{source.title}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="case-card" style={{ padding: 16 }}>
                  <h3 style={{ marginTop: 0 }}>Objects</h3>
                  <div style={{ display: "grid", gap: 8, maxHeight: 150, overflow: "auto" }}>
                    {objects.map((object) => (
                      <label key={object.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={editorDraft.objectIds.has(object.id)}
                          onChange={() => setEditorDraft((current) => current ? { ...current, objectIds: toggleInSet(current.objectIds, object.id) } : current)}
                        />
                        <span>{object.title}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="case-card" style={{ padding: 16 }}>
                  <h3 style={{ marginTop: 0 }}>Codes</h3>
                  <div style={{ display: "grid", gap: 8, maxHeight: 150, overflow: "auto" }}>
                    {codes.map((code) => (
                      <label key={code.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={editorDraft.codeIds.has(code.id)}
                          onChange={() => setEditorDraft((current) => current ? { ...current, codeIds: toggleInSet(current.codeIds, code.id) } : current)}
                        />
                        <span>{code.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="case-card" style={{ padding: 16 }}>
                  <h3 style={{ marginTop: 0 }}>Annotations</h3>
                  <div style={{ display: "grid", gap: 8, maxHeight: 180, overflow: "auto" }}>
                    {annotations.map((annotation) => (
                      <label key={annotation.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={editorDraft.annotationIds.has(annotation.id)}
                          onChange={() => setEditorDraft((current) => current ? { ...current, annotationIds: toggleInSet(current.annotationIds, annotation.id) } : current)}
                        />
                        <span>
                          <strong>{sourceById.get(annotation.sourceId)?.title ?? "Source"}</strong>
                          <span style={{ display: "block", color: "var(--text-secondary, #667085)" }}>
                            {excerpt(annotation.quote, 90)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn" onClick={() => setEditorDraft(null)} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void handleSaveMemo()} disabled={submitting}>
                {submitting ? "Saving..." : "Save memo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteMemoId ? (
        <div className="modal-overlay" onClick={() => !submitting && setDeleteMemoId(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Delete Memo</h2>
            <p>This will permanently remove the memo and its source, annotation, code, and object links.</p>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setDeleteMemoId(null)} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="btn btn--danger" onClick={() => void handleDeleteMemo()} disabled={submitting}>
                {submitting ? "Deleting..." : "Delete memo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
