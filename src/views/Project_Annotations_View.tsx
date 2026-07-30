import { type CSSProperties, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import circleFilledShapeSvg from "../assets/object-shapes/circle-filled.svg?raw";
import circleOutlineShapeSvg from "../assets/object-shapes/circle-outline.svg?raw";
import rectangleFilledShapeSvg from "../assets/object-shapes/rectangle-filled.svg?raw";
import rectangleOutlineShapeSvg from "../assets/object-shapes/rectangle-outline.svg?raw";
import triangleFilledShapeSvg from "../assets/object-shapes/triangle-filled.svg?raw";
import triangleOutlineShapeSvg from "../assets/object-shapes/triangle-outline.svg?raw";
import diamondFilledShapeSvg from "../assets/object-shapes/diamond-filled.svg?raw";
import diamondOutlineShapeSvg from "../assets/object-shapes/diamond-outline.svg?raw";
import hexagonFilledShapeSvg from "../assets/object-shapes/hexagon-filled.svg?raw";
import hexagonOutlineShapeSvg from "../assets/object-shapes/hexagon-outline.svg?raw";
import octagonFilledShapeSvg from "../assets/object-shapes/octagon-filled.svg?raw";
import octagonOutlineShapeSvg from "../assets/object-shapes/octagon-outline.svg?raw";
import parallelogramFilledShapeSvg from "../assets/object-shapes/parallelogram-filled.svg?raw";
import parallelogramOutlineShapeSvg from "../assets/object-shapes/parallelogram-outline.svg?raw";
import trapezoidFilledShapeSvg from "../assets/object-shapes/trapezoid-filled.svg?raw";
import trapezoidOutlineShapeSvg from "../assets/object-shapes/trapezoid-outline.svg?raw";
import tagFilledShapeSvg from "../assets/object-shapes/tag-filled.svg?raw";
import tagOutlineShapeSvg from "../assets/object-shapes/tag-outline.svg?raw";
import starFilledShapeSvg from "../assets/object-shapes/star-filled.svg?raw";
import starOutlineShapeSvg from "../assets/object-shapes/star-outline.svg?raw";
import sourceTextOutlineShapeSvg from "../assets/object-shapes/source-text-outline.svg?raw";
import sourcePdfOutlineShapeSvg from "../assets/object-shapes/source-pdf-outline.svg?raw";
import sourceImageOutlineShapeSvg from "../assets/object-shapes/source-image-outline.svg?raw";
import sourceAudioOutlineShapeSvg from "../assets/object-shapes/source-audio-outline.svg?raw";
import sourceVideoOutlineShapeSvg from "../assets/object-shapes/source-video-outline.svg?raw";
import { useOptionalStore } from "../context/StoreContext";
import { HelpIcon } from "../components/AppIcons";
import { useI18n } from "../i18n/provider";
import { loadPostgresProjectWorkspaceSnapshot } from "../lib/postgresProjectWorkspace";

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
type SourceObjectVisualKey = "source_text" | "source_pdf" | "source_image" | "source_audio" | "source_video";

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
const POSTGRES_SOURCE_OBJECT_TYPE_SYSTEM_KEYS = [
  "source_text",
  "source_pdf",
  "source_image",
  "source_audio",
  "source_video",
] as const;

function buildSvgDataUrl(svgMarkup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`;
}

const SOURCE_OBJECT_SHAPE_ASSET_URLS: Record<SourceObjectTypeShape, { filled: string; outline: string }> = {
  rounded: { filled: buildSvgDataUrl(circleFilledShapeSvg), outline: buildSvgDataUrl(circleOutlineShapeSvg) },
  rectangle: { filled: buildSvgDataUrl(rectangleFilledShapeSvg), outline: buildSvgDataUrl(rectangleOutlineShapeSvg) },
  triangle: { filled: buildSvgDataUrl(triangleFilledShapeSvg), outline: buildSvgDataUrl(triangleOutlineShapeSvg) },
  diamond: { filled: buildSvgDataUrl(diamondFilledShapeSvg), outline: buildSvgDataUrl(diamondOutlineShapeSvg) },
  hexagon: { filled: buildSvgDataUrl(hexagonFilledShapeSvg), outline: buildSvgDataUrl(hexagonOutlineShapeSvg) },
  octagon: { filled: buildSvgDataUrl(octagonFilledShapeSvg), outline: buildSvgDataUrl(octagonOutlineShapeSvg) },
  parallelogram: { filled: buildSvgDataUrl(parallelogramFilledShapeSvg), outline: buildSvgDataUrl(parallelogramOutlineShapeSvg) },
  trapezoid: { filled: buildSvgDataUrl(trapezoidFilledShapeSvg), outline: buildSvgDataUrl(trapezoidOutlineShapeSvg) },
  tag: { filled: buildSvgDataUrl(tagFilledShapeSvg), outline: buildSvgDataUrl(tagOutlineShapeSvg) },
  star: { filled: buildSvgDataUrl(starFilledShapeSvg), outline: buildSvgDataUrl(starOutlineShapeSvg) },
};
const SOURCE_OBJECT_VISUAL_ASSET_URLS: Record<SourceObjectVisualKey, string> = {
  source_text: buildSvgDataUrl(sourceTextOutlineShapeSvg),
  source_pdf: buildSvgDataUrl(sourcePdfOutlineShapeSvg),
  source_image: buildSvgDataUrl(sourceImageOutlineShapeSvg),
  source_audio: buildSvgDataUrl(sourceAudioOutlineShapeSvg),
  source_video: buildSvgDataUrl(sourceVideoOutlineShapeSvg),
};

function normalizeSourceObjectTypeShape(value: string | undefined): SourceObjectTypeShape {
  const normalized = (value ?? "").trim().toLowerCase();
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

function normalizeSourceObjectFill(value: string | undefined): SourceObjectFill {
  return (value ?? "").trim().toLowerCase() === "outline" ? "outline" : "filled";
}

function normalizeSourceObjectColor(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : SOURCE_OBJECT_TYPE_DEFAULT_COLOR;
}

function getSourceObjectVisualKey(systemKey: string | null | undefined): SourceObjectVisualKey | null {
  if (
    systemKey === "source_text"
    || systemKey === "source_pdf"
    || systemKey === "source_image"
    || systemKey === "source_audio"
    || systemKey === "source_video"
  ) {
    return systemKey;
  }
  return null;
}

function getSourceObjectMaskStyle(url: string): CSSProperties {
  return {
    WebkitMaskImage: `url("${url}")`,
    maskImage: `url("${url}")`,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  };
}

function SourceObjectTypeSwatch(props: {
  shape: SourceObjectTypeShape;
  fill: SourceObjectFill;
  color: string;
  sourceVisualKey: SourceObjectVisualKey | null;
}) {
  const { shape, fill, color, sourceVisualKey } = props;
  const sourceOutlineAsset = sourceVisualKey ? SOURCE_OBJECT_VISUAL_ASSET_URLS[sourceVisualKey] : null;
  const shapeAssets = sourceVisualKey ? null : SOURCE_OBJECT_SHAPE_ASSET_URLS[shape];
  const background = fill === "outline" ? "transparent" : `${color}2e`;

  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "inline-flex",
        width: 24,
        height: 18,
        overflow: "hidden",
        flexShrink: 0,
        verticalAlign: "middle",
        lineHeight: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          background: sourceOutlineAsset ? "transparent" : background,
          ...(sourceOutlineAsset ? {} : getSourceObjectMaskStyle(shapeAssets!.filled)),
        }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          background: color,
          ...getSourceObjectMaskStyle(sourceOutlineAsset ?? shapeAssets!.outline),
        }}
      />
    </span>
  );
}

export interface AnnotationsViewProps {
  postgresProjectId?: string;
  postgresProjectStoragePath?: string;
  postgresCurrentUserId?: string;
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

function ClipPlayIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <path d="M5.25 3.6v8.8L12 8 5.25 3.6Z" fill="currentColor" />
    </svg>
  );
}

function ClipPauseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <path d="M4.5 3.5h2.25v9H4.5v-9Zm4.75 0h2.25v9H9.25v-9Z" fill="currentColor" />
    </svg>
  );
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
        setLoadError(error instanceof Error ? error.message : "Could not load the audio clip.");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endMs, mediaType, resolvedPath, startMs]);

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
      <h3 className="case-card-title">Audio Clip</h3>
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
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause audio clip" : "Play audio clip"}
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
                aria-label="Clip position"
              />
              <div className="annotation-clip-time-row">
                <span>{formatMediaMilliseconds(clipProgressMs)}</span>
                <span>{formatMediaMilliseconds(clipDurationMs)}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="users-guide-copy" style={{ margin: 0 }}>Loading audio clip...</p>
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
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
        setLoadError(error instanceof Error ? error.message : "Could not load the video clip.");
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [endMs, mediaType, resolvedPath, startMs]);

  if (startMs == null || endMs == null) return null;

  function handleLoadedMetadata() {
    if (!videoRef.current) return;
    videoRef.current.currentTime = startSeconds;
    setClipProgressMs(0);
  }

  function handlePlay() {
    if (!videoRef.current) return;
    if (videoRef.current.currentTime < startSeconds || videoRef.current.currentTime >= endSeconds) {
      videoRef.current.currentTime = startSeconds;
    }
    setPlaying(true);
  }

  function handleTimeUpdate() {
    if (!videoRef.current) return;
    const nextProgressMs = Math.max(0, Math.min(clipDurationMs, (videoRef.current.currentTime - startSeconds) * 1000));
    setClipProgressMs(nextProgressMs);
    if (videoRef.current.currentTime >= endSeconds) {
      videoRef.current.pause();
      videoRef.current.currentTime = startSeconds;
      setPlaying(false);
      setClipProgressMs(0);
    }
  }

  function handlePause() {
    setPlaying(false);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < startSeconds || video.currentTime >= endSeconds) {
        video.currentTime = startSeconds + (clipProgressMs / 1000);
      }
      void video.play();
      return;
    }
    video.pause();
  }

  function seekWithinClip(progressMs: number) {
    const video = videoRef.current;
    const nextProgressMs = Math.max(0, Math.min(clipDurationMs, progressMs));
    setClipProgressMs(nextProgressMs);
    if (video) {
      video.currentTime = startSeconds + (nextProgressMs / 1000);
    }
  }

  return (
    <div className="case-card">
      <h3 className="case-card-title">Video Clip</h3>
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
              onPlay={handlePlay}
              onPause={handlePause}
              onTimeUpdate={handleTimeUpdate}
              onClick={togglePlayback}
            >
              <source src={videoUrl} type={mediaType ?? undefined} />
            </video>
            <div className="annotation-clip-player annotation-clip-player--video">
              <button
                type="button"
                className="annotation-clip-play-btn"
                onClick={togglePlayback}
                title={playing ? "Pause" : "Play"}
                aria-label={playing ? "Pause video clip" : "Play video clip"}
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
                  aria-label="Clip position"
                />
                <div className="annotation-clip-time-row">
                  <span>{formatMediaMilliseconds(clipProgressMs)}</span>
                  <span>{formatMediaMilliseconds(clipDurationMs)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="users-guide-copy" style={{ margin: 0 }}>Loading video clip...</p>
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
        setLoadError(error instanceof Error ? error.message : `Could not load the ${isPdf ? "PDF" : "image"} crop.`);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isPdf, region, resolvedPath]);

  if (!region) return null;

  const safeRegionWidth = Math.max(region.width, 1);
  const safeRegionHeight = Math.max(region.height, 1);
  const safeImageWidth = Math.max(region.imageWidth, safeRegionWidth);
  const safeImageHeight = Math.max(region.imageHeight, safeRegionHeight);

  return (
    <div className="case-card">
      <h3 className="case-card-title">{isPdf ? "PDF Region" : "Image Region"}</h3>
      <div className="annotation-excerpt annotation-excerpt--clip">
        <div className="annotation-excerpt-label">
          {isPdf ? `Page ${region.pageNumber ?? 1} - ` : ""}
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
              alt="Cropped annotation region"
              style={{
                width: `${(safeImageWidth / safeRegionWidth) * 100}%`,
                height: `${(safeImageHeight / safeRegionHeight) * 100}%`,
                transform: `translate(-${(Math.max(region.x, 0) / safeImageWidth) * 100}%, -${(Math.max(region.y, 0) / safeImageHeight) * 100}%)`,
              }}
            />
          </div>
        ) : (
          <p className="users-guide-copy" style={{ margin: 0 }}>Loading image region...</p>
        )}
      </div>
    </div>
  );
}

function describeSourceLock(
  userId: string | undefined,
  userName: string | undefined,
  currentUserId: string | undefined,
): { label: string; title: string } {
  if (!userId) {
    return {
      label: "Available",
      title: "This source is currently available for coding.",
    };
  }
  if (currentUserId && userId === currentUserId) {
    return {
      label: "You",
      title: "You are currently holding this source lock.",
    };
  }
  return {
    label: "Locked",
    title: `${userName || "Another user"} is currently holding this source lock.`,
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
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "-";
  if (normalized === "pdf") return "PDF";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function sourceTypeRowLabel(label: string): string {
  const cleaned = label
    .replace(/\bsources?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || label;
}

export function AnnotationsView(props: AnnotationsViewProps) {
  const { postgresProjectId, postgresProjectStoragePath, postgresCurrentUserId, onOpenPostgresSourceAnnotation } = props;
  const { t } = useI18n();
  const store = useOptionalStore();
  const activeProject = store?.activeProject ?? null;
  const pb = store?.pb ?? null;
  const documents = store?.documents ?? [];
  const localizedCols = [
    { ...COLS[0], label: t("projectAnnotations.table.document") },
    COLS[1],
    { ...COLS[2], label: t("projectAnnotations.table.code") },
    { ...COLS[3], label: t("projectAnnotations.table.lock") },
    { ...COLS[4], label: t("projectAnnotations.table.created") },
    { ...COLS[5], label: t("projectAnnotations.table.createdBy") },
  ];

  const [rows, setRows] = useState<AnnRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>("documentName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedSourceKindFilter, setSelectedSourceKindFilter] = useState<string>("all");
  const [selectedRow, setSelectedRow] = useState<AnnRow | null>(null);
  const postgresMode = !!postgresProjectId;

  const load = useCallback(async () => {
    if (!activeProject && !postgresProjectId) return;
    setLoading(true);
    setError(null);
    try {
      if (postgresProjectId) {
        const snapshot = await loadPostgresProjectWorkspaceSnapshot(postgresProjectId);
        const sourceById = Object.fromEntries(snapshot.sources.map((source) => [source.id, source]));
        const primaryCodeById = Object.fromEntries(snapshot.codes.map((code) => [code.id, code]));
        const sourceObjectBySourceId = new Map(
          snapshot.objects
            .filter((object) => object.sourceId)
            .map((object) => [object.sourceId!, object]),
        );
        const sourceObjectTypeById = new Map(
          snapshot.objectTypes
            .filter((objectType) => objectType.systemKey
              && POSTGRES_SOURCE_OBJECT_TYPE_SYSTEM_KEYS.includes(objectType.systemKey as (typeof POSTGRES_SOURCE_OBJECT_TYPE_SYSTEM_KEYS)[number]))
            .map((objectType) => [objectType.id, objectType]),
        );
        const sourceLockById = Object.fromEntries(
          snapshot.sourceLocks.map((lock) => [lock.sourceId, lock]),
        );
        setRows(snapshot.annotations.map((annotation) => {
          const source = sourceById[annotation.sourceId];
          const sourceObject = sourceObjectBySourceId.get(annotation.sourceId);
          const sourceObjectType = sourceObject ? sourceObjectTypeById.get(sourceObject.objectTypeId) : null;
          const primaryCode = primaryCodeById[annotation.primaryCodeId];
          const sourceLock = sourceLockById[annotation.sourceId];
          const lockStatus = describeSourceLock(
            sourceLock?.userId,
            sourceLock?.userName,
            postgresCurrentUserId,
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
            sourceKind: annotation.sourceKind || source?.sourceKind,
            sourceObjectType: sourceObjectType?.name ?? sourceObject?.objectType,
            sourceObjectTypeSystemKey: sourceObjectType?.systemKey ?? sourceObject?.objectTypeSystemKey,
            sourceObjectTypeShape: normalizeSourceObjectTypeShape(sourceObjectType?.shape),
            sourceObjectTypeColor: normalizeSourceObjectColor(sourceObjectType?.color),
            sourceObjectTypeFill: normalizeSourceObjectFill(sourceObjectType?.fill),
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
        return;
      }

      if (!activeProject || !pb) return;

      const annRecs = await pb.collection("annotations").getFullList({
        filter: `document.project="${activeProject.id}"&&deleted_at=""`,
        expand: "code,document,created_by",
        sort: "document,start_offset",
      });

      setRows(annRecs.map((record) => ({
        id: record.id,
        displayId: null,
        documentId: record.document,
        documentName: record.expand?.document?.name ?? "-",
        codeId: record.code,
        codeLabel: record.expand?.code?.label ?? "-",
        codeColor: record.expand?.code?.color ?? "#888888",
        quote: record.quote ?? "",
        note: record.note ?? "",
        sourceKind: record.expand?.document?.type ?? "",
        createdByName: record.expand?.created_by?.name ?? "-",
        createdAt: record.created,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projectAnnotations.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [activeProject, pb, postgresCurrentUserId, postgresProjectId]);

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

  function openAnnotation(row: AnnRow) {
    setSelectedRow(row);
  }

  function jumpToSourceAnnotation(row: AnnRow) {
    if (postgresProjectId) {
      onOpenPostgresSourceAnnotation?.({
        sourceId: row.documentId,
        annotationId: row.id,
      });
      return;
    }
    if (!pb) return;
    const document = documents.find((item) => item.id === row.documentId);
    if (!document) return;
    store?.setActiveDocument(document);
    store?.setPendingAnnId(row.id);
    store?.setView("code-text");
  }

  const sourceKindSummaries = useMemo(() => {
    const summaryByKind = new Map<string, {
      label: string;
      count: number;
      shape: SourceObjectTypeShape;
      color: string;
      fill: SourceObjectFill;
      systemKey: string | null;
    }>();
    for (const row of rows) {
      const kind = (row.sourceKind ?? "").trim() || "source";
      const current = summaryByKind.get(kind);
      if (current) {
        current.count += 1;
      } else {
        summaryByKind.set(kind, {
          label: row.sourceObjectType || formatSourceType(kind),
          count: 1,
          shape: row.sourceObjectTypeShape ?? "rounded",
          color: row.sourceObjectTypeColor ?? SOURCE_OBJECT_TYPE_DEFAULT_COLOR,
          fill: row.sourceObjectTypeFill ?? "filled",
          systemKey: row.sourceObjectTypeSystemKey ?? null,
        });
      }
    }
    return [...summaryByKind.entries()]
      .map(([kind, summary]) => ({
        kind,
        label: summary.label,
        count: summary.count,
        shape: summary.shape,
        color: summary.color,
        fill: summary.fill,
        systemKey: summary.systemKey,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  }, [rows]);

  useEffect(() => {
    if (selectedSourceKindFilter === "all") return;
    if (!sourceKindSummaries.some((summary) => summary.kind === selectedSourceKindFilter)) {
      setSelectedSourceKindFilter("all");
    }
  }, [selectedSourceKindFilter, sourceKindSummaries]);

  const filteredRows = useMemo(
    () => selectedSourceKindFilter === "all"
      ? rows
      : rows.filter((row) => ((row.sourceKind ?? "").trim() || "source") === selectedSourceKindFilter),
    [rows, selectedSourceKindFilter],
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
            Back to Annotations
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              onClick={() => jumpToSourceAnnotation(selectedRow)}
            >
              Open in Source
            </button>
          </div>
        </div>

        <div className="doc-detail-layout">
          <div className="doc-detail-left">
            <div className="case-card">
              <h3 className="case-card-title">Annotation</h3>
              <p className="case-card-value">{formatAnnotationDisplayId(selectedRow.displayId)}</p>
              <p className="users-guide-copy" style={{ marginTop: 8, marginBottom: 0 }} title={selectedRow.lockTitle}>
                Lock: {selectedRow.lockLabel ?? "-"}
              </p>
            </div>

            <dl className="user-detail-meta case-detail-meta">
              <dt>ID</dt> <dd>{formatAnnotationDisplayId(selectedRow.displayId)}</dd>
              <dt>Source ID</dt> <dd>{selectedRow.documentId}</dd>
              <dt>{t("projectAnnotations.table.document")}</dt> <dd>{selectedRow.documentName}</dd>
              <dt>Source Type</dt> <dd>{formatSourceType(selectedRow.sourceKind)}</dd>
              <dt>{t("projectAnnotations.table.code")}</dt>
              <dd style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="code-swatch" style={{ background: selectedRow.codeColor }} />
                {selectedRow.codeLabel}
              </dd>
              <dt>Start Time</dt>
              <dd>
                {typeof selectedRow.timeStartMs === "number" ? formatMediaMilliseconds(selectedRow.timeStartMs) : "-"}
              </dd>
              <dt>End Time</dt>
              <dd>
                {typeof selectedRow.timeEndMs === "number" ? formatMediaMilliseconds(selectedRow.timeEndMs) : "-"}
              </dd>
              <dt>{t("projectAnnotations.table.createdBy")}</dt> <dd>{selectedRow.createdByName}</dd>
              <dt>{t("projectDocuments.columns.created")}</dt> <dd>{fmtDate(selectedRow.createdAt)}</dd>
            </dl>

            {selectedRow.note ? (
              <div className="case-card">
                <h3 className="case-card-title">Note</h3>
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
                    <h3 className="case-card-title">Annotated Text</h3>
                  </div>
                </div>
                <div className="doc-content-scroll-shell">
                  <pre
                    className="doc-content-body"
                    style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {selectedRow.quote || "No annotation text is available for this annotation."}
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
      {postgresMode && (
        <p className="users-guide-copy" style={{ marginBottom: 16 }}>
          PostgreSQL annotations are loaded directly from the project workspace. Selecting an annotation opens its detail view, and you can still jump from there into the source coding workflow when needed.
        </p>
      )}

      <div
        className="postgres-sources-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)",
          gap: 20,
          alignItems: "center",
          flex: 1,
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
                <h2 style={{ margin: 0, fontSize: 18 }}>Source object types</h2>
                <span className="home-restricted-value">{sourceKindSummaries.length}</span>
              </div>
            </div>
            <div>
              <table className="users-table" style={{ tableLayout: "fixed" }}>
                <tbody>
                  <tr
                    className="users-row"
                    style={{
                      background: selectedSourceKindFilter === "all" ? "rgba(53, 80, 112, 0.10)" : undefined,
                    }}
                  >
                    <td
                      className="users-td users-td--name"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSourceKindFilter("all")}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedSourceKindFilter("all");
                        }
                      }}
                    >
                      All
                    </td>
                    <td className="users-td users-td--muted">{rows.length}</td>
                  </tr>
                  {sourceKindSummaries.map((summary) => (
                    <tr
                      key={summary.kind}
                      className="users-row"
                      style={{
                        background: selectedSourceKindFilter === summary.kind ? "rgba(53, 80, 112, 0.10)" : undefined,
                      }}
                    >
                      <td
                        className="users-td users-td--name"
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedSourceKindFilter(summary.kind)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedSourceKindFilter(summary.kind);
                          }
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, paddingLeft: 18 }}>
                          <SourceObjectTypeSwatch
                            shape={summary.shape}
                            fill={summary.fill}
                            color={summary.color}
                            sourceVisualKey={getSourceObjectVisualKey(summary.systemKey)}
                          />
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {sourceTypeRowLabel(summary.label)}
                          </span>
                        </div>
                      </td>
                      <td className="users-td users-td--muted">{summary.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sourceKindSummaries.length === 0 ? (
                <div className="empty-state" style={{ minHeight: 140 }}>
                  <p>No source types yet.</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>

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
          <div
            className="users-table-wrap"
            style={{ maxHeight: 34 + (Math.max(rowCount, 1) + 2) * 36 }}
          >
            <table className="users-table">
              <thead>
                <tr>
                  <th style={{ width: ANNOTATION_ID_WIDTH }} className="users-th">
                    ID
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
        </section>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectAnnotations.help.title")}</h2>
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
            <div className="form-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
