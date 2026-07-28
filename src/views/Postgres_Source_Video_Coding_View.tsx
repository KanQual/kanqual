import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import {
  MediaController,
  MediaControlBar,
  MediaMuteButton,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaVolumeRange,
} from "media-chrome/react";
import type { PostgresExperimentCode } from "../lib/postgresExperiment";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import {
  createMediaWaveformCache,
  parseMediaWaveformCache,
  serializeMediaWaveformCache,
  type MediaWaveformCache,
} from "../lib/mediaWaveform";
import {
  createMediaVideoFrameIndexCache,
  parseMediaVideoFrameIndexCache,
  serializeMediaVideoFrameIndexCache,
} from "../lib/mediaVideoFrameIndex";
import { useI18n } from "../i18n/provider";
import type { PendingSelection, SourceAnnotationRow } from "./Postgres_Sources_View";
import {
  AnnotationEditorModal,
  type AnnotationContextMenuState,
  orderedCodesWithDepth,
  type PostgresSourceCodingViewProps,
  PostgresSourceAnnotationContextMenu,
  PostgresSourceAnnotationPanel,
  visibleCodeNodes,
} from "./Postgres_Source_Coding_Shared";
import {
  buildMediaClipQuote,
  formatMediaTime,
  PostgresSourceMediaTimeline,
  type PostgresSourceMediaTimelineHandle,
  type PostgresSourceMediaTimelineZoomUiState,
} from "./Postgres_Source_Media_Timeline";
import "./Postgres_Source_Media_Coding_View.css";

function fileExtensionFromPath(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function isAbsoluteStoragePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function resolveProjectStoragePath(projectStoragePath: string, sourceStoragePath: string): string {
  const trimmedSourcePath = sourceStoragePath.trim();
  if (!trimmedSourcePath) return "";
  if (isAbsoluteStoragePath(trimmedSourcePath)) return trimmedSourcePath;
  const trimmedProjectPath = projectStoragePath.trim().replace(/[\\/]+$/, "");
  if (!trimmedProjectPath) return trimmedSourcePath;
  const normalizedSourcePath = trimmedSourcePath.replace(/^([\\/])+/, "");
  return `${trimmedProjectPath}\\${normalizedSourcePath.replace(/\//g, "\\")}`;
}

function mediaTypeFromFileExtension(ext: string): string | null {
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a" || ext === "aac") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "flac") return "audio/flac";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "avi") return "video/x-msvideo";
  if (ext === "mkv") return "video/x-matroska";
  if (ext === "webm") return "video/webm";
  return null;
}

type PendingClipSelection = PendingSelection & {
  timeStartMs: number;
  timeEndMs: number;
  anchorKind: "time_range";
};

type SelectedClipDraft = {
  annotationId: string;
  startMs: number;
  endMs: number;
  codeIds: string[];
};

const PLAYBACK_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const FRAME_STEP_SECONDS = 1 / 30;
const FRAME_STEP_EPSILON_SECONDS = 0.0005;

function nearestPlaybackSpeedIndex(rate: number) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  PLAYBACK_SPEED_OPTIONS.forEach((option, index) => {
    const distance = Math.abs(option - rate);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  });
  return nearestIndex;
}

function clipSelectionFromRange(startMs: number, endMs: number): PendingClipSelection {
  const safeStart = Math.max(0, Math.round(Math.min(startMs, endMs)));
  const safeEnd = Math.max(safeStart + 1, Math.round(Math.max(startMs, endMs)));
  const quote = buildMediaClipQuote(safeStart, safeEnd);
  return {
    startOffset: 0,
    endOffset: 0,
    quote,
    displayLabel: quote,
    anchorKind: "time_range",
    timeStartMs: safeStart,
    timeEndMs: safeEnd,
  };
}

function selectedAnnotationRange(annotation: SourceAnnotationRow | null) {
  if (!annotation || annotation.timeStartMs == null || annotation.timeEndMs == null) return null;
  return {
    startMs: Math.max(0, annotation.timeStartMs),
    endMs: Math.max(annotation.timeStartMs + 1, annotation.timeEndMs),
  };
}

function rangeContainsTime(range: { startMs: number; endMs: number }, timeMs: number) {
  return timeMs >= range.startMs && timeMs < range.endMs;
}

function formatEditableTimestamp(timeMs: number) {
  const totalTenths = Math.max(0, Math.round(timeMs / 100));
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 1) {
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function parseEditableTimestamp(value: string): number | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  if (!trimmedValue.includes(":")) {
    const seconds = Number(trimmedValue);
    return Number.isFinite(seconds) ? seconds : null;
  }

  const parts = trimmedValue.split(":");
  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (minutes < 0 || seconds < 0 || seconds >= 60) return null;

    return minutes * 60 + seconds;
  }

  if (parts.length !== 3) return null;

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

function TimestampStepUpIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M6 3L10 8H2L6 3Z" fill="currentColor" />
    </svg>
  );
}

function TimestampStepDownIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M6 9L2 4H10L6 9Z" fill="currentColor" />
    </svg>
  );
}

function ZoomFitIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.8" cy="6.8" r="4.7" />
      <path d="M10.15 10.15L14 14" />
      <path d="M5.55 5.55L4.55 4.55" />
      <path d="M8.05 5.55L9.05 4.55" />
      <path d="M5.55 8.05L4.55 9.05" />
      <path d="M8.05 8.05L9.05 9.05" />
      <path d="M5.3 4.55H4.55V5.3" />
      <path d="M8.3 4.55H9.05V5.3" />
      <path d="M5.3 9.05H4.55V8.3" />
      <path d="M8.3 9.05H9.05V8.3" />
    </svg>
  );
}

function NewClipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 3.5h-2v9h2" />
      <path d="M11.5 3.5h2v9h-2" />
      <path d="M8 5.5v5" />
      <path d="M5.5 8h5" />
    </svg>
  );
}

function ClearClipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 3.5l9 9" />
      <path d="M12.5 3.5l-9 9" />
    </svg>
  );
}

function TrashClipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h8" />
      <path d="M6 5V3.5h4V5" />
      <path d="M5.25 7l.5 5.5h4.5l.5-5.5" />
    </svg>
  );
}

function AcceptClipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.25l3.25 3.25L13 4.5" />
    </svg>
  );
}

function ExtractFrameIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.25 4.25L6.25 2.75H9.75L10.75 4.25H12.25C13.2 4.25 14 5.05 14 6V11.5C14 12.45 13.2 13.25 12.25 13.25H3.75C2.8 13.25 2 12.45 2 11.5V6C2 5.05 2.8 4.25 3.75 4.25H5.25Z" />
      <circle cx="8" cy="8.75" r="2.35" />
      <path d="M11.75 6.25H11.8" />
    </svg>
  );
}

function findAdjacentFrameTimestamp(
  timestampsSeconds: number[],
  currentTimeSeconds: number,
  direction: -1 | 1,
) {
  if (timestampsSeconds.length === 0) return null;
  if (direction > 0) {
    let left = 0;
    let right = timestampsSeconds.length;
    const target = currentTimeSeconds + FRAME_STEP_EPSILON_SECONDS;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (timestampsSeconds[mid] <= target) left = mid + 1;
      else right = mid;
    }
    return timestampsSeconds[Math.min(left, timestampsSeconds.length - 1)] ?? null;
  }

  let left = 0;
  let right = timestampsSeconds.length;
  const target = currentTimeSeconds - FRAME_STEP_EPSILON_SECONDS;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (timestampsSeconds[mid] < target) left = mid + 1;
    else right = mid;
  }
  return timestampsSeconds[Math.max(0, left - 1)] ?? null;
}

function FrameBackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4v8" />
      <path d="M12 4L6.5 8L12 12V4Z" />
    </svg>
  );
}

function FrameForwardIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4v8" />
      <path d="M4 4L9.5 8L4 12V4Z" />
    </svg>
  );
}

function sanitizeFrameFileNamePart(value: string) {
  const sanitized = value
    .trim()
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "video-frame";
}

function waitForVideoReady(videoElement: HTMLVideoElement) {
  if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      videoElement.removeEventListener("loadeddata", handleReady);
      videoElement.removeEventListener("canplay", handleReady);
      videoElement.removeEventListener("error", handleError);
    };
    const handleReady = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Could not prepare the video frame for extraction."));
    };
    videoElement.addEventListener("loadeddata", handleReady, { once: true });
    videoElement.addEventListener("canplay", handleReady, { once: true });
    videoElement.addEventListener("error", handleError, { once: true });
  });
}

function waitForVideoSeek(videoElement: HTMLVideoElement, timeSeconds: number) {
  if (!Number.isFinite(timeSeconds)) return Promise.resolve();
  if (Math.abs(videoElement.currentTime - timeSeconds) <= 0.02 && !videoElement.seeking) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      videoElement.removeEventListener("seeked", handleSeeked);
      videoElement.removeEventListener("error", handleError);
    };
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Could not seek the video frame for extraction."));
    };
    videoElement.addEventListener("seeked", handleSeeked, { once: true });
    videoElement.addEventListener("error", handleError, { once: true });
    videoElement.currentTime = timeSeconds;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode the extracted frame."));
    }, "image/png");
  });
}

function formatOpenTimingDetails(details?: Record<string, number | string | boolean | null | undefined>) {
  if (!details) return "";
  const entries = Object.entries(details).filter(([, value]) => value != null);
  if (entries.length === 0) return "";
  return ` ${entries.map(([key, value]) => `${key}=${String(value)}`).join(" ")}`;
}

export function PostgresSourceVideoCodingView({
  row,
  codes,
  annotations,
  codeOptions,
  currentUserId,
  sourceLock,
  sourceLockConflict,
  lockSyncing,
  canKickSourceLocks,
  canManageAnnotations,
  canManageMemos,
  initialSelectedAnnotationId,
  projectStoragePath,
  saving,
  error,
  onCreateAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onKickSourceLock,
  onOpenMemoDraft,
  onUpdateSourceWaveform,
  onUpdateSourceVideoFrameIndex,
  onExtractVideoFrame,
  onBack,
}: PostgresSourceCodingViewProps & {
  projectStoragePath: string;
}) {
  const mediaKind = "video" as const;
  const { t } = useI18n();
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingClipSelection | null>(null);
  const [pendingClipCodeIds, setPendingClipCodeIds] = useState<string[]>([]);
  const [selectedClipDraft, setSelectedClipDraft] = useState<SelectedClipDraft | null>(null);
  const [editingAnnotation, setEditingAnnotation] = useState<SourceAnnotationRow | null>(null);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generatedWaveformCache, setGeneratedWaveformCache] = useState<MediaWaveformCache | null>(null);
  const [collapsedCodeIds, setCollapsedCodeIds] = useState<Set<string>>(new Set());
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [clipPlaybackAnnotationId, setClipPlaybackAnnotationId] = useState<string | null>(null);
  const [mediaElement, setMediaElement] = useState<HTMLMediaElement | null>(null);
  const [videoWaveformPanelWidth, setVideoWaveformPanelWidth] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [zoomUiState, setZoomUiState] = useState<PostgresSourceMediaTimelineZoomUiState>({
    canZoomIn: false,
    canZoomOut: false,
    canFit: false,
    zoomPercent: 100,
  });
  const [clipSelectionDraftStart, setClipSelectionDraftStart] = useState("");
  const [clipSelectionDraftEnd, setClipSelectionDraftEnd] = useState("");
  const [volumeControlOpen, setVolumeControlOpen] = useState(false);
  const [zoomControlOpen, setZoomControlOpen] = useState(false);
  const [speedControlOpen, setSpeedControlOpen] = useState(false);
  const [frameExtracting, setFrameExtracting] = useState(false);
  const [frameExtractError, setFrameExtractError] = useState<string | null>(null);
  const [frameSourceDraft, setFrameSourceDraft] = useState<{ file: File; title: string; previewUrl: string; extractedFromVideoSourceId: string; extractedFromVideoTimeMs: number } | null>(null);
  const [codeContextMenu, setCodeContextMenu] = useState<{ x: number; y: number; code: PostgresExperimentCode } | null>(null);
  const [annotationContextMenu, setAnnotationContextMenu] = useState<AnnotationContextMenuState | null>(null);
  const [clipDeleteConfirmation, setClipDeleteConfirmation] = useState<SourceAnnotationRow | null>(null);
  const codeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const annotationContextMenuRef = useRef<HTMLDivElement | null>(null);
  const codeContextMenuStyle = useViewportContextMenuStyle(codeContextMenu, codeContextMenuRef);
  const annotationContextMenuStyle = useViewportContextMenuStyle(annotationContextMenu, annotationContextMenuRef);
  const videoPreviewElementRef = useRef<HTMLVideoElement | null>(null);
  const mediaElementRef = useRef<HTMLMediaElement | null>(null);
  const mediaTimelineRef = useRef<PostgresSourceMediaTimelineHandle | null>(null);
  const playbackRangeRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const playbackMonitorFrameRef = useRef<number | null>(null);
  const waveformRecoveryAttemptedRef = useRef<string | null>(null);
  const frameIndexRecoveryAttemptedRef = useRef<string | null>(null);
  const openTimingStartRef = useRef<number>(performance.now());
  const volumeControlCloseTimeoutRef = useRef<number | null>(null);
  const zoomControlCloseTimeoutRef = useRef<number | null>(null);
  const speedControlCloseTimeoutRef = useRef<number | null>(null);
  const mediaElementCallbackRef = useCallback((element: HTMLMediaElement | null) => {
    if (mediaElementRef.current === element) return;
    mediaElementRef.current = element;
    setMediaElement(element);
  }, []);
  const videoPreviewElementCallbackRef = useCallback((element: HTMLVideoElement | null) => {
    videoPreviewElementRef.current = element;
  }, []);

  const canEditAnnotations = canManageAnnotations && !!sourceLock && sourceLock.userId === currentUserId && !sourceLockConflict;
  const fileExt = row.filePath ? fileExtensionFromPath(row.filePath) : "";
  const resolvedFilePath = resolveProjectStoragePath(projectStoragePath, row.filePath);
  const persistedWaveformCache = useMemo(() => parseMediaWaveformCache(row.waveformPeaksJson), [row.waveformPeaksJson]);
  const videoFrameIndexCache = useMemo(
    () => parseMediaVideoFrameIndexCache(row.videoFrameIndexJson),
    [row.videoFrameIndexJson],
  );
  const waveformCache = generatedWaveformCache ?? persistedWaveformCache;
  const mediaAnnotations = useMemo(
    () => annotations
      .filter((annotation) => annotation.timeStartMs != null && annotation.timeEndMs != null)
      .sort((left, right) => (left.timeStartMs ?? 0) - (right.timeStartMs ?? 0) || left.createdAt.localeCompare(right.createdAt)),
    [annotations],
  );
  const codesById = useMemo(() => new Map(codes.map((code) => [code.id, code])), [codes]);
  const codeTree = useMemo(() => orderedCodesWithDepth(codes), [codes]);
  const visibleCodes = useMemo(() => visibleCodeNodes(codeTree, collapsedCodeIds), [collapsedCodeIds, codeTree]);
  const annotationCountByCodeId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of mediaAnnotations) {
      for (const codeId of annotation.codeIds) {
        counts.set(codeId, (counts.get(codeId) ?? 0) + 1);
      }
    }
    return counts;
  }, [mediaAnnotations]);
  const selectedAnnotation = selectedAnnotationId
    ? mediaAnnotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null
    : null;
  const selectedRange = selectedAnnotationRange(selectedAnnotation);
  const activeClipRange = pendingSelection
    ? { startMs: pendingSelection.timeStartMs, endMs: pendingSelection.timeEndMs }
    : selectedClipDraft && selectedClipDraft.annotationId === selectedAnnotationId
      ? { startMs: selectedClipDraft.startMs, endMs: selectedClipDraft.endMs }
    : selectedRange;
  const activePlaybackRange = pendingSelection
    ? { startMs: pendingSelection.timeStartMs, endMs: pendingSelection.timeEndMs }
    : selectedClipDraft && selectedClipDraft.annotationId === selectedAnnotationId
      ? { startMs: selectedClipDraft.startMs, endMs: selectedClipDraft.endMs }
    : selectedRange;
  const activeClipCodeIds = pendingSelection
    ? pendingClipCodeIds
    : selectedClipDraft && selectedClipDraft.annotationId === selectedAnnotationId
      ? selectedClipDraft.codeIds
      : selectedAnnotation?.codeIds ?? [];
  const activeClipHasCodes = activeClipCodeIds.length > 0;
  const activeClipCodes = activeClipCodeIds.map((codeId) => codesById.get(codeId)).filter((code): code is PostgresExperimentCode => !!code);
  const pendingClipCodeColors = useMemo(
    () => pendingClipCodeIds.map((codeId) => codesById.get(codeId)?.color ?? "#888888"),
    [codesById, pendingClipCodeIds],
  );
  const zoomSliderMax = Math.max(800, zoomUiState.zoomPercent);
  const zoomSliderValue = zoomSliderMax + 100 - Math.max(100, zoomUiState.zoomPercent);
  const zoomSliderFillPercent = Math.min(100, ((zoomSliderValue - 100) / (zoomSliderMax - 100)) * 100);
  const playbackRateLabel = `${Number.isInteger(playbackRate) ? playbackRate.toFixed(0) : playbackRate.toFixed(2).replace(/0$/, "")}x`;
  const playbackSpeedIndex = nearestPlaybackSpeedIndex(playbackRate);
  const playbackSpeedSliderValue = PLAYBACK_SPEED_OPTIONS.length - 1 - playbackSpeedIndex;
  const playbackSpeedFillPercent = (playbackSpeedSliderValue / (PLAYBACK_SPEED_OPTIONS.length - 1)) * 100;

  function logOpenTiming(phase: string, details?: Record<string, number | string | boolean | null | undefined>) {
    const elapsedMs = Math.round(performance.now() - openTimingStartRef.current);
    console.info(`[media-open:${row.id}] +${elapsedMs}ms ${phase}${formatOpenTimingDetails(details)}`);
  }

  function handleClipBadgeContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!selectedAnnotation || (!canManageMemos && !canEditAnnotations)) return;
    event.preventDefault();
    event.stopPropagation();
    setPendingSelection(null);
    setPendingClipCodeIds([]);
    setSelectedAnnotationId(selectedAnnotation.id);
    setAnnotationContextMenu({ x: event.clientX, y: event.clientY, annotation: selectedAnnotation });
  }

  useEffect(() => {
    playbackRangeRef.current = activePlaybackRange;
  }, [activePlaybackRange]);

  useEffect(() => {
    const videoElement = videoPreviewElementRef.current;
    if (!videoElement) {
      setVideoWaveformPanelWidth(null);
      return;
    }

    let frameId: number | null = null;
    const syncPanelWidth = () => {
      if (frameId != null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        const frame = videoElement.closest<HTMLElement>(".media-player-console-frame");
        const card = videoElement.closest<HTMLElement>(".media-source-card");
        const controlsPanel = frame?.querySelector<HTMLElement>(".media-player-controls-panel--video") ?? null;
        const frameRect = frame?.getBoundingClientRect();
        const cardRect = card?.getBoundingClientRect();
        const controlsPanelRect = controlsPanel?.getBoundingClientRect();
        const maxPanelWidth = frame ? Math.max(240, frame.clientWidth - 20) : Number.POSITIVE_INFINITY;
        const maxVideoWidth = Math.max(180, maxPanelWidth - 28);
        const viewportBottomPadding = 28;
        const controlsReserveHeight = Math.max(280, controlsPanelRect ? Math.ceil(controlsPanelRect.height) + 62 : 280);
        const availableBelowFrameTop = frameRect ? window.innerHeight - frameRect.top - viewportBottomPadding : window.innerHeight;
        const availableCardHeight = cardRect ? cardRect.height - 54 : availableBelowFrameTop;
        const maxVideoHeight = Math.max(
          180,
          Math.min(window.innerHeight * 0.62, availableBelowFrameTop - controlsReserveHeight, availableCardHeight - controlsReserveHeight),
        );
        const naturalWidth = videoElement.videoWidth || 0;
        const naturalHeight = videoElement.videoHeight || 0;

        if (naturalWidth > 0 && naturalHeight > 0) {
          const fittedHeight = Math.min(naturalHeight, maxVideoHeight);
          const fittedWidth = Math.min(naturalWidth, maxVideoWidth, fittedHeight * (naturalWidth / naturalHeight));
          setVideoWaveformPanelWidth(Math.ceil(fittedWidth) + 28);
          return;
        }

        const videoWidth = videoElement.getBoundingClientRect().width;
        setVideoWaveformPanelWidth(videoWidth > 0 ? Math.ceil(Math.min(videoWidth, maxVideoWidth)) + 28 : null);
      });
    };

    syncPanelWidth();
    videoElement.addEventListener("loadedmetadata", syncPanelWidth);
    window.addEventListener("resize", syncPanelWidth);
    const resizeObserver = new ResizeObserver(syncPanelWidth);
    resizeObserver.observe(videoElement);

    return () => {
      if (frameId != null) window.cancelAnimationFrame(frameId);
      videoElement.removeEventListener("loadedmetadata", syncPanelWidth);
      window.removeEventListener("resize", syncPanelWidth);
      resizeObserver.disconnect();
    };
  }, [previewUrl]);

  useEffect(() => {
    openTimingStartRef.current = performance.now();
    logOpenTiming("open-start", {
      mediaKind,
      hasCachedWaveform: Boolean(row.waveformPeaksJson),
    });
  }, [mediaKind, row.id, row.waveformPeaksJson]);

  useEffect(() => {
    return () => {
      if (playbackMonitorFrameRef.current != null) {
        window.cancelAnimationFrame(playbackMonitorFrameRef.current);
        playbackMonitorFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!initialSelectedAnnotationId) return;
    if (!mediaAnnotations.some((annotation) => annotation.id === initialSelectedAnnotationId)) return;
    setSelectedAnnotationId(initialSelectedAnnotationId);
  }, [initialSelectedAnnotationId, mediaAnnotations]);

  useEffect(() => {
    if (selectedAnnotationId && !mediaAnnotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
      setSelectedClipDraft(null);
    }
  }, [mediaAnnotations, selectedAnnotationId]);

  useEffect(() => {
    if (pendingSelection || !selectedAnnotation || !selectedRange) {
      setSelectedClipDraft(null);
      return;
    }
    setSelectedClipDraft({
      annotationId: selectedAnnotation.id,
      startMs: selectedRange.startMs,
      endMs: selectedRange.endMs,
      codeIds: selectedAnnotation.codeIds,
    });
  }, [pendingSelection, selectedAnnotation?.id]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (codeContextMenuRef.current && !codeContextMenuRef.current.contains(event.target as Node)) {
        setCodeContextMenu(null);
      }
      if (annotationContextMenuRef.current && !annotationContextMenuRef.current.contains(event.target as Node)) {
        setAnnotationContextMenu(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCodeContextMenu(null);
        setAnnotationContextMenu(null);
        if (pendingSelection && !saving) {
          event.preventDefault();
          setPendingSelection(null);
          setPendingClipCodeIds([]);
        }
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [pendingSelection, saving]);

  useEffect(() => {
    setGeneratedWaveformCache(null);
    waveformRecoveryAttemptedRef.current = null;
    frameIndexRecoveryAttemptedRef.current = null;
  }, [row.id, row.waveformPeaksJson, row.videoFrameIndexJson]);

  useEffect(() => {
    if (!resolvedFilePath) {
      setPreviewLoading(false);
      setPreviewBytes(null);
      setPreviewError(null);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setPreviewLoading(true);
    setPreviewError(null);
    logOpenTiming("file-read-start", { path: resolvedFilePath });

    void readTauriFile(resolvedFilePath)
      .then((bytes) => {
        if (cancelled) return;
        setPreviewBytes(bytes);
        logOpenTiming("file-read-complete", { bytes: bytes.byteLength });
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaTypeFromFileExtension(fileExt) ?? undefined }));
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
        logOpenTiming("preview-url-ready");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setPreviewBytes(null);
        logOpenTiming("file-read-error", {
          message: loadError instanceof Error ? loadError.message : "unknown",
        });
        setPreviewError(loadError instanceof Error ? loadError.message : `Failed to load ${mediaKind} preview.`);
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileExt, mediaKind, resolvedFilePath]);

  useEffect(() => {
    if (waveformCache || !previewBytes) return;
    if (waveformRecoveryAttemptedRef.current === row.id) return;

    waveformRecoveryAttemptedRef.current = row.id;
    let cancelled = false;

    void createMediaWaveformCache(previewBytes).then((nextCache) => {
      if (cancelled || !nextCache) return;
      setGeneratedWaveformCache(nextCache);
      void onUpdateSourceWaveform(row.id, serializeMediaWaveformCache(nextCache)).catch(() => {});
    });

    return () => {
      cancelled = true;
    };
  }, [onUpdateSourceWaveform, previewBytes, row.id, waveformCache]);

  useEffect(() => {
    if (videoFrameIndexCache || !previewBytes || !onUpdateSourceVideoFrameIndex) return;
    if (frameIndexRecoveryAttemptedRef.current === row.id) return;
    if (waveformCache && !row.waveformPeaksJson && waveformRecoveryAttemptedRef.current === row.id) return;
    if (!waveformCache && waveformRecoveryAttemptedRef.current !== row.id) return;

    frameIndexRecoveryAttemptedRef.current = row.id;
    let cancelled = false;

    void createMediaVideoFrameIndexCache(previewBytes).then((nextCache) => {
      if (cancelled || !nextCache) return;
      void onUpdateSourceVideoFrameIndex(row.id, serializeMediaVideoFrameIndexCache(nextCache)).catch(() => {});
    });

    return () => {
      cancelled = true;
    };
  }, [onUpdateSourceVideoFrameIndex, previewBytes, row.id, row.waveformPeaksJson, videoFrameIndexCache, waveformCache]);

  useEffect(() => {
    setMediaElement(null);
    mediaElementRef.current = null;
    setPlaybackRate(1);
  }, [previewUrl, mediaKind]);

  useEffect(() => {
    if (!mediaElement) return;
    if (mediaElement.playbackRate !== 1) {
      mediaElement.playbackRate = 1;
    }
    setPlaybackRate(1);
  }, [mediaElement, previewUrl, mediaKind]);

  useEffect(() => {
    if (mediaKind !== "video" || !mediaElement) return;
    const visibleVideoElement = videoPreviewElementRef.current;
    if (!visibleVideoElement || visibleVideoElement === mediaElement) return;

    let frameId: number | null = null;

    const syncVisibleTime = () => {
      if (Number.isFinite(mediaElement.currentTime)) {
        const driftSeconds = Math.abs(visibleVideoElement.currentTime - mediaElement.currentTime);
        if (driftSeconds > 0.04) {
          visibleVideoElement.currentTime = mediaElement.currentTime;
        }
      }
    };

    const stopSyncLoop = () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
    };

    const startSyncLoop = () => {
      stopSyncLoop();
      const tick = () => {
        syncVisibleTime();
        if (mediaElement.paused || mediaElement.ended) {
          frameId = null;
          return;
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
    };

    const syncVisiblePlayback = () => {
      syncVisibleTime();
      visibleVideoElement.playbackRate = mediaElement.playbackRate || 1;
      if (mediaElement.paused || mediaElement.ended) {
        visibleVideoElement.pause();
        stopSyncLoop();
        return;
      }

      visibleVideoElement.muted = true;
      void visibleVideoElement.play().catch(() => {
        syncVisibleTime();
      });
      startSyncLoop();
    };

    mediaElement.addEventListener("play", syncVisiblePlayback);
    mediaElement.addEventListener("pause", syncVisiblePlayback);
    mediaElement.addEventListener("ended", syncVisiblePlayback);
    mediaElement.addEventListener("seeking", syncVisibleTime);
    mediaElement.addEventListener("seeked", syncVisibleTime);
    mediaElement.addEventListener("timeupdate", syncVisibleTime);
    mediaElement.addEventListener("ratechange", syncVisiblePlayback);
    visibleVideoElement.addEventListener("loadedmetadata", syncVisibleTime);
    syncVisiblePlayback();

    return () => {
      stopSyncLoop();
      mediaElement.removeEventListener("play", syncVisiblePlayback);
      mediaElement.removeEventListener("pause", syncVisiblePlayback);
      mediaElement.removeEventListener("ended", syncVisiblePlayback);
      mediaElement.removeEventListener("seeking", syncVisibleTime);
      mediaElement.removeEventListener("seeked", syncVisibleTime);
      mediaElement.removeEventListener("timeupdate", syncVisibleTime);
      mediaElement.removeEventListener("ratechange", syncVisiblePlayback);
      visibleVideoElement.removeEventListener("loadedmetadata", syncVisibleTime);
    };
  }, [mediaElement, mediaKind, previewUrl]);

  useEffect(() => {
    const mediaElement = mediaElementRef.current;
    if (!mediaElement) return;

    const stopPlaybackAtRangeEnd = (playbackRange: { startMs: number; endMs: number }) => {
      mediaElement.pause();
      mediaElement.currentTime = playbackRange.endMs / 1000;
      setCurrentTimeMs(playbackRange.endMs);
      setClipPlaybackAnnotationId(null);
    };

    const cancelPlaybackMonitor = () => {
      if (playbackMonitorFrameRef.current != null) {
        window.cancelAnimationFrame(playbackMonitorFrameRef.current);
        playbackMonitorFrameRef.current = null;
      }
    };

    const startPlaybackMonitor = () => {
      cancelPlaybackMonitor();
      const tick = () => {
        const playbackRange = playbackRangeRef.current;
        if (!playbackRange || mediaElement.paused || mediaElement.ended) {
          playbackMonitorFrameRef.current = null;
          return;
        }
        if (mediaElement.currentTime * 1000 >= playbackRange.endMs) {
          stopPlaybackAtRangeEnd(playbackRange);
          playbackMonitorFrameRef.current = null;
          return;
        }
        playbackMonitorFrameRef.current = window.requestAnimationFrame(tick);
      };
      playbackMonitorFrameRef.current = window.requestAnimationFrame(tick);
    };

    const handleTimeUpdate = () => {
      const currentTimeMs = mediaElement.currentTime * 1000;
      setCurrentTimeMs(currentTimeMs);
      const playbackRange = playbackRangeRef.current;
      if (!playbackRange) return;
      if (currentTimeMs >= playbackRange.endMs) {
        stopPlaybackAtRangeEnd(playbackRange);
      }
    };

    const handleLoadedMetadata = () => {
      setDurationMs(Number.isFinite(mediaElement.duration) ? mediaElement.duration * 1000 : 0);
      setCurrentTimeMs(mediaElement.currentTime * 1000);
      setPlaybackRate(mediaElement.playbackRate || 1);
      logOpenTiming("media-loaded-metadata", {
        durationMs: Number.isFinite(mediaElement.duration) ? Math.round(mediaElement.duration * 1000) : 0,
      });
    };
    const handleCanPlay = () => {
      logOpenTiming("media-can-play");
    };

    const handleEnded = () => setClipPlaybackAnnotationId(null);
    const handleRateChange = () => setPlaybackRate(mediaElement.playbackRate || 1);
    const handlePlay = () => {
      const playbackRange = playbackRangeRef.current;
      if (playbackRange) {
        const currentTimeMs = mediaElement.currentTime * 1000;
        if (!rangeContainsTime(playbackRange, currentTimeMs)) {
          mediaElement.currentTime = playbackRange.startMs / 1000;
          setCurrentTimeMs(playbackRange.startMs);
        }
      }
      startPlaybackMonitor();
    };
    const handlePause = () => {
      cancelPlaybackMonitor();
      if (!mediaElement.ended) setClipPlaybackAnnotationId(null);
    };

    mediaElement.addEventListener("timeupdate", handleTimeUpdate);
    mediaElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    mediaElement.addEventListener("canplay", handleCanPlay);
    mediaElement.addEventListener("ended", handleEnded);
    mediaElement.addEventListener("ratechange", handleRateChange);
    mediaElement.addEventListener("play", handlePlay);
    mediaElement.addEventListener("pause", handlePause);
    handleLoadedMetadata();

    return () => {
      cancelPlaybackMonitor();
      mediaElement.removeEventListener("timeupdate", handleTimeUpdate);
      mediaElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      mediaElement.removeEventListener("canplay", handleCanPlay);
      mediaElement.removeEventListener("ended", handleEnded);
      mediaElement.removeEventListener("ratechange", handleRateChange);
      mediaElement.removeEventListener("play", handlePlay);
      mediaElement.removeEventListener("pause", handlePause);
    };
  }, [clipPlaybackAnnotationId, mediaAnnotations]);

  function togglePendingClipCode(codeId: string) {
    setPendingClipCodeIds((current) => (
      current.includes(codeId)
        ? current.filter((entry) => entry !== codeId)
        : [...current, codeId]
    ));
  }

  function toggleSelectedAnnotationCode(codeId: string) {
    if (!selectedAnnotation || !canEditAnnotations || saving) return;
    setSelectedClipDraft((current) => {
      const draft = current && current.annotationId === selectedAnnotation.id
        ? current
        : {
          annotationId: selectedAnnotation.id,
          startMs: selectedAnnotation.timeStartMs ?? 0,
          endMs: selectedAnnotation.timeEndMs ?? (selectedAnnotation.timeStartMs ?? 0) + 1,
          codeIds: selectedAnnotation.codeIds,
        };
      const nextCodeIds = draft.codeIds.includes(codeId)
        ? draft.codeIds.filter((entry) => entry !== codeId)
        : [...draft.codeIds, codeId];
      return { ...draft, codeIds: nextCodeIds };
    });
  }

  function handleCodebookCodeClick(codeId: string) {
    if (!canEditAnnotations || saving) return;
    if (pendingSelection) {
      togglePendingClipCode(codeId);
      return;
    }
    if (selectedAnnotation) {
      toggleSelectedAnnotationCode(codeId);
    }
  }

  function getDraftRangeFromInputs(fallbackRange: { startMs: number; endMs: number }) {
    const parsedStartSeconds = parseEditableTimestamp(clipSelectionDraftStart);
    const parsedEndSeconds = parseEditableTimestamp(clipSelectionDraftEnd);
    if (parsedStartSeconds == null || parsedEndSeconds == null) return fallbackRange;

    const durationLimitMs = durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY;
    const nextStartMs = Math.max(0, Math.round(parsedStartSeconds * 1000));
    const nextEndMs = Math.min(durationLimitMs, Math.round(parsedEndSeconds * 1000));
    return {
      startMs: nextStartMs,
      endMs: Math.max(nextStartMs + 1, nextEndMs),
    };
  }

  async function acceptActiveClipChanges() {
    if (!activeClipRange || !canEditAnnotations || saving) return;
    if (!activeClipHasCodes) return;
    const nextRange = getDraftRangeFromInputs(activeClipRange);

    if (pendingSelection) {
      await onCreateAnnotation(row.id, clipSelectionFromRange(nextRange.startMs, nextRange.endMs), { codeIds: pendingClipCodeIds, note: "" });
      setPendingSelection(null);
      setPendingClipCodeIds([]);
      setClipPlaybackAnnotationId(null);
      return;
    }

    if (!selectedAnnotation) return;
    const draft = selectedClipDraft && selectedClipDraft.annotationId === selectedAnnotation.id
      ? selectedClipDraft
      : {
        annotationId: selectedAnnotation.id,
        startMs: nextRange.startMs,
        endMs: nextRange.endMs,
        codeIds: selectedAnnotation.codeIds,
      };
    const clipQuote = buildMediaClipQuote(nextRange.startMs, nextRange.endMs);
    await onUpdateAnnotation(selectedAnnotation, {
      codeIds: draft.codeIds,
      note: selectedAnnotation.note,
      startOffset: null,
      endOffset: null,
      quote: selectedAnnotation.quote.startsWith("Clip ") ? clipQuote : selectedAnnotation.quote,
      anchorKind: "time_range",
      timeStartMs: nextRange.startMs,
      timeEndMs: nextRange.endMs,
    });
    setSelectedClipDraft(null);
    setSelectedAnnotationId(null);
    setClipPlaybackAnnotationId(null);
  }

  function toggleCollapsedCode(codeId: string) {
    setCollapsedCodeIds((current) => {
      const next = new Set(current);
      if (next.has(codeId)) next.delete(codeId);
      else next.add(codeId);
      return next;
    });
  }

  function seekToAnnotation(annotation: SourceAnnotationRow) {
    if (annotation.timeStartMs == null || !mediaElementRef.current) return;
    mediaElementRef.current.currentTime = annotation.timeStartMs / 1000;
    setCurrentTimeMs(annotation.timeStartMs);
  }

  function playClip(annotationId: string) {
    const annotation = mediaAnnotations.find((entry) => entry.id === annotationId);
    const mediaElement = mediaElementRef.current;
    if (!annotation || annotation.timeStartMs == null || annotation.timeEndMs == null || !mediaElement) return;
    playRange(annotation.timeStartMs, annotation.timeEndMs, annotation.id);
    setPendingSelection(null);
    setPendingClipCodeIds([]);
    setSelectedAnnotationId(annotation.id);
  }

  function playRange(startMs: number, endMs: number, annotationId: string | null) {
    const mediaElement = mediaElementRef.current;
    if (!mediaElement) return;
    mediaElement.currentTime = startMs / 1000;
    setCurrentTimeMs(startMs);
    setClipPlaybackAnnotationId(annotationId);
    playbackRangeRef.current = { startMs, endMs };
    void mediaElement.play().catch(() => {
      setClipPlaybackAnnotationId(null);
    });
  }

  function createSelectionFromCurrentTime() {
    const mediaElement = mediaElementRef.current;
    const currentStartMs = mediaElement ? Math.max(0, Math.round(mediaElement.currentTime * 1000)) : currentTimeMs;
    const knownDurationMs = mediaElement && Number.isFinite(mediaElement.duration)
      ? Math.max(0, Math.round(mediaElement.duration * 1000))
      : durationMs;
    const targetEndMs = currentStartMs + 5000;
    const nextEndMs = knownDurationMs > 0
      ? Math.max(currentStartMs + 1, Math.min(targetEndMs, knownDurationMs))
      : targetEndMs;
    setPendingSelection(clipSelectionFromRange(currentStartMs, nextEndMs));
    setPendingClipCodeIds([]);
    setSelectedAnnotationId(null);
    setClipPlaybackAnnotationId(null);
  }

  async function handleUpdateAnnotationRange(annotationId: string, startMs: number, endMs: number) {
    const annotation = mediaAnnotations.find((entry) => entry.id === annotationId);
    if (!annotation) return;
    if (annotationId === selectedAnnotationId) {
      setSelectedClipDraft((current) => ({
        annotationId,
        startMs,
        endMs,
        codeIds: current && current.annotationId === annotationId ? current.codeIds : annotation.codeIds,
      }));
      return;
    }
    const clipQuote = buildMediaClipQuote(startMs, endMs);
    await onUpdateAnnotation(annotation, {
      codeIds: annotation.codeIds,
      note: annotation.note,
      startOffset: null,
      endOffset: null,
      quote: annotation.quote.startsWith("Clip ") ? clipQuote : annotation.quote,
      anchorKind: "time_range",
      timeStartMs: startMs,
      timeEndMs: endMs,
    });
  }

  const playerActionButtonStyle = {
    appearance: "none",
    border: "1px solid rgba(53, 80, 112, 0.16)",
    background: "linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(232, 238, 244, 0.98))",
    color: "#233142",
    borderRadius: 999,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.01em",
    lineHeight: 1,
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.08)",
  } as const;
  const clipActionEnabledStyle = canEditAnnotations
    ? { opacity: 1, cursor: "pointer" as const }
    : { opacity: 0.45, cursor: "not-allowed" as const };
  const mediaChromeThemeStyle = {
    "--media-primary-color": "#233142",
    "--media-secondary-color": "rgba(232, 238, 244, 0.98)",
    "--media-text-color": "#233142",
    "--media-icon-color": "#233142",
    "--media-control-background": "linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(232, 238, 244, 0.98))",
    "--media-control-hover-background": "rgba(53, 80, 112, 0.10)",
    "--media-control-height": "34px",
    "--media-control-padding": "8px",
    "--media-button-padding": "8px",
    "--media-button-icon-height": "18px",
    "--media-button-icon-width": "18px",
    "--media-font-family": "\"Noto Sans\", \"Segoe UI\", sans-serif",
    "--media-font-size": "12px",
    "--media-font-weight": "700",
    "--media-range-track-height": "4px",
    "--media-range-track-border-radius": "999px",
    "--media-range-track-background": "rgba(53, 80, 112, 0.14)",
    "--media-range-bar-color": "#4b5563",
    "--media-range-thumb-width": "12px",
    "--media-range-thumb-height": "12px",
    "--media-range-thumb-border-radius": "999px",
    "--media-range-thumb-background": "#4b5563",
    "--media-range-thumb-border": "2px solid rgba(255, 255, 255, 0.98)",
    "--media-range-thumb-box-shadow": "0 1px 2px rgba(15, 23, 42, 0.18)",
    "--media-focus-box-shadow": "0 0 0 2px rgba(75, 85, 99, 0.18)",
  } as const;

  useEffect(() => {
    return () => {
      if (volumeControlCloseTimeoutRef.current != null) {
        window.clearTimeout(volumeControlCloseTimeoutRef.current);
      }
      if (zoomControlCloseTimeoutRef.current != null) {
        window.clearTimeout(zoomControlCloseTimeoutRef.current);
      }
      if (speedControlCloseTimeoutRef.current != null) {
        window.clearTimeout(speedControlCloseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (frameSourceDraft?.previewUrl) URL.revokeObjectURL(frameSourceDraft.previewUrl);
    };
  }, [frameSourceDraft?.previewUrl]);

  useEffect(() => {
    if (!activeClipRange) return;
    setClipSelectionDraftStart(formatEditableTimestamp(activeClipRange.startMs));
    setClipSelectionDraftEnd(formatEditableTimestamp(activeClipRange.endMs));
  }, [activeClipRange?.startMs, activeClipRange?.endMs]);

  function clearActiveClipSelection() {
    setPendingSelection(null);
    setPendingClipCodeIds([]);
    setSelectedAnnotationId(null);
    setClipPlaybackAnnotationId(null);
  }

  function handleClipTrashClick() {
    if (saving) return;
    if (pendingSelection) {
      clearActiveClipSelection();
      return;
    }
    if (selectedAnnotation && canEditAnnotations) {
      setClipDeleteConfirmation(selectedAnnotation);
    }
  }

  async function confirmClipAnnotationDelete() {
    if (!clipDeleteConfirmation || saving) return;
    await onDeleteAnnotation(clipDeleteConfirmation.id);
    setClipDeleteConfirmation(null);
    setSelectedClipDraft(null);
    setSelectedAnnotationId(null);
    setClipPlaybackAnnotationId(null);
  }

  function resetClipSelectionDraftsToActiveRange() {
    if (!activeClipRange) return;
    setClipSelectionDraftStart(formatEditableTimestamp(activeClipRange.startMs));
    setClipSelectionDraftEnd(formatEditableTimestamp(activeClipRange.endMs));
  }

  function handleClipSelectionDraftChange(field: "start" | "end", value: string) {
    if (field === "start") {
      setClipSelectionDraftStart(value);
    } else {
      setClipSelectionDraftEnd(value);
    }

    if (!canEditAnnotations || saving || !activeClipRange) return;

    const nextStartDraft = field === "start" ? value : clipSelectionDraftStart;
    const nextEndDraft = field === "end" ? value : clipSelectionDraftEnd;
    const parsedStartSeconds = parseEditableTimestamp(nextStartDraft);
    const parsedEndSeconds = parseEditableTimestamp(nextEndDraft);
    if (parsedStartSeconds == null || parsedEndSeconds == null) return;

    const durationLimitMs = durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY;
    const nextStartMs = Math.max(0, Math.round(parsedStartSeconds * 1000));
    const nextEndMs = Math.min(durationLimitMs, Math.round(parsedEndSeconds * 1000));
    const safeEndMs = Math.max(nextStartMs + 1, nextEndMs);

    if (pendingSelection) {
      setPendingSelection(clipSelectionFromRange(nextStartMs, safeEndMs));
    } else if (selectedAnnotation) {
      setSelectedClipDraft((current) => ({
        annotationId: selectedAnnotation.id,
        startMs: nextStartMs,
        endMs: safeEndMs,
        codeIds: current && current.annotationId === selectedAnnotation.id ? current.codeIds : selectedAnnotation.codeIds,
      }));
    }
  }

  function stepClipSelectionDraft(field: "start" | "end", direction: 1 | -1) {
    if (!activeClipRange || !canEditAnnotations || saving) return;

    const currentDraft = field === "start" ? clipSelectionDraftStart : clipSelectionDraftEnd;
    const fallbackSeconds = (field === "start" ? activeClipRange.startMs : activeClipRange.endMs) / 1000;
    const currentSeconds = parseEditableTimestamp(currentDraft) ?? fallbackSeconds;
    const nextSeconds = Math.max(0, currentSeconds + direction * 0.1);

    handleClipSelectionDraftChange(field, formatEditableTimestamp(nextSeconds * 1000));
  }

  function openVolumeControl() {
    if (volumeControlCloseTimeoutRef.current != null) {
      window.clearTimeout(volumeControlCloseTimeoutRef.current);
      volumeControlCloseTimeoutRef.current = null;
    }
    setVolumeControlOpen(true);
  }

  function scheduleVolumeControlClose() {
    if (volumeControlCloseTimeoutRef.current != null) {
      window.clearTimeout(volumeControlCloseTimeoutRef.current);
    }
    volumeControlCloseTimeoutRef.current = window.setTimeout(() => {
      volumeControlCloseTimeoutRef.current = null;
      setVolumeControlOpen(false);
    }, 1000);
  }

  function openZoomControl() {
    if (zoomControlCloseTimeoutRef.current != null) {
      window.clearTimeout(zoomControlCloseTimeoutRef.current);
      zoomControlCloseTimeoutRef.current = null;
    }
    setZoomControlOpen(true);
  }

  function scheduleZoomControlClose() {
    if (zoomControlCloseTimeoutRef.current != null) {
      window.clearTimeout(zoomControlCloseTimeoutRef.current);
    }
    zoomControlCloseTimeoutRef.current = window.setTimeout(() => {
      zoomControlCloseTimeoutRef.current = null;
      setZoomControlOpen(false);
    }, 1000);
  }

  function openSpeedControl() {
    if (speedControlCloseTimeoutRef.current != null) {
      window.clearTimeout(speedControlCloseTimeoutRef.current);
      speedControlCloseTimeoutRef.current = null;
    }
    setSpeedControlOpen(true);
  }

  function scheduleSpeedControlClose() {
    if (speedControlCloseTimeoutRef.current != null) {
      window.clearTimeout(speedControlCloseTimeoutRef.current);
    }
    speedControlCloseTimeoutRef.current = window.setTimeout(() => {
      speedControlCloseTimeoutRef.current = null;
      setSpeedControlOpen(false);
    }, 1000);
  }

  function setMediaPlaybackRate(rate: number) {
    const mediaElement = mediaElementRef.current;
    if (mediaElement) {
      mediaElement.playbackRate = rate;
    }
    setPlaybackRate(rate);
  }

  function stepMediaByFrame(direction: -1 | 1) {
    const mediaElement = mediaElementRef.current;
    if (!mediaElement) return;
    mediaElement.pause();
    const durationSeconds = Number.isFinite(mediaElement.duration) ? mediaElement.duration : null;
    const indexedFrameTime = videoFrameIndexCache
      ? findAdjacentFrameTimestamp(videoFrameIndexCache.timestampsSeconds, mediaElement.currentTime, direction)
      : null;
    const unclampedTime = indexedFrameTime ?? mediaElement.currentTime + direction * FRAME_STEP_SECONDS;
    const nextTime = Math.max(0, durationSeconds == null ? unclampedTime : Math.min(unclampedTime, durationSeconds));
    mediaElement.currentTime = nextTime;
    if (videoPreviewElementRef.current) {
      videoPreviewElementRef.current.currentTime = nextTime;
    }
    setCurrentTimeMs(nextTime * 1000);
    setClipPlaybackAnnotationId(null);
  }

  async function extractCurrentVideoFrame() {
    if (!onExtractVideoFrame || frameExtracting) return;
    const sourceVideoElement = videoPreviewElementRef.current
      ?? (mediaElementRef.current instanceof HTMLVideoElement ? mediaElementRef.current : null);
    if (!sourceVideoElement) {
      setFrameExtractError("No video frame is available to extract.");
      return;
    }

    setFrameExtracting(true);
    setFrameExtractError(null);
    try {
      const mediaElement = mediaElementRef.current;
      const currentTimeSeconds = Number.isFinite(mediaElement?.currentTime)
        ? mediaElement!.currentTime
        : sourceVideoElement.currentTime;

      await waitForVideoReady(sourceVideoElement);
      await waitForVideoSeek(sourceVideoElement, currentTimeSeconds);
      await waitForVideoReady(sourceVideoElement);

      const width = sourceVideoElement.videoWidth;
      const height = sourceVideoElement.videoHeight;
      if (width <= 0 || height <= 0) {
        throw new Error("The current video frame has no drawable dimensions.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create a canvas for the extracted frame.");
      context.drawImage(sourceVideoElement, 0, 0, width, height);

      const blob = await canvasToPngBlob(canvas);
      const timeMs = Math.max(0, Math.round(currentTimeSeconds * 1000));
      const title = `${row.name} frame ${formatMediaTime(timeMs)}`;
      const fileNameBase = sanitizeFrameFileNamePart(row.name);
      const fileNameTime = String(timeMs).padStart(8, "0");
      const file = new File([blob], `${fileNameBase}-frame-${fileNameTime}ms.png`, { type: "image/png" });
      setFrameSourceDraft((currentDraft) => {
        if (currentDraft?.previewUrl) URL.revokeObjectURL(currentDraft.previewUrl);
        return {
          file,
          title,
          previewUrl: URL.createObjectURL(file),
          extractedFromVideoSourceId: row.id,
          extractedFromVideoTimeMs: timeMs,
        };
      });
    } catch (extractError) {
      setFrameExtractError(extractError instanceof Error ? extractError.message : "Failed to extract video frame.");
    } finally {
      setFrameExtracting(false);
    }
  }

  async function approveFrameSourceDraft() {
    if (!frameSourceDraft || !onExtractVideoFrame) return;
    setFrameExtracting(true);
    setFrameExtractError(null);
    try {
      await onExtractVideoFrame({
        file: frameSourceDraft.file,
        title: frameSourceDraft.title,
        extractedFromVideoSourceId: frameSourceDraft.extractedFromVideoSourceId,
        extractedFromVideoTimeMs: frameSourceDraft.extractedFromVideoTimeMs,
      });
      URL.revokeObjectURL(frameSourceDraft.previewUrl);
      setFrameSourceDraft(null);
    } catch (approveError) {
      setFrameExtractError(approveError instanceof Error ? approveError.message : "Failed to create frame source.");
    } finally {
      setFrameExtracting(false);
    }
  }

  function cancelFrameSourceDraft() {
    if (frameExtracting) return;
    setFrameSourceDraft((currentDraft) => {
      if (currentDraft?.previewUrl) URL.revokeObjectURL(currentDraft.previewUrl);
      return null;
    });
    setFrameExtractError(null);
  }

  const hasOwnSourceLock = !!sourceLock && sourceLock.userId === currentUserId;
  const showSourceAccessNotice = sourceLockConflict?.reason === "kicked"
    || sourceLockConflict?.reason === "locked"
    || !canManageAnnotations
    || (!!sourceLock && !hasOwnSourceLock);

  return (
    <div className="view doc-detail-view">
      <div className="workspace-back-row workspace-back-row--split">
        <button className="btn" onClick={onBack}>{t("projectDocuments.detail.backToDocuments")}</button>
        <p className="users-guide-copy" style={{ margin: 0 }}>
          PostgreSQL {mediaKind} coding workspace
        </p>
      </div>

      <div className="annotate-layout code-text-annotate-layout" style={{ minHeight: 0 }}>
        <div className="annotate-left" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">Codebook</span>
            </div>
            {pendingSelection ? (
              <div className="codebook-selection-hint">
                <span>
                  Select one or more codes for this clip.
                </span>
              </div>
            ) : null}
            <ul className="code-list">
              {codes.length === 0 ? (
                <li className="code-list-empty">No codes yet.</li>
              ) : (
                visibleCodes.map(({ code, depth, hasChildren }) => (
                  <li
                    key={code.id}
                    className={`code-item${activeClipRange && canEditAnnotations ? " code-item--annotatable" : ""}${activeClipCodeIds.includes(code.id) ? " code-item--selected" : ""}`}
                    style={{ paddingLeft: 6 + depth * 16 }}
                    onMouseDown={(event) => {
                      if (activeClipRange) event.preventDefault();
                    }}
                    onClick={() => handleCodebookCodeClick(code.id)}
                    onContextMenu={(event) => {
                      if (!canManageMemos) return;
                      event.preventDefault();
                      setCodeContextMenu({ x: event.clientX, y: event.clientY, code });
                    }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        className="code-collapse-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleCollapsedCode(code.id);
                        }}
                        title={collapsedCodeIds.has(code.id) ? "Expand" : "Collapse"}
                      >
                        {collapsedCodeIds.has(code.id) ? "\u25b6" : "\u25bc"}
                      </button>
                    ) : (
                      <span className="code-collapse-spacer" />
                    )}
                    <span className="code-swatch" style={{ background: code.color }} />
                    <span className="code-label">{code.label}</span>
                    <span className="code-ann-count">{annotationCountByCodeId.get(code.id) ?? 0}</span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <PostgresSourceAnnotationPanel
            annotations={mediaAnnotations}
            selectedAnnotationId={selectedAnnotationId}
            codesById={codesById}
            onSelectAnnotation={(annotationId) => {
              setPendingSelection(null);
              setPendingClipCodeIds([]);
              setSelectedAnnotationId(annotationId);
              const annotation = mediaAnnotations.find((entry) => entry.id === annotationId);
              if (annotation) seekToAnnotation(annotation);
            }}
            onDeleteAnnotation={(annotationId) => {
              void onDeleteAnnotation(annotationId);
            }}
            onOpenMemoDraft={onOpenMemoDraft}
            canManageMemos={canManageMemos}
            canDeleteAnnotations={canEditAnnotations}
          />
        </div>

        <div className="annotate-main">
          <div className="annotate-card annotate-card--grow media-source-card">
            {showSourceAccessNotice ? (
              <div style={{ marginTop: 12, marginBottom: 12 }}>
                {sourceLockConflict?.reason === "kicked" ? (
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    {sourceLockConflict.userName || "A project editor"} removed your source lock. Return to the source list or reacquire access before annotating again.
                  </p>
                ) : sourceLockConflict?.reason === "locked" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <p className="users-guide-copy" style={{ margin: 0 }}>
                      {sourceLockConflict.userName || "Another user"} is currently annotating this source.
                    </p>
                    {canKickSourceLocks ? (
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => void onKickSourceLock(sourceLockConflict)}
                        disabled={saving || lockSyncing}
                      >
                        {lockSyncing ? "Updating..." : "Take Lock"}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    {lockSyncing ? "Claiming the source lock for annotation..." : `This ${mediaKind} source is currently read-only in the coding workspace.`}
                  </p>
                )}
              </div>
            ) : null}

            {previewLoading ? (
              <p className="users-guide-copy" style={{ margin: 0 }}>Loading {mediaKind} preview...</p>
            ) : previewError ? (
              <div style={{ display: "grid", gap: 8 }}>
                <p className="auth-error" style={{ margin: 0 }}>{previewError}</p>
                <p className="users-guide-copy" style={{ margin: 0 }}>
                  The {mediaKind} file is stored with this source, but its preview could not be opened.
                </p>
              </div>
            ) : previewUrl ? (
              <div style={{ display: "grid", gap: 16, minHeight: 0 }}>
                <div className="media-player-console-frame">
                  <svg
                    className="media-player-console-outline"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M 2 8 Q 2 2 8 2 H 92 Q 98 2 98 8 V 58 Q 98 62 94 62 H 70 Q 67.3 62 67.1 65 L 65 90 Q 64.5 96 58.5 96 H 41.5 Q 35.5 96 35 90 L 32.9 65 Q 32.7 62 30 62 H 6 Q 2 62 2 58 Z"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <div
                    className="media-player-waveform-panel media-player-waveform-panel--video"
                    style={videoWaveformPanelWidth ? {
                      "--media-player-video-panel-width": `${videoWaveformPanelWidth}px`,
                    } as CSSProperties : undefined}
                  >
                    <div className="media-player-console-title">
                      <span className="doc-name">{row.name}</span>
                    </div>
                    <div className="media-player-video-preview">
                      <video
                        className="media-player-video-preview-element"
                        ref={videoPreviewElementCallbackRef}
                        src={previewUrl}
                        playsInline
                      />
                    </div>
                    <PostgresSourceMediaTimeline
                      ref={mediaTimelineRef}
                      mediaElement={mediaElement}
                      waveformCache={waveformCache}
                      annotations={mediaAnnotations}
                      selectedAnnotationId={selectedAnnotationId}
                      canEditAnnotations={canEditAnnotations}
                      waveformHeight={47}
                      waveformShellStyle={{
                        width: "100%",
                        padding: "0 14px 0",
                      }}
                      pendingSelection={pendingSelection ? {
                        startMs: pendingSelection.timeStartMs,
                        endMs: pendingSelection.timeEndMs,
                      } : null}
                      pendingSelectionCodeColors={pendingClipCodeColors}
                      onCreateSelection={(startMs, endMs) => {
                        setPendingSelection(clipSelectionFromRange(startMs, endMs));
                        setPendingClipCodeIds([]);
                        setSelectedAnnotationId(null);
                      }}
                      onSelectAnnotation={(annotationId) => {
                        setPendingSelection(null);
                        setPendingClipCodeIds([]);
                        setSelectedAnnotationId(annotationId);
                        const annotation = mediaAnnotations.find((entry) => entry.id === annotationId);
                        if (annotation) seekToAnnotation(annotation);
                      }}
                      onAnnotationContextMenu={(annotation, x, y) => {
                        if (!canManageMemos && !canEditAnnotations) return;
                        setPendingSelection(null);
                        setPendingClipCodeIds([]);
                        setSelectedAnnotationId(annotation.id);
                        setAnnotationContextMenu({ x, y, annotation });
                      }}
                      onUpdateAnnotationRange={(annotationId, startMs, endMs) => {
                        void handleUpdateAnnotationRange(annotationId, startMs, endMs);
                      }}
                      onPlayClip={playClip}
                      onZoomUiStateChange={setZoomUiState}
                    />
                  </div>

                  <div className="media-player-controls-panel media-player-controls-panel--video">
                    <MediaController
                      className="media-player-controller"
                      style={{
                        display: "grid",
                        gap: 10,
                        width: "100%",
                        ...mediaChromeThemeStyle,
                      }}
                    >
                  {mediaKind === "video" ? (
                    <video
                      slot="media"
                      ref={mediaElementCallbackRef}
                      src={previewUrl}
                      playsInline
                      style={{
                        position: "absolute",
                        width: 1,
                        height: 1,
                        opacity: 0,
                        pointerEvents: "none",
                      }}
                    />
                  ) : (
                    <audio
                      slot="media"
                      ref={mediaElementCallbackRef}
                      src={previewUrl}
                      style={{
                        position: "absolute",
                        width: 1,
                        height: 1,
                        opacity: 0,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                    <MediaControlBar
                      className="media-player-control-bar"
                      style={{
                        width: "100%",
                        color: "#233142",
                      }}
                    >
                      <div className="media-player-layout-grid media-player-layout-grid--video">
                        {activeClipRange ? (
                          <div className="media-player-clip-anchor-slot">
                            <button
                              type="button"
                              onClick={activeClipHasCodes ? () => void acceptActiveClipChanges() : clearActiveClipSelection}
                              disabled={activeClipHasCodes && (!canEditAnnotations || saving)}
                              className="media-player-clip-action media-player-clip-anchor"
                              aria-label={activeClipHasCodes ? "Accept clip changes" : "Cancel clip changes"}
                              title={activeClipHasCodes ? "Accept changes" : "Cancel changes"}
                              style={playerActionButtonStyle}
                            >
                              {activeClipHasCodes ? <AcceptClipIcon /> : <ClearClipIcon />}
                            </button>
                          </div>
                        ) : null}
                        <div
                          className={`media-player-control-cluster media-player-clip-cluster media-player-grid-clip${activeClipRange ? " media-player-clip-cluster--active" : ""}`}
                        >
                          {activeClipRange ? (
                            <div className="media-player-clip-group">
                              <svg
                                className="media-player-clip-shape"
                                viewBox="0 0 312 164"
                                preserveAspectRatio="none"
                                aria-hidden="true"
                                focusable="false"
                              >
                                <defs>
                                  <linearGradient id="media-player-clip-shape-gradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="rgba(237, 242, 247, 0.98)" />
                                    <stop offset="100%" stopColor="rgba(226, 232, 240, 0.98)" />
                                  </linearGradient>
                                </defs>
                                <path
                                  d="M288 0H24Q0 0 0 24V40Q0 64 24 64H40Q64 64 64 88V140Q64 164 88 164H288Q312 164 312 140V24Q312 0 288 0Z"
                                  className="media-player-clip-shape-fill"
                                />
                              </svg>
                              <div className="media-player-clip-popout">
                                <div className="media-player-clip-inline-editor">
                                  <div className="media-player-clip-code-badges" aria-label="Selected clip codes">
                                    {activeClipCodes.length > 0 ? (
                                      activeClipCodes.map((code) => (
                                        <span
                                          key={code.id}
                                          className="annotation-code-badge"
                                          style={{ background: code.color }}
                                          onContextMenu={handleClipBadgeContextMenu}
                                        >
                                          {code.label}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="annotation-code-badge media-player-clip-code-badge--empty">
                                        No codes
                                      </span>
                                    )}
                                  </div>
                                  <label className="media-player-clip-inline-field">
                                    <span>Start</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={clipSelectionDraftStart}
                                      onChange={(event) => handleClipSelectionDraftChange("start", event.target.value)}
                                      onBlur={resetClipSelectionDraftsToActiveRange}
                                      disabled={!canEditAnnotations || saving}
                                    />
                                    <span className="media-player-clip-stepper" aria-hidden={false}>
                                      <button
                                        type="button"
                                        className="media-player-clip-stepper-button"
                                        onClick={() => stepClipSelectionDraft("start", 1)}
                                        disabled={!canEditAnnotations || saving}
                                        aria-label="Increase start timestamp"
                                        title="Increase start timestamp"
                                      >
                                        <TimestampStepUpIcon />
                                      </button>
                                      <button
                                        type="button"
                                        className="media-player-clip-stepper-button"
                                        onClick={() => stepClipSelectionDraft("start", -1)}
                                        disabled={!canEditAnnotations || saving}
                                        aria-label="Decrease start timestamp"
                                        title="Decrease start timestamp"
                                      >
                                        <TimestampStepDownIcon />
                                      </button>
                                    </span>
                                  </label>
                                  <label className="media-player-clip-inline-field">
                                    <span>End</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={clipSelectionDraftEnd}
                                      onChange={(event) => handleClipSelectionDraftChange("end", event.target.value)}
                                      onBlur={resetClipSelectionDraftsToActiveRange}
                                      disabled={!canEditAnnotations || saving}
                                    />
                                    <span className="media-player-clip-stepper" aria-hidden={false}>
                                      <button
                                        type="button"
                                        className="media-player-clip-stepper-button"
                                        onClick={() => stepClipSelectionDraft("end", 1)}
                                        disabled={!canEditAnnotations || saving}
                                        aria-label="Increase end timestamp"
                                        title="Increase end timestamp"
                                      >
                                        <TimestampStepUpIcon />
                                      </button>
                                      <button
                                        type="button"
                                        className="media-player-clip-stepper-button"
                                        onClick={() => stepClipSelectionDraft("end", -1)}
                                        disabled={!canEditAnnotations || saving}
                                        aria-label="Decrease end timestamp"
                                        title="Decrease end timestamp"
                                      >
                                        <TimestampStepDownIcon />
                                      </button>
                                    </span>
                                  </label>
                                </div>
                                <button
                                  type="button"
                                  className="media-player-clip-trash-button"
                                  onClick={handleClipTrashClick}
                                  disabled={saving || (!pendingSelection && (!selectedAnnotation || !canEditAnnotations))}
                                  aria-label={pendingSelection ? "Discard clip selection" : "Delete clip annotation"}
                                  title={pendingSelection ? "Discard selection" : "Delete annotation"}
                                >
                                  <TrashClipIcon />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={createSelectionFromCurrentTime}
                              disabled={!canEditAnnotations}
                              className="media-player-clip-action media-player-clip-action--primary"
                              aria-label="New clip"
                              title="New clip"
                              style={{
                                ...playerActionButtonStyle,
                                ...clipActionEnabledStyle,
                              }}
                            >
                              <NewClipIcon />
                            </button>
                          )}
                        </div>
                        <div
                          className={`media-player-zoom-cluster media-player-grid-zoom${zoomControlOpen ? " is-zoom-open" : ""}`}
                          onPointerEnter={openZoomControl}
                          onPointerLeave={scheduleZoomControlClose}
                          onFocus={openZoomControl}
                          onBlur={scheduleZoomControlClose}
                        >
                          <button
                            type="button"
                            className="media-player-native-control media-player-zoom-fit-button"
                            disabled={!zoomUiState.canFit}
                            onClick={() => mediaTimelineRef.current?.fitToWaveform()}
                            aria-label="Fit waveform"
                            title="Fit waveform"
                          >
                            <ZoomFitIcon />
                          </button>
                          <div className="media-player-zoom-popout" aria-label="Waveform zoom">
                            <div className="media-player-zoom-meter" aria-label={`Zoom ${zoomUiState.zoomPercent}%`}>
                              <input
                                type="range"
                                min="100"
                                max={zoomSliderMax}
                                step="1"
                                value={zoomSliderValue}
                                onChange={(event) => mediaTimelineRef.current?.setZoomPercent(zoomSliderMax + 100 - Number(event.target.value))}
                                className="media-player-zoom-range"
                                aria-label={`Waveform zoom level, ${zoomUiState.zoomPercent}%`}
                                style={{
                                  background: `linear-gradient(90deg, rgba(53, 80, 112, 0.14) 0%, rgba(53, 80, 112, 0.14) ${zoomSliderFillPercent}%, #4b5563 ${zoomSliderFillPercent}%, #4b5563 100%)`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="media-player-grid-seek-back">
                          <MediaSeekBackwardButton
                            className="media-player-native-control"
                            seekOffset={5}
                            title="Back 5 seconds"
                            aria-label="Back 5 seconds"
                            noTooltip
                          />
                        </div>
                        <div className="media-player-grid-frame-back">
                          <button
                            type="button"
                            className="media-player-native-control media-player-frame-step-button"
                            onClick={() => stepMediaByFrame(-1)}
                            disabled={!mediaElement}
                            title="Back 1 frame"
                            aria-label="Back 1 frame"
                          >
                            <FrameBackIcon />
                          </button>
                        </div>
                        <div className="media-player-grid-play">
                          <MediaPlayButton
                            className="media-player-native-control media-player-native-control--play"
                            title="Play"
                            aria-label="Play"
                            noTooltip
                          />
                        </div>
                        <div className="media-player-grid-extract-frame">
                          <button
                            type="button"
                            className="media-player-native-control media-player-frame-extract-button"
                            onClick={() => void extractCurrentVideoFrame()}
                            disabled={!onExtractVideoFrame || !mediaElement || frameExtracting || saving}
                            title={frameExtracting ? "Extracting frame" : "Extract frame"}
                            aria-label={frameExtracting ? "Extracting frame" : "Extract current video frame"}
                          >
                            <ExtractFrameIcon />
                          </button>
                        </div>
                        <div className="media-player-grid-frame-forward">
                          <button
                            type="button"
                            className="media-player-native-control media-player-frame-step-button"
                            onClick={() => stepMediaByFrame(1)}
                            disabled={!mediaElement}
                            title="Forward 1 frame"
                            aria-label="Forward 1 frame"
                          >
                            <FrameForwardIcon />
                          </button>
                        </div>
                        <div className="media-player-grid-seek-forward">
                          <MediaSeekForwardButton
                            className="media-player-native-control"
                            seekOffset={5}
                            title="Forward 5 seconds"
                            aria-label="Forward 5 seconds"
                            noTooltip
                          />
                        </div>
                        <div className="media-player-grid-speed">
                          <div
                            className={`media-player-speed-cluster${speedControlOpen ? " is-speed-open" : ""}`}
                            onPointerEnter={openSpeedControl}
                            onPointerLeave={scheduleSpeedControlClose}
                            onFocus={openSpeedControl}
                            onBlur={scheduleSpeedControlClose}
                          >
                            <button
                              type="button"
                              className="media-player-native-control media-player-speed-button"
                              onClick={() => {
                                const currentIndex = PLAYBACK_SPEED_OPTIONS.findIndex((rate) => Math.abs(rate - playbackRate) < 0.01);
                                setMediaPlaybackRate(PLAYBACK_SPEED_OPTIONS[(currentIndex + 1) % PLAYBACK_SPEED_OPTIONS.length]);
                              }}
                              aria-label={`Playback speed ${playbackRateLabel}`}
                              title="Playback speed"
                            >
                              {playbackRateLabel}
                            </button>
                            <div className="media-player-speed-popout" aria-label="Playback speed">
                              <div className="media-player-speed-meter" aria-label={`Playback speed ${playbackRateLabel}`}>
                                <input
                                  type="range"
                                  min="0"
                                  max={PLAYBACK_SPEED_OPTIONS.length - 1}
                                  step="1"
                                  value={playbackSpeedSliderValue}
                                  onChange={(event) => {
                                    const nextRate = PLAYBACK_SPEED_OPTIONS[PLAYBACK_SPEED_OPTIONS.length - 1 - Number(event.target.value)];
                                    if (nextRate != null) setMediaPlaybackRate(nextRate);
                                  }}
                                  className="media-player-speed-range"
                                  aria-label={`Playback speed, ${playbackRateLabel}`}
                                  style={{
                                    background: `linear-gradient(90deg, rgba(53, 80, 112, 0.14) 0%, rgba(53, 80, 112, 0.14) ${playbackSpeedFillPercent}%, #4b5563 ${playbackSpeedFillPercent}%, #4b5563 100%)`,
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="media-player-grid-volume">
                          <div
                            className={`media-player-volume-cluster${volumeControlOpen ? " is-volume-open" : ""}`}
                            onPointerEnter={openVolumeControl}
                            onPointerLeave={scheduleVolumeControlClose}
                            onFocus={openVolumeControl}
                            onBlur={scheduleVolumeControlClose}
                          >
                            <MediaMuteButton
                              className="media-player-native-control"
                              title="Volume"
                              aria-label="Volume"
                              noTooltip
                            />
                            <div className="media-player-volume-popout" aria-label="Volume">
                              <MediaVolumeRange className="media-player-volume-range" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </MediaControlBar>
                    </MediaController>
                  </div>
                  {frameExtractError ? (
                    <p className="auth-error media-player-frame-extract-error">{frameExtractError}</p>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="case-card-empty">No {mediaKind} preview is available for this source.</p>
            )}
          </div>
        </div>
      </div>

      {codeContextMenu && canManageMemos ? (
        <div ref={codeContextMenuRef} className="context-menu" style={codeContextMenuStyle}>
          <button
            className="context-menu-item"
            onClick={() => {
              onOpenMemoDraft({ codeIds: [codeContextMenu.code.id] });
              setCodeContextMenu(null);
            }}
          >
            Memo about code
          </button>
        </div>
      ) : null}

      <PostgresSourceAnnotationContextMenu
        contextMenu={annotationContextMenu}
        contextMenuRef={annotationContextMenuRef}
        contextMenuStyle={annotationContextMenuStyle}
        onClose={() => setAnnotationContextMenu(null)}
        onDeleteAnnotation={(annotationId) => {
          void onDeleteAnnotation(annotationId);
        }}
        onOpenMemoDraft={onOpenMemoDraft}
        canManageMemos={canManageMemos}
        canDeleteAnnotations={canEditAnnotations}
      />

      {frameSourceDraft ? (
        <div className="modal-overlay" onClick={cancelFrameSourceDraft}>
          <div className="modal modal--wide media-player-frame-source-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Approve Frame Source</h2>
            <p className="users-guide-copy" style={{ marginTop: 0, marginBottom: 16 }}>
              Review this extracted frame before adding it as an image source.
            </p>
            <div className="media-player-frame-source-preview">
              <img src={frameSourceDraft.previewUrl} alt="" />
            </div>
            <label className="form-label">
              Source Title
              <input
                className="form-input"
                value={frameSourceDraft.title}
                onChange={(event) => {
                  setFrameSourceDraft((currentDraft) => (
                    currentDraft
                      ? { ...currentDraft, title: event.target.value }
                      : currentDraft
                  ));
                }}
                autoFocus
              />
            </label>
            {frameExtractError ? <p className="auth-error">{frameExtractError}</p> : null}
            <div className="form-actions">
              <button className="btn" onClick={cancelFrameSourceDraft} disabled={frameExtracting || saving}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={() => void approveFrameSourceDraft()}
                disabled={frameExtracting || saving || !frameSourceDraft.title.trim()}
              >
                {frameExtracting || saving ? "Creating..." : "Approve and Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingAnnotation && canEditAnnotations ? (
        <AnnotationEditorModal
          title="Edit Annotation"
          codeOptions={codeOptions}
          selection={{
            startOffset: editingAnnotation.startOffset ?? 0,
            endOffset: editingAnnotation.endOffset ?? 0,
            quote: editingAnnotation.quote,
            anchorKind: "time_range",
            timeStartMs: editingAnnotation.timeStartMs,
            timeEndMs: editingAnnotation.timeEndMs,
            displayLabel: editingAnnotation.timeStartMs != null && editingAnnotation.timeEndMs != null
              ? `${formatMediaTime(editingAnnotation.timeStartMs)} - ${formatMediaTime(editingAnnotation.timeEndMs)}`
              : editingAnnotation.quote,
          }}
          initialAnnotation={editingAnnotation}
          saving={saving}
          error={error}
          onCancel={() => {
            if (saving) return;
            setEditingAnnotation(null);
          }}
          onDelete={async () => {
            await onDeleteAnnotation(editingAnnotation.id);
            setEditingAnnotation(null);
          }}
          onSave={async (payload) => {
            await onUpdateAnnotation(editingAnnotation, {
              codeIds: payload.codeIds,
              note: payload.note,
              startOffset: null,
              endOffset: null,
              anchorKind: "time_range",
              timeStartMs: editingAnnotation.timeStartMs,
              timeEndMs: editingAnnotation.timeEndMs,
              quote: editingAnnotation.quote,
            });
            setEditingAnnotation(null);
          }}
        />
      ) : null}

      {clipDeleteConfirmation && canEditAnnotations ? (
        <div className="modal-overlay" onClick={() => !saving && setClipDeleteConfirmation(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2>Delete clip annotation?</h2>
            <p className="users-guide-copy">
              This will remove the selected coded clip from this source.
            </p>
            <div className="form-actions">
              <button className="btn" onClick={() => setClipDeleteConfirmation(null)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn--danger" onClick={() => void confirmClipAnnotationDelete()} disabled={saving}>
                {saving ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

