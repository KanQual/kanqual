import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  POSTGRES_PROJECT_CHANGED_EVENT,
  createPostgresMemo,
  deletePostgresMemo,
  listPostgresMemos,
  type PostgresAnnotationSummary,
  type PostgresCode,
  type PostgresMemo,
  type PostgresProjectChangeEvent,
  type PostgresSource,
  updatePostgresMemo,
} from "../lib/postgres";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import { ArrowLeftIcon, HelpIcon, PlusIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { orderedCodesWithDepth } from "./Postgres_Source_Coding_Shared";

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
      return module;
    });
  }
  return pdfJsPromise;
}

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

function formatAnnotationDisplayId(value: number | null | undefined): string {
  return value == null ? "-" : `A${String(value).padStart(2, "0")}`;
}

function formatSourceType(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (!normalized) return "Source";
  if (normalized === "pdf") return "PDF";
  if (normalized === "processed transcript") return "Transcript";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatMediaMilliseconds(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const milliseconds = Math.max(0, Math.floor(value % 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
  return `${base}.${String(Math.floor(milliseconds / 100)).padStart(1, "0")}`;
}

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

function annotationTooltipContent(
  annotation: PostgresAnnotationSummary,
  labels: {
    annotatedText: string;
    audioClip: string;
    videoClip: string;
    pdfRegion: string;
    imageRegion: string;
    annotation: string;
    unavailable: string;
    pageRegion: (page: number, width: number, height: number) => string;
    region: (width: number, height: number) => string;
  },
): { title: string; body: string } {
  const quote = annotation.quote.trim();
  if (quote) {
    return {
      title: labels.annotatedText,
      body: quote,
    };
  }

  if (annotation.sourceKind === "audio" || annotation.sourceKind === "video") {
    const start = typeof annotation.timeStartMs === "number" ? formatMediaMilliseconds(annotation.timeStartMs) : "-";
    const end = typeof annotation.timeEndMs === "number" ? formatMediaMilliseconds(annotation.timeEndMs) : "-";
    return {
      title: annotation.sourceKind === "audio" ? labels.audioClip : labels.videoClip,
      body: `${start} - ${end}`,
    };
  }

  if ((annotation.sourceKind === "image" || annotation.sourceKind === "pdf") && annotation.imageRegion) {
    const region = annotation.imageRegion;
    return {
      title: annotation.sourceKind === "pdf" ? labels.pdfRegion : labels.imageRegion,
      body: annotation.sourceKind === "pdf"
        ? labels.pageRegion(region.pageNumber ?? 1, Math.round(region.width), Math.round(region.height))
        : labels.region(Math.round(region.width), Math.round(region.height)),
    };
  }

  return {
    title: labels.annotation,
    body: labels.unavailable,
  };
}

function MemoAnnotationMediaPreview({
  annotation,
  source,
  projectStoragePath,
}: {
  annotation: PostgresAnnotationSummary;
  source: PostgresSource | null;
  projectStoragePath?: string;
}) {
  const { t } = useI18n();
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const resolvedPath = resolveProjectStoragePath(projectStoragePath, source?.storagePath);
  const sourceKind = source?.sourceKind || annotation.sourceKind;
  const mediaType = mediaTypeFromFileExtension(fileExtensionFromPath(source?.storagePath ?? ""));
  const region = annotation.imageRegion;

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
      if (!region) throw new Error(t("analysisMemos.annotationPreview.pdfRegionUnavailable"));
      const pdfjsLib = await loadPdfJs();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const safePage = Math.min(Math.max(region.pageNumber ?? 1, 1), pdf.numPages);
      const page = await pdf.getPage(safePage);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("analysisMemos.annotationPreview.pdfPreviewPrepareFailed"));
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error(t("analysisMemos.annotationPreview.pdfPreviewRenderFailed")));
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
        setLoadError(error instanceof Error ? error.message : t("analysisMemos.annotationPreview.mediaLoadFailed"));
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaType, region, resolvedPath, sourceKind, t]);

  if (!["audio", "video", "image", "pdf"].includes(sourceKind)) return null;
  if (loadError) return <p className="postgres-memo-annotation-tooltip-error">{loadError}</p>;
  if (!mediaUrl) return <p className="postgres-memo-annotation-tooltip-loading">{t("analysisMemos.annotationPreview.loadingMedia")}</p>;

  if (sourceKind === "audio") {
    return (
      <audio
        className="postgres-memo-annotation-tooltip-audio"
        controls
        preload="metadata"
        src={mediaUrl}
      />
    );
  }

  if (sourceKind === "video") {
    return (
      <video
        className="postgres-memo-annotation-tooltip-video"
        controls
        preload="metadata"
        playsInline
        src={mediaUrl}
      />
    );
  }

  if ((sourceKind === "image" || sourceKind === "pdf") && region) {
    const safeRegionWidth = Math.max(region.width, 1);
    const safeRegionHeight = Math.max(region.height, 1);
    const safeImageWidth = Math.max(region.imageWidth, safeRegionWidth);
    const safeImageHeight = Math.max(region.imageHeight, safeRegionHeight);
    return (
      <div
        className="postgres-memo-annotation-tooltip-image"
        style={{ aspectRatio: `${safeRegionWidth} / ${safeRegionHeight}` }}
      >
        <img
          src={mediaUrl}
          alt={t("analysisMemos.annotationPreview.annotationRegionAlt")}
          style={{
            width: `${(safeImageWidth / safeRegionWidth) * 100}%`,
            height: `${(safeImageHeight / safeRegionHeight) * 100}%`,
            transform: `translate(-${(Math.max(region.x, 0) / safeImageWidth) * 100}%, -${(Math.max(region.y, 0) / safeImageHeight) * 100}%)`,
          }}
        />
      </div>
    );
  }

  return null;
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

function draftFromMemo(memo: PostgresMemo): MemoEditorDraft {
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

const MEMO_RTE_TOOLS: { cmd: string; label: string; title: string }[] = [
  { cmd: "bold", label: "B", title: "Bold" },
  { cmd: "italic", label: "I", title: "Italic" },
  { cmd: "underline", label: "U", title: "Underline" },
  { cmd: "insertUnorderedList", label: "*", title: "Bullet list" },
  { cmd: "insertOrderedList", label: "1.", title: "Numbered list" },
];

function MemoRichTextEditor({
  initialHtml,
  onChange,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const loadedInitialHtmlRef = useRef(false);

  useEffect(() => {
    if (!loadedInitialHtmlRef.current && editorRef.current) {
      editorRef.current.innerHTML = initialHtml;
      loadedInitialHtmlRef.current = true;
    }
  }, [initialHtml]);

  function runCommand(command: string) {
    editorRef.current?.focus();
    document.execCommand(command, false);
    onChange(editorRef.current?.innerHTML ?? "");
  }

  return (
    <div className="rte rte--grow postgres-memo-rte">
      <div className="rte-toolbar">
        {MEMO_RTE_TOOLS.map((tool) => (
          <button
            key={tool.cmd}
            type="button"
            className="rte-btn"
            title={tool.title}
            onMouseDown={(event) => {
              event.preventDefault();
              runCommand(tool.cmd);
            }}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        className="rte-content"
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(editorRef.current?.innerHTML ?? "")}
      />
    </div>
  );
}

export function PostgresMemosView({
  projectId,
  projectStoragePath,
  canManageMemos,
  initialSourceIds,
  initialAnnotationIds,
  initialCodeIds,
  onInitialDraftHandled,
}: {
  projectId: string;
  projectStoragePath?: string;
  canManageMemos: boolean;
  initialSourceIds?: string[] | null;
  initialAnnotationIds?: string[] | null;
  initialCodeIds?: string[] | null;
  onInitialDraftHandled?: () => void;
}) {
  const { t } = useI18n();
  const [memos, setMemos] = useState<PostgresMemo[]>([]);
  const [sources, setSources] = useState<PostgresSource[]>([]);
  const [codes, setCodes] = useState<PostgresCode[]>([]);
  const [annotations, setAnnotations] = useState<PostgresAnnotationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [editorDraft, setEditorDraft] = useState<MemoEditorDraft | null>(null);
  const [collapsedSelectorCards, setCollapsedSelectorCards] = useState<Set<"codes" | "sources" | "annotations">>(new Set());
  const [annotationTooltip, setAnnotationTooltip] = useState<{ annotationId: string; x: number; y: number } | null>(null);
  const annotationTooltipHideTimerRef = useRef<number | null>(null);
  const [deleteMemoId, setDeleteMemoId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [snapshot, memoRows] = await Promise.all([
        loadPostgresProjectWorkspaceSnapshot(projectId),
        listPostgresMemos(projectId),
      ]);
      setSources(snapshot.sources);
      setCodes(snapshot.codes);
      setAnnotations(snapshot.annotations);
      setMemos(memoRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("analysisMemos.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (annotationTooltipHideTimerRef.current != null) {
        window.clearTimeout(annotationTooltipHideTimerRef.current);
      }
    };
  }, []);

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
      unlisten = await listen<PostgresProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
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
  const annotationById = useMemo(
    () => new Map(annotations.map((annotation) => [annotation.id, annotation])),
    [annotations],
  );

  const codeTree = useMemo(() => orderedCodesWithDepth(codes), [codes]);
  const draftSources = editorDraft ? sources.filter((source) => editorDraft.sourceIds.has(source.id)) : [];
  const draftCodes = editorDraft ? codes.filter((code) => editorDraft.codeIds.has(code.id)) : [];
  const draftAnnotations = editorDraft ? annotations.filter((annotation) => editorDraft.annotationIds.has(annotation.id)) : [];

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
        ? await updatePostgresMemo({
            ...payload,
            memoId: editorDraft.memoId,
          })
        : await createPostgresMemo(payload);
      setEditorDraft(null);
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
      await deletePostgresMemo(projectId, deleteMemoId);
      setDeleteMemoId(null);
      setNotice(memo ? `Deleted "${memo.title}".` : "Deleted memo.");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete memo.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleSelectorCard(card: "codes" | "sources" | "annotations") {
    setCollapsedSelectorCards((current) => {
      const next = new Set(current);
      if (next.has(card)) next.delete(card);
      else next.add(card);
      return next;
    });
  }

  function showAnnotationTooltip(annotationId: string, anchorElement: HTMLElement) {
    if (annotationTooltipHideTimerRef.current != null) {
      window.clearTimeout(annotationTooltipHideTimerRef.current);
      annotationTooltipHideTimerRef.current = null;
    }
    const tableElement = anchorElement.closest(".postgres-memo-annotation-table") as HTMLElement | null;
    const anchorRect = (tableElement ?? anchorElement).getBoundingClientRect();
    const rowRect = anchorElement.getBoundingClientRect();
    const tooltipWidth = 360;
    const tooltipMaxHeight = 320;
    setAnnotationTooltip({
      annotationId,
      x: Math.max(16, Math.min(anchorRect.right + 12, window.innerWidth - tooltipWidth - 16)),
      y: Math.max(16, Math.min(rowRect.top, window.innerHeight - tooltipMaxHeight - 16)),
    });
  }

  function scheduleHideAnnotationTooltip() {
    if (annotationTooltipHideTimerRef.current != null) {
      window.clearTimeout(annotationTooltipHideTimerRef.current);
    }
    annotationTooltipHideTimerRef.current = window.setTimeout(() => {
      setAnnotationTooltip(null);
      annotationTooltipHideTimerRef.current = null;
    }, 1000);
  }

  function removeDraftAffiliation(kind: "codeIds" | "sourceIds" | "annotationIds", id: string) {
    setEditorDraft((current) => {
      if (!current) return current;
      const nextIds = new Set(current[kind]);
      nextIds.delete(id);
      return { ...current, [kind]: nextIds };
    });
  }

  if (editorDraft) {
    const codesOpen = !collapsedSelectorCards.has("codes");
    const sourcesOpen = !collapsedSelectorCards.has("sources");
    const annotationsOpen = !collapsedSelectorCards.has("annotations");
    const hoveredAnnotation = annotationTooltip ? annotationById.get(annotationTooltip.annotationId) : null;
    const hoveredAnnotationSource = hoveredAnnotation ? sourceById.get(hoveredAnnotation.sourceId) : null;
    const hoveredAnnotationContent = hoveredAnnotation ? annotationTooltipContent(hoveredAnnotation, {
      annotatedText: t("analysisMemos.annotationPreview.annotatedText"),
      audioClip: t("analysisMemos.annotationPreview.audioClip"),
      videoClip: t("analysisMemos.annotationPreview.videoClip"),
      pdfRegion: t("analysisMemos.annotationPreview.pdfRegion"),
      imageRegion: t("analysisMemos.annotationPreview.imageRegion"),
      annotation: t("analysisMemos.annotationPreview.annotation"),
      unavailable: t("analysisMemos.annotationPreview.unavailable"),
      pageRegion: (page, width, height) => t("analysisMemos.annotationPreview.pageRegion", { page, width, height }),
      region: (width, height) => t("analysisMemos.annotationPreview.region", { width, height }),
    }) : null;

    return (
      <div className="view doc-detail-view postgres-memo-editor-view">
        <header className="view-header">
          <div className="users-title-wrap code-text-title-wrap">
            <button
              type="button"
              className="code-text-header-back-button"
              onClick={() => {
                if (submitting) return;
                setEditorDraft(null);
              }}
              disabled={submitting}
              title={t("analysisMemos.actions.backToMemosLower")}
              aria-label={t("analysisMemos.actions.backToMemosLower")}
            >
              <ArrowLeftIcon className="code-text-header-back-icon" />
            </button>
            <h1>{t("analysisMemos.editor.title")}</h1>
            <button
              type="button"
              className="users-help-icon-btn"
              onClick={() => setHelpOpen(true)}
              title={t("analysisMemos.editor.openHelp")}
              aria-label={t("analysisMemos.editor.openHelp")}
            >
              <HelpIcon className="users-help-icon" />
            </button>
          </div>
          <div className="view-header-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleSaveMemo()}
              disabled={submitting}
            >
              {submitting ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        {helpOpen ? (
          <SettingsModal title={t("analysisMemos.editor.helpTitle")} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
            <div className="app-settings-modal-body">
              <p className="users-guide-copy">
                {t("analysisMemos.editor.helpLine1")}
              </p>
              <p className="users-guide-copy">
                {t("analysisMemos.editor.helpLine2")}
              </p>
            </div>
            <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </button>
            </div>
          </SettingsModal>
        ) : null}

        <div className="annotate-layout code-text-annotate-layout postgres-memo-editor-layout">
          <div className="annotate-left postgres-memo-editor-left">
            <div className={`annotate-card postgres-memo-select-card${codesOpen ? "" : " postgres-memo-select-card--collapsed"}`}>
              <button
                type="button"
                className="annotate-card-header postgres-memo-select-header"
                aria-expanded={codesOpen}
                onClick={() => toggleSelectorCard("codes")}
              >
                <span className="annotate-card-title">{t("analysisMemos.table.codes")}{draftCodes.length > 0 ? ` (${draftCodes.length})` : ""}</span>
                <span className="postgres-memo-collapse-indicator">{codesOpen ? "▼" : "▶"}</span>
              </button>
              {codesOpen ? (
                <div className="postgres-memo-select-list">
                  {codes.length === 0 ? (
                    <p className="case-card-empty">{t("analysisMemos.empty.noCodesYet")}</p>
                  ) : (
                    codeTree.map(({ code, depth }) => (
                      <label
                        key={code.id}
                        className={`postgres-memo-select-row postgres-memo-select-row--code${editorDraft.codeIds.has(code.id) ? " postgres-memo-select-row--checked" : ""}`}
                        style={{ "--memo-code-depth": depth } as CSSProperties}
                      >
                        <input
                          type="checkbox"
                          className="memo-sel-checkbox"
                          checked={editorDraft.codeIds.has(code.id)}
                          onChange={() => setEditorDraft((current) => current ? { ...current, codeIds: toggleInSet(current.codeIds, code.id) } : current)}
                        />
                        <span className="code-swatch" style={{ background: code.color }} />
                        <span className="postgres-memo-select-text">{code.label}</span>
                      </label>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            <div className={`annotate-card postgres-memo-select-card${sourcesOpen ? "" : " postgres-memo-select-card--collapsed"}`}>
              <button
                type="button"
                className="annotate-card-header postgres-memo-select-header"
                aria-expanded={sourcesOpen}
                onClick={() => toggleSelectorCard("sources")}
              >
                <span className="annotate-card-title">{t("projectCore.sources.title")}{draftSources.length > 0 ? ` (${draftSources.length})` : ""}</span>
                <span className="postgres-memo-collapse-indicator">{sourcesOpen ? "▼" : "▶"}</span>
              </button>
              {sourcesOpen ? (
                <div className="postgres-memo-select-list postgres-memo-source-table">
                  {sources.length === 0 ? (
                    <p className="case-card-empty">{t("analysisMemos.empty.noSourcesYet")}</p>
                  ) : (
                    <>
                      <div className="postgres-memo-source-table-header">
                        <span />
                        <span>{t("analysisMemos.editor.sourceTitle")}</span>
                        <span>{t("analysisMemos.editor.type")}</span>
                      </div>
                      {sources.map((source) => (
                        <label
                          key={source.id}
                          className={`postgres-memo-select-row postgres-memo-source-table-row${editorDraft.sourceIds.has(source.id) ? " postgres-memo-select-row--checked" : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="memo-sel-checkbox"
                            checked={editorDraft.sourceIds.has(source.id)}
                            onChange={() => setEditorDraft((current) => current ? { ...current, sourceIds: toggleInSet(current.sourceIds, source.id) } : current)}
                          />
                          <span className="postgres-memo-source-title">{source.title}</span>
                          <span className="postgres-memo-source-type">{formatSourceType(source.sourceKind)}</span>
                        </label>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
            </div>

            <div className={`annotate-card postgres-memo-select-card${annotationsOpen ? "" : " postgres-memo-select-card--collapsed"}`}>
              <button
                type="button"
                className="annotate-card-header postgres-memo-select-header"
                aria-expanded={annotationsOpen}
                onClick={() => toggleSelectorCard("annotations")}
              >
                <span className="annotate-card-title">{t("analysisMemos.detail.annotations")}{draftAnnotations.length > 0 ? ` (${draftAnnotations.length})` : ""}</span>
                <span className="postgres-memo-collapse-indicator">{annotationsOpen ? "▼" : "▶"}</span>
              </button>
              {annotationsOpen ? (
                <div className="postgres-memo-select-list postgres-memo-annotation-table">
                  {annotations.length === 0 ? (
                    <p className="case-card-empty">{t("analysisMemos.empty.noAnnotationsYet")}</p>
                  ) : (
                    <>
                      <div className="postgres-memo-annotation-table-header">
                        <span />
                        <span>ID</span>
                        <span>{t("analysisMemos.editor.sourceFallback")}</span>
                        <span>{t("analysisMemos.editor.type")}</span>
                      </div>
                      {annotations.map((annotation) => {
                        const source = sourceById.get(annotation.sourceId);
                        return (
                          <label
                            key={annotation.id}
                            className={`postgres-memo-select-row postgres-memo-annotation-table-row${editorDraft.annotationIds.has(annotation.id) ? " postgres-memo-select-row--checked" : ""}`}
                            onMouseEnter={(event) => showAnnotationTooltip(annotation.id, event.currentTarget)}
                            onMouseLeave={scheduleHideAnnotationTooltip}
                            onFocus={(event) => showAnnotationTooltip(annotation.id, event.currentTarget)}
                            onBlur={scheduleHideAnnotationTooltip}
                          >
                            <input
                              type="checkbox"
                              className="memo-sel-checkbox"
                              checked={editorDraft.annotationIds.has(annotation.id)}
                              onChange={() => setEditorDraft((current) => current ? { ...current, annotationIds: toggleInSet(current.annotationIds, annotation.id) } : current)}
                            />
                            <span className="postgres-memo-annotation-id">{formatAnnotationDisplayId(annotation.displayId)}</span>
                            <span className="postgres-memo-annotation-source-title">{source?.title ?? t("analysisMemos.editor.sourceFallback")}</span>
                            <span className="postgres-memo-annotation-source-type">{formatSourceType(source?.sourceKind)}</span>
                          </label>
                        );
                      })}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="annotate-main postgres-memo-editor-main">
            <div className="annotate-card postgres-memo-title-card">
              <div className="annotate-card-header">
                <span className="annotate-card-title">{t("analysisMemos.editor.memoTitle")}</span>
              </div>
              <input
                className="memo-editor-title-input"
                value={editorDraft.title}
                onChange={(event) => setEditorDraft((current) => current ? { ...current, title: event.target.value } : current)}
                placeholder={t("analysisMemos.editor.memoTitle")}
              />
            </div>

            <div className="annotate-card postgres-memo-affiliations-card">
              <div className="annotate-card-header">
                <span className="annotate-card-title">{t("analysisMemos.editor.affiliations")}</span>
              </div>
              <div className="postgres-memo-affiliation-grid">
                <div>
                  <h3>{t("analysisMemos.table.codes")}</h3>
                  {draftCodes.length === 0 ? <p className="case-card-empty">{t("analysisMemos.editor.noLinkedCodes")}</p> : (
                    <div className="postgres-memo-chip-list">
                      {draftCodes.map((code) => (
                        <span key={code.id} className="postgres-memo-chip">
                          <button
                            type="button"
                            className="postgres-memo-chip-remove"
                            onClick={() => removeDraftAffiliation("codeIds", code.id)}
                            title={t("analysisMemos.editor.removeItem", { label: code.label })}
                            aria-label={t("analysisMemos.editor.removeItem", { label: code.label })}
                          >
                            x
                          </button>
                          <span className="code-swatch" style={{ background: code.color }} />
                          <span className="postgres-memo-chip-label">{code.label}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3>{t("projectCore.sources.title")}</h3>
                  {draftSources.length === 0 ? <p className="case-card-empty">{t("analysisMemos.editor.noLinkedSources")}</p> : (
                    <div className="postgres-memo-chip-list">
                      {draftSources.map((source) => (
                        <span key={source.id} className="postgres-memo-chip">
                          <button
                            type="button"
                            className="postgres-memo-chip-remove"
                            onClick={() => removeDraftAffiliation("sourceIds", source.id)}
                            title={t("analysisMemos.editor.removeItem", { label: source.title })}
                            aria-label={t("analysisMemos.editor.removeItem", { label: source.title })}
                          >
                            x
                          </button>
                          <span className="postgres-memo-chip-label">{source.title}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3>{t("analysisMemos.detail.annotations")}</h3>
                  {draftAnnotations.length === 0 ? <p className="case-card-empty">{t("analysisMemos.editor.noLinkedAnnotations")}</p> : (
                    <div className="postgres-memo-affiliation-list">
                      {draftAnnotations.map((annotation) => (
                        <span
                          key={annotation.id}
                          className="postgres-memo-chip"
                          onMouseEnter={(event) => showAnnotationTooltip(annotation.id, event.currentTarget)}
                          onMouseLeave={scheduleHideAnnotationTooltip}
                          onFocus={(event) => showAnnotationTooltip(annotation.id, event.currentTarget)}
                          onBlur={scheduleHideAnnotationTooltip}
                        >
                          <button
                            type="button"
                            className="postgres-memo-chip-remove"
                            onClick={() => removeDraftAffiliation("annotationIds", annotation.id)}
                            title={t("analysisMemos.editor.removeItem", { label: formatAnnotationDisplayId(annotation.displayId) })}
                            aria-label={t("analysisMemos.editor.removeItem", { label: formatAnnotationDisplayId(annotation.displayId) })}
                          >
                            x
                          </button>
                          <span className="postgres-memo-chip-label">{formatAnnotationDisplayId(annotation.displayId)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="annotate-card annotate-card--grow postgres-memo-body-card">
              <div className="annotate-card-header">
                <span className="annotate-card-title">{t("analysisMemos.editor.memoText")}</span>
              </div>
              <MemoRichTextEditor
                key={editorDraft.memoId ?? "new"}
                initialHtml={editorDraft.body}
                onChange={(body) => setEditorDraft((current) => current ? { ...current, body } : current)}
              />
            </div>
          </div>
        </div>
        {hoveredAnnotation && hoveredAnnotationContent ? (
          <div
            className="postgres-memo-annotation-tooltip"
            onMouseEnter={() => {
              if (annotationTooltipHideTimerRef.current != null) {
                window.clearTimeout(annotationTooltipHideTimerRef.current);
                annotationTooltipHideTimerRef.current = null;
              }
            }}
            onMouseLeave={scheduleHideAnnotationTooltip}
            style={{
              left: annotationTooltip?.x ?? 16,
              top: annotationTooltip?.y ?? 16,
            }}
          >
            <div className="postgres-memo-annotation-tooltip-header">
              <strong>{formatAnnotationDisplayId(hoveredAnnotation.displayId)}</strong>
              <span>{hoveredAnnotationSource?.title ?? t("analysisMemos.editor.sourceFallback")} | {formatSourceType(hoveredAnnotationSource?.sourceKind ?? hoveredAnnotation.sourceKind)}</span>
            </div>
            <div className="postgres-memo-annotation-tooltip-card">
              <span className="postgres-memo-annotation-tooltip-label">{hoveredAnnotationContent.title}</span>
              <MemoAnnotationMediaPreview
                annotation={hoveredAnnotation}
                source={hoveredAnnotationSource ?? null}
                projectStoragePath={projectStoragePath}
              />
              <p>{hoveredAnnotationContent.body}</p>
            </div>
            {hoveredAnnotation.note.trim() ? (
              <div className="postgres-memo-annotation-tooltip-note">
                <span className="postgres-memo-annotation-tooltip-label">{t("analysisMemos.editor.note")}</span>
                <p>{hoveredAnnotation.note}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("analysisMemos.pageTitle")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("analysisMemos.showHelp")}
            aria-label={t("analysisMemos.showHelp")}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen ? (
        <SettingsModal title={t("analysisMemos.help.title")} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("analysisMemos.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("analysisMemos.help.line3")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}

      <div className="postgres-memo-table-shell">
        <section className="home-project-card project-table-card postgres-memo-table-card">
          <div className="project-table-card-header">
            <h2>{t("analysisMemos.pageTitle")}</h2>
            {canManageMemos ? (
              <button
                type="button"
                className="btn btn--primary project-table-header-icon-button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setEditorDraft(createEmptyDraft());
                }}
                title={t("analysisMemos.actions.newMemoShort")}
                aria-label={t("analysisMemos.actions.newMemoShort")}
              >
                <PlusIcon className="project-table-header-icon" />
              </button>
            ) : null}
          </div>
        <div className="users-table-wrap postgres-memo-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th className="users-th">{t("analysisMemos.editor.memoTitle")}</th>
                <th className="users-th">{t("analysisMemos.editor.affiliations")}</th>
                <th className="users-th">{t("reportsLanding.saved")}</th>
                <th className="users-th">{t("reportsLanding.createdBy")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="users-td" colSpan={4}>{t("analysisMemos.empty.loadingMemos")}</td>
                </tr>
              ) : memos.length === 0 ? (
                <tr>
                  <td className="users-td-msg" colSpan={4}>{t("analysisMemos.empty.noMemos")}</td>
                </tr>
              ) : (
                memos.map((memo) => {
                  const affiliationCount = memo.sourceIds.length + memo.annotationIds.length + memo.codeIds.length + memo.objectIds.length;
                  return (
                    <tr
                      key={memo.id}
                      className="users-row"
                      onClick={() => {
                        if (canManageMemos) setEditorDraft(draftFromMemo(memo));
                      }}
                      style={{ cursor: canManageMemos ? "pointer" : undefined }}
                    >
                      <td className="users-td">
                        <strong>{memo.title}</strong>
                      </td>
                      <td className="users-td">{affiliationCount}</td>
                      <td className="users-td">{formatMemoDate(memo.updatedAt)}</td>
                      <td className="users-td">{memo.createdByName || t("analysisMemos.editor.unknownAuthor")}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        </section>
      </div>

      {deleteMemoId ? (
        <SettingsModal title={t("analysisMemos.deleteModal.title")} onClose={() => setDeleteMemoId(null)} closeDisabled={submitting}>
          <div className="app-settings-modal-body">
            <p>{t("analysisMemos.deleteModal.warning")}</p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn" onClick={() => setDeleteMemoId(null)} disabled={submitting}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn--danger" onClick={() => void handleDeleteMemo()} disabled={submitting}>
              {submitting ? t("analysisMemos.statuses.deleting") : t("analysisMemos.actions.deleteMemoLower")}
            </button>
          </div>
        </SettingsModal>
      ) : null}
    </div>
  );
}
