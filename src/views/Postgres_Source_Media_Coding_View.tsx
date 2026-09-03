import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import { SettingsModal } from "../components/SettingsModal";
import type { PostgresCode } from "../lib/postgres";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import {
  ArrowLeftIcon,
  BackFiveIcon,
  CheckIcon as AcceptClipIcon,
  CloseIcon,
  ForwardFiveIcon,
  HelpIcon,
  MediaZoomFitIcon as ZoomFitIcon,
  NewClipIcon,
  PauseIcon,
  PlayIcon,
  StepBackIcon as FineBackIcon,
  StepForwardIcon as FineForwardIcon,
  VolumeIcon,
} from "../components/AppIcons";
import {
  createMediaWaveformCache,
  parseMediaWaveformCache,
  serializeMediaWaveformCache,
  type MediaWaveformCache,
} from "../lib/mediaWaveform";
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
import { NewCodeModal, type CodeRow } from "../components/NewCodeModal";
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

function formatOpenTimingDetails(details?: Record<string, number | string | boolean | null | undefined>) {
  if (!details) return "";
  const entries = Object.entries(details).filter(([, value]) => value != null);
  if (entries.length === 0) return "";
  return ` ${entries.map(([key, value]) => `${key}=${String(value)}`).join(" ")}`;
}

function AnnotationClipPlayer({
  annotation,
  mediaKind,
  previewUrl,
  mediaType,
}: {
  annotation: SourceAnnotationRow;
  mediaKind: "audio" | "video";
  previewUrl: string | null;
  mediaType: string | null;
}) {
  const { t } = useI18n();
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const startSeconds = Math.max(0, (annotation.timeStartMs ?? 0) / 1000);
  const clipLabel = annotation.timeStartMs != null && annotation.timeEndMs != null
    ? `${formatMediaTime(annotation.timeStartMs)} - ${formatMediaTime(annotation.timeEndMs)}`
    : annotation.quote;

  if (!previewUrl || annotation.timeStartMs == null || annotation.timeEndMs == null) {
    return null;
  }

  function handleLoadedMetadata() {
    if (!mediaRef.current) return;
    mediaRef.current.currentTime = startSeconds;
  }

  return (
    <div className="annotation-excerpt annotation-excerpt--clip" onClick={(event) => event.stopPropagation()}>
      <div className="annotation-excerpt-label">{clipLabel}</div>
      {mediaKind === "video" ? (
        <video
          ref={mediaRef as RefObject<HTMLVideoElement>}
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          aria-label={t("sourceCoding.media.videoClipPreview")}
          className="annotation-excerpt-media annotation-excerpt-media--video"
        >
          <source src={previewUrl} type={mediaType ?? undefined} />
        </video>
      ) : null}
    </div>
  );
}

export function PostgresSourceMediaCodingView({
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
  canCreateCodes,
  initialSelectedAnnotationId,
  projectStoragePath,
  mediaKind,
  saving,
  error,
  onCreateAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onKickSourceLock,
  onOpenMemoDraft,
  onUpdateSourceWaveform,
  onCreateCode,
  onUpdateCode,
  onDeleteCode,
  onBack,
}: PostgresSourceCodingViewProps & {
  projectStoragePath: string;
  mediaKind: "audio" | "video";
}) {
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
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [codeContextMenu, setCodeContextMenu] = useState<{ x: number; y: number; code: PostgresCode } | null>(null);
  const [newCodeOpen, setNewCodeOpen] = useState(false);
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null);
  const [childCodeParentId, setChildCodeParentId] = useState<string | null>(null);
  const [deletingCodeId, setDeletingCodeId] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState(false);
  const [deleteCodeError, setDeleteCodeError] = useState("");
  const [annotationContextMenu, setAnnotationContextMenu] = useState<AnnotationContextMenuState | null>(null);
  const codeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const annotationContextMenuRef = useRef<HTMLDivElement | null>(null);
  const codeContextMenuStyle = useViewportContextMenuStyle(codeContextMenu, codeContextMenuRef);
  const annotationContextMenuStyle = useViewportContextMenuStyle(annotationContextMenu, annotationContextMenuRef);
  const mediaElementRef = useRef<HTMLMediaElement | null>(null);
  const mediaTimelineRef = useRef<PostgresSourceMediaTimelineHandle | null>(null);
  const playbackRangeRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const playbackMonitorFrameRef = useRef<number | null>(null);
  const waveformRecoveryAttemptedRef = useRef<string | null>(null);
  const openTimingStartRef = useRef<number>(performance.now());
  const volumeControlCloseTimeoutRef = useRef<number | null>(null);
  const zoomControlCloseTimeoutRef = useRef<number | null>(null);
  const speedControlCloseTimeoutRef = useRef<number | null>(null);
  const mediaElementCallbackRef = useCallback((element: HTMLMediaElement | null) => {
    if (mediaElementRef.current === element) return;
    mediaElementRef.current = element;
    setMediaElement(element);
  }, []);

  const canEditAnnotations = canManageAnnotations && !!sourceLock && sourceLock.userId === currentUserId && !sourceLockConflict;
  const fileExt = row.filePath ? fileExtensionFromPath(row.filePath) : "";
  const resolvedFilePath = resolveProjectStoragePath(projectStoragePath, row.filePath);
  const persistedWaveformCache = useMemo(() => parseMediaWaveformCache(row.waveformPeaksJson), [row.waveformPeaksJson]);
  const waveformCache = generatedWaveformCache ?? persistedWaveformCache;
  const mediaAnnotations = useMemo(
    () => annotations
      .filter((annotation) => annotation.timeStartMs != null && annotation.timeEndMs != null)
      .sort((left, right) => (left.timeStartMs ?? 0) - (right.timeStartMs ?? 0) || left.createdAt.localeCompare(right.createdAt)),
    [annotations],
  );
  const codesById = useMemo(() => new Map(codes.map((code) => [code.id, code])), [codes]);
  const codebookRows = useMemo<CodeRow[]>(() => codes.map((code) => {
    const parentCode = code.parentCodeId ? codesById.get(code.parentCodeId) : null;
    return {
      id: code.id,
      label: code.label,
      color: code.color,
      description: code.description,
      parentId: code.parentCodeId,
      parentLabel: parentCode?.label ?? "",
      createdByName: "",
      createdAt: code.createdAt,
      sourcesCount: 0,
    };
  }), [codes, codesById]);
  const editingCodeRow = editingCodeId ? codebookRows.find((code) => code.id === editingCodeId) ?? null : null;
  const childCodeParentRow = childCodeParentId ? codebookRows.find((code) => code.id === childCodeParentId) ?? null : null;
  const deletingCodeRow = deletingCodeId ? codebookRows.find((code) => code.id === deletingCodeId) ?? null : null;
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
  const activeClipCodes = activeClipCodeIds.map((codeId) => codesById.get(codeId)).filter((code): code is PostgresCode => !!code);
  const pendingClipCodeColors = useMemo(
    () => pendingClipCodeIds.map((codeId) => codesById.get(codeId)?.color ?? "#888888"),
    [codesById, pendingClipCodeIds],
  );
  const zoomSliderMax = Math.max(800, zoomUiState.zoomPercent);
  const zoomSliderValue = Math.max(100, zoomUiState.zoomPercent);
  const zoomSliderFillPercent = Math.min(100, ((zoomSliderValue - 100) / (zoomSliderMax - 100)) * 100);
  const playbackRateLabel = `${Number.isInteger(playbackRate) ? playbackRate.toFixed(0) : playbackRate.toFixed(2).replace(/0$/, "")}x`;
  const playbackSpeedIndex = nearestPlaybackSpeedIndex(playbackRate);
  const playbackSpeedSliderValue = playbackSpeedIndex;
  const playbackSpeedFillPercent = (playbackSpeedSliderValue / (PLAYBACK_SPEED_OPTIONS.length - 1)) * 100;
  const volumeSliderFillPercent = Math.round(Math.max(0, Math.min(volumeLevel, 1)) * 100);

  function logOpenTiming(phase: string, details?: Record<string, number | string | boolean | null | undefined>) {
    const elapsedMs = Math.round(performance.now() - openTimingStartRef.current);
    console.info(`[media-open:${row.id}] +${elapsedMs}ms ${phase}${formatOpenTimingDetails(details)}`);
  }

  useEffect(() => {
    playbackRangeRef.current = activePlaybackRange;
  }, [activePlaybackRange]);

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
  }, [row.id, row.waveformPeaksJson]);

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
    setMediaElement(null);
    mediaElementRef.current = null;
    setPlaybackRate(1);
    setIsPlaying(false);
    setVolumeLevel(1);
    setIsMuted(false);
  }, [previewUrl, mediaKind]);

  useEffect(() => {
    if (!mediaElement) return;
    if (mediaElement.playbackRate !== 1) {
      mediaElement.playbackRate = 1;
    }
    setPlaybackRate(1);
  }, [mediaElement, previewUrl, mediaKind]);

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
      setVolumeLevel(mediaElement.volume);
      setIsMuted(mediaElement.muted);
      logOpenTiming("media-loaded-metadata", {
        durationMs: Number.isFinite(mediaElement.duration) ? Math.round(mediaElement.duration * 1000) : 0,
      });
    };
    const handleCanPlay = () => {
      logOpenTiming("media-can-play");
    };

    const handleEnded = () => {
      setClipPlaybackAnnotationId(null);
      setIsPlaying(false);
    };
    const handleRateChange = () => setPlaybackRate(mediaElement.playbackRate || 1);
    const handleVolumeChange = () => {
      setVolumeLevel(mediaElement.volume);
      setIsMuted(mediaElement.muted);
    };
    const handlePlay = () => {
      setIsPlaying(true);
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
      setIsPlaying(false);
      cancelPlaybackMonitor();
      if (!mediaElement.ended) setClipPlaybackAnnotationId(null);
    };

    mediaElement.addEventListener("timeupdate", handleTimeUpdate);
    mediaElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    mediaElement.addEventListener("canplay", handleCanPlay);
    mediaElement.addEventListener("ended", handleEnded);
    mediaElement.addEventListener("ratechange", handleRateChange);
    mediaElement.addEventListener("volumechange", handleVolumeChange);
    mediaElement.addEventListener("play", handlePlay);
    mediaElement.addEventListener("pause", handlePause);
    handleLoadedMetadata();
    handleVolumeChange();

    return () => {
      cancelPlaybackMonitor();
      mediaElement.removeEventListener("timeupdate", handleTimeUpdate);
      mediaElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      mediaElement.removeEventListener("canplay", handleCanPlay);
      mediaElement.removeEventListener("ended", handleEnded);
      mediaElement.removeEventListener("ratechange", handleRateChange);
      mediaElement.removeEventListener("volumechange", handleVolumeChange);
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

  function removeActiveClipCode(codeId: string) {
    if (!activeClipRange || !canEditAnnotations || saving) return;
    const nextCodeIds = activeClipCodeIds.filter((entry) => entry !== codeId);

    if (pendingSelection) {
      setPendingClipCodeIds(nextCodeIds);
      return;
    }

    if (!selectedAnnotation) return;
    setSelectedClipDraft({
      annotationId: selectedAnnotation.id,
      startMs: activeClipRange.startMs,
      endMs: activeClipRange.endMs,
      codeIds: nextCodeIds,
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
    mediaElementRef.current.pause();
    playbackRangeRef.current = null;
    setClipPlaybackAnnotationId(null);
    mediaElementRef.current.currentTime = annotation.timeStartMs / 1000;
    setCurrentTimeMs(annotation.timeStartMs);
  }

  function selectClipAnnotation(annotationId: string) {
    const annotation = mediaAnnotations.find((entry) => entry.id === annotationId);
    setPendingSelection(null);
    setPendingClipCodeIds([]);
    setSelectedAnnotationId(annotationId);
    setSelectedClipDraft(annotation && annotation.timeStartMs != null && annotation.timeEndMs != null
      ? {
        annotationId: annotation.id,
        startMs: annotation.timeStartMs,
        endMs: annotation.timeEndMs,
        codeIds: annotation.codeIds,
      }
      : null);
    if (annotation) seekToAnnotation(annotation);
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

  function seekMediaBySeconds(deltaSeconds: number) {
    const mediaElement = mediaElementRef.current;
    if (!mediaElement) return;
    const durationSeconds = Number.isFinite(mediaElement.duration) ? mediaElement.duration : null;
    const unclampedTime = mediaElement.currentTime + deltaSeconds;
    const nextTime = Math.max(0, durationSeconds == null ? unclampedTime : Math.min(unclampedTime, durationSeconds));
    mediaElement.currentTime = nextTime;
    setCurrentTimeMs(nextTime * 1000);
    setClipPlaybackAnnotationId(null);
  }

  function toggleMediaPlayback() {
    const mediaElement = mediaElementRef.current;
    if (!mediaElement) return;
    if (mediaElement.paused || mediaElement.ended) {
      if (activeClipRange) {
        playbackRangeRef.current = activeClipRange;
        setClipPlaybackAnnotationId(selectedAnnotationId);
        const nextCurrentTimeMs = mediaElement.currentTime * 1000;
        if (!rangeContainsTime(activeClipRange, nextCurrentTimeMs) || nextCurrentTimeMs >= activeClipRange.endMs) {
          mediaElement.currentTime = activeClipRange.startMs / 1000;
          setCurrentTimeMs(activeClipRange.startMs);
        }
      }
      void mediaElement.play().catch(() => {
        setIsPlaying(false);
      });
      return;
    }
    mediaElement.pause();
  }

  function toggleMediaMuted() {
    const mediaElement = mediaElementRef.current;
    if (!mediaElement) return;
    mediaElement.muted = !mediaElement.muted;
    setIsMuted(mediaElement.muted);
  }

  function setMediaVolume(nextVolume: number) {
    const mediaElement = mediaElementRef.current;
    const clampedVolume = Math.max(0, Math.min(1, nextVolume));
    if (mediaElement) {
      mediaElement.volume = clampedVolume;
      mediaElement.muted = clampedVolume <= 0 ? true : false;
    }
    setVolumeLevel(clampedVolume);
    setIsMuted(clampedVolume <= 0);
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

  async function handleConfirmDeleteCode() {
    if (!deletingCodeId || !onDeleteCode) return;
    setDeletingCode(true);
    setDeleteCodeError("");
    try {
      await onDeleteCode(deletingCodeId);
      setPendingClipCodeIds((current) => current.filter((codeId) => codeId !== deletingCodeId));
      setSelectedClipDraft((current) => current
        ? { ...current, codeIds: current.codeIds.filter((codeId) => codeId !== deletingCodeId) }
        : current);
      setDeletingCodeId(null);
    } catch (deleteError) {
      setDeleteCodeError(deleteError instanceof Error ? deleteError.message : "Failed to delete code.");
    } finally {
      setDeletingCode(false);
    }
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

  const hasOwnSourceLock = !!sourceLock && sourceLock.userId === currentUserId;
  const showSourceAccessNotice = sourceLockConflict?.reason === "kicked"
    || sourceLockConflict?.reason === "locked"
    || !canManageAnnotations
    || (!!sourceLock && !hasOwnSourceLock);

  return (
    <div className="view doc-detail-view">
      <header className="view-header">
        <div className="users-title-wrap code-text-title-wrap">
          <button
            type="button"
            className="code-text-header-back-button"
            onClick={onBack}
            title={t("projectDocuments.detail.backToDocuments")}
            aria-label={t("projectDocuments.detail.backToDocuments")}
          >
            <ArrowLeftIcon className="code-text-header-back-icon" />
          </button>
          <h1>{mediaKind === "audio" ? t("sourceCoding.media.codeAudio") : t("sourceCoding.media.codeVideo")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("sourceCoding.media.openHelp", { kind: mediaKind })}
            aria-label={t("sourceCoding.media.openHelp", { kind: mediaKind })}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      <div className="annotate-layout code-text-annotate-layout" style={{ minHeight: 0 }}>
        <div className="annotate-left" style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
          <div className="annotate-card" style={{ flexShrink: 0 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">{t("sourceCoding.common.codebook")}</span>
              <button
                type="button"
                className="codebook-icon-action"
                onClick={() => setNewCodeOpen(true)}
                disabled={!canCreateCodes || !onCreateCode || saving}
                aria-label={t("sourceCoding.common.newCode")}
                title={canCreateCodes && onCreateCode ? t("sourceCoding.common.newCode") : t("sourceCoding.common.noCodeCreatePermission")}
              >
                +
              </button>
            </div>
            {pendingSelection ? (
              <div className="codebook-selection-hint">
                <span>
                  {t("sourceCoding.media.selectClipCodes")}
                </span>
              </div>
            ) : null}
            <ul className="code-list">
              {codes.length === 0 ? (
                <li className="code-list-empty">{t("sourceCoding.common.noCodesYet")}</li>
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
                      if (!canManageMemos && !canCreateCodes && !onUpdateCode && !onDeleteCode) return;
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
                        title={collapsedCodeIds.has(code.id) ? t("sourceCoding.common.expand") : t("sourceCoding.common.collapse")}
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
            renderAnnotationExcerpt={(annotation) => (
              <AnnotationClipPlayer
                annotation={annotation}
                mediaKind={mediaKind}
                previewUrl={previewUrl}
                mediaType={mediaTypeFromFileExtension(fileExt)}
              />
            )}
            onSelectAnnotation={(annotationId) => {
              selectClipAnnotation(annotationId);
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
                    {t("sourceCoding.common.sourceLockRemoved", { userName: sourceLockConflict.userName || t("sourceCoding.common.projectEditor") })}
                  </p>
                ) : sourceLockConflict?.reason === "locked" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <p className="users-guide-copy" style={{ margin: 0 }}>
                      {t("sourceCoding.common.sourceLockHeld", { userName: sourceLockConflict.userName || t("sourceCoding.common.anotherUser") })}
                    </p>
                    {canKickSourceLocks ? (
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => void onKickSourceLock(sourceLockConflict)}
                        disabled={saving || lockSyncing}
                      >
                        {lockSyncing ? t("sourceCoding.common.updating") : t("sourceCoding.common.takeLock")}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="users-guide-copy" style={{ margin: 0 }}>
                    {lockSyncing ? t("sourceCoding.common.claimingSourceLock") : t("sourceCoding.common.readOnlyWorkspace")}
                  </p>
                )}
              </div>
            ) : null}

            {previewLoading ? (
              <p className="users-guide-copy" style={{ margin: 0 }}>{t("sourceCoding.media.loadingPreview", { kind: mediaKind })}</p>
            ) : previewError ? (
              <div style={{ display: "grid", gap: 8 }}>
                <p className="auth-error" style={{ margin: 0 }}>{previewError}</p>
                <p className="users-guide-copy" style={{ margin: 0 }}>
                  {t("sourceCoding.media.previewOpenFailed", { kind: mediaKind })}
                </p>
              </div>
            ) : previewUrl ? (
              <div style={{ display: "grid", gap: 16, minHeight: 0 }}>
                {mediaKind === "video" ? (
                  <div className="doc-content-scroll-shell" style={{ padding: 0 }}>
                    <video
                      ref={mediaElementCallbackRef}
                      src={previewUrl}
                      playsInline
                      style={{ display: "block", width: "100%", maxHeight: "52vh", background: "#000000" }}
                    />
                  </div>
                ) : (
                  <audio
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
                  <div className="media-player-waveform-panel media-player-waveform-panel--audio">
                    <div className="media-player-console-title">
                      <span className="doc-name">{row.name}</span>
                    </div>
                    <div className="media-player-video-waveform-row media-player-audio-waveform-row">
                      <div className="media-player-video-waveform-square" aria-label={t("sourceCoding.media.audioTransportControls")}>
                        <button
                          type="button"
                          className="media-player-video-square-play"
                          onClick={toggleMediaPlayback}
                          disabled={!mediaElement}
                          aria-label={isPlaying ? t("common.pause") : t("common.play")}
                          title={isPlaying ? t("common.pause") : t("common.play")}
                        >
                          {isPlaying ? <PauseIcon /> : <PlayIcon />}
                        </button>
                        <div className="media-player-video-square-step-row">
                          <button
                            type="button"
                            className="media-player-video-square-step"
                            onClick={() => seekMediaBySeconds(-5)}
                            disabled={!mediaElement}
                            title={t("sourceCoding.media.backFiveSeconds")}
                            aria-label={t("sourceCoding.media.backFiveSeconds")}
                          >
                            <BackFiveIcon />
                          </button>
                          <button
                            type="button"
                            className="media-player-video-square-step"
                            onClick={() => seekMediaBySeconds(-0.1)}
                            disabled={!mediaElement}
                            title={t("sourceCoding.media.backFineStep")}
                            aria-label={t("sourceCoding.media.backFineStep")}
                          >
                            <FineBackIcon />
                          </button>
                          <button
                            type="button"
                            className="media-player-video-square-step"
                            onClick={() => seekMediaBySeconds(0.1)}
                            disabled={!mediaElement}
                            title={t("sourceCoding.media.forwardFineStep")}
                            aria-label={t("sourceCoding.media.forwardFineStep")}
                          >
                            <FineForwardIcon />
                          </button>
                          <button
                            type="button"
                            className="media-player-video-square-step"
                            onClick={() => seekMediaBySeconds(5)}
                            disabled={!mediaElement}
                            title={t("sourceCoding.media.forwardFiveSeconds")}
                            aria-label={t("sourceCoding.media.forwardFiveSeconds")}
                          >
                            <ForwardFiveIcon />
                          </button>
                        </div>
                      </div>
                      <div className="media-player-video-waveform-side-rect" aria-label={t("sourceCoding.media.audioSecondaryControls")}>
                        <div
                          className={`media-player-video-side-cluster media-player-zoom-cluster${zoomControlOpen ? " is-zoom-open" : ""}`}
                          onPointerEnter={openZoomControl}
                          onPointerLeave={scheduleZoomControlClose}
                          onFocus={openZoomControl}
                          onBlur={scheduleZoomControlClose}
                        >
                          <button
                            type="button"
                            className="media-player-video-side-control media-player-zoom-fit-button"
                            disabled={!zoomUiState.canFit}
                            onClick={() => mediaTimelineRef.current?.fitToWaveform()}
                            aria-label={t("sourceCoding.media.fitWaveform")}
                            title={t("sourceCoding.media.fitWaveform")}
                          >
                            <ZoomFitIcon />
                          </button>
                          <div className="media-player-zoom-popout" aria-label={t("sourceCoding.media.waveformZoom")}>
                            <div className="media-player-zoom-meter" aria-label={`${t("sourceCoding.media.waveformZoom")} ${zoomUiState.zoomPercent}%`}>
                              <input
                                type="range"
                                min="100"
                                max={zoomSliderMax}
                                step="1"
                                value={zoomSliderValue}
                                onChange={(event) => mediaTimelineRef.current?.setZoomPercent(Number(event.target.value))}
                                className="media-player-zoom-range"
                                aria-label={`${t("sourceCoding.media.waveformZoom")}, ${zoomUiState.zoomPercent}%`}
                                style={{
                                  background: `linear-gradient(90deg, #4b5563 0%, #4b5563 ${zoomSliderFillPercent}%, rgba(53, 80, 112, 0.14) ${zoomSliderFillPercent}%, rgba(53, 80, 112, 0.14) 100%)`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                        <div
                          className={`media-player-video-side-cluster media-player-speed-cluster${speedControlOpen ? " is-speed-open" : ""}`}
                          onPointerEnter={openSpeedControl}
                          onPointerLeave={scheduleSpeedControlClose}
                          onFocus={openSpeedControl}
                          onBlur={scheduleSpeedControlClose}
                        >
                          <button
                            type="button"
                            className="media-player-video-side-control media-player-speed-button"
                            onClick={() => {
                              const currentIndex = PLAYBACK_SPEED_OPTIONS.findIndex((rate) => Math.abs(rate - playbackRate) < 0.01);
                              setMediaPlaybackRate(PLAYBACK_SPEED_OPTIONS[(currentIndex + 1) % PLAYBACK_SPEED_OPTIONS.length]);
                            }}
                            aria-label={`${t("sourceCoding.media.playbackSpeed")} ${playbackRateLabel}`}
                            title={t("sourceCoding.media.playbackSpeed")}
                          >
                            {playbackRateLabel}
                          </button>
                          <div className="media-player-speed-popout" aria-label={t("sourceCoding.media.playbackSpeed")}>
                            <div className="media-player-speed-meter" aria-label={`${t("sourceCoding.media.playbackSpeed")} ${playbackRateLabel}`}>
                              <input
                                type="range"
                                min="0"
                                max={PLAYBACK_SPEED_OPTIONS.length - 1}
                                step="1"
                                value={playbackSpeedSliderValue}
                                onChange={(event) => {
                                  const nextRate = PLAYBACK_SPEED_OPTIONS[Number(event.target.value)];
                                  if (nextRate != null) setMediaPlaybackRate(nextRate);
                                }}
                                className="media-player-speed-range"
                                aria-label={`${t("sourceCoding.media.playbackSpeed")}, ${playbackRateLabel}`}
                                style={{
                                  background: `linear-gradient(90deg, #4b5563 0%, #4b5563 ${playbackSpeedFillPercent}%, rgba(53, 80, 112, 0.14) ${playbackSpeedFillPercent}%, rgba(53, 80, 112, 0.14) 100%)`,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                        <div
                          className={`media-player-video-side-cluster media-player-volume-cluster${volumeControlOpen ? " is-volume-open" : ""}`}
                          onPointerEnter={openVolumeControl}
                          onPointerLeave={scheduleVolumeControlClose}
                          onFocus={openVolumeControl}
                          onBlur={scheduleVolumeControlClose}
                        >
                          <button
                            type="button"
                            className="media-player-video-side-control"
                            onClick={toggleMediaMuted}
                            disabled={!mediaElement}
                            title={t("sourceCoding.media.volume")}
                            aria-label={t("sourceCoding.media.volume")}
                          >
                            <VolumeIcon muted={isMuted || volumeLevel <= 0} />
                          </button>
                          <div className="media-player-volume-popout" aria-label={t("sourceCoding.media.volume")}>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              value={volumeLevel}
                              onChange={(event) => setMediaVolume(Number(event.target.value))}
                              className="media-player-volume-range media-player-native-volume-range"
                              aria-label={`${t("sourceCoding.media.volume")} ${volumeSliderFillPercent}%`}
                              style={{
                                background: `linear-gradient(90deg, #4b5563 0%, #4b5563 ${volumeSliderFillPercent}%, rgba(53, 80, 112, 0.14) ${volumeSliderFillPercent}%, rgba(53, 80, 112, 0.14) 100%)`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      <PostgresSourceMediaTimeline
                        ref={mediaTimelineRef}
                        mediaElement={mediaElement}
                        waveformCache={waveformCache}
                        annotations={mediaAnnotations}
                        selectedAnnotationId={selectedAnnotationId}
                        canEditAnnotations={canEditAnnotations}
                        waveformHeight={47}
                        annotationStripReservedLanes={1}
                        reserveScrollbarGutter={false}
                        waveformShellStyle={{
                          width: "100%",
                          padding: 0,
                          scrollbarGutter: "auto",
                        }}
                        seekBounds={activeClipRange}
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
                          selectClipAnnotation(annotationId);
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
                      {!activeClipRange ? (
                        <div className="media-player-video-waveform-actions media-player-audio-waveform-actions" aria-label={t("sourceCoding.media.audioClipActions")}>
                          <button
                            type="button"
                            onClick={createSelectionFromCurrentTime}
                            disabled={!canEditAnnotations}
                            className="media-player-video-action-button media-player-video-action-button--primary"
                            aria-label={t("sourceCoding.media.newClip")}
                            title={t("sourceCoding.media.newClip")}
                          >
                            <NewClipIcon />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {activeClipRange ? (
                    <div className="media-player-video-action-card" aria-label={t("sourceCoding.media.audioClipActions")}>
                      <div className="media-player-video-clip-fields" aria-label={t("sourceCoding.media.activeClipDetails")}>
                        <div className="media-player-video-clip-field media-player-video-clip-code-row">
                          <span className="media-player-video-clip-field-label">{t("sourceCoding.common.codes")}</span>
                          <div className="media-player-video-clip-code-list">
                            {activeClipCodes.length > 0 ? (
                              activeClipCodes.map((code) => (
                                <span
                                  key={code.id}
                                  className="annotation-code-badge media-player-video-clip-code-badge"
                                  style={{ background: code.color }}
                                >
                                  <span className="media-player-video-clip-code-label">{code.label}</span>
                                  <button
                                    type="button"
                                    className="media-player-video-clip-code-remove"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      removeActiveClipCode(code.id);
                                    }}
                                    disabled={!canEditAnnotations || saving}
                                    aria-label={t("sourceCoding.media.removeCodeFromClip", { codeLabel: code.label })}
                                    title={t("sourceCoding.media.removeCode", { codeLabel: code.label })}
                                  >
                                    <CloseIcon className="media-player-video-clip-code-remove-icon" />
                                  </button>
                                </span>
                              ))
                            ) : (
                              <span className="media-player-video-clip-muted">{t("sourceCoding.media.notCoded")}</span>
                            )}
                          </div>
                        </div>
                        <label className="media-player-video-clip-field">
                          <span className="media-player-video-clip-field-label">{t("sourceCoding.media.start")}</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={clipSelectionDraftStart}
                            onChange={(event) => handleClipSelectionDraftChange("start", event.target.value)}
                            onBlur={resetClipSelectionDraftsToActiveRange}
                            disabled={!canEditAnnotations || saving}
                            placeholder="--:--.-"
                          />
                        </label>
                        <label className="media-player-video-clip-field">
                          <span className="media-player-video-clip-field-label">{t("sourceCoding.media.end")}</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={clipSelectionDraftEnd}
                            onChange={(event) => handleClipSelectionDraftChange("end", event.target.value)}
                            onBlur={resetClipSelectionDraftsToActiveRange}
                            disabled={!canEditAnnotations || saving}
                            placeholder="--:--.-"
                          />
                        </label>
                      </div>
                      <div className="media-player-video-clip-save-stack" aria-label={t("sourceCoding.media.activeClipSaveControls")}>
                        <button
                          type="button"
                          className="media-player-video-clip-action-button media-player-video-clip-action-button--save"
                          onClick={() => void acceptActiveClipChanges()}
                          disabled={!activeClipHasCodes || !canEditAnnotations || saving}
                          aria-label={t("sourceCoding.media.saveClip")}
                          title={t("common.save")}
                        >
                          <AcceptClipIcon />
                        </button>
                        <button
                          type="button"
                          className="media-player-video-clip-action-button media-player-video-clip-action-button--cancel"
                          onClick={clearActiveClipSelection}
                          disabled={saving}
                          aria-label={t("sourceCoding.media.cancelClipEdits")}
                          title={t("common.cancel")}
                        >
                          <CloseIcon className="media-player-video-clip-action-close-icon" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="case-card-empty">{t("sourceCoding.media.noPreview", { kind: mediaKind })}</p>
            )}
          </div>
        </div>
      </div>

      {codeContextMenu ? (
        <div ref={codeContextMenuRef} className="context-menu" style={codeContextMenuStyle}>
          {canCreateCodes && onUpdateCode ? (
            <button
              className="context-menu-item"
              onClick={() => {
                setEditingCodeId(codeContextMenu.code.id);
                setNewCodeOpen(false);
                setChildCodeParentId(null);
                setCodeContextMenu(null);
              }}
            >
              {t("sourceCoding.common.editCode")}
            </button>
          ) : null}
          {canManageMemos ? (
            <button
              className="context-menu-item"
              onClick={() => {
                onOpenMemoDraft({ codeIds: [codeContextMenu.code.id] });
                setCodeContextMenu(null);
              }}
            >
              {t("sourceCoding.common.memoAboutCode")}
            </button>
          ) : null}
          {canCreateCodes && onCreateCode ? (
            <button
              className="context-menu-item"
              onClick={() => {
                setChildCodeParentId(codeContextMenu.code.id);
                setNewCodeOpen(false);
                setEditingCodeId(null);
                setCodeContextMenu(null);
              }}
            >
              {t("sourceCoding.common.addChildCode")}
            </button>
          ) : null}
          {canCreateCodes && onDeleteCode ? (
            <button
              className="context-menu-item context-menu-item--danger"
              onClick={() => {
                setDeletingCodeId(codeContextMenu.code.id);
                setDeleteCodeError("");
                setCodeContextMenu(null);
              }}
            >
              {t("sourceCoding.common.deleteCode")}
            </button>
          ) : null}
        </div>
      ) : null}

      {helpOpen ? (
        <SettingsModal
          title={mediaKind === "audio" ? t("sourceCoding.media.helpTitleAudio") : t("sourceCoding.media.helpTitleVideo")}
          onClose={() => setHelpOpen(false)}
          modalClassName="modal--help"
        >
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("sourceCoding.media.helpLine1")}
            </p>
            <p className="users-guide-copy">
              {t("sourceCoding.media.helpLine2")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
      ) : null}

      {newCodeOpen ? (
        <NewCodeModal
          allCodes={codebookRows}
          onSubmit={async (payload) => {
            if (!onCreateCode || !canCreateCodes) return;
            const createdCode = await onCreateCode({
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? null,
            });
            if (pendingSelection) setPendingClipCodeIds((current) => current.includes(createdCode.id) ? current : [...current, createdCode.id]);
          }}
          onDone={() => setNewCodeOpen(false)}
          onClose={() => setNewCodeOpen(false)}
        />
      ) : null}

      {childCodeParentRow ? (
        <NewCodeModal
          allCodes={codebookRows}
          title={t("sourceCoding.common.addChildCodeTitle")}
          submitLabel={t("sourceCoding.common.createCode")}
          initialParentId={childCodeParentRow.id}
          onSubmit={async (payload) => {
            if (!onCreateCode || !canCreateCodes) return;
            const createdCode = await onCreateCode({
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? childCodeParentRow.id,
            });
            if (pendingSelection) setPendingClipCodeIds((current) => current.includes(createdCode.id) ? current : [...current, createdCode.id]);
          }}
          onDone={() => setChildCodeParentId(null)}
          onClose={() => setChildCodeParentId(null)}
        />
      ) : null}

      {editingCodeRow ? (
        <NewCodeModal
          allCodes={codebookRows}
          title={t("sourceCoding.common.editCodeTitle")}
          submitLabel={t("sourceCoding.common.saveChanges")}
          initialLabel={editingCodeRow.label}
          initialDescription={editingCodeRow.description}
          initialColor={editingCodeRow.color}
          initialParentId={editingCodeRow.parentId}
          excludeCodeId={editingCodeRow.id}
          onSubmit={async (payload) => {
            if (!onUpdateCode || !canCreateCodes) return;
            await onUpdateCode(editingCodeRow.id, {
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? null,
            });
          }}
          onDone={() => setEditingCodeId(null)}
          onClose={() => setEditingCodeId(null)}
        />
      ) : null}

      {deletingCodeRow ? (
        <SettingsModal title={t("sourceCoding.common.deleteCodeTitle")} onClose={() => setDeletingCodeId(null)} closeDisabled={deletingCode}>
          <div className="app-settings-modal-body">
            <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
              {t("common.delete")} <strong>{deletingCodeRow.label}</strong>?
            </p>
            <p className="modal-warning-text">
              {t("sourceCoding.common.deleteCodeWarning")}
            </p>
            {deleteCodeError ? <p className="auth-error">{deleteCodeError}</p> : null}
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn" onClick={() => setDeletingCodeId(null)} disabled={deletingCode}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn--danger" onClick={() => void handleConfirmDeleteCode()} disabled={deletingCode}>
              {deletingCode ? t("sourceCoding.common.deleting") : t("sourceCoding.common.deleteCodeTitle")}
            </button>
          </div>
        </SettingsModal>
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

      {editingAnnotation && canEditAnnotations ? (
        <AnnotationEditorModal
          title={t("sourceCoding.common.editAnnotation")}
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

    </div>
  );
}
