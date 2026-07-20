import { useEffect, useMemo, useRef, useState } from "react";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import {
  MediaController,
  MediaControlBar,
  MediaDurationDisplay,
  MediaFullscreenButton,
  MediaMuteButton,
  MediaPlaybackRateButton,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
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
import { useI18n } from "../i18n/provider";
import type { PendingSelection, SourceAnnotationRow } from "./Postgres_Sources_View";
import {
  AnnotationEditorModal,
  orderedCodesWithDepth,
  type PostgresSourceCodingViewProps,
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

function formatEditableSeconds(timeMs: number) {
  return (timeMs / 1000).toFixed(2).replace(/\.?0+$/, "");
}

function ZoomOutIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.5 10.5L13.5 13.5" />
      <path d="M5 7H9" />
    </svg>
  );
}

function ZoomFitIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.25 2.5H2.5v2.75" />
      <path d="M10.75 2.5h2.75v2.75" />
      <path d="M5.25 13.5H2.5v-2.75" />
      <path d="M10.75 13.5h2.75v-2.75" />
      <path d="M6 6l-3.5-3.5" />
      <path d="M10 6l3.5-3.5" />
      <path d="M6 10l-3.5 3.5" />
      <path d="M10 10l3.5 3.5" />
    </svg>
  );
}

function ZoomInIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.5 10.5L13.5 13.5" />
      <path d="M7 5V9" />
      <path d="M5 7H9" />
    </svg>
  );
}

function NewClipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 3.5h-2v9h2" />
      <path d="M11.5 3.5h2v9h-2" />
      <path d="M8 5.5v5" />
      <path d="M5.5 8h5" />
    </svg>
  );
}

function EditClipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13l2.75-.5L13 5.25 10.75 3 3.5 10.25 3 13Z" />
      <path d="M9.75 4L12 6.25" />
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
  onBack,
}: PostgresSourceCodingViewProps & {
  projectStoragePath: string;
  mediaKind: "audio" | "video";
}) {
  const { t } = useI18n();
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingClipSelection | null>(null);
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
  const [zoomUiState, setZoomUiState] = useState<PostgresSourceMediaTimelineZoomUiState>({
    canZoomIn: false,
    canZoomOut: false,
    canFit: false,
  });
  const [clipSelectionEditorOpen, setClipSelectionEditorOpen] = useState(false);
  const [clipSelectionDraftStart, setClipSelectionDraftStart] = useState("");
  const [clipSelectionDraftEnd, setClipSelectionDraftEnd] = useState("");
  const [codeContextMenu, setCodeContextMenu] = useState<{ x: number; y: number; code: PostgresExperimentCode } | null>(null);
  const codeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const clipSelectionEditorRef = useRef<HTMLDivElement | null>(null);
  const codeContextMenuStyle = useViewportContextMenuStyle(codeContextMenu, codeContextMenuRef);
  const mediaElementRef = useRef<HTMLMediaElement | null>(null);
  const mediaTimelineRef = useRef<PostgresSourceMediaTimelineHandle | null>(null);
  const playbackRangeRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const playbackMonitorFrameRef = useRef<number | null>(null);
  const waveformRecoveryAttemptedRef = useRef<string | null>(null);

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
    : selectedRange;
  const activePlaybackRange = pendingSelection
    ? { startMs: pendingSelection.timeStartMs, endMs: pendingSelection.timeEndMs }
    : selectedRange;

  useEffect(() => {
    playbackRangeRef.current = activePlaybackRange;
  }, [activePlaybackRange]);

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
    }
  }, [mediaAnnotations, selectedAnnotationId]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (codeContextMenuRef.current && !codeContextMenuRef.current.contains(event.target as Node)) {
        setCodeContextMenu(null);
      }
      if (clipSelectionEditorRef.current && !clipSelectionEditorRef.current.contains(event.target as Node)) {
        setClipSelectionEditorOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCodeContextMenu(null);
        setClipSelectionEditorOpen(false);
        if (!saving) setPendingSelection(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [saving]);

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

    void readTauriFile(resolvedFilePath)
      .then((bytes) => {
        if (cancelled) return;
        setPreviewBytes(bytes);
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mediaTypeFromFileExtension(fileExt) ?? undefined }));
        setPreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((loadError) => {
        if (cancelled) return;
        setPreviewBytes(null);
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
  }, [previewUrl, mediaKind]);

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
    };

    const handleEnded = () => setClipPlaybackAnnotationId(null);
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
    mediaElement.addEventListener("ended", handleEnded);
    mediaElement.addEventListener("play", handlePlay);
    mediaElement.addEventListener("pause", handlePause);
    handleLoadedMetadata();

    return () => {
      cancelPlaybackMonitor();
      mediaElement.removeEventListener("timeupdate", handleTimeUpdate);
      mediaElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      mediaElement.removeEventListener("ended", handleEnded);
      mediaElement.removeEventListener("play", handlePlay);
      mediaElement.removeEventListener("pause", handlePause);
    };
  }, [clipPlaybackAnnotationId, mediaAnnotations]);

  async function handleQuickCode(codeId: string) {
    if (!pendingSelection || !canEditAnnotations || saving) return;
    await onCreateAnnotation(row.id, pendingSelection, { codeIds: [codeId], note: "" });
    setPendingSelection(null);
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
    setSelectedAnnotationId(null);
    setClipPlaybackAnnotationId(null);
  }

  async function handleUpdateAnnotationRange(annotationId: string, startMs: number, endMs: number) {
    const annotation = mediaAnnotations.find((entry) => entry.id === annotationId);
    if (!annotation) return;
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
  const disabledPlayerActionStyle = {
    opacity: 0.42,
    cursor: "not-allowed" as const,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  };
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

  function openClipSelectionEditor() {
    if (!activeClipRange) return;
    setClipSelectionDraftStart(formatEditableSeconds(activeClipRange.startMs));
    setClipSelectionDraftEnd(formatEditableSeconds(activeClipRange.endMs));
    setClipSelectionEditorOpen(true);
  }

  function clearActiveClipSelection() {
    setPendingSelection(null);
    setSelectedAnnotationId(null);
    setClipPlaybackAnnotationId(null);
    setClipSelectionEditorOpen(false);
  }

  async function applyClipSelectionEdits() {
    if (!activeClipRange || !canEditAnnotations) return;
    const parsedStartSeconds = Number(clipSelectionDraftStart);
    const parsedEndSeconds = Number(clipSelectionDraftEnd);
    if (!Number.isFinite(parsedStartSeconds) || !Number.isFinite(parsedEndSeconds)) return;
    const durationLimitMs = durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY;
    const nextStartMs = Math.max(0, Math.round(parsedStartSeconds * 1000));
    const nextEndMs = Math.min(durationLimitMs, Math.round(parsedEndSeconds * 1000));
    const safeEndMs = Math.max(nextStartMs + 1, nextEndMs);
    if (pendingSelection) {
      setPendingSelection(clipSelectionFromRange(nextStartMs, safeEndMs));
    } else if (selectedAnnotation) {
      await handleUpdateAnnotationRange(selectedAnnotation.id, nextStartMs, safeEndMs);
    }
    setClipSelectionEditorOpen(false);
  }

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
                A pending clip selection is active. Drag its edges on the waveform to adjust it, or select a code to apply it.
              </div>
            ) : null}
            <ul className="code-list">
              {codes.length === 0 ? (
                <li className="code-list-empty">No codes yet.</li>
              ) : (
                visibleCodes.map(({ code, depth, hasChildren }) => (
                  <li
                    key={code.id}
                    className={`code-item${pendingSelection && canEditAnnotations ? " code-item--annotatable" : ""}`}
                    style={{ paddingLeft: 6 + depth * 16 }}
                    onMouseDown={(event) => {
                      if (pendingSelection) event.preventDefault();
                    }}
                    onClick={() => void handleQuickCode(code.id)}
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
          <div className="annotate-card annotate-card--grow">
            <div className="doc-viewer-toolbar">
              <span className="doc-name">{row.name}</span>
            </div>

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
              ) : !canEditAnnotations ? (
                <p className="users-guide-copy" style={{ margin: 0 }}>
                  {lockSyncing ? "Claiming the source lock for annotation..." : `This ${mediaKind} source is currently read-only in the coding workspace.`}
                </p>
              ) : null}
            </div>

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
                {mediaKind === "video" ? (
                  <div className="doc-content-scroll-shell" style={{ padding: 0 }}>
                    <video
                      ref={(element) => {
                        mediaElementRef.current = element;
                        setMediaElement(element);
                      }}
                      src={previewUrl}
                      playsInline
                      style={{ display: "block", width: "100%", maxHeight: "52vh", background: "#000000" }}
                    />
                  </div>
                ) : (
                  <audio
                    ref={(element) => {
                      mediaElementRef.current = element;
                      setMediaElement(element);
                    }}
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

                <PostgresSourceMediaTimeline
                  ref={mediaTimelineRef}
                  mediaElement={mediaElement}
                  waveformCache={waveformCache}
                  annotations={mediaAnnotations}
                  selectedAnnotationId={selectedAnnotationId}
                  canEditAnnotations={canEditAnnotations}
                  pendingSelection={pendingSelection ? {
                    startMs: pendingSelection.timeStartMs,
                    endMs: pendingSelection.timeEndMs,
                  } : null}
                  onCreateSelection={(startMs, endMs) => {
                    setPendingSelection(clipSelectionFromRange(startMs, endMs));
                    setSelectedAnnotationId(null);
                  }}
                  onSelectAnnotation={(annotationId) => {
                    setSelectedAnnotationId(annotationId);
                    const annotation = mediaAnnotations.find((entry) => entry.id === annotationId);
                    if (annotation) seekToAnnotation(annotation);
                  }}
                  onUpdateAnnotationRange={(annotationId, startMs, endMs) => {
                    void handleUpdateAnnotationRange(annotationId, startMs, endMs);
                  }}
                  onPlayClip={playClip}
                  onZoomUiStateChange={setZoomUiState}
                />

                <MediaController
                  audio={mediaKind === "audio" ? true : undefined}
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
                      ref={(element) => {
                        mediaElementRef.current = element;
                        setMediaElement(element);
                      }}
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
                      ref={(element) => {
                        mediaElementRef.current = element;
                        setMediaElement(element);
                      }}
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
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "10px 12px",
                      borderRadius: 14,
                      background: "rgba(255, 255, 255, 0.94)",
                      border: "1px solid rgba(53, 80, 112, 0.12)",
                      boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
                      color: "#233142",
                    }}
                  >
                      <div className="media-player-control-row">
                        <div className="media-player-control-cluster">
                          <button
                            type="button"
                            className="media-player-clip-action"
                            disabled={!zoomUiState.canZoomOut}
                            onClick={() => mediaTimelineRef.current?.zoomOut()}
                            aria-label="Zoom out"
                            title="Zoom out"
                            style={{
                              ...playerActionButtonStyle,
                              ...(!zoomUiState.canZoomOut ? disabledPlayerActionStyle : null),
                            }}
                          >
                            <ZoomOutIcon />
                          </button>
                          <button
                            type="button"
                            className="media-player-clip-action"
                            disabled={!zoomUiState.canFit}
                            onClick={() => mediaTimelineRef.current?.fitToWaveform()}
                            aria-label="Fit waveform"
                            title="Fit waveform"
                            style={{
                              ...playerActionButtonStyle,
                              ...(!zoomUiState.canFit ? disabledPlayerActionStyle : null),
                            }}
                          >
                            <ZoomFitIcon />
                          </button>
                          <button
                            type="button"
                            className="media-player-clip-action"
                            disabled={!zoomUiState.canZoomIn}
                            onClick={() => mediaTimelineRef.current?.zoomIn()}
                            aria-label="Zoom in"
                            title="Zoom in"
                            style={{
                              ...playerActionButtonStyle,
                              ...(!zoomUiState.canZoomIn ? disabledPlayerActionStyle : null),
                            }}
                          >
                            <ZoomInIcon />
                          </button>
                        </div>
                        <div ref={clipSelectionEditorRef} className="media-player-control-cluster media-player-clip-cluster">
                          {activeClipRange ? (
                            <>
                              <button
                                type="button"
                                onClick={openClipSelectionEditor}
                                disabled={!canEditAnnotations}
                                className="media-player-clip-action"
                                aria-label="Edit selection"
                                title="Edit selection"
                                style={{
                                  ...playerActionButtonStyle,
                                  ...clipActionEnabledStyle,
                                }}
                              >
                                <EditClipIcon />
                              </button>
                              <button
                                type="button"
                                onClick={clearActiveClipSelection}
                                className="media-player-clip-action"
                                aria-label="Clear selection"
                                title="Clear selection"
                                style={playerActionButtonStyle}
                              >
                                <ClearClipIcon />
                              </button>
                              {clipSelectionEditorOpen ? (
                                <div className="media-player-clip-editor">
                                  <label className="media-player-clip-editor-field">
                                    <span>Start</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={durationMs > 0 ? durationMs / 1000 : undefined}
                                      step={0.1}
                                      value={clipSelectionDraftStart}
                                      onChange={(event) => setClipSelectionDraftStart(event.target.value)}
                                    />
                                  </label>
                                  <label className="media-player-clip-editor-field">
                                    <span>End</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={durationMs > 0 ? durationMs / 1000 : undefined}
                                      step={0.1}
                                      value={clipSelectionDraftEnd}
                                      onChange={(event) => setClipSelectionDraftEnd(event.target.value)}
                                    />
                                  </label>
                                  <div className="media-player-clip-editor-actions">
                                    <button
                                      type="button"
                                      className="media-player-clip-action"
                                      onClick={() => setClipSelectionEditorOpen(false)}
                                      style={playerActionButtonStyle}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="media-player-clip-action media-player-clip-action--primary"
                                      onClick={() => void applyClipSelectionEdits()}
                                      disabled={!canEditAnnotations || saving}
                                      style={{
                                        ...playerActionButtonStyle,
                                        background: "linear-gradient(180deg, rgba(75, 85, 99, 0.98), rgba(55, 65, 81, 0.98))",
                                        color: "#f8fafc",
                                        border: "1px solid rgba(31, 41, 55, 0.5)",
                                        opacity: !canEditAnnotations || saving ? 0.5 : 1,
                                        cursor: !canEditAnnotations || saving ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      Apply
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </>
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
                      </div>
                      <div className="media-player-control-row">
                        <div className="media-player-control-cluster">
                          <MediaPlayButton className="media-player-native-control" />
                          <MediaSeekBackwardButton className="media-player-native-control" seekOffset={5} />
                          <MediaSeekForwardButton className="media-player-native-control" seekOffset={5} />
                          <MediaPlaybackRateButton className="media-player-native-control media-player-native-control--label" />
                          <div className="media-player-volume-cluster">
                            <MediaMuteButton className="media-player-native-control" />
                            <MediaVolumeRange className="media-player-volume-range" />
                          </div>
                          {mediaKind === "video" ? <MediaFullscreenButton className="media-player-native-control" /> : null}
                          <MediaTimeDisplay className="media-player-time-display" />
                          <span className="users-guide-copy media-player-time-separator">/</span>
                          <MediaDurationDisplay className="media-player-time-display" />
                        </div>
                      </div>
                  </MediaControlBar>
                </MediaController>
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
    </div>
  );
}
