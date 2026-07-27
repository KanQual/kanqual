import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties } from "react";
import WaveSurfer from "wavesurfer.js";
import HoverPlugin from "wavesurfer.js/dist/plugins/hover.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.js";
import type { Region } from "wavesurfer.js/dist/plugins/regions.js";
import type { MediaWaveformCache } from "../lib/mediaWaveform";
import { buildMultiAnnotationBackground, getFloatingTooltipStyle, tooltipExcerpt } from "./Postgres_Source_Coding_Shared";
import type { SourceAnnotationRow } from "./Postgres_Sources_View";

const BASE_WAVE_COLOR = "#c9d5df";
const BASE_PROGRESS_COLOR = "#4b5563";
const DEFAULT_REGION_COLOR = "#355070";
const MIN_ZOOM_PX_PER_SEC = 1;
const MAX_ZOOM_PX_PER_SEC = 800;
const ZOOM_STEP_FACTOR = 1.35;
const TIMELINE_HEIGHT_PX = 28;
const SEGMENT_STRIP_ROW_HEIGHT_PX = 9;
const SEGMENT_STRIP_ROW_GAP_PX = 4;
const SEGMENT_STRIP_MIN_BAR_WIDTH_PX = 3;
const SEGMENT_STRIP_PADDING_TOP_PX = 6;
const SEGMENT_STRIP_PADDING_BOTTOM_PX = 2;
const DIMMED_SEGMENT_OPACITY = 0.38;
const SCROLLBAR_RESERVE_PX = 0;
const MIN_LABEL_GAP_PX = 84;
const LABEL_WIDTH_BIAS_PX = 18;

type PendingClipSelection = {
  startMs: number;
  endMs: number;
};

type MediaTimelineTooltip = {
  x: number;
  y: number;
  label: string;
  timeLabel: string;
  quote: string;
  color: string;
};

type TimelineViewportMetrics = {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
};

type ResponsiveTimelineConfig = {
  timeInterval: number;
  primaryLabelInterval: number;
  secondaryLabelInterval: number;
  primaryLabelSpacing?: number;
  secondaryLabelSpacing?: number;
};

function formatOpenTimingDetails(details?: Record<string, number | string | boolean | null | undefined>) {
  if (!details) return "";
  const entries = Object.entries(details).filter(([, value]) => value != null);
  if (entries.length === 0) return "";
  return ` ${entries.map(([key, value]) => `${key}=${String(value)}`).join(" ")}`;
}

export type PostgresSourceMediaTimelineHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fitToWaveform: () => void;
  setZoomPercent: (percent: number) => void;
  isReady: () => boolean;
};

export type PostgresSourceMediaTimelineZoomUiState = {
  canZoomIn: boolean;
  canZoomOut: boolean;
  canFit: boolean;
  zoomPercent: number;
};

type PostgresSourceMediaTimelineProps = {
  mediaElement: HTMLMediaElement | null;
  waveformCache?: MediaWaveformCache | null;
  annotations: SourceAnnotationRow[];
  selectedAnnotationId: string | null;
  canEditAnnotations: boolean;
  waveformHeight?: number;
  waveformShellStyle?: CSSProperties;
  pendingSelection: PendingClipSelection | null;
  pendingSelectionCodeColors?: string[];
  onCreateSelection: (startMs: number, endMs: number) => void;
  onSelectAnnotation: (annotationId: string) => void;
  onAnnotationContextMenu?: (annotation: SourceAnnotationRow, x: number, y: number) => void;
  onUpdateAnnotationRange: (annotationId: string, startMs: number, endMs: number) => void;
  onPlayClip: (annotationId: string) => void;
  onZoomUiStateChange?: (state: PostgresSourceMediaTimelineZoomUiState) => void;
};

export function formatMediaTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const milliseconds = clamped % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatTimelineAxisTime(seconds: number): string {
  const roundedMs = Math.max(0, Math.round(seconds * 1000));
  const full = formatMediaTime(roundedMs);
  return full.endsWith(".000") ? full.slice(0, -4) : full;
}

export function buildMediaClipQuote(startMs: number, endMs: number): string {
  return `Clip ${formatMediaTime(startMs)} - ${formatMediaTime(endMs)}`;
}

function clampMediaRange(startMs: number, endMs: number) {
  const safeStart = Math.max(0, Math.round(Math.min(startMs, endMs)));
  const safeEnd = Math.max(safeStart + 1, Math.round(Math.max(startMs, endMs)));
  return {
    startMs: safeStart,
    endMs: safeEnd,
  };
}

function annotationRange(annotation: SourceAnnotationRow) {
  if (annotation.timeStartMs == null || annotation.timeEndMs == null) return null;
  return clampMediaRange(annotation.timeStartMs, annotation.timeEndMs);
}

function applyRegionBoundaryMarkers(
  region: Region,
  color: string,
) {
  const element = region.element;
  if (!element) return;

  element.querySelectorAll("[data-region-boundary-marker='true']").forEach((node) => node.remove());
  element.style.setProperty("overflow", "visible");
  element.style.setProperty("border-left", `3px solid ${color}`);
  element.style.setProperty("border-right", `3px solid ${color}`);
  element.style.setProperty("box-sizing", "border-box");
}

function buildSelectedRegionContent(annotation: SourceAnnotationRow) {
  return ` ${annotation.codeLabels.join(", ") || "Annotation"} `;
}

function buildMediaClipRegionBackground(colors: string[], isSelected: boolean) {
  const uniqueColors = [...new Set(colors.filter(Boolean))];
  return buildMultiAnnotationBackground(uniqueColors, isSelected);
}

function applyRegionBackground(region: Region, background: string) {
  if (!region.element) return;
  const isGradient = background.includes("gradient(");
  region.element.style.removeProperty("background");
  region.element.style.setProperty("background-image", isGradient ? background : "none");
  region.element.style.setProperty("background-color", isGradient ? "transparent" : background);
}

function applyAnnotationRegionStyles(
  region: Region,
  annotation: SourceAnnotationRow,
  canEditAnnotations: boolean,
  isSelected: boolean,
) {
  const range = annotationRange(annotation);
  if (!range) return;

  const primaryColor = annotation.codeColors[0] || DEFAULT_REGION_COLOR;
  const regionBackground = buildMediaClipRegionBackground(annotation.codeColors, isSelected);
  region.setOptions({
    start: range.startMs / 1000,
    end: range.endMs / 1000,
    drag: false,
    resize: canEditAnnotations,
    color: regionBackground,
    content: isSelected ? buildSelectedRegionContent(annotation) : "",
  });

  region.element?.setAttribute("data-annotation-id", annotation.id);
  applyRegionBackground(region, regionBackground);
  region.element?.style.setProperty("border-top", `2px solid ${primaryColor}`);
  region.element?.style.setProperty("border-bottom", `2px solid ${primaryColor}`);
  region.element?.style.setProperty("cursor", "pointer");
  region.element?.style.setProperty("z-index", isSelected ? "4" : "2");
  region.element?.style.setProperty(
    "opacity",
    isSelected ? "1" : "1",
  );
  applyRegionBoundaryMarkers(region, primaryColor);
}

function clampZoomPxPerSec(value: number): number {
  if (!Number.isFinite(value)) return MIN_ZOOM_PX_PER_SEC;
  return Math.min(MAX_ZOOM_PX_PER_SEC, Math.max(MIN_ZOOM_PX_PER_SEC, value));
}

function hasUsableHorizontalOverflow(element: HTMLElement) {
  return element.scrollWidth > element.clientWidth + 4;
}

function shouldWaveSurferAutoScroll(scrollContainer: HTMLElement, isFitZoom: boolean) {
  return !isFitZoom && hasUsableHorizontalOverflow(scrollContainer);
}

function shouldShowHorizontalScrollbar(scrollContainer: HTMLElement, isFitZoom: boolean) {
  return !isFitZoom && hasUsableHorizontalOverflow(scrollContainer);
}

function applyWaveScrollContainerStyles(scrollContainer: HTMLElement | null, isFitZoom = false) {
  if (!scrollContainer) return;
  const shouldShowScrollbar = shouldShowHorizontalScrollbar(scrollContainer, isFitZoom);
  if (!shouldShowScrollbar) {
    scrollContainer.scrollLeft = 0;
  }
  scrollContainer.style.overflowX = shouldShowScrollbar ? "auto" : "hidden";
  scrollContainer.style.overflowY = "hidden";
  scrollContainer.style.scrollbarGutter = "stable";
  scrollContainer.style.boxSizing = "border-box";
  scrollContainer.style.paddingBottom = `${SCROLLBAR_RESERVE_PX}px`;
}

function resetWaveScrollContainerStyles(scrollContainer: HTMLElement | null) {
  if (!scrollContainer) return;
  scrollContainer.style.overflowX = "";
  scrollContainer.style.overflowY = "";
  scrollContainer.style.scrollbarGutter = "";
  scrollContainer.style.boxSizing = "";
  scrollContainer.style.paddingBottom = "";
}

function chooseTimelineTimeInterval(pxPerSec: number) {
  if (pxPerSec >= 320) return 0.25;
  if (pxPerSec >= 220) return 0.5;
  if (pxPerSec >= 140) return 1;
  if (pxPerSec >= 90) return 2;
  if (pxPerSec >= 45) return 5;
  if (pxPerSec >= 18) return 10;
  return 15;
}

function buildResponsiveTimelineConfig(pxPerSec: number, containerWidth: number): ResponsiveTimelineConfig {
  const safePxPerSec = Math.max(MIN_ZOOM_PX_PER_SEC, pxPerSec || MIN_ZOOM_PX_PER_SEC);
  const safeWidth = Math.max(240, containerWidth || 240);
  const widthPressure = safeWidth < 560 ? 1.5 : safeWidth < 760 ? 1.2 : 1;
  const timeInterval = chooseTimelineTimeInterval(safePxPerSec);
  const minPrimarySpacingPx = (MIN_LABEL_GAP_PX + LABEL_WIDTH_BIAS_PX) * widthPressure;
  const primaryLabelSpacing = Math.max(1, Math.ceil(minPrimarySpacingPx / (timeInterval * safePxPerSec)));
  return {
    timeInterval,
    primaryLabelInterval: 9999,
    secondaryLabelInterval: 9999,
    primaryLabelSpacing,
    secondaryLabelSpacing: primaryLabelSpacing,
  };
}

function buildZoomUiState(currentZoomPxPerSec: number, fitZoomPxPerSec: number): PostgresSourceMediaTimelineZoomUiState {
  const safeCurrentZoom = clampZoomPxPerSec(currentZoomPxPerSec);
  const safeFitZoom = clampZoomPxPerSec(fitZoomPxPerSec);
  const fitThreshold = Math.max(0.5, safeFitZoom * 0.02);
  const maxThreshold = Math.max(0.5, MAX_ZOOM_PX_PER_SEC * 0.005);
  const isAtFit = safeCurrentZoom <= safeFitZoom + fitThreshold;
  const isAtMax = safeCurrentZoom >= MAX_ZOOM_PX_PER_SEC - maxThreshold;
  return {
    canZoomIn: !isAtMax,
    canZoomOut: !isAtFit,
    canFit: !isAtFit,
    zoomPercent: Math.max(1, Math.round((safeCurrentZoom / safeFitZoom) * 100)),
  };
}

export const PostgresSourceMediaTimeline = forwardRef<PostgresSourceMediaTimelineHandle, PostgresSourceMediaTimelineProps>(({
  mediaElement,
  waveformCache,
  annotations,
  selectedAnnotationId,
  canEditAnnotations,
  waveformHeight = 140,
  waveformShellStyle,
  pendingSelection,
  pendingSelectionCodeColors = [],
  onCreateSelection,
  onSelectAnnotation,
  onAnnotationContextMenu,
  onUpdateAnnotationRange,
  onPlayClip,
  onZoomUiStateChange,
}, ref) => {
  const waveformContainerRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const timelinePluginRef = useRef<ReturnType<typeof TimelinePlugin.create> | null>(null);
  const timelineConfigSignatureRef = useRef<string | null>(null);
  const regionsPluginRef = useRef<RegionsPlugin | null>(null);
  const pendingRegionRef = useRef<Region | null>(null);
  const annotationRegionsRef = useRef<Map<string, Region>>(new Map());
  const annotationRegionCleanupRef = useRef<Map<string, Array<() => void>>>(new Map());
  const disableDragSelectionRef = useRef<(() => void) | null>(null);
  const isSyncingRegionsRef = useRef(false);
  const mediaAnnotationIdsRef = useRef<Set<string>>(new Set());
  const mediaAnnotationsByIdRef = useRef<Map<string, SourceAnnotationRow>>(new Map());
  const isFitZoomRef = useRef(true);
  const openTimingStartRef = useRef<number>(performance.now());
  const waveCreateCountRef = useRef(0);
  const initialRegionsLoggedRef = useRef(false);
  const onCreateSelectionRef = useRef(onCreateSelection);
  const onSelectAnnotationRef = useRef(onSelectAnnotation);
  const onAnnotationContextMenuRef = useRef(onAnnotationContextMenu);
  const onUpdateAnnotationRangeRef = useRef(onUpdateAnnotationRange);
  const onPlayClipRef = useRef(onPlayClip);
  const onZoomUiStateChangeRef = useRef(onZoomUiStateChange);
  const [waveReady, setWaveReady] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<MediaTimelineTooltip | null>(null);
  const [zoomPxPerSec, setZoomPxPerSec] = useState<number | null>(null);
  const [timelineDurationMs, setTimelineDurationMs] = useState(0);
  const [timelineContainerWidth, setTimelineContainerWidth] = useState(0);
  const [timelineViewport, setTimelineViewport] = useState<TimelineViewportMetrics>({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
  });

  const mediaAnnotations = useMemo(
    () => annotations.filter((annotation) => annotationRange(annotation) != null),
    [annotations],
  );
  const mediaAnnotationIds = useMemo(
    () => new Set(mediaAnnotations.map((annotation) => annotation.id)),
    [mediaAnnotations],
  );
  const annotationStripBars = useMemo(() => {
    const laneEndTimes: number[] = [];
    const bars: Array<{
      annotation: SourceAnnotationRow;
      background: string;
      color: string;
      lane: number;
      startMs: number;
      endMs: number;
    }> = [];

    for (const annotation of mediaAnnotations) {
      const range = annotationRange(annotation);
      if (!range) continue;
      let lane = laneEndTimes.findIndex((endMs) => range.startMs >= endMs);
      if (lane === -1) {
        lane = laneEndTimes.length;
        laneEndTimes.push(range.endMs);
      } else {
        laneEndTimes[lane] = range.endMs;
      }
      bars.push({
        annotation,
        background: buildMultiAnnotationBackground(annotation.codeColors, false),
        color: annotation.codeColors[0] || DEFAULT_REGION_COLOR,
        lane,
        startMs: range.startMs,
        endMs: range.endMs,
      });
    }

    return {
      bars,
      laneCount: laneEndTimes.length,
    };
  }, [mediaAnnotations]);
  const segmentStripHeight = annotationStripBars.laneCount > 0
    ? SEGMENT_STRIP_PADDING_TOP_PX
      + SEGMENT_STRIP_PADDING_BOTTOM_PX
      + annotationStripBars.laneCount * SEGMENT_STRIP_ROW_HEIGHT_PX
      + Math.max(0, annotationStripBars.laneCount - 1) * SEGMENT_STRIP_ROW_GAP_PX
    : 0;

  function logOpenTiming(phase: string, details?: Record<string, number | string | boolean | null | undefined>) {
    const elapsedMs = Math.round(performance.now() - openTimingStartRef.current);
    console.info(`[wave-open] +${elapsedMs}ms ${phase}${formatOpenTimingDetails(details)}`);
  }

  useEffect(() => {
    mediaAnnotationIdsRef.current = mediaAnnotationIds;
    mediaAnnotationsByIdRef.current = new Map(mediaAnnotations.map((annotation) => [annotation.id, annotation]));
    onCreateSelectionRef.current = onCreateSelection;
    onSelectAnnotationRef.current = onSelectAnnotation;
    onAnnotationContextMenuRef.current = onAnnotationContextMenu;
    onUpdateAnnotationRangeRef.current = onUpdateAnnotationRange;
    onPlayClipRef.current = onPlayClip;
    onZoomUiStateChangeRef.current = onZoomUiStateChange;
  }, [mediaAnnotationIds, mediaAnnotations, onAnnotationContextMenu, onCreateSelection, onPlayClip, onSelectAnnotation, onUpdateAnnotationRange, onZoomUiStateChange]);

  function getFitZoomPxPerSec() {
    const waveSurfer = waveSurferRef.current;
    const container = waveformContainerRef.current;
    if (!waveSurfer || !container) return MIN_ZOOM_PX_PER_SEC;
    const duration = waveSurfer.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return MIN_ZOOM_PX_PER_SEC;
    return clampZoomPxPerSec(container.clientWidth / duration);
  }

  function applyZoom(nextZoomPxPerSec: number, fitMode: boolean) {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer) return;
    const clampedZoom = clampZoomPxPerSec(nextZoomPxPerSec);
    isFitZoomRef.current = fitMode;
    const scrollContainer = waveSurfer.getWrapper().parentElement;
    if (scrollContainer) {
      waveSurfer.options.autoScroll = shouldWaveSurferAutoScroll(scrollContainer, fitMode);
      if (fitMode) {
        scrollContainer.scrollLeft = 0;
      }
    }
    waveSurfer.zoom(clampedZoom);
    setZoomPxPerSec(clampedZoom);
  }

  function fitToWaveform() {
    applyZoom(getFitZoomPxPerSec(), true);
  }

  function adjustZoom(direction: "in" | "out") {
    const baseZoom = zoomPxPerSec ?? getFitZoomPxPerSec();
    const fitZoom = getFitZoomPxPerSec();
    const nextZoom = direction === "in"
      ? baseZoom * ZOOM_STEP_FACTOR
      : baseZoom / ZOOM_STEP_FACTOR;
    if (direction === "out" && nextZoom <= fitZoom) {
      applyZoom(fitZoom, true);
      return;
    }
    applyZoom(nextZoom, false);
  }

  function setZoomPercent(percent: number) {
    const safePercent = Math.max(100, percent);
    applyZoom(getFitZoomPxPerSec() * (safePercent / 100), safePercent <= 100);
  }

  function syncZoomUiState(nextZoomPxPerSec?: number) {
    const currentZoom = nextZoomPxPerSec ?? zoomPxPerSec ?? getFitZoomPxPerSec();
    onZoomUiStateChangeRef.current?.(buildZoomUiState(currentZoom, getFitZoomPxPerSec()));
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => adjustZoom("in"),
    zoomOut: () => adjustZoom("out"),
    fitToWaveform,
    setZoomPercent,
    isReady: () => waveReady,
  }), [waveReady, zoomPxPerSec]);

  useEffect(() => {
    const container = waveformContainerRef.current;
    if (!container || !mediaElement) return;

    openTimingStartRef.current = performance.now();
    initialRegionsLoggedRef.current = false;
    waveCreateCountRef.current += 1;
    setWaveReady(false);
    setTimelineError(null);
    logOpenTiming("wavesurfer-create-start", {
      instance: waveCreateCountRef.current,
      hasCachedWaveform: Boolean(waveformCache?.peaks?.length),
    });

    const waveSurfer = WaveSurfer.create({
      container,
      media: mediaElement,
      backend: "MediaElement",
      peaks: waveformCache?.peaks,
      duration: waveformCache?.durationSeconds,
      waveColor: BASE_WAVE_COLOR,
      progressColor: BASE_PROGRESS_COLOR,
      cursorColor: "#1f2933",
      cursorWidth: 2,
      height: waveformHeight,
      normalize: true,
      autoScroll: false,
      autoCenter: false,
      minPxPerSec: 90,
      dragToSeek: true,
      plugins: [
        RegionsPlugin.create(),
        TimelinePlugin.create({
          height: TIMELINE_HEIGHT_PX,
          formatTimeCallback: formatTimelineAxisTime,
          ...buildResponsiveTimelineConfig(90, container.clientWidth),
        }),
        HoverPlugin.create({
          lineColor: "#355070",
          labelBackground: "#ffffff",
          labelColor: "#355070",
          formatTimeCallback: (seconds) => formatMediaTime(seconds * 1000),
        }),
      ],
    });

    const regions = waveSurfer.getActivePlugins().find((plugin) => plugin instanceof RegionsPlugin) as RegionsPlugin | undefined;
    const timelinePlugin = waveSurfer.getActivePlugins().find((plugin) => plugin instanceof TimelinePlugin) as ReturnType<typeof TimelinePlugin.create> | undefined;
    if (!regions) {
      waveSurfer.destroy();
      setTimelineError("The waveform regions plugin could not be initialized.");
      return;
    }

    waveSurferRef.current = waveSurfer;
    timelinePluginRef.current = timelinePlugin ?? null;
    regionsPluginRef.current = regions;
    setTimelineContainerWidth(container.clientWidth);
    timelineConfigSignatureRef.current = JSON.stringify(buildResponsiveTimelineConfig(90, container.clientWidth));

    const wrapper = waveSurfer.getWrapper();
    const scrollContainer = wrapper.parentElement;
    applyWaveScrollContainerStyles(scrollContainer, isFitZoomRef.current);

    const unsubscribers = [
      waveSurfer.on("ready", (durationSeconds) => {
        setWaveReady(true);
        setTimelineError(null);
        setTimelineDurationMs(Math.max(0, Math.round(durationSeconds * 1000)));
        logOpenTiming("wavesurfer-ready", {
          durationMs: Math.max(0, Math.round(durationSeconds * 1000)),
        });
        fitToWaveform();
        syncZoomUiState(getFitZoomPxPerSec());
      }),
      waveSurfer.on("error", (error) => {
        logOpenTiming("wavesurfer-error", { message: error.message || "unknown" });
        setTimelineError(error.message || "The waveform could not be loaded.");
      }),
      waveSurfer.on("zoom", (minPxPerSec) => {
        setZoomPxPerSec(minPxPerSec);
        syncZoomUiState(minPxPerSec);
      }),
      regions.on("region-created", (region) => {
        if (isSyncingRegionsRef.current) return;
        if (mediaAnnotationIdsRef.current.has(region.id)) return;
        pendingRegionRef.current?.remove();
        pendingRegionRef.current = region;
        const nextRange = clampMediaRange(region.start * 1000, region.end * 1000);
        onCreateSelectionRef.current(nextRange.startMs, nextRange.endMs);
      }),
      regions.on("region-updated", (region) => {
        if (isSyncingRegionsRef.current) return;
        const nextRange = clampMediaRange(region.start * 1000, region.end * 1000);
        if (mediaAnnotationIdsRef.current.has(region.id)) {
          void onUpdateAnnotationRangeRef.current(region.id, nextRange.startMs, nextRange.endMs);
          return;
        }
        if (pendingRegionRef.current?.id === region.id) {
          onCreateSelectionRef.current(nextRange.startMs, nextRange.endMs);
        }
      }),
      regions.on("region-clicked", (region, event) => {
        event.preventDefault();
        if (!mediaAnnotationIdsRef.current.has(region.id)) return;
        onSelectAnnotationRef.current(region.id);
      }),
      regions.on("region-double-clicked", (region, event) => {
        event.preventDefault();
        if (!mediaAnnotationIdsRef.current.has(region.id)) return;
        onPlayClipRef.current(region.id);
      }),
    ];

    return () => {
      logOpenTiming("wavesurfer-destroy", { instance: waveCreateCountRef.current });
      disableDragSelectionRef.current?.();
      disableDragSelectionRef.current = null;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      pendingRegionRef.current = null;
      annotationRegionCleanupRef.current.forEach((cleanups) => cleanups.forEach((cleanup) => cleanup()));
      annotationRegionCleanupRef.current.clear();
      annotationRegionsRef.current.clear();
      timelinePluginRef.current = null;
      timelineConfigSignatureRef.current = null;
      regionsPluginRef.current = null;
      waveSurferRef.current = null;
      resetWaveScrollContainerStyles(scrollContainer);
      waveSurfer.destroy();
    };
  }, [mediaElement, waveformCache, waveformHeight]);

  useEffect(() => {
    const container = waveformContainerRef.current;
    if (!container || !waveReady) return;

    const handleWheel = (event: WheelEvent) => {
      if (!waveSurferRef.current) return;
      event.preventDefault();
      if (event.deltaY < 0) adjustZoom("in");
      else if (event.deltaY > 0) {
        const currentZoom = zoomPxPerSec ?? getFitZoomPxPerSec();
        const fitZoom = getFitZoomPxPerSec();
        if (currentZoom <= fitZoom) {
          fitToWaveform();
          return;
        }
        adjustZoom("out");
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [waveReady, zoomPxPerSec]);

  useEffect(() => {
    const container = waveformContainerRef.current;
    if (!container || !waveReady) return;

    const handleResize = () => {
      setTimelineContainerWidth(container.clientWidth);
      if (isFitZoomRef.current) {
        fitToWaveform();
      } else {
        syncZoomUiState();
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    window.addEventListener("resize", handleResize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [waveReady]);

  useEffect(() => {
    const waveSurfer = waveSurferRef.current;
    const container = waveformContainerRef.current;
    if (!waveSurfer || !container || !waveReady) return;

    const effectiveZoom = zoomPxPerSec ?? getFitZoomPxPerSec();
    const nextConfig = buildResponsiveTimelineConfig(effectiveZoom, timelineContainerWidth || container.clientWidth);
    const nextSignature = JSON.stringify(nextConfig);
    if (timelineConfigSignatureRef.current === nextSignature) return;

    const previousTimelinePlugin = timelinePluginRef.current;
    if (previousTimelinePlugin) {
      waveSurfer.unregisterPlugin(previousTimelinePlugin);
    }

    const nextTimelinePlugin = waveSurfer.registerPlugin(TimelinePlugin.create({
      height: TIMELINE_HEIGHT_PX,
      formatTimeCallback: formatTimelineAxisTime,
      ...nextConfig,
    }));

    timelinePluginRef.current = nextTimelinePlugin;
    timelineConfigSignatureRef.current = nextSignature;
  }, [waveReady, zoomPxPerSec, timelineContainerWidth]);

  useEffect(() => {
    const regions = regionsPluginRef.current;
    if (!regions || !waveReady) return;

    disableDragSelectionRef.current?.();
    disableDragSelectionRef.current = null;

    if (!canEditAnnotations) return;

    disableDragSelectionRef.current = regions.enableDragSelection({
      color: "rgba(53, 80, 112, 0.18)",
      drag: true,
      resize: true,
      minLength: 0.05,
    }, 3);

    return () => {
      disableDragSelectionRef.current?.();
      disableDragSelectionRef.current = null;
    };
  }, [canEditAnnotations]);

  useEffect(() => {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer || !waveReady) return;

    const regionsContainer = waveSurfer.getWrapper().querySelector<HTMLElement>('[part="regions-container"]');
    if (!regionsContainer) return;

    regionsContainer.style.height = `calc(100% - ${TIMELINE_HEIGHT_PX}px)`;
    regionsContainer.style.overflow = "hidden";
  }, [waveReady, zoomPxPerSec]);

  useEffect(() => {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer || !waveReady) return;

    const wrapper = waveSurfer.getWrapper();
    const scrollContainer = wrapper.parentElement;
    if (!scrollContainer) return;

    let frameId: number | null = null;
    const reapplyScrollStyles = () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        applyWaveScrollContainerStyles(scrollContainer, isFitZoomRef.current);
        waveSurfer.options.autoScroll = shouldWaveSurferAutoScroll(scrollContainer, isFitZoomRef.current);
        syncViewport();
        frameId = null;
      });
    };

    const syncViewport = () => {
      const shouldShowScrollbar = shouldShowHorizontalScrollbar(scrollContainer, isFitZoomRef.current);
      waveSurfer.options.autoScroll = shouldWaveSurferAutoScroll(scrollContainer, isFitZoomRef.current);
      scrollContainer.style.overflowX = shouldShowScrollbar ? "auto" : "hidden";
      if (!shouldShowScrollbar && scrollContainer.scrollLeft !== 0) {
        scrollContainer.scrollLeft = 0;
      }
      setTimelineViewport({
        scrollLeft: shouldShowScrollbar ? scrollContainer.scrollLeft : 0,
        scrollWidth: scrollContainer.scrollWidth,
        clientWidth: scrollContainer.clientWidth,
      });
    };

    reapplyScrollStyles();
    scrollContainer.addEventListener("scroll", syncViewport, { passive: true });
    const resizeObserver = new ResizeObserver(syncViewport);
    resizeObserver.observe(scrollContainer);
    window.addEventListener("resize", syncViewport);

    const unsubscribeZoom = waveSurfer.on("zoom", reapplyScrollStyles);
    const unsubscribeRedraw = waveSurfer.on("redraw", reapplyScrollStyles);
    const unsubscribeRedrawComplete = waveSurfer.on("redrawcomplete", reapplyScrollStyles);

    return () => {
      if (frameId != null) {
        window.cancelAnimationFrame(frameId);
      }
      scrollContainer.removeEventListener("scroll", syncViewport);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncViewport);
      unsubscribeZoom();
      unsubscribeRedraw();
      unsubscribeRedrawComplete();
      resetWaveScrollContainerStyles(scrollContainer);
    };
  }, [waveReady]);

  useEffect(() => {
    const regions = regionsPluginRef.current;
    if (!regions) return;

    isSyncingRegionsRef.current = true;
    const existingRegions = new Map(annotationRegionsRef.current);
    const nextRegionIds = new Set(mediaAnnotations.map((annotation) => annotation.id));

    for (const [annotationId, region] of existingRegions) {
      if (nextRegionIds.has(annotationId)) continue;
      annotationRegionCleanupRef.current.get(annotationId)?.forEach((cleanup) => cleanup());
      annotationRegionCleanupRef.current.delete(annotationId);
      annotationRegionsRef.current.delete(annotationId);
      region.remove();
    }

    for (const annotation of mediaAnnotations) {
      const range = annotationRange(annotation);
      if (!range) continue;
      let region = annotationRegionsRef.current.get(annotation.id) ?? null;

      if (!region) {
        region = regions.addRegion({
          id: annotation.id,
          start: range.startMs / 1000,
          end: range.endMs / 1000,
          drag: false,
          resize: canEditAnnotations,
          color: buildMediaClipRegionBackground(annotation.codeColors, annotation.id === selectedAnnotationId),
          content: annotation.id === selectedAnnotationId ? buildSelectedRegionContent(annotation) : "",
        });

        const cleanupFns: Array<() => void> = [];
        const handleContextMenu = (event: Event) => {
          event.preventDefault();
          const mouseEvent = event as MouseEvent;
          const latestAnnotation = mediaAnnotationsByIdRef.current.get(annotation.id);
          if (!latestAnnotation) return;
          onSelectAnnotationRef.current(latestAnnotation.id);
          onAnnotationContextMenuRef.current?.(latestAnnotation, mouseEvent.clientX, mouseEvent.clientY);
        };
        region.element?.addEventListener("contextmenu", handleContextMenu);
        cleanupFns.push(() => region?.element?.removeEventListener("contextmenu", handleContextMenu));
        cleanupFns.push(region.on("over", (event) => {
          const latestAnnotation = mediaAnnotationsByIdRef.current.get(annotation.id);
          const latestRange = latestAnnotation ? annotationRange(latestAnnotation) : null;
          if (!latestAnnotation || !latestRange) return;
          setTooltip({
            x: event.clientX,
            y: event.clientY,
            label: latestAnnotation.codeLabels.join(", ") || "Annotation",
            timeLabel: `${formatMediaTime(latestRange.startMs)} - ${formatMediaTime(latestRange.endMs)}`,
            quote: latestAnnotation.quote,
            color: latestAnnotation.codeColors[0] || DEFAULT_REGION_COLOR,
          });
        }));
        cleanupFns.push(region.on("leave", () => setTooltip(null)));
        annotationRegionCleanupRef.current.set(annotation.id, cleanupFns);
        annotationRegionsRef.current.set(annotation.id, region);
      }

      applyAnnotationRegionStyles(
        region,
        annotation,
        canEditAnnotations,
        annotation.id === selectedAnnotationId,
      );
      region.element?.style.setProperty(
        "opacity",
        selectedAnnotationId && annotation.id !== selectedAnnotationId ? String(DIMMED_SEGMENT_OPACITY) : "1",
      );
    }

    isSyncingRegionsRef.current = false;

    if (waveReady && !initialRegionsLoggedRef.current) {
      initialRegionsLoggedRef.current = true;
      logOpenTiming("regions-initial-sync", { annotations: mediaAnnotations.length });
    }
  }, [canEditAnnotations, mediaAnnotations, selectedAnnotationId, waveReady]);

  useEffect(() => {
    const regions = regionsPluginRef.current;
    if (!regions || !waveReady) return;

    isSyncingRegionsRef.current = true;

    if (!pendingSelection) {
      pendingRegionRef.current?.remove();
      pendingRegionRef.current = null;
      isSyncingRegionsRef.current = false;
      return;
    }

    const range = clampMediaRange(pendingSelection.startMs, pendingSelection.endMs);
    const pendingRegionColor = pendingSelectionCodeColors.length > 0
      ? buildMediaClipRegionBackground(pendingSelectionCodeColors, true)
      : "rgba(53, 80, 112, 0.18)";
    const pendingRegionBorderColor = pendingSelectionCodeColors[0] || "#355070";
    const pendingRegion = pendingRegionRef.current?.id === "__pending__"
      ? pendingRegionRef.current
      : regions.addRegion({
        id: "__pending__",
        start: range.startMs / 1000,
        end: range.endMs / 1000,
        drag: false,
        resize: canEditAnnotations,
        color: pendingRegionColor,
      });

    pendingRegion.setOptions({
      start: range.startMs / 1000,
      end: range.endMs / 1000,
      drag: false,
      resize: canEditAnnotations,
      color: pendingRegionColor,
      content: "",
    });
    pendingRegion.element?.style.setProperty("border-top", `2px dashed ${pendingRegionBorderColor}`);
    pendingRegion.element?.style.setProperty("border-bottom", `2px dashed ${pendingRegionBorderColor}`);
    applyRegionBackground(pendingRegion, pendingRegionColor);
    applyRegionBoundaryMarkers(pendingRegion, pendingRegionBorderColor);
    pendingRegionRef.current = pendingRegion;

    isSyncingRegionsRef.current = false;
  }, [canEditAnnotations, pendingSelection, pendingSelectionCodeColors, waveReady]);

  const shouldShowTimelineScrollbar = !isFitZoomRef.current && timelineViewport.scrollWidth > timelineViewport.clientWidth + 4;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        className="doc-content-scroll-shell media-player-waveform-shell"
        style={{
          justifySelf: "center",
          width: "calc(100% - 20px)",
          boxSizing: "border-box",
          padding: "16px 16px 0 24px",
          border: 0,
          borderBottom: 0,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          background: "transparent",
          overflowX: shouldShowTimelineScrollbar ? "auto" : "hidden",
          overflowY: "hidden",
          scrollbarGutter: "stable",
          ...waveformShellStyle,
        }}
      >
        {segmentStripHeight > 0 && timelineViewport.scrollWidth > 0 ? (
          <div
            style={{
              position: "relative",
              marginBottom: 6,
              height: segmentStripHeight,
              overflow: "hidden",
              borderTop: 0,
              paddingTop: SEGMENT_STRIP_PADDING_TOP_PX,
            }}
          >
            <div
              style={{
                position: "relative",
                width: timelineViewport.scrollWidth,
                height: segmentStripHeight - SEGMENT_STRIP_PADDING_TOP_PX,
                transform: `translateX(-${timelineViewport.scrollLeft}px)`,
              }}
            >
              {annotationStripBars.bars.map(({ annotation, background, color, lane, startMs, endMs }) => {
                const durationMs = Math.max(1, timelineDurationMs);
                const fullWidth = timelineViewport.scrollWidth;
                const left = (startMs / durationMs) * fullWidth;
                const width = Math.max(
                  SEGMENT_STRIP_MIN_BAR_WIDTH_PX,
                  ((Math.max(endMs, startMs + 1) - startMs) / durationMs) * fullWidth,
                );
                const isSelected = annotation.id === selectedAnnotationId;
                const barBackground = isSelected
                  ? buildMultiAnnotationBackground(annotation.codeColors, true)
                  : background;
                return (
                  <button
                    key={annotation.id}
                    type="button"
                    title={`${annotation.codeLabels.join(", ") || "Annotation"} (${formatMediaTime(startMs)} - ${formatMediaTime(endMs)})`}
                    onClick={() => onSelectAnnotationRef.current(annotation.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onSelectAnnotationRef.current(annotation.id);
                      onAnnotationContextMenuRef.current?.(annotation, event.clientX, event.clientY);
                    }}
                    onMouseEnter={(event) => {
                      setTooltip({
                        x: event.clientX,
                        y: event.clientY,
                        label: annotation.codeLabels.join(", ") || "Annotation",
                        timeLabel: `${formatMediaTime(startMs)} - ${formatMediaTime(endMs)}`,
                        quote: annotation.quote,
                        color,
                      });
                    }}
                    onMouseMove={(event) => {
                      setTooltip((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      position: "absolute",
                      top: lane * (SEGMENT_STRIP_ROW_HEIGHT_PX + SEGMENT_STRIP_ROW_GAP_PX),
                      left,
                      width,
                      height: SEGMENT_STRIP_ROW_HEIGHT_PX,
                      border: isSelected ? "1px solid rgba(31, 41, 51, 0.95)" : "1px solid rgba(31, 41, 51, 0.18)",
                      borderRadius: 999,
                      background: barBackground,
                      boxShadow: isSelected ? "0 0 0 1px rgba(255, 255, 255, 0.9)" : "none",
                      cursor: "pointer",
                      padding: 0,
                      opacity: selectedAnnotationId && !isSelected ? DIMMED_SEGMENT_OPACITY : 1,
                      zIndex: isSelected ? 3 : 1,
                    }}
                  />
                );
              }).sort((leftBar, rightBar) => {
                const leftSelected = leftBar.key === selectedAnnotationId;
                const rightSelected = rightBar.key === selectedAnnotationId;
                if (leftSelected === rightSelected) return 0;
                return leftSelected ? 1 : -1;
              })}
            </div>
          </div>
        ) : null}
        <div ref={waveformContainerRef} />
      </div>
      {timelineError ? (
        <p className="auth-error" style={{ margin: 0 }}>{timelineError}</p>
      ) : null}
      {tooltip ? (
        <div
          className="annotation-hover-tooltip"
          style={getFloatingTooltipStyle(tooltip.x, tooltip.y, 320, 180)}
        >
          <div className="annotation-hover-tooltip-section">
            <div className="annotation-hover-tooltip-code">
              <span className="annotation-hover-tooltip-swatch" style={{ background: tooltip.color }} />
              {tooltip.label}
            </div>
            <div className="users-guide-copy" style={{ margin: "6px 0 0" }}>{tooltip.timeLabel}</div>
            <div className="annotation-hover-tooltip-quote">"{tooltipExcerpt(tooltip.quote)}"</div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

PostgresSourceMediaTimeline.displayName = "PostgresSourceMediaTimeline";
