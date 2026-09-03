import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { HelpIcon, PauseIcon as ClipPauseIcon, PlayIcon as ClipPlayIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { useI18n } from "../i18n/provider";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";
import type { PostgresCode } from "../lib/postgres";
import { visibleCodeNodes, type CodeTreeNode } from "./Postgres_Source_Coding_Shared";

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

interface AnnRow {
  id: string;
  displayId: number | null;
  documentId: string;
  documentName: string;
  codeId: string;
  codeLabel: string;
  codeColor: string;
  quote: string;
  note: string;
  sourceKind?: string;
  sourceObjectType?: string;
  sourceObjectTypeSystemKey?: string | null;
  sourceObjectTypeShape?: SourceObjectTypeShape;
  sourceObjectTypeColor?: string;
  sourceObjectTypeFill?: SourceObjectFill;
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
  lockLabel?: string;
  lockTitle?: string;
  createdAt?: string;
}

type SortCol = "documentName" | "sourceKind" | "codeLabel" | "lockLabel" | "createdAt" | "createdByName";
type SortDir = "asc" | "desc";
type CodeFilterSortCol = "code" | "count";
type SourceObjectTypeShape =
  | "rounded"
  | "rectangle"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "octagon"
  | "parallelogram"
  | "trapezoid"
  | "tag"
  | "star";
type SourceObjectFill = "filled" | "outline";
type SourceObjectVisualKey = "source_text" | "source_processed_transcript" | "source_pdf" | "source_image" | "source_audio" | "source_video";

const COLS: { key: SortCol; label: string; width: string }[] = [
  { key: "documentName", label: "Document", width: "20%" },
  { key: "sourceKind", label: "Type", width: "10%" },
  { key: "codeLabel", label: "Code", width: "16%" },
  { key: "lockLabel", label: "Lock", width: "10%" },
  { key: "createdAt", label: "Created", width: "15%" },
  { key: "createdByName", label: "Created By", width: "13%" },
];

const ANNOTATION_ID_WIDTH = "10%";
const SOURCE_OBJECT_TYPE_DEFAULT_COLOR = "#355070";

const POSTGRES_SOURCE_KIND_VISUALS: Record<string, { label: string; color: string; systemKey: SourceObjectVisualKey }> = {
  text: { label: "Text", color: "#355070", systemKey: "source_text" },
  transcript: { label: "Transcript", color: "#2a9d8f", systemKey: "source_processed_transcript" },
  pdf: { label: "PDF", color: "#7f5539", systemKey: "source_pdf" },
  image: { label: "Image", color: "#6d597a", systemKey: "source_image" },
  audio: { label: "Audio", color: "#b56576", systemKey: "source_audio" },
  video: { label: "Video", color: "#457b9d", systemKey: "source_video" },
};

function normalizeSourceObjectTypeShape(value: string): SourceObjectTypeShape {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pill" || normalized === "circle") return "rounded";
  if (
    normalized === "rectangle"
    || normalized === "triangle"
    || normalized === "diamond"
    || normalized === "hexagon"
    || normalized === "octagon"
    || normalized === "parallelogram"
    || normalized === "trapezoid"
    || normalized === "tag"
    || normalized === "star"
  ) {
    return normalized;
  }
  return "rounded";
}

function normalizeSourceObjectFill(value: string): SourceObjectFill {
  return value.trim().toLowerCase() === "outline" ? "outline" : "filled";
}

function normalizeSourceObjectColor(value: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : SOURCE_OBJECT_TYPE_DEFAULT_COLOR;
}

function getSourceObjectVisualKey(systemKey: string | null | undefined): SourceObjectVisualKey | null {
  if (
    systemKey === "source_text"
    || systemKey === "source_processed_transcript"
    || systemKey === "source_pdf"
    || systemKey === "source_image"
    || systemKey === "source_audio"
    || systemKey === "source_video"
  ) {
    return systemKey;
  }
  return null;
}

function getSourceKindVisual(sourceKind: string | null | undefined): { label: string; color: string; systemKey: SourceObjectVisualKey } | null {
  const normalized = (sourceKind ?? "").trim().toLowerCase().replace(/_/g, " ");
  const key = normalized === "processed transcript" ? "transcript" : normalized;
  return POSTGRES_SOURCE_KIND_VISUALS[key] ?? null;
}

export interface AnnotationsViewProps {
  postgresProjectId?: string;
  postgresProjectStoragePath?: string;
  postgresCurrentUserId?: string;
  initialPostgresAnnotationId?: string | null;
  onInitialPostgresAnnotationHandled?: () => void;
  onOpenPostgresSourceAnnotation?: (target: { sourceId: string; annotationId: string }) => void;
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

function AudioAnnotationClip({
  sourcePath,
  projectStoragePath,
  timeStartMs,
  timeEndMs,
}: {
  sourcePath?: string;
  projectStoragePath?: string;
  timeStartMs?: number | null;
  timeEndMs?: number | null;
}) {
  const { t } = useI18n();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [clipProgressMs, setClipProgressMs] = useState(0);
  const resolvedPath = resolveProjectStoragePath(projectStoragePath, sourcePath);
  const startMs = timeStartMs ?? null;
  const endMs = timeEndMs ?? null;
  const startSeconds = Math.max(0, (startMs ?? 0) / 1000);
  const endSeconds = Math.max(startSeconds, (endMs ?? startMs ?? 0) / 1000);
  const clipDurationMs = Math.max(1, (endMs ?? 0) - (startMs ?? 0));
  const mediaType = mediaTypeFromFileExtension(fileExtensionFromPath(sourcePath ?? ""));

  useEffect(() => {
    if (!resolvedPath || startMs == null || endMs == null) {
      setAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setLoadError(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoadError(null);
    void readTauriFile(resolvedPath)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaType ?? "audio/*" }));
        setAudioUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setAudioUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
        setLoadError(error instanceof Error ? error.message : t("projectAnnotations.errors.audioClipLoadFailed"));
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endMs, mediaType, resolvedPath, startMs, t]);

  if (startMs == null || endMs == null) return null;

  function handleLoadedMetadata() {
    if (!audioRef.current) return;
    audioRef.current.currentTime = startSeconds;
    setClipProgressMs(0);
  }

  function handlePlay() {
    if (!audioRef.current) return;
    if (audioRef.current.currentTime < startSeconds || audioRef.current.currentTime >= endSeconds) {
      audioRef.current.currentTime = startSeconds;
    }
    setPlaying(true);
  }

  function handleTimeUpdate() {
    if (!audioRef.current) return;
    const nextProgressMs = Math.max(0, Math.min(clipDurationMs, (audioRef.current.currentTime - startSeconds) * 1000));
    setClipProgressMs(nextProgressMs);
    if (audioRef.current.currentTime >= endSeconds) {
      audioRef.current.pause();
      audioRef.current.currentTime = startSeconds;
      setPlaying(false);
      setClipProgressMs(0);
    }
  }

  function handlePause() {
    setPlaying(false);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.currentTime < startSeconds || audio.currentTime >= endSeconds) {
        audio.currentTime = startSeconds + (clipProgressMs / 1000);
      }
      void audio.play();
      return;
    }
    audio.pause();
  }

  function seekWithinClip(progressMs: number) {
    const audio = audioRef.current;
    const nextProgressMs = Math.max(0, Math.min(clipDurationMs, progressMs));
    setClipProgressMs(nextProgressMs);
    if (audio) {
      audio.currentTime = startSeconds + (nextProgressMs / 1000);
    }
  }

  return (
    <div className="case-card">
      <h3 className="case-card-title">{t("projectAnnotations.detail.audioClip")}</h3>
      <div className="annotation-excerpt annotation-excerpt--clip">
        <div className="annotation-excerpt-label">
          {formatMediaMilliseconds(startMs)} - {formatMediaMilliseconds(endMs)}
        </div>
        {loadError ? (
          <p className="auth-error" style={{ margin: 0 }}>{loadError}</p>
        ) : audioUrl ? (
          <div className="annotation-clip-player">
            <audio
              ref={audioRef}
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={handlePlay}
              onPause={handlePause}
              onTimeUpdate={handleTimeUpdate}
            >
              <source src={audioUrl} type={mediaType ?? undefined} />
            </audio>
            <button
              type="button"
              className="annotation-clip-play-btn"
              onClick={togglePlayback}
              title={playing ? t("projectAnnotations.media.pause") : t("projectAnnotations.media.play")}
              aria-label={playing ? t("projectAnnotations.media.pauseAudioClip") : t("projectAnnotations.media.playAudioClip")}
            >
              {playing ? <ClipPauseIcon /> : <ClipPlayIcon />}
            </button>
            <div className="annotation-clip-scrubber">
              <input
                type="range"
                min="0"
                max={clipDurationMs}
                step="100"
                value={Math.round(clipProgressMs)}
                onChange={(event) => seekWithinClip(Number(event.target.value))}
                aria-label={t("projectAnnotations.media.clipPosition")}
              />
              <div className="annotation-clip-time-row">
                <span>{formatMediaMilliseconds(clipProgressMs)}</span>
                <span>{formatMediaMilliseconds(clipDurationMs)}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="users-guide-copy" style={{ margin: 0 }}>{t("projectAnnotations.media.loadingAudioClip")}</p>
        )}
      </div>
    </div>
  );
}

function VideoAnnotationClip({
  sourcePath,
  projectStoragePath,
  timeStartMs,
  timeEndMs,
}: {
  sourcePath?: string;
  projectStoragePath?: string;
  timeStartMs?: number | null;
  timeEndMs?: number | null;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const resolvedPath = resolveProjectStoragePath(projectStoragePath, sourcePath);
  const startMs = timeStartMs ?? null;
  const endMs = timeEndMs ?? null;
  const startSeconds = Math.max(0, (startMs ?? 0) / 1000);
  const mediaType = mediaTypeFromFileExtension(fileExtensionFromPath(sourcePath ?? ""));

  useEffect(() => {
    if (!resolvedPath || startMs == null || endMs == null) {
      setVideoUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setLoadError(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoadError(null);
    void readTauriFile(resolvedPath)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaType ?? "video/*" }));
        setVideoUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setVideoUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
        setLoadError(error instanceof Error ? error.message : t("projectAnnotations.errors.videoClipLoadFailed"));
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endMs, mediaType, resolvedPath, startMs, t]);

  if (startMs == null || endMs == null) return null;

  function handleLoadedMetadata() {
    if (!videoRef.current) return;
    videoRef.current.currentTime = startSeconds;
  }

  return (
    <div className="case-card">
      <h3 className="case-card-title">{t("projectAnnotations.detail.videoClip")}</h3>
      <div className="annotation-excerpt annotation-excerpt--clip">
        <div className="annotation-excerpt-label">
          {formatMediaMilliseconds(startMs)} - {formatMediaMilliseconds(endMs)}
        </div>
        {loadError ? (
          <p className="auth-error" style={{ margin: 0 }}>{loadError}</p>
        ) : videoUrl ? (
          <div className="annotation-video-clip">
            <video
              ref={videoRef}
              className="annotation-video-clip-media"
              preload="metadata"
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
              aria-label={t("projectAnnotations.media.videoClipPreview")}
            >
              <source src={videoUrl} type={mediaType ?? undefined} />
            </video>
          </div>
        ) : (
          <p className="users-guide-copy" style={{ margin: 0 }}>{t("projectAnnotations.media.loadingVideoClip")}</p>
        )}
      </div>
    </div>
  );
}

function ImageAnnotationCrop({
  sourcePath,
  sourceKind,
  projectStoragePath,
  imageRegion,
}: {
  sourcePath?: string;
  sourceKind?: string;
  projectStoragePath?: string;
  imageRegion?: AnnRow["imageRegion"];
}) {
  const { t } = useI18n();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const resolvedPath = resolveProjectStoragePath(projectStoragePath, sourcePath);
  const region = imageRegion ?? null;
  const isPdf = sourceKind === "pdf";

  useEffect(() => {
    if (!resolvedPath || !region) {
      setImageUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      setLoadError(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const cropRegion = region;
    setLoadError(null);

    async function buildPreviewUrl(bytes: Uint8Array): Promise<string> {
      if (!isPdf) {
        return URL.createObjectURL(new Blob([bytes]));
      }

      const pdfjsLib = await loadPdfJs();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const safePage = Math.min(Math.max(cropRegion.pageNumber ?? 1, 1), pdf.numPages);
      const page = await pdf.getPage(safePage);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("projectAnnotations.errors.pdfPreviewPrepareFailed"));
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error(t("projectAnnotations.errors.pdfPreviewRenderFailed")));
        }, "image/png");
      });
      return URL.createObjectURL(blob);
    }

    void readTauriFile(resolvedPath)
      .then(async (bytes) => {
        if (cancelled) return;
        objectUrl = await buildPreviewUrl(bytes);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setImageUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setImageUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
        setLoadError(error instanceof Error ? error.message : t("projectAnnotations.errors.cropLoadFailed", { kind: isPdf ? "PDF" : "image" }));
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isPdf, region, resolvedPath, t]);

  if (!region) return null;

  const safeRegionWidth = Math.max(region.width, 1);
  const safeRegionHeight = Math.max(region.height, 1);
  const safeImageWidth = Math.max(region.imageWidth, safeRegionWidth);
  const safeImageHeight = Math.max(region.imageHeight, safeRegionHeight);

  return (
    <div className="case-card">
      <h3 className="case-card-title">{isPdf ? t("projectAnnotations.detail.pdfRegion") : t("projectAnnotations.detail.imageRegion")}</h3>
      <div className="annotation-excerpt annotation-excerpt--clip">
        <div className="annotation-excerpt-label">
          {isPdf ? t("projectAnnotations.detail.pagePrefix", { page: region.pageNumber ?? 1 }) : ""}
          {Math.round(region.width)} x {Math.round(region.height)} px
        </div>
        {loadError ? (
          <p className="auth-error" style={{ margin: 0 }}>{loadError}</p>
        ) : imageUrl ? (
          <div
            className="annotation-image-crop"
            style={{ aspectRatio: `${safeRegionWidth} / ${safeRegionHeight}` }}
          >
            <img
              src={imageUrl}
              alt={t("projectAnnotations.detail.croppedAnnotationRegion")}
              style={{
                width: `${(safeImageWidth / safeRegionWidth) * 100}%`,
                height: `${(safeImageHeight / safeRegionHeight) * 100}%`,
                transform: `translate(-${(Math.max(region.x, 0) / safeImageWidth) * 100}%, -${(Math.max(region.y, 0) / safeImageHeight) * 100}%)`,
              }}
            />
          </div>
        ) : (
          <p className="users-guide-copy" style={{ margin: 0 }}>{t("projectAnnotations.media.loadingImageRegion")}</p>
        )}
      </div>
    </div>
  );
}

function describeSourceLock(
  userId: string | undefined,
  userName: string | undefined,
  currentUserId: string | undefined,
  t: ReturnType<typeof useI18n>["t"],
): { label: string; title: string } {
  if (!userId) {
    return {
      label: t("projectAnnotations.values.available"),
      title: t("projectAnnotations.values.availableTitle"),
    };
  }
  if (currentUserId && userId === currentUserId) {
    return {
      label: t("projectAnnotations.values.you"),
      title: t("projectAnnotations.values.youLockTitle"),
    };
  }
  return {
    label: t("projectAnnotations.values.locked"),
    title: t("projectAnnotations.values.lockedTitle", { name: userName || t("projectAnnotations.values.anotherUser") }),
  };
}

function fmtDate(value?: string): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatAnnotationDisplayId(value: number | null): string {
  return value == null ? "-" : `A${value}`;
}

function formatSourceType(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (!normalized) return "-";
  if (normalized === "pdf") return "PDF";
  if (normalized === "processed transcript") return "Transcript";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function AnnotationsView(props: AnnotationsViewProps) {
  const {
    postgresProjectId,
    postgresProjectStoragePath,
    postgresCurrentUserId,
    initialPostgresAnnotationId,
    onInitialPostgresAnnotationHandled,
    onOpenPostgresSourceAnnotation,
  } = props;
  const { t } = useI18n();
  const localizedCols = [
    { ...COLS[0], label: t("projectAnnotations.table.document") },
    COLS[1],
    { ...COLS[2], label: t("projectAnnotations.table.code") },
    { ...COLS[3], label: t("projectAnnotations.table.lock") },
    { ...COLS[4], label: t("projectAnnotations.table.created") },
    { ...COLS[5], label: t("projectAnnotations.table.createdBy") },
  ];

  const [rows, setRows] = useState<AnnRow[]>([]);
  const [codes, setCodes] = useState<PostgresCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>("documentName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedCodeFilter, setSelectedCodeFilter] = useState<string>("all");
  const [collapsedCodeIds, setCollapsedCodeIds] = useState<Set<string>>(new Set());
  const [codeFilterSortCol, setCodeFilterSortCol] = useState<CodeFilterSortCol>("code");
  const [codeFilterSortDir, setCodeFilterSortDir] = useState<SortDir>("asc");
  const [selectedRow, setSelectedRow] = useState<AnnRow | null>(null);

  useEffect(() => {
    if (!initialPostgresAnnotationId || rows.length === 0) return;
    const matchingRow = rows.find((row) => row.id === initialPostgresAnnotationId);
    if (!matchingRow) return;
    setSelectedRow(matchingRow);
    onInitialPostgresAnnotationHandled?.();
  }, [initialPostgresAnnotationId, onInitialPostgresAnnotationHandled, rows]);

  const load = useCallback(async () => {
    if (!postgresProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await loadPostgresProjectWorkspaceSnapshot(postgresProjectId);
      const sourceById = Object.fromEntries(snapshot.sources.map((source) => [source.id, source]));
      const primaryCodeById = Object.fromEntries(snapshot.codes.map((code) => [code.id, code]));
      const sourceObjectTypeBySystemKey = new Map(
        snapshot.objectTypes
          .filter((objectType) => getSourceObjectVisualKey(objectType.systemKey))
          .map((objectType) => [objectType.systemKey, objectType]),
      );
      const sourceLockById = Object.fromEntries(
        snapshot.sourceLocks.map((lock) => [lock.sourceId, lock]),
      );
      setCodes(snapshot.codes);
      setRows(snapshot.annotations.map((annotation) => {
        const source = sourceById[annotation.sourceId];
        const primaryCode = primaryCodeById[annotation.primaryCodeId];
        const sourceLock = sourceLockById[annotation.sourceId];
        const sourceKind = annotation.sourceKind || source?.sourceKind || "";
        const sourceVisual = getSourceKindVisual(sourceKind);
        const sourceObjectType = sourceVisual?.systemKey
          ? sourceObjectTypeBySystemKey.get(sourceVisual.systemKey) ?? null
          : null;
        const lockStatus = describeSourceLock(
          sourceLock?.userId,
          sourceLock?.userName,
          postgresCurrentUserId,
          t,
        );
        return {
          id: annotation.id,
          displayId: annotation.displayId,
          documentId: annotation.sourceId,
          documentName: source?.title ?? "-",
          codeId: annotation.primaryCodeId,
          codeLabel: annotation.primaryCodeLabel || primaryCode?.label || "-",
          codeColor: primaryCode?.color ?? "#888888",
          quote: annotation.quote ?? "",
          note: annotation.note ?? "",
          sourceKind,
          sourceObjectType: sourceObjectType?.name ?? sourceVisual?.label ?? formatSourceType(sourceKind || "source"),
          sourceObjectTypeSystemKey: sourceObjectType?.systemKey ?? sourceVisual?.systemKey ?? null,
          sourceObjectTypeShape: sourceObjectType ? normalizeSourceObjectTypeShape(sourceObjectType.shape) : "rounded",
          sourceObjectTypeColor: sourceObjectType
            ? normalizeSourceObjectColor(sourceObjectType.color)
            : sourceVisual?.color ?? SOURCE_OBJECT_TYPE_DEFAULT_COLOR,
          sourceObjectTypeFill: sourceObjectType ? normalizeSourceObjectFill(sourceObjectType.fill) : "outline",
          sourcePath: source?.storagePath,
          imageRegion: annotation.imageRegion,
          timeStartMs: annotation.timeStartMs,
          timeEndMs: annotation.timeEndMs,
          createdByName: annotation.createdByName || "-",
          lockLabel: lockStatus.label,
          lockTitle: lockStatus.title,
          createdAt: annotation.createdAt,
        };
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projectAnnotations.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [postgresCurrentUserId, postgresProjectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function handleCodeFilterSort(col: CodeFilterSortCol) {
    if (col === codeFilterSortCol) setCodeFilterSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setCodeFilterSortCol(col);
      setCodeFilterSortDir("asc");
    }
  }

  function openAnnotation(row: AnnRow) {
    setSelectedRow(row);
  }

  function jumpToSourceAnnotation(row: AnnRow) {
    onOpenPostgresSourceAnnotation?.({
      sourceId: row.documentId,
      annotationId: row.id,
    });
  }

  const annotationCountByCodeId = useMemo(() => {
    const countByCode = new Map<string, number>();
    for (const row of rows) {
      const codeId = row.codeId || "__unknown__";
      countByCode.set(codeId, (countByCode.get(codeId) ?? 0) + 1);
    }
    return countByCode;
  }, [rows]);

  const codeTree = useMemo(() => {
    const children = new Map<string | null, PostgresCode[]>();
    codes.forEach((code) => {
      const parentId = code.parentCodeId || null;
      const list = children.get(parentId) ?? [];
      list.push(code);
      children.set(parentId, list);
    });
    children.forEach((list) => {
      list.sort((left, right) => {
        let comparison = 0;
        if (codeFilterSortCol === "count") {
          comparison = (annotationCountByCodeId.get(left.id) ?? 0) - (annotationCountByCodeId.get(right.id) ?? 0);
          if (comparison === 0) {
            comparison = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
          }
        } else {
          comparison = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
        }
        return codeFilterSortDir === "asc" ? comparison : -comparison;
      });
    });

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
  }, [annotationCountByCodeId, codeFilterSortCol, codeFilterSortDir, codes]);
  const visibleCodes = useMemo(() => visibleCodeNodes(codeTree, collapsedCodeIds), [codeTree, collapsedCodeIds]);

  useEffect(() => {
    if (selectedCodeFilter === "all") return;
    if (!codes.some((code) => code.id === selectedCodeFilter)) {
      setSelectedCodeFilter("all");
    }
  }, [selectedCodeFilter, codes]);

  function toggleCollapsedCode(codeId: string) {
    setCollapsedCodeIds((current) => {
      const next = new Set(current);
      if (next.has(codeId)) next.delete(codeId);
      else next.add(codeId);
      return next;
    });
  }

  const filteredRows = useMemo(
    () => selectedCodeFilter === "all"
      ? rows
      : rows.filter((row) => (row.codeId || "__unknown__") === selectedCodeFilter),
    [rows, selectedCodeFilter],
  );

  const sorted = [...filteredRows].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "documentName") cmp = a.documentName.localeCompare(b.documentName);
    else if (sortCol === "sourceKind") cmp = formatSourceType(a.sourceKind).localeCompare(formatSourceType(b.sourceKind));
    else if (sortCol === "codeLabel") cmp = a.codeLabel.localeCompare(b.codeLabel);
    else if (sortCol === "lockLabel") cmp = (a.lockLabel ?? "").localeCompare(b.lockLabel ?? "");
    else if (sortCol === "createdAt") cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    else if (sortCol === "createdByName") cmp = a.createdByName.localeCompare(b.createdByName);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const rowCount = loading || sorted.length === 0 ? 1 : sorted.length;

  if (selectedRow) {
    return (
      <div className="view doc-detail-view">
        <div className="workspace-back-row workspace-back-row--split">
          <button className="btn" onClick={() => setSelectedRow(null)}>
            {t("projectAnnotations.actions.backToAnnotations")}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              onClick={() => jumpToSourceAnnotation(selectedRow)}
            >
              {t("projectAnnotations.actions.openInCoding")}
            </button>
          </div>
        </div>

        <div className="doc-detail-layout">
          <div className="doc-detail-left">
            <div className="case-card">
              <h3 className="case-card-title">{t("projectAnnotations.detail.annotation")}</h3>
              <p className="case-card-value">{formatAnnotationDisplayId(selectedRow.displayId)}</p>
              <p className="users-guide-copy" style={{ marginTop: 8, marginBottom: 0 }} title={selectedRow.lockTitle}>
                {t("projectAnnotations.detail.lockValue", { value: selectedRow.lockLabel ?? "-" })}
              </p>
            </div>

            <dl className="user-detail-meta case-detail-meta">
              <dt>{t("projectAnnotations.table.id")}</dt> <dd>{formatAnnotationDisplayId(selectedRow.displayId)}</dd>
              <dt>{t("projectAnnotations.table.sourceId")}</dt> <dd>{selectedRow.documentId}</dd>
              <dt>{t("projectAnnotations.table.document")}</dt> <dd>{selectedRow.documentName}</dd>
              <dt>{t("projectAnnotations.table.sourceType")}</dt> <dd>{formatSourceType(selectedRow.sourceKind)}</dd>
              <dt>{t("projectAnnotations.table.code")}</dt>
              <dd style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="code-swatch" style={{ background: selectedRow.codeColor }} />
                {selectedRow.codeLabel}
              </dd>
              <dt>{t("projectAnnotations.table.startTime")}</dt>
              <dd>
                {typeof selectedRow.timeStartMs === "number" ? formatMediaMilliseconds(selectedRow.timeStartMs) : "-"}
              </dd>
              <dt>{t("projectAnnotations.table.endTime")}</dt>
              <dd>
                {typeof selectedRow.timeEndMs === "number" ? formatMediaMilliseconds(selectedRow.timeEndMs) : "-"}
              </dd>
              <dt>{t("projectAnnotations.table.createdBy")}</dt> <dd>{selectedRow.createdByName}</dd>
              <dt>{t("projectDocuments.columns.created")}</dt> <dd>{fmtDate(selectedRow.createdAt)}</dd>
            </dl>

            {selectedRow.note ? (
              <div className="case-card">
                <h3 className="case-card-title">{t("projectAnnotations.detail.note")}</h3>
                <p className="users-guide-copy" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                  {selectedRow.note}
                </p>
              </div>
            ) : null}
          </div>

          <div className="doc-detail-right doc-detail-right--annotation">
            {selectedRow.sourceKind === "audio" ? (
              <AudioAnnotationClip
                sourcePath={selectedRow.sourcePath}
                projectStoragePath={postgresProjectStoragePath}
                timeStartMs={selectedRow.timeStartMs}
                timeEndMs={selectedRow.timeEndMs}
              />
            ) : selectedRow.sourceKind === "video" ? (
              <VideoAnnotationClip
                sourcePath={selectedRow.sourcePath}
                projectStoragePath={postgresProjectStoragePath}
                timeStartMs={selectedRow.timeStartMs}
                timeEndMs={selectedRow.timeEndMs}
              />
            ) : selectedRow.sourceKind === "image" || selectedRow.sourceKind === "pdf" ? (
              <ImageAnnotationCrop
                sourcePath={selectedRow.sourcePath}
                sourceKind={selectedRow.sourceKind}
                projectStoragePath={postgresProjectStoragePath}
                imageRegion={selectedRow.imageRegion}
              />
            ) : (
              <div className="case-card doc-content-card doc-content-card--annotation-text">
                <div className="case-card-header">
                  <div className="doc-content-header-title">
                    <h3 className="case-card-title">{t("projectAnnotations.detail.annotatedText")}</h3>
                  </div>
                </div>
                <div className="doc-content-scroll-shell">
                  <pre
                    className="doc-content-body"
                    style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {selectedRow.quote || t("projectAnnotations.detail.noAnnotatedText")}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("projectAnnotations.pageTitle")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("projectAnnotations.showHelp")}
            aria-label={t("projectAnnotations.showHelp")}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {error && <p className="users-error">{error}</p>}
      <div
        className="postgres-sources-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 340px) auto minmax(0, 1fr)",
          gap: 0,
          alignItems: "stretch",
          flex: "0 0 auto",
          minHeight: 0,
        }}
      >
        <div
          className="home-primary-column"
          style={{
            alignSelf: "center",
            justifyContent: "flex-start",
            gap: 16,
            minHeight: 0,
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 4,
          }}
        >
          <div className="ai-assist-home-tabbar" style={{ marginBottom: 0, visibility: "hidden", pointerEvents: "none" }} aria-hidden="true">
            <div className="segmented-control" role="presentation">
              <button type="button" className="segmented-control-option segmented-control-option--active" tabIndex={-1}>
                {t("projectAnnotations.detail.details")}
              </button>
              <button type="button" className="segmented-control-option" tabIndex={-1}>
                {t("projectAnnotations.detail.attributes")}
              </button>
            </div>
          </div>
          <section className="home-project-card" style={{ padding: 0, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 18,
                borderBottom: "1px solid rgba(53, 80, 112, 0.08)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{t("projectAnnotations.table.codes")}</h2>
              </div>
            </div>
            <div>
              <table className="users-table" style={{ tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th
                      className={`users-th${codeFilterSortCol === "code" ? " users-th--sorted" : ""}`}
                      style={{ width: "76%" }}
                      onClick={() => handleCodeFilterSort("code")}
                    >
                      {t("projectAnnotations.table.code")}
                      <span className="users-sort-icon">
                        {codeFilterSortCol === "code" ? (codeFilterSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </th>
                    <th
                      className={`users-th${codeFilterSortCol === "count" ? " users-th--sorted" : ""}`}
                      style={{ width: "24%" }}
                      onClick={() => handleCodeFilterSort("count")}
                    >
                      {t("projectAnnotations.table.count")}
                      <span className="users-sort-icon">
                        {codeFilterSortCol === "count" ? (codeFilterSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    className="users-row"
                    style={{
                      background: selectedCodeFilter === "all" ? "rgba(53, 80, 112, 0.10)" : undefined,
                    }}
                  >
                    <td
                      className="users-td users-td--name"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedCodeFilter("all")}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedCodeFilter("all");
                        }
                      }}
                    >
                      <span>{t("projectAnnotations.detail.allAnnotations")}</span>
                    </td>
                    <td className="users-td users-td--muted">{rows.length}</td>
                  </tr>
                  {visibleCodes.map(({ code, depth, hasChildren }) => (
                    <tr
                      key={code.id}
                      className="users-row"
                      style={{
                        background: selectedCodeFilter === code.id ? "rgba(53, 80, 112, 0.10)" : undefined,
                      }}
                    >
                      <td
                        className="users-td users-td--name"
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedCodeFilter(code.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedCodeFilter(code.id);
                          }
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, paddingLeft: depth * 18 }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              className="code-collapse-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleCollapsedCode(code.id);
                              }}
                              title={collapsedCodeIds.has(code.id) ? t("projectAnnotations.actions.expand") : t("projectAnnotations.actions.collapse")}
                              aria-label={collapsedCodeIds.has(code.id) ? t("projectAnnotations.actions.expandCode") : t("projectAnnotations.actions.collapseCode")}
                            >
                              {collapsedCodeIds.has(code.id) ? "▶" : "▼"}
                            </button>
                          ) : (
                            <span className="code-collapse-spacer" aria-hidden="true" />
                          )}
                          <span className="code-swatch" style={{ background: code.color || "#888888" }} />
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {code.label || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="users-td users-td--muted">{annotationCountByCodeId.get(code.id) ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {codes.length === 0 ? (
                <div className="empty-state" style={{ minHeight: 140 }}>
                  <p>{t("projectAnnotations.detail.noCodes")}</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div className="project-workspace-col-divider" aria-hidden="true" />

        <section
          className="users-content"
          style={{
            alignItems: "stretch",
            justifyContent: "center",
            gap: 16,
            minHeight: 0,
            maxHeight: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 4,
          }}
        >
          <div className="home-project-card project-table-card">
            <div className="project-table-card-header">
              <h2>{t("projectAnnotations.pageTitle")}</h2>
            </div>
          <div
            className="users-table-wrap"
            style={{ maxHeight: 34 + (Math.max(rowCount, 1) + 2) * 36 }}
          >
            <table className="users-table">
              <thead>
                <tr>
                  <th style={{ width: ANNOTATION_ID_WIDTH }} className="users-th">
                    {t("projectAnnotations.table.id")}
                  </th>
                  {localizedCols.map((col) => (
                    <th
                      key={col.key}
                      style={{ width: col.width }}
                      className={`users-th${sortCol === col.key ? " users-th--sorted" : ""}`}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      <span className="users-sort-icon">
                        {sortCol === col.key
                          ? sortDir === "asc"
                            ? " ↑"
                            : " ↓"
                          : " ↕"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="users-td-msg">{t("projectAnnotations.loading")}</td></tr>
                )}
                {!loading && sorted.length === 0 && (
                  <tr><td colSpan={7} className="users-td-msg">{t("projectAnnotations.empty")}</td></tr>
                )}
                {!loading && sorted.map((row) => (
                  <tr
                    key={row.id}
                    className="users-row annotations-list-row"
                    onClick={() => openAnnotation(row)}
                    title={row.lockTitle}
                  >
                    <td className="users-td users-td--muted">
                      {formatAnnotationDisplayId(row.displayId)}
                    </td>
                    <td className="users-td users-td--name">{row.documentName}</td>
                    <td className="users-td users-td--muted">{formatSourceType(row.sourceKind)}</td>
                    <td className="users-td">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className="code-swatch" style={{ background: row.codeColor }} />
                        {row.codeLabel}
                      </span>
                    </td>
                    <td className="users-td users-td--muted">
                      {row.lockLabel ?? "-"}
                    </td>
                    <td className="users-td users-td--muted">
                      {fmtDate(row.createdAt)}
                    </td>
                    <td className="users-td users-td--muted">
                      {row.createdByName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </section>
      </div>

      {helpOpen && (
        <SettingsModal
          title={t("projectAnnotations.help.title")}
          onClose={() => setHelpOpen(false)}
          modalClassName="modal--help"
        >
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("projectAnnotations.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("projectAnnotations.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("projectAnnotations.help.line3")}
            </p>
            <p className="users-guide-copy">
              {t("projectAnnotations.help.line4")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
      )}
    </div>
  );
}
