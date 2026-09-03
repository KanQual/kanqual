import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ArrowLeftIcon, HelpIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { useI18n } from "../i18n/provider";
import type { PostgresCode } from "../lib/postgres";
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
import { NewCodeModal, type CodeRow } from "../components/NewCodeModal";

const SOURCE_IMPORT_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

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

type DraftRect = {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type ResizeHandle = "nw" | "ne" | "sw" | "se";

type InteractionState = {
  pointerId: number;
  annotationId: string;
  mode: "move" | "resize";
  handle?: ResizeHandle;
  startPointerX: number;
  startPointerY: number;
  startRegion: NonNullable<SourceAnnotationRow["imageRegion"]>;
};

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundRegionValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildSelectionFromDraft(
  draft: DraftRect,
  imageElement: HTMLImageElement,
  pageNumber?: number | null,
): PendingSelection | null {
  const renderedWidth = imageElement.clientWidth;
  const renderedHeight = imageElement.clientHeight;
  const naturalWidth = imageElement.naturalWidth;
  const naturalHeight = imageElement.naturalHeight;
  if (!renderedWidth || !renderedHeight || !naturalWidth || !naturalHeight) return null;

  const left = Math.min(draft.startX, draft.currentX);
  const top = Math.min(draft.startY, draft.currentY);
  const width = Math.abs(draft.currentX - draft.startX);
  const height = Math.abs(draft.currentY - draft.startY);
  if (width < 6 || height < 6) return null;

  const scaleX = naturalWidth / renderedWidth;
  const scaleY = naturalHeight / renderedHeight;
  const regionWidth = roundRegionValue(width * scaleX);
  const regionHeight = roundRegionValue(height * scaleY);
  return {
    startOffset: 0,
    endOffset: 0,
    quote: "Image region",
    anchorKind: "image_rect",
    displayLabel: `Region ${Math.round(regionWidth)} x ${Math.round(regionHeight)} px`,
    imageRegion: {
      x: roundRegionValue(left * scaleX),
      y: roundRegionValue(top * scaleY),
      width: regionWidth,
      height: regionHeight,
      imageWidth: naturalWidth,
      imageHeight: naturalHeight,
      pageNumber: pageNumber ?? null,
    },
  };
}

function overlayStyleForRegion(
  region: NonNullable<SourceAnnotationRow["imageRegion"]>,
  renderedWidth: number,
  renderedHeight: number,
) {
  const widthRatio = renderedWidth / Math.max(region.imageWidth, 1);
  const heightRatio = renderedHeight / Math.max(region.imageHeight, 1);
  return {
    left: `${region.x * widthRatio}px`,
    top: `${region.y * heightRatio}px`,
    width: `${region.width * widthRatio}px`,
    height: `${region.height * heightRatio}px`,
  };
}

function displayRegionFromImageRegion(
  region: NonNullable<SourceAnnotationRow["imageRegion"]>,
  renderedWidth: number,
  renderedHeight: number,
) {
  const widthRatio = renderedWidth / Math.max(region.imageWidth, 1);
  const heightRatio = renderedHeight / Math.max(region.imageHeight, 1);
  return {
    left: region.x * widthRatio,
    top: region.y * heightRatio,
    width: region.width * widthRatio,
    height: region.height * heightRatio,
  };
}

function imageRegionFromDisplayRect(
  displayRect: { left: number; top: number; width: number; height: number },
  baseRegion: NonNullable<SourceAnnotationRow["imageRegion"]>,
  renderedWidth: number,
  renderedHeight: number,
): NonNullable<SourceAnnotationRow["imageRegion"]> {
  const scaleX = baseRegion.imageWidth / Math.max(renderedWidth, 1);
  const scaleY = baseRegion.imageHeight / Math.max(renderedHeight, 1);
  return {
    x: roundRegionValue(displayRect.left * scaleX),
    y: roundRegionValue(displayRect.top * scaleY),
    width: roundRegionValue(displayRect.width * scaleX),
    height: roundRegionValue(displayRect.height * scaleY),
    imageWidth: baseRegion.imageWidth,
    imageHeight: baseRegion.imageHeight,
  };
}

function updateDisplayRectFromInteraction(
  startRect: { left: number; top: number; width: number; height: number },
  interaction: InteractionState,
  pointerX: number,
  pointerY: number,
  overlayWidth: number,
  overlayHeight: number,
) {
  const deltaX = pointerX - interaction.startPointerX;
  const deltaY = pointerY - interaction.startPointerY;
  const minSize = 12;

  if (interaction.mode === "move") {
    const maxLeft = Math.max(0, overlayWidth - startRect.width);
    const maxTop = Math.max(0, overlayHeight - startRect.height);
    return {
      left: clamp(startRect.left + deltaX, 0, maxLeft),
      top: clamp(startRect.top + deltaY, 0, maxTop),
      width: startRect.width,
      height: startRect.height,
    };
  }

  let left = startRect.left;
  let top = startRect.top;
  let right = startRect.left + startRect.width;
  let bottom = startRect.top + startRect.height;

  switch (interaction.handle) {
    case "nw":
      left = clamp(startRect.left + deltaX, 0, right - minSize);
      top = clamp(startRect.top + deltaY, 0, bottom - minSize);
      break;
    case "ne":
      right = clamp(startRect.left + startRect.width + deltaX, left + minSize, overlayWidth);
      top = clamp(startRect.top + deltaY, 0, bottom - minSize);
      break;
    case "sw":
      left = clamp(startRect.left + deltaX, 0, right - minSize);
      bottom = clamp(startRect.top + startRect.height + deltaY, top + minSize, overlayHeight);
      break;
    case "se":
      right = clamp(startRect.left + startRect.width + deltaX, left + minSize, overlayWidth);
      bottom = clamp(startRect.top + startRect.height + deltaY, top + minSize, overlayHeight);
      break;
    default:
      break;
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function PostgresSourceImageCodingView({
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
  saving,
  error,
  onCreateAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onKickSourceLock,
  onOpenMemoDraft,
  onCreateCode,
  onUpdateCode,
  onDeleteCode,
  onBack,
}: PostgresSourceCodingViewProps & { projectStoragePath: string }) {
  const { t } = useI18n();
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [scrollToAnnotationId, setScrollToAnnotationId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [editingAnnotation, setEditingAnnotation] = useState<SourceAnnotationRow | null>(null);
  const [draftRect, setDraftRect] = useState<DraftRect | null>(null);
  const [interactionState, setInteractionState] = useState<InteractionState | null>(null);
  const [previewRegions, setPreviewRegions] = useState<Record<string, NonNullable<SourceAnnotationRow["imageRegion"]>>>({});
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [pdfPagePreviewUrls, setPdfPagePreviewUrls] = useState<Record<number, string>>({});
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [selectedPdfPage, setSelectedPdfPage] = useState(1);
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [naturalImageSize, setNaturalImageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [baseImageSize, setBaseImageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [imageDisplaySize, setImageDisplaySize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [collapsedCodeIds, setCollapsedCodeIds] = useState<Set<string>>(new Set());
  const [codeContextMenu, setCodeContextMenu] = useState<{ x: number; y: number; code: PostgresCode } | null>(null);
  const [newCodeOpen, setNewCodeOpen] = useState(false);
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null);
  const [childCodeParentId, setChildCodeParentId] = useState<string | null>(null);
  const [deletingCodeId, setDeletingCodeId] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState(false);
  const [deleteCodeError, setDeleteCodeError] = useState("");
  const [annotationContextMenu, setAnnotationContextMenu] = useState<AnnotationContextMenuState | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const codeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const annotationContextMenuRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const codeContextMenuStyle = useViewportContextMenuStyle(codeContextMenu, codeContextMenuRef);
  const annotationContextMenuStyle = useViewportContextMenuStyle(annotationContextMenu, annotationContextMenuRef);

  const codesById = useMemo(() => new Map(codes.map((code) => [code.id, code])), [codes]);
  const codeTree = useMemo(() => orderedCodesWithDepth(codes), [codes]);
  const visibleCodes = useMemo(() => visibleCodeNodes(codeTree, collapsedCodeIds), [collapsedCodeIds, codeTree]);
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
  const canEditAnnotations = canManageAnnotations && !!sourceLock && sourceLock.userId === currentUserId && !sourceLockConflict;
  const canDeleteAnnotations = canEditAnnotations;
  const fileExt = row.filePath ? fileExtensionFromPath(row.filePath) : "";
  const normalizedSourceType = row.type.trim().toLowerCase();
  const isPdfSource = normalizedSourceType === "pdf" || fileExt === "pdf";
  const isImageSource = SOURCE_IMPORT_IMAGE_EXTS.has(fileExt) || normalizedSourceType === "image" || isPdfSource;
  const codingSourceLabel = isPdfSource ? "PDF" : "Image";
  const codingSourceName = isPdfSource ? "PDF" : "image";
  const resolvedFilePath = resolveProjectStoragePath(projectStoragePath, row.filePath);
  const regionAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.anchorKind === "image_rect" && annotation.imageRegion),
    [annotations],
  );
  const annotationCountByCodeId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of regionAnnotations) {
      for (const codeId of annotation.codeIds) {
        counts.set(codeId, (counts.get(codeId) ?? 0) + 1);
      }
    }
    return counts;
  }, [regionAnnotations]);
  const currentPageRegionAnnotations = useMemo(
    () => regionAnnotations.filter((annotation) => !isPdfSource || (annotation.imageRegion?.pageNumber ?? 1) === selectedPdfPage),
    [isPdfSource, regionAnnotations, selectedPdfPage],
  );
  const initialSelectedAnnotation = useMemo(
    () => initialSelectedAnnotationId
      ? regionAnnotations.find((annotation) => annotation.id === initialSelectedAnnotationId) ?? null
      : null,
    [initialSelectedAnnotationId, regionAnnotations],
  );
  const initialSelectedPdfPage = isPdfSource
    ? initialSelectedAnnotation?.imageRegion?.pageNumber ?? 1
    : 1;

  useEffect(() => {
    if (!initialSelectedAnnotation) return;
    if (isPdfSource) {
      setSelectedPdfPage(initialSelectedAnnotation.imageRegion?.pageNumber ?? 1);
    }
    setSelectedAnnotationId(initialSelectedAnnotation.id);
    setScrollToAnnotationId(initialSelectedAnnotation.id);
  }, [initialSelectedAnnotation, isPdfSource]);

  useEffect(() => {
    if (selectedAnnotationId && !regionAnnotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
  }, [regionAnnotations, selectedAnnotationId]);

  useEffect(() => {
    if (!scrollToAnnotationId || !viewportRef.current || !imageDisplaySize.width || !imageDisplaySize.height || imagePreviewLoading) return;
    const selectedAnnotation = regionAnnotations.find((annotation) => annotation.id === scrollToAnnotationId);
    if (!selectedAnnotation) return;
    if (isPdfSource && (selectedAnnotation.imageRegion?.pageNumber ?? 1) !== selectedPdfPage) return;
    const frame = window.requestAnimationFrame(() => {
      const target = viewportRef.current?.querySelector<HTMLElement>(`button[data-annotation-id="${scrollToAnnotationId}"]`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      setScrollToAnnotationId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    currentPageRegionAnnotations,
    imageDisplaySize.height,
    imageDisplaySize.width,
    imagePreviewLoading,
    imagePreviewUrl,
    isPdfSource,
    regionAnnotations,
    scrollToAnnotationId,
    selectedPdfPage,
  ]);

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
        setDraftRect(null);
        setInteractionState(null);
        setPreviewRegions({});
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
    setPreviewRegions({});
    setInteractionState(null);
  }, [annotations]);

  useEffect(() => {
    setZoom(1);
    setBaseImageSize({ width: 0, height: 0 });
    setNaturalImageSize({ width: 0, height: 0 });
    setSelectedPdfPage(initialSelectedPdfPage);
    setPdfPageCount(0);
    setPdfPagePreviewUrls((current) => {
      Object.values(current).forEach((url) => URL.revokeObjectURL(url));
      return {};
    });
  }, [initialSelectedPdfPage, row.id]);

  useEffect(() => {
    if (!isImageSource || !resolvedFilePath) {
      setImagePreviewLoading(false);
      setImagePreviewError(null);
      setImagePreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setImagePreviewLoading(true);
    setImagePreviewError(null);

    if (isPdfSource) {
      void readTauriFile(resolvedFilePath)
        .then(async (bytes) => {
          if (cancelled) return;
          const pdfjsLib = await loadPdfJs();
          const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
          if (cancelled) return;
          const safePage = clamp(selectedPdfPage, 1, pdf.numPages);
          const page = await pdf.getPage(safePage);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1.6 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) throw new Error(t("sourceCoding.image.pdfPreviewPrepareFailed"));
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          if (cancelled) return;
          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((nextBlob) => {
              if (nextBlob) resolve(nextBlob);
              else reject(new Error(t("sourceCoding.image.pdfPreviewRenderFailed")));
            }, "image/png");
          });
          objectUrl = URL.createObjectURL(blob);
          setPdfPageCount(pdf.numPages);
          setSelectedPdfPage(safePage);
          setPdfPagePreviewUrls((current) => {
            const existing = current[safePage];
            if (existing) URL.revokeObjectURL(existing);
            return { ...current, [safePage]: objectUrl as string };
          });
          setImagePreviewUrl((current) => {
            if (current && !isPdfSource) URL.revokeObjectURL(current);
            return objectUrl;
          });
        })
        .catch((loadError) => {
          if (cancelled) return;
          setImagePreviewError(loadError instanceof Error ? loadError.message : "Failed to load PDF preview.");
          setImagePreviewUrl(null);
        })
        .finally(() => {
          if (!cancelled) setImagePreviewLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }

    void readTauriFile(resolvedFilePath)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes]));
        setImagePreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch((loadError) => {
        if (cancelled) return;
        setImagePreviewError(loadError instanceof Error ? loadError.message : "Failed to load image preview.");
        setImagePreviewUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
      })
      .finally(() => {
        if (!cancelled) setImagePreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isImageSource, isPdfSource, resolvedFilePath, selectedPdfPage, t]);

  useEffect(() => {
    const imageElement = imageRef.current;
    if (!imageElement) return;
    const measure = () => {
      setImageDisplaySize({
        width: imageElement.clientWidth,
        height: imageElement.clientHeight,
      });
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(imageElement);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;
    const measure = () => {
      const rect = viewportElement.getBoundingClientRect();
      setViewportSize({
        width: rect.width,
        height: rect.height,
      });
    };
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(viewportElement);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (baseImageSize.width > 0 && baseImageSize.height > 0) return;
    if (!naturalImageSize.width || !naturalImageSize.height || !viewportSize.width || !viewportSize.height) return;
    const horizontalScale = Math.max((viewportSize.width - 48) / naturalImageSize.width, 0.05);
    const verticalScale = Math.max((viewportSize.height - 48) / naturalImageSize.height, 0.05);
    const fitScale = Math.min(horizontalScale, verticalScale, 1);
    setBaseImageSize({
      width: Math.max(1, naturalImageSize.width * fitScale),
      height: Math.max(1, naturalImageSize.height * fitScale),
    });
  }, [baseImageSize.height, baseImageSize.width, naturalImageSize.height, naturalImageSize.width, viewportSize.height, viewportSize.width]);

  const baseRenderedImageSize = useMemo(() => ({
    width: Math.max(1, baseImageSize.width || naturalImageSize.width || 1),
    height: Math.max(1, baseImageSize.height || naturalImageSize.height || 1),
  }), [baseImageSize.height, baseImageSize.width, naturalImageSize.height, naturalImageSize.width]);

  const zoomedImageSize = useMemo(() => ({
    width: Math.max(1, baseRenderedImageSize.width * zoom),
    height: Math.max(1, baseRenderedImageSize.height * zoom),
  }), [baseRenderedImageSize.height, baseRenderedImageSize.width, zoom]);

  function toOverlayPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
  }

  function handleOverlayPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canEditAnnotations || pendingSelection || saving || interactionState) return;
    if (event.button !== 0) return;
    const point = toOverlayPoint(event);
    if (!point) return;
    event.preventDefault();
    setSelectedAnnotationId(null);
    setDraftRect({
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleOverlayPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draftRect || draftRect.pointerId !== event.pointerId) return;
    const point = toOverlayPoint(event);
    if (!point) return;
    setDraftRect((current) => current && current.pointerId === event.pointerId ? {
      ...current,
      currentX: point.x,
      currentY: point.y,
    } : current);
  }

  function finishDraft(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draftRect || draftRect.pointerId !== event.pointerId) return;
    const point = toOverlayPoint(event);
    const finalDraft = point ? {
      ...draftRect,
      currentX: point.x,
      currentY: point.y,
    } : draftRect;
    setDraftRect(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const imageElement = imageRef.current;
    if (!imageElement) return;
    const selection = buildSelectionFromDraft(finalDraft, imageElement, isPdfSource ? selectedPdfPage : null);
    if (selection) setPendingSelection(selection);
  }

  async function handleQuickCode(codeId: string) {
    if (!pendingSelection || !canEditAnnotations || saving) return;
    await onCreateAnnotation(row.id, pendingSelection, { codeIds: [codeId], note: "" });
    setPendingSelection(null);
  }

  async function handleConfirmDeleteCode() {
    if (!deletingCodeId || !onDeleteCode) return;
    setDeletingCode(true);
    setDeleteCodeError("");
    try {
      await onDeleteCode(deletingCodeId);
      setDeletingCodeId(null);
    } catch (deleteError) {
      setDeleteCodeError(deleteError instanceof Error ? deleteError.message : "Failed to delete code.");
    } finally {
      setDeletingCode(false);
    }
  }

  function toggleCollapsedCode(codeId: string) {
    setCollapsedCodeIds((current) => {
      const next = new Set(current);
      if (next.has(codeId)) next.delete(codeId);
      else next.add(codeId);
      return next;
    });
  }

  const draftStyle = useMemo(() => {
    if (!draftRect) return null;
    return {
      left: `${Math.min(draftRect.startX, draftRect.currentX)}px`,
      top: `${Math.min(draftRect.startY, draftRect.currentY)}px`,
      width: `${Math.abs(draftRect.currentX - draftRect.startX)}px`,
      height: `${Math.abs(draftRect.currentY - draftRect.startY)}px`,
    };
  }, [draftRect]);

  async function commitRegionUpdate(annotation: SourceAnnotationRow, nextRegion: NonNullable<SourceAnnotationRow["imageRegion"]>) {
    setPreviewRegions((current) => ({ ...current, [annotation.id]: nextRegion }));
    try {
      await onUpdateAnnotation(annotation, {
        codeIds: annotation.codeIds,
        note: annotation.note,
        startOffset: null,
        endOffset: null,
        quote: annotation.quote,
        anchorKind: "image_rect",
        imageRegion: nextRegion,
      });
    } finally {
      setPreviewRegions((current) => {
        const next = { ...current };
        delete next[annotation.id];
        return next;
      });
    }
  }

  function selectRegionAnnotation(annotation: SourceAnnotationRow) {
    if (isPdfSource && annotation.imageRegion?.pageNumber) {
      setSelectedPdfPage(annotation.imageRegion.pageNumber);
    }
    setSelectedAnnotationId(annotation.id);
    setScrollToAnnotationId(annotation.id);
  }

  function renderRegionExcerpt(annotation: SourceAnnotationRow) {
    const region = annotation.imageRegion;
    if (!region) return null;
    const pageNumber = region.pageNumber ?? 1;
    const previewUrl = isPdfSource ? pdfPagePreviewUrls[pageNumber] : imagePreviewUrl;
    const label = isPdfSource
      ? `Page ${pageNumber} section`
      : "Saved image section";

    if (!previewUrl) {
      return (
        <div className="annotation-excerpt annotation-excerpt--region">
          <div className="annotation-excerpt-label">{label}</div>
        </div>
      );
    }

    return (
      <div className="annotation-excerpt annotation-excerpt--region" onClick={(event) => event.stopPropagation()}>
        <div className="annotation-excerpt-label">{label}</div>
        <div
          className="annotation-excerpt-region-frame"
          style={{
            aspectRatio: `${Math.max(region.width, 1)} / ${Math.max(region.height, 1)}`,
          }}
        >
          <img
            src={previewUrl}
            alt=""
            style={{
              width: `${(region.imageWidth / Math.max(region.width, 1)) * 100}%`,
              height: `${(region.imageHeight / Math.max(region.height, 1)) * 100}%`,
              transform: `translate(${-region.x / Math.max(region.imageWidth, 1) * 100}%, ${-region.y / Math.max(region.imageHeight, 1) * 100}%)`,
            }}
          />
        </div>
      </div>
    );
  }

  function startRegionInteraction(
    event: ReactPointerEvent<HTMLButtonElement>,
    annotation: SourceAnnotationRow,
    mode: "move" | "resize",
    handle?: ResizeHandle,
  ) {
    if (!canEditAnnotations || !annotation.imageRegion || !overlayRef.current || saving || pendingSelection) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedAnnotationId(annotation.id);
    const overlayRect = overlayRef.current.getBoundingClientRect();
    setInteractionState({
      pointerId: event.pointerId,
      annotationId: annotation.id,
      mode,
      handle,
      startPointerX: clamp(event.clientX - overlayRect.left, 0, overlayRect.width),
      startPointerY: clamp(event.clientY - overlayRect.top, 0, overlayRect.height),
      startRegion: previewRegions[annotation.id] ?? annotation.imageRegion,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleRegionPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!interactionState || interactionState.annotationId !== event.currentTarget.dataset.annotationId) return;
    if (!overlayRef.current || interactionState.pointerId !== event.pointerId) return;
    const overlayRect = overlayRef.current.getBoundingClientRect();
    const renderedWidth = overlayRect.width;
    const renderedHeight = overlayRect.height;
    const pointerX = clamp(event.clientX - overlayRect.left, 0, renderedWidth);
    const pointerY = clamp(event.clientY - overlayRect.top, 0, renderedHeight);
    const startRect = displayRegionFromImageRegion(
      interactionState.startRegion,
      renderedWidth,
      renderedHeight,
    );
    const nextRect = updateDisplayRectFromInteraction(
      startRect,
      interactionState,
      pointerX,
      pointerY,
      renderedWidth,
      renderedHeight,
    );
    const nextRegion = imageRegionFromDisplayRect(
      nextRect,
      interactionState.startRegion,
      renderedWidth,
      renderedHeight,
    );
    setPreviewRegions((current) => ({ ...current, [interactionState.annotationId]: nextRegion }));
  }

  async function finishRegionInteraction(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!interactionState || interactionState.annotationId !== event.currentTarget.dataset.annotationId) return;
    if (interactionState.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const annotation = regionAnnotations.find((entry) => entry.id === interactionState.annotationId);
    const nextRegion = previewRegions[interactionState.annotationId];
    setInteractionState(null);
    if (!annotation || !nextRegion) {
      setPreviewRegions((current) => {
        const next = { ...current };
        delete next[interactionState.annotationId];
        return next;
      });
      return;
    }
    await commitRegionUpdate(annotation, nextRegion);
  }

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
          <h1>{t("sourceCoding.image.title", { label: codingSourceLabel })}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title={t("sourceCoding.image.openHelp", { name: codingSourceName })}
            aria-label={t("sourceCoding.image.openHelp", { name: codingSourceName })}
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
                {t("sourceCoding.image.selectCodeHint")}
              </div>
            ) : null}
            <ul className="code-list">
              {codes.length === 0 ? (
                <li className="code-list-empty">{t("sourceCoding.common.noCodesYet")}</li>
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
            annotations={regionAnnotations}
            selectedAnnotationId={selectedAnnotationId}
            codesById={codesById}
            renderAnnotationExcerpt={renderRegionExcerpt}
            onSelectAnnotation={(annotationId) => {
              const annotation = regionAnnotations.find((entry) => entry.id === annotationId);
              if (annotation) selectRegionAnnotation(annotation);
              else setSelectedAnnotationId(annotationId);
            }}
            onDeleteAnnotation={(annotationId) => {
              void onDeleteAnnotation(annotationId);
            }}
            onOpenMemoDraft={onOpenMemoDraft}
            canManageMemos={canManageMemos}
            canDeleteAnnotations={canDeleteAnnotations}
          />
        </div>

        <div className="annotate-main">
          <div className="annotate-card annotate-card--grow">
            <div className="doc-viewer-toolbar">
              <span className="doc-name">{row.name}</span>
              {imagePreviewUrl ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {isPdfSource && pdfPageCount > 0 ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => setSelectedPdfPage((current) => Math.max(1, current - 1))}
                        disabled={selectedPdfPage <= 1 || imagePreviewLoading}
                      >
                        {t("sourceCoding.image.previousPage")}
                      </button>
                      <span className="users-guide-copy" style={{ margin: 0, whiteSpace: "nowrap" }}>
                        {t("sourceCoding.image.page")} {selectedPdfPage} / {pdfPageCount}
                      </span>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => setSelectedPdfPage((current) => Math.min(pdfPageCount, current + 1))}
                        disabled={selectedPdfPage >= pdfPageCount || imagePreviewLoading}
                      >
                        {t("sourceCoding.image.nextPage")}
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => setZoom((current) => Math.max(0.5, Math.round((current - 0.25) * 100) / 100))}
                    disabled={zoom <= 0.5}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => setZoom(1)}
                    disabled={Math.abs(zoom - 1) < 0.001}
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => setZoom((current) => Math.min(4, Math.round((current + 0.25) * 100) / 100))}
                    disabled={zoom >= 4}
                  >
                    +
                  </button>
                </div>
              ) : null}
            </div>

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
              ) : canEditAnnotations ? null : (
                <p className="users-guide-copy" style={{ margin: 0 }}>
                  {lockSyncing ? t("sourceCoding.common.claimingSourceLock") : t("sourceCoding.common.readOnlyWorkspace")}
                </p>
              )}
            </div>

            {imagePreviewLoading ? (
              <p className="users-guide-copy" style={{ margin: 0 }}>{t("sourceCoding.image.loadingPreview")}</p>
            ) : imagePreviewError ? (
              <div style={{ display: "grid", gap: 8 }}>
                <p className="auth-error" style={{ margin: 0 }}>{imagePreviewError}</p>
                <p className="users-guide-copy" style={{ margin: 0 }}>
                  {t("sourceCoding.image.previewOpenFailed")}
                </p>
              </div>
            ) : imagePreviewUrl ? (
              <div
                ref={viewportRef}
                className="doc-content-scroll-shell"
                style={{
                  flex: 1,
                  minHeight: 0,
                  width: "100%",
                  padding: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "auto",
                  backgroundColor: "#f4f5f7",
                  backgroundImage: `
                    linear-gradient(45deg, rgba(127, 140, 141, 0.14) 25%, transparent 25%),
                    linear-gradient(-45deg, rgba(127, 140, 141, 0.14) 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, rgba(127, 140, 141, 0.14) 75%),
                    linear-gradient(-45deg, transparent 75%, rgba(127, 140, 141, 0.14) 75%)
                  `,
                  backgroundSize: "24px 24px",
                  backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    display: "inline-block",
                    lineHeight: 0,
                    width: `${zoomedImageSize.width}px`,
                    height: `${zoomedImageSize.height}px`,
                    border: "1px solid rgba(127, 140, 141, 0.28)",
                    borderRadius: 0,
                    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.55), 0 4px 14px rgba(44, 62, 80, 0.10)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: `${baseRenderedImageSize.width}px`,
                      height: `${baseRenderedImageSize.height}px`,
                      transform: `scale(${zoom})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <img
                      ref={imageRef}
                      src={imagePreviewUrl}
                      alt={row.name}
                      onLoad={(event) => {
                        setNaturalImageSize({
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        });
                        setImageDisplaySize({
                          width: event.currentTarget.clientWidth,
                          height: event.currentTarget.clientHeight,
                        });
                      }}
                      style={{
                        display: "block",
                        width: `${baseRenderedImageSize.width}px`,
                        height: `${baseRenderedImageSize.height}px`,
                        objectFit: "fill",
                        borderRadius: 0,
                      }}
                    />
                    <div
                      ref={overlayRef}
                      style={{
                        position: "absolute",
                        inset: 0,
                        cursor: canEditAnnotations && !pendingSelection ? "crosshair" : "default",
                      }}
                      onPointerDown={handleOverlayPointerDown}
                      onPointerMove={handleOverlayPointerMove}
                      onPointerUp={finishDraft}
                      onPointerCancel={() => setDraftRect(null)}
                    >
                      {currentPageRegionAnnotations.map((annotation) => {
                        const activeRegion = previewRegions[annotation.id] ?? annotation.imageRegion;
                        if (!activeRegion || !imageDisplaySize.width || !imageDisplaySize.height) return null;
                        const isSelected = annotation.id === selectedAnnotationId;
                        const primaryColor = annotation.codeColors[0] || "#355070";
                        const overlayStyle = overlayStyleForRegion(activeRegion, imageDisplaySize.width, imageDisplaySize.height);
                        return (
                          <div
                            key={annotation.id}
                            style={{
                              position: "absolute",
                              ...overlayStyle,
                            }}
                          >
                            <button
                              data-annotation-id={annotation.id}
                              type="button"
                              title={annotation.codeLabels.join(", ") || "Image annotation"}
                              onClick={(event) => {
                                event.stopPropagation();
                                selectRegionAnnotation(annotation);
                              }}
                              onDoubleClick={(event) => {
                                event.stopPropagation();
                                if (canEditAnnotations) setEditingAnnotation(annotation);
                              }}
                              onContextMenu={(event) => {
                                if (!canManageMemos && !canDeleteAnnotations) return;
                                event.preventDefault();
                                event.stopPropagation();
                                selectRegionAnnotation(annotation);
                                setAnnotationContextMenu({ x: event.clientX, y: event.clientY, annotation });
                              }}
                              onPointerDown={(event) => startRegionInteraction(event, annotation, "move")}
                              onPointerMove={handleRegionPointerMove}
                              onPointerUp={(event) => {
                                void finishRegionInteraction(event);
                              }}
                              onPointerCancel={() => {
                                setInteractionState(null);
                                setPreviewRegions((current) => {
                                  const next = { ...current };
                                  delete next[annotation.id];
                                  return next;
                                });
                              }}
                              style={{
                                position: "absolute",
                                inset: 0,
                                padding: 0,
                                margin: 0,
                                border: `2px solid ${primaryColor}`,
                                background: isSelected ? `${primaryColor}22` : `${primaryColor}12`,
                                boxShadow: isSelected ? `0 0 0 2px ${primaryColor}55` : undefined,
                                borderRadius: 8,
                                cursor: canEditAnnotations ? "move" : "default",
                              }}
                            />
                            {isSelected && canEditAnnotations ? (
                              ([
                                ["nw", { left: -6, top: -6, cursor: "nwse-resize" }],
                                ["ne", { right: -6, top: -6, cursor: "nesw-resize" }],
                                ["sw", { left: -6, bottom: -6, cursor: "nesw-resize" }],
                                ["se", { right: -6, bottom: -6, cursor: "nwse-resize" }],
                              ] as const).map(([handle, handleStyle]) => (
                                <button
                                  key={handle}
                                  data-annotation-id={annotation.id}
                                  type="button"
                                  aria-label={`Resize ${handle}`}
                                  onPointerDown={(event) => startRegionInteraction(event, annotation, "resize", handle)}
                                  onPointerMove={handleRegionPointerMove}
                                  onPointerUp={(event) => {
                                    void finishRegionInteraction(event);
                                  }}
                                  onPointerCancel={() => {
                                    setInteractionState(null);
                                    setPreviewRegions((current) => {
                                      const next = { ...current };
                                      delete next[annotation.id];
                                      return next;
                                    });
                                  }}
                                  style={{
                                    position: "absolute",
                                    width: 12,
                                    height: 12,
                                    borderRadius: 999,
                                    border: `2px solid ${primaryColor}`,
                                    background: "#ffffff",
                                    padding: 0,
                                    ...handleStyle,
                                  }}
                                />
                              ))
                            ) : null}
                          </div>
                        );
                      })}
                      {draftStyle ? (
                        <div
                          style={{
                            position: "absolute",
                            border: "2px dashed #355070",
                            background: "rgba(53, 80, 112, 0.12)",
                            borderRadius: 8,
                            ...draftStyle,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="case-card-empty">{t("sourceCoding.image.noPreview")}</p>
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

      {newCodeOpen ? (
        <NewCodeModal
          allCodes={codebookRows}
          onSubmit={async (payload) => {
            if (!onCreateCode || !canCreateCodes) return;
            await onCreateCode({
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? null,
            });
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
            await onCreateCode({
              label: payload.label,
              color: payload.color,
              description: payload.description,
              parentCodeId: payload.parentId ?? childCodeParentRow.id,
            });
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

      {helpOpen ? (
        <SettingsModal title={t("sourceCoding.image.helpTitle", { label: codingSourceLabel })} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              {t("sourceCoding.image.helpLine1")}
            </p>
            <p className="users-guide-copy">
              {t("sourceCoding.image.helpLine2")}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </SettingsModal>
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
        canDeleteAnnotations={canDeleteAnnotations}
      />

      {pendingSelection && canEditAnnotations ? (
        <AnnotationEditorModal
          title={t("sourceCoding.common.newAnnotation")}
          codeOptions={codeOptions}
          selection={pendingSelection}
          saving={saving}
          error={error}
          onCancel={() => {
            if (saving) return;
            setPendingSelection(null);
          }}
          onSave={async (payload) => {
            await onCreateAnnotation(row.id, pendingSelection, payload);
            setPendingSelection(null);
          }}
        />
      ) : null}

      {editingAnnotation && canEditAnnotations ? (
        <AnnotationEditorModal
          title={t("sourceCoding.common.editAnnotation")}
          codeOptions={codeOptions}
          selection={{
            startOffset: editingAnnotation.startOffset ?? 0,
            endOffset: editingAnnotation.endOffset ?? 0,
            quote: editingAnnotation.quote,
            anchorKind: editingAnnotation.anchorKind,
            imageRegion: editingAnnotation.imageRegion,
            displayLabel: editingAnnotation.imageRegion
              ? t("sourceCoding.common.regionSize", {
                width: Math.round(editingAnnotation.imageRegion.width),
                height: Math.round(editingAnnotation.imageRegion.height),
              })
              : undefined,
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
            await onUpdateAnnotation(editingAnnotation, payload);
            setEditingAnnotation(null);
          }}
        />
      ) : null}
    </div>
  );
}
