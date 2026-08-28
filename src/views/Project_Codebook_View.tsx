import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { HelpIcon, PlusIcon } from "../components/AppIcons";
import { NewCodeModal, type CodeRow } from "../components/NewCodeModal";
import { SettingsModal } from "../components/SettingsModal";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";
import {
  createPostgresCode,
  deletePostgresCode,
  type PostgresAnnotationSummary,
  type PostgresSource,
  updatePostgresCode,
} from "../lib/postgres";

let codebookPdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadCodebookPdfJs() {
  if (!codebookPdfJsPromise) {
    codebookPdfJsPromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
      return module;
    });
  }
  return codebookPdfJsPromise;
}

// Types

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
  sourceKind?: string;
  sourcePath?: string;
  imageRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
    pageNumber?: number | null;
  } | null;
  timeStartMs?: number | null;
  timeEndMs?: number | null;
  createdByName: string;
  createdAt: string;
}

type SortCol = "label" | "color" | "createdByName" | "createdAt" | "sourcesCount";
type SortDir = "asc" | "desc";

// Helpers

function fmtDate(iso: string): string {
  if (!iso) return "-";
  try {
    return formatCurrentDateTime(iso, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

// Color utilities

function isAbsoluteStoragePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function resolveProjectStoragePath(projectStoragePath: string | undefined, sourceStoragePath: string | undefined): string {
  const trimmedSourcePath = (sourceStoragePath ?? "").trim();
  if (!trimmedSourcePath) return "";
  if (isAbsoluteStoragePath(trimmedSourcePath)) return trimmedSourcePath;
  const trimmedProjectPath = (projectStoragePath ?? "").trim().replace(/[\\/]+$/, "");
  if (!trimmedProjectPath) return trimmedSourcePath;
  const normalizedSourcePath = trimmedSourcePath.replace(/^([\\/])+/, "");
  return `${trimmedProjectPath}\\${normalizedSourcePath.replace(/\//g, "\\")}`;
}

function fileExtensionFromPath(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function mediaTypeFromFileExtension(ext: string): string | null {
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a" || ext === "aac") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "flac") return "audio/flac";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "ogv") return "video/ogg";
  if (ext === "mov") return "video/quicktime";
  return null;
}

function CodebookAnnotationMediaPreview({
  annotation,
  projectStoragePath,
}: {
  annotation: AnnotationRow;
  projectStoragePath?: string;
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const resolvedPath = resolveProjectStoragePath(projectStoragePath, annotation.sourcePath);
  const sourceKind = annotation.sourceKind ?? "";
  const mediaType = mediaTypeFromFileExtension(fileExtensionFromPath(annotation.sourcePath ?? ""));
  const region = annotation.imageRegion;
  const startMs = annotation.timeStartMs ?? null;
  const endMs = annotation.timeEndMs ?? null;

  useEffect(() => {
    if (!resolvedPath || !["audio", "video", "image", "pdf"].includes(sourceKind)) {
      setMediaUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setLoadError(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoadError(null);

    async function buildPreviewUrl(bytes: Uint8Array): Promise<string> {
      if (sourceKind !== "pdf") {
        return URL.createObjectURL(new Blob([bytes], { type: mediaType ?? undefined }));
      }
      if (!region) throw new Error("No PDF region is available for this annotation.");
      const pdfjsLib = await loadCodebookPdfJs();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const safePage = Math.min(Math.max(region.pageNumber ?? 1, 1), pdf.numPages);
      const page = await pdf.getPage(safePage);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare the PDF page preview.");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error("Could not render the PDF page preview."));
        }, "image/png");
      });
      return URL.createObjectURL(blob);
    }

    void readTauriFile(resolvedPath)
      .then(async (bytes) => {
        objectUrl = await buildPreviewUrl(bytes);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setMediaUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setMediaUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
        setLoadError(error instanceof Error ? error.message : "Could not load annotation media.");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaType, region, resolvedPath, sourceKind]);

  if (!["audio", "video", "image", "pdf"].includes(sourceKind)) return null;
  if (loadError) return <p className="code-ann-media-error">{loadError}</p>;
  if (!mediaUrl) return <p className="code-ann-media-loading">Loading media...</p>;

  function handleLoadedMetadata() {
    if (!mediaRef.current || startMs == null) return;
    mediaRef.current.currentTime = Math.max(0, startMs / 1000);
  }

  function handleTimeUpdate() {
    if (!mediaRef.current || endMs == null) return;
    if (mediaRef.current.currentTime >= Math.max(0, endMs / 1000)) {
      mediaRef.current.pause();
    }
  }

  if (sourceKind === "audio") {
    return (
      <div className="code-ann-media" onClick={(event) => event.stopPropagation()}>
        <audio
          ref={(element) => { mediaRef.current = element; }}
          controls
          preload="metadata"
          src={mediaUrl}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
        />
      </div>
    );
  }

  if (sourceKind === "video") {
    return (
      <div className="code-ann-media" onClick={(event) => event.stopPropagation()}>
        <video
          ref={(element) => { mediaRef.current = element; }}
          className="code-ann-video"
          controls
          preload="metadata"
          playsInline
          src={mediaUrl}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
        />
      </div>
    );
  }

  if ((sourceKind === "image" || sourceKind === "pdf") && region) {
    const safeRegionWidth = Math.max(region.width, 1);
    const safeRegionHeight = Math.max(region.height, 1);
    const safeImageWidth = Math.max(region.imageWidth, safeRegionWidth);
    const safeImageHeight = Math.max(region.imageHeight, safeRegionHeight);
    return (
      <div className="code-ann-media" onClick={(event) => event.stopPropagation()}>
        <div
          className="code-ann-image-crop"
          style={{ aspectRatio: `${safeRegionWidth} / ${safeRegionHeight}` }}
        >
          <img
            src={mediaUrl}
            alt="Coded annotation region"
            style={{
              width: `${(safeImageWidth / safeRegionWidth) * 100}%`,
              height: `${(safeImageHeight / safeRegionHeight) * 100}%`,
              transform: `translate(-${(Math.max(region.x, 0) / safeImageWidth) * 100}%, -${(Math.max(region.y, 0) / safeImageHeight) * 100}%)`,
            }}
          />
        </div>
      </div>
    );
  }

  return null;
}

// Tree helpers

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

// Column definitions

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "label",         label: "Name",       width: "22rem" },
  { key: "createdByName", label: "Created By", width: "9rem" },
  { key: "createdAt",     label: "Created",    width: "10rem" },
  { key: "sourcesCount",  label: "Sources",    width: "5rem" },
];

// Color swatch

function ColorSwatch({ color, size }: { color: string; size?: number }) {
  return (
    <span
      className="code-swatch"
      style={{ background: color || "#ccc", ...(size ? { width: size, height: size } : {}) }}
      title={color}
    />
  );
}

// Main view

export type CodebookViewProps = {
  postgresProjectId?: string | null;
  postgresProjectStoragePath?: string;
  postgresCanCreateCodes?: boolean;
  postgresCanEditCodes?: boolean;
  postgresCanDeleteCodes?: boolean;
  postgresCanMemoAboutCodes?: boolean;
  onOpenPostgresSourceAnnotation?: (payload: { sourceId: string; annotationId: string }) => void;
  onOpenPostgresMemoForCode?: (payload: { codeId: string }) => void;
};

export function CodebookView({
  postgresProjectId,
  postgresProjectStoragePath,
  postgresCanCreateCodes,
  postgresCanEditCodes,
  postgresCanDeleteCodes,
  postgresCanMemoAboutCodes,
  onOpenPostgresSourceAnnotation,
  onOpenPostgresMemoForCode,
}: CodebookViewProps = {}) {
  const { t } = useI18n();
  const activeProjectId = postgresProjectId ?? null;
  const canCreateCodes = !!postgresCanCreateCodes;
  const canEditCodes = !!postgresCanEditCodes;
  const canDeleteCodes = !!postgresCanDeleteCodes;
  const canMemoAboutCodes = !!postgresCanMemoAboutCodes;

  const [rows,    setRows]    = useState<CodeRow[]>([]);
  const [postgresSources, setPostgresSources] = useState<PostgresSource[]>([]);
  const [postgresAnnotations, setPostgresAnnotations] = useState<PostgresAnnotationSummary[]>([]);
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
  const localizedCols = [
    { ...COLS[0], label: t("projectCodebook.table.name") },
    { ...COLS[1], label: t("projectCodebook.table.createdBy") },
    { ...COLS[2], label: t("projectCodebook.table.created") },
    { ...COLS[3], label: "Sources" },
  ];

  // Load

  const loadCodes = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    setError(null);
    try {
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
          createdByName: code.createdByName || "-",
          createdAt: code.createdAt,
          sourcesCount: docsByCode[code.id]?.size ?? 0,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projectCodebook.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, t]);

  useEffect(() => { loadCodes(); }, [loadCodes]);

  // Close context menu on outside click / Escape

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

  // Tree + visible rows

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

  // Delete

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      if (!activeProjectId) throw new Error("Project is required to delete a code.");
      await deletePostgresCode(activeProjectId, confirmDelete.id);
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
        await updatePostgresCode({
          projectId: activeProjectId,
          codeId: editingRow.id,
          label: payload.label,
          color: payload.color,
          description: payload.description,
          parentCodeId: payload.parentId ?? "",
          shortcut: "",
        });
      } else {
        await createPostgresCode({
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

  // Detail / edit

  const postgresSourceNameById = useMemo(
    () => Object.fromEntries(postgresSources.map((source) => [source.id, source.title])),
    [postgresSources],
  );
  const postgresSourceById = useMemo(
    () => new Map(postgresSources.map((source) => [source.id, source])),
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
        documentName: postgresSourceNameById[annotation.sourceId] ?? "-",
        documentId: annotation.sourceId,
        createdByName: annotation.createdByName || "-",
        createdAt: annotation.createdAt,
      }));
  }, [postgresAnnotations, postgresSourceNameById, selectedRow]);

  const postgresDetailAnnotationsWithMedia = useMemo(() => (
    postgresDetailAnnotations.map((row) => {
      const annotation = postgresAnnotations.find((item) => item.id === row.id);
      const source = annotation ? postgresSourceById.get(annotation.sourceId) : null;
      return {
        ...row,
        sourceKind: annotation?.sourceKind || source?.sourceKind,
        sourcePath: source?.storagePath,
        imageRegion: annotation?.imageRegion ?? null,
        timeStartMs: annotation?.timeStartMs ?? null,
        timeEndMs: annotation?.timeEndMs ?? null,
      };
    })
  ), [postgresAnnotations, postgresDetailAnnotations, postgresSourceById]);

  const detailRow = selectedRow ?? editStartRow;
  if (detailRow) {
    return (
      <>
        <PostgresCodeDetail
          row={detailRow}
          allCodes={rows}
          annotations={postgresDetailAnnotationsWithMedia}
          projectStoragePath={postgresProjectStoragePath}
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
          <SettingsModal
            title={t("projectCodebook.deleteModal.title")}
            onClose={() => setConfirmDelete(null)}
            closeDisabled={deleteLoading}
          >
            <div className="app-settings-modal-body">
              <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                {t("projectCodebook.deleteModal.body", { label: confirmDelete.label })}
              </p>
              <p className="modal-warning-text">
                {t("projectCodebook.deleteModal.warning")}
              </p>
            </div>
            <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>
                {t("common.cancel")}
              </button>
              <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
                {deleteLoading ? t("projectCodebook.statuses.deleting") : t("projectCodebook.actions.deleteCode")}
              </button>
            </div>
          </SettingsModal>
        )}
      </>
    );
  }
  // Render

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
      </header>

      {error && <p className="users-error">{error}</p>}
      <div className="users-content codebook-table-shell">
      <div className="home-project-card project-table-card codebook-table-card">
        <div className="project-table-card-header">
          <h2>{t("projectCodebook.pageTitle")}</h2>
          <button
            className="btn btn--primary project-table-header-icon-button"
            onClick={() => {
              setNewCodeParentId("");
              setSubmitError(null);
              setNewCodeOpen(true);
            }}
            disabled={!canCreateCodes}
            title={
              !canCreateCodes
                ? t("projectCodebook.permissions.cannotCreateCodes")
                : t("projectCodebook.actions.newCode")
            }
            aria-label={t("projectCodebook.actions.newCode")}
          >
            <PlusIcon className="project-table-header-icon" />
          </button>
        </div>
      <div
        className="users-table-wrap codebook-table-wrap"
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
                    {" "}
                    {sortCol === col.key ? (sortDir === "asc" ? "\u2191" : "\u2193") : "\u2195"}
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
                        {collapsed.has(node.id) ? "\u25b6" : "\u25bc"}
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
                <td className="users-td users-td--muted">{node.sourcesCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
      </div>

      {helpOpen && (
        <SettingsModal
          title={t("projectCodebook.help.title")}
          onClose={() => setHelpOpen(false)}
          modalClassName="modal--help"
        >
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("projectCodebook.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("projectCodebook.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("projectCodebook.help.line3")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
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
                onOpenPostgresMemoForCode?.({
                  codeId: contextMenu.row.id,
                });
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
                setEditingRow(contextMenu.row);
                setSubmitError(null);
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
        <SettingsModal
          title={t("projectCodebook.deleteModal.title")}
          onClose={() => setConfirmDelete(null)}
          closeDisabled={deleteLoading}
        >
          <div className="app-settings-modal-body">
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("projectCodebook.deleteModal.body", { label: confirmDelete.label })}
            </p>
            <p className="modal-warning-text">
              {t("projectCodebook.deleteModal.warning")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button className="btn" onClick={() => setConfirmDelete(null)} disabled={deleteLoading}>
              {t("common.cancel")}
            </button>
            <button className="btn btn--danger" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? t("projectCodebook.statuses.deleting") : t("projectCodebook.actions.deleteCode")}
            </button>
          </div>
        </SettingsModal>
      )}

      {/* New Code modal */}
      {newCodeOpen && activeProjectId && (
        <NewCodeModal
          allCodes={rows}
          initialParentId={newCodeParentId}
          onSubmit={handlePostgresCodeSave}
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
      {editingRow && activeProjectId && (
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
      {submitError && !editingRow && !newCodeOpen && (
        <p className="users-error" style={{ marginTop: 12 }}>{submitError}</p>
      )}
    </div>
  );
}

function PostgresCodeDetail({
  row: initialRow,
  allCodes,
  annotations,
  projectStoragePath,
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
  projectStoragePath?: string;
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
            <dt>{t("projectCodebook.detail.parent")}</dt> <dd>{row.parentLabel || "-"}</dd>
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
                {annotations.map((annotation) => {
                  const isMediaAnnotation = ["audio", "video", "image", "pdf"].includes(annotation.sourceKind ?? "");
                  return (
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
                      <CodebookAnnotationMediaPreview
                        annotation={annotation}
                        projectStoragePath={projectStoragePath}
                      />
                      {!isMediaAnnotation ? (
                        <>
                          <blockquote className="code-ann-quote">"{annotation.quote}"</blockquote>
                          {annotation.note && <p className="code-ann-note">{annotation.note}</p>}
                        </>
                      ) : null}
                      <div className="code-ann-meta">{fmtDate(annotation.createdAt)} · {annotation.createdByName}</div>
                    </li>
                  );
                })}
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



