import { useEffect, useRef, useState } from "react";
import { SettingsModal } from "./SettingsModal";
import { useI18n } from "../i18n/provider";
import { getPostgresImageMimeType } from "../lib/postgresStoredImages";

export type PostgresImageUploadDraft = {
  originalFileName: string;
  fileBytesBase64: string;
  previewUrl: string;
  fileSizeBytes: number;
};

export type PostgresImageCropAspect = "original" | "1:1" | "4:3" | "16:9";

export type PostgresImageCropDraft = {
  upload: PostgresImageUploadDraft;
  mode: "full" | "crop";
  aspect: PostgresImageCropAspect;
  sizePercent: number;
  xPercent: number;
  yPercent: number;
  error: string;
};

type PostgresImageCropResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type PostgresImageCropDragState = {
  mode: "move" | "resize";
  handle?: PostgresImageCropResizeHandle;
  startClientX: number;
  startClientY: number;
  startSizePercent: number;
  startXPercent: number;
  startYPercent: number;
  imageWidth: number;
  imageHeight: number;
  displayScale: number;
};

export type PostgresImageCropErrorMessages = {
  loadFailed: string;
  prepareFailed: string;
};

export const POSTGRES_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function sanitizeFileStem(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "saved-canvas";
  return trimmed.replace(/[<>:\"/\\|?*\u0000-\u001F]+/g, "-").replace(/\s+/g, " ").trim();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function getFileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || "image";
}

export function formatPostgresFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 ? 1 : 2)} MB`;
}

export function getPostgresCropAspectRatio(
  aspect: PostgresImageCropAspect,
  imageWidth: number,
  imageHeight: number,
): number {
  if (aspect === "1:1") return 1;
  if (aspect === "4:3") return 4 / 3;
  if (aspect === "16:9") return 16 / 9;
  return imageWidth / imageHeight;
}

export function getPostgresCropRect(
  imageWidth: number,
  imageHeight: number,
  aspect: PostgresImageCropAspect,
  sizePercent: number,
  xPercent: number,
  yPercent: number,
) {
  const ratio = getPostgresCropAspectRatio(aspect, imageWidth, imageHeight);
  const imageRatio = imageWidth / imageHeight;
  const maxCropWidth = imageRatio > ratio ? imageHeight * ratio : imageWidth;
  const maxCropHeight = imageRatio > ratio ? imageHeight : imageWidth / ratio;
  const scale = Math.min(1, Math.max(0.2, sizePercent / 100));
  const width = Math.max(1, maxCropWidth * scale);
  const height = Math.max(1, maxCropHeight * scale);
  const x = Math.max(0, (imageWidth - width) * Math.min(100, Math.max(0, xPercent)) / 100);
  const y = Math.max(0, (imageHeight - height) * Math.min(100, Math.max(0, yPercent)) / 100);
  return { x, y, width, height };
}

export function loadPostgresImageElement(src: string, messages: Pick<PostgresImageCropErrorMessages, "loadFailed">): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(messages.loadFailed));
    image.src = src;
  });
}

export function canvasToPostgresBlob(canvas: HTMLCanvasElement, mimeType: string, prepareFailedMessage: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error(prepareFailedMessage));
      }
    }, mimeType, quality);
  });
}

export function getPostgresCroppedImageFileName(originalFileName: string, mimeType: string): string {
  const stem = sanitizeFileStem(originalFileName.replace(/\.[^.]+$/, "")) || "image";
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  return `${stem}-cropped.${extension}`;
}

export async function cropPostgresImageUpload(
  upload: PostgresImageUploadDraft,
  aspect: PostgresImageCropAspect,
  sizePercent: number,
  xPercent: number,
  yPercent: number,
  messages: PostgresImageCropErrorMessages,
): Promise<PostgresImageUploadDraft> {
  const image = await loadPostgresImageElement(upload.previewUrl, messages);
  const crop = getPostgresCropRect(image.naturalWidth, image.naturalHeight, aspect, sizePercent, xPercent, yPercent);
  const maxOutputDimension = 1600;
  const outputScale = Math.min(1, maxOutputDimension / Math.max(crop.width, crop.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * outputScale));
  canvas.height = Math.max(1, Math.round(crop.height * outputScale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error(messages.prepareFailed);
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const sourceMimeType = getPostgresImageMimeType(upload.originalFileName);
  const outputMimeType = sourceMimeType === "image/jpeg" || sourceMimeType === "image/webp" ? sourceMimeType : "image/png";
  const blob = await canvasToPostgresBlob(canvas, outputMimeType, messages.prepareFailed, 0.9);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    originalFileName: getPostgresCroppedImageFileName(upload.originalFileName, outputMimeType),
    fileBytesBase64: bytesToBase64(bytes),
    previewUrl: URL.createObjectURL(blob),
    fileSizeBytes: bytes.length,
  };
}

export function PostgresImageCropModal(props: {
  draft: PostgresImageCropDraft;
  onDraftChange: (draft: PostgresImageCropDraft) => void;
  onCancel: () => void;
  onUseFullImage: () => void;
  onUseCrop: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const { draft, onDraftChange, onCancel, onUseFullImage, onUseCrop, busy } = props;
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [cropDragState, setCropDragState] = useState<PostgresImageCropDragState | null>(null);
  const cropFrameRef = useRef<HTMLDivElement | null>(null);
  const cropDisplay = imageDimensions
    ? (() => {
        const maxWidth = 420;
        const maxHeight = 360;
        const scale = Math.min(1, maxWidth / imageDimensions.width, maxHeight / imageDimensions.height);
        const width = Math.max(1, Math.round(imageDimensions.width * scale));
        const height = Math.max(1, Math.round(imageDimensions.height * scale));
        const crop = getPostgresCropRect(
          imageDimensions.width,
          imageDimensions.height,
          draft.aspect,
          draft.sizePercent,
          draft.xPercent,
          draft.yPercent,
        );
        return {
          width,
          height,
          scale,
          crop,
          cropStyle: {
            left: `${(crop.x / imageDimensions.width) * 100}%`,
            top: `${(crop.y / imageDimensions.height) * 100}%`,
            width: `${(crop.width / imageDimensions.width) * 100}%`,
            height: `${(crop.height / imageDimensions.height) * 100}%`,
          },
        };
      })()
    : null;

  useEffect(() => {
    let active = true;
    void loadPostgresImageElement(draft.upload.previewUrl, { loadFailed: t("sharedModals.imageCrop.loadFailed") })
      .then((image) => {
        if (active) setImageDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      })
      .catch(() => {
        if (active) setImageDimensions(null);
      });
    return () => {
      active = false;
    };
  }, [draft.upload.previewUrl, t]);

  const updateDraft = (patch: Partial<PostgresImageCropDraft>) => {
    onDraftChange({ ...draft, ...patch, error: patch.error ?? "" });
  };

  useEffect(() => {
    if (!cropDragState) return;
    const handlePointerMove = (event: PointerEvent) => {
      const crop = getPostgresCropRect(
        cropDragState.imageWidth,
        cropDragState.imageHeight,
        draft.aspect,
        cropDragState.startSizePercent,
        cropDragState.startXPercent,
        cropDragState.startYPercent,
      );
      const dx = (event.clientX - cropDragState.startClientX) / cropDragState.displayScale;
      const dy = (event.clientY - cropDragState.startClientY) / cropDragState.displayScale;
      if (cropDragState.mode === "move") {
        const nextX = Math.min(Math.max(0, crop.x + dx), Math.max(0, cropDragState.imageWidth - crop.width));
        const nextY = Math.min(Math.max(0, crop.y + dy), Math.max(0, cropDragState.imageHeight - crop.height));
        updateDraft({
          xPercent: cropDragState.imageWidth === crop.width ? 50 : (nextX / (cropDragState.imageWidth - crop.width)) * 100,
          yPercent: cropDragState.imageHeight === crop.height ? 50 : (nextY / (cropDragState.imageHeight - crop.height)) * 100,
        });
        return;
      }

      const ratio = getPostgresCropAspectRatio(draft.aspect, cropDragState.imageWidth, cropDragState.imageHeight);
      const imageRatio = cropDragState.imageWidth / cropDragState.imageHeight;
      const maxCropWidth = imageRatio > ratio ? cropDragState.imageHeight * ratio : cropDragState.imageWidth;
      const maxCropHeight = imageRatio > ratio ? cropDragState.imageHeight : cropDragState.imageWidth / ratio;
      const handle = cropDragState.handle ?? "se";
      const xDirection = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
      const yDirection = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
      const widthScale = xDirection === 0 ? crop.width / maxCropWidth : (crop.width + dx * xDirection) / maxCropWidth;
      const heightScale = yDirection === 0 ? crop.height / maxCropHeight : (crop.height + dy * yDirection) / maxCropHeight;
      const rawScale = xDirection !== 0 && yDirection !== 0
        ? Math.max(widthScale, heightScale)
        : xDirection !== 0
          ? widthScale
          : heightScale;
      const nextScale = Math.min(1, Math.max(0.2, rawScale));
      const nextWidth = maxCropWidth * nextScale;
      const nextHeight = maxCropHeight * nextScale;
      let nextX = crop.x;
      let nextY = crop.y;
      if (handle.includes("w")) {
        nextX = crop.x + crop.width - nextWidth;
      } else if (!handle.includes("e")) {
        nextX = crop.x + (crop.width - nextWidth) / 2;
      }
      if (handle.includes("n")) {
        nextY = crop.y + crop.height - nextHeight;
      } else if (!handle.includes("s")) {
        nextY = crop.y + (crop.height - nextHeight) / 2;
      }
      nextX = Math.min(Math.max(0, nextX), Math.max(0, cropDragState.imageWidth - nextWidth));
      nextY = Math.min(Math.max(0, nextY), Math.max(0, cropDragState.imageHeight - nextHeight));
      updateDraft({
        sizePercent: nextScale * 100,
        xPercent: cropDragState.imageWidth === nextWidth ? 50 : (nextX / (cropDragState.imageWidth - nextWidth)) * 100,
        yPercent: cropDragState.imageHeight === nextHeight ? 50 : (nextY / (cropDragState.imageHeight - nextHeight)) * 100,
      });
    };
    const handlePointerUp = () => setCropDragState(null);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [cropDragState, draft.aspect, draft, onDraftChange]);

  const startCropDrag = (
    event: React.PointerEvent,
    mode: PostgresImageCropDragState["mode"],
    handle?: PostgresImageCropResizeHandle,
  ) => {
    if (!imageDimensions || !cropDisplay || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const frameBounds = cropFrameRef.current?.getBoundingClientRect();
    const displayScale = frameBounds ? frameBounds.width / imageDimensions.width : cropDisplay.scale;
    setCropDragState({
      mode,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startSizePercent: draft.sizePercent,
      startXPercent: draft.xPercent,
      startYPercent: draft.yPercent,
      imageWidth: imageDimensions.width,
      imageHeight: imageDimensions.height,
      displayScale,
    });
  };

  return (
    <SettingsModal
      title={t("sharedModals.imageCrop.title")}
      onClose={onCancel}
      closeDisabled={busy}
      modalClassName="modal--wide"
      overlayStyle={{ zIndex: 300 }}
    >
      <div className="app-settings-modal-body">
        <p className="auth-hint" style={{ marginTop: 0 }}>
          {t("sharedModals.imageCrop.description")}
        </p>
        <div className="segmented-control modal-segmented-control modal-secondary-segmented-control modal-secondary-segmented-control--two" role="tablist" aria-label={t("sharedModals.imageCrop.regionMode")}>
          <button
            type="button"
            className={`segmented-control-option ${draft.mode === "full" ? "segmented-control-option--active" : ""}`}
            onClick={() => updateDraft({ mode: "full" })}
            disabled={busy}
          >
            {t("sharedModals.imageCrop.fullImage")}
          </button>
          <button
            type="button"
            className={`segmented-control-option ${draft.mode === "crop" ? "segmented-control-option--active" : ""}`}
            onClick={() => updateDraft({
              mode: "crop",
              sizePercent: draft.sizePercent === 100 ? 80 : draft.sizePercent,
              xPercent: 50,
              yPercent: 50,
            })}
            disabled={busy}
          >
            {t("sharedModals.imageCrop.selectRegion")}
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 0.8fr)",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div
            style={{
              border: "1px solid rgba(53, 80, 112, 0.14)",
              borderRadius: 10,
              background: "rgba(248, 250, 252, 0.92)",
              padding: 12,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: 220,
            }}
          >
            {draft.mode === "crop" && cropDisplay ? (
              <div
                ref={cropFrameRef}
                style={{
                  position: "relative",
                  width: `min(100%, ${cropDisplay.width}px)`,
                  aspectRatio: `${cropDisplay.width} / ${cropDisplay.height}`,
                  lineHeight: 0,
                  userSelect: "none",
                  touchAction: "none",
                  overflow: "hidden",
                  borderRadius: 8,
                }}
              >
                <img
                  src={draft.upload.previewUrl}
                  alt=""
                  draggable={false}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    borderRadius: 8,
                  }}
                />
                <div
                  role="img"
                  aria-label={t("sharedModals.imageCrop.selectedRegion")}
                  onPointerDown={(event) => {
                    if (event.currentTarget === event.target) startCropDrag(event, "move");
                  }}
                  style={{
                    position: "absolute",
                    left: cropDisplay.cropStyle.left,
                    top: cropDisplay.cropStyle.top,
                    width: cropDisplay.cropStyle.width,
                    height: cropDisplay.cropStyle.height,
                    border: "2px solid #ffffff",
                    borderRadius: 6,
                    outline: "2px solid rgba(53, 80, 112, 0.82)",
                    boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.34), 0 10px 28px rgba(15, 23, 42, 0.22)",
                    cursor: busy ? "default" : "move",
                    boxSizing: "border-box",
                    background: "rgba(255, 255, 255, 0.03)",
                    touchAction: "none",
                  }}
                >
                  {[
                    ["nw", { left: -7, top: -7, cursor: "nwse-resize" }],
                    ["n", { left: "50%", top: -7, transform: "translateX(-50%)", cursor: "ns-resize" }],
                    ["ne", { right: -7, top: -7, cursor: "nesw-resize" }],
                    ["w", { left: -7, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" }],
                    ["e", { right: -7, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" }],
                    ["sw", { left: -7, bottom: -7, cursor: "nesw-resize" }],
                    ["s", { left: "50%", bottom: -7, transform: "translateX(-50%)", cursor: "ns-resize" }],
                    ["se", { right: -7, bottom: -7, cursor: "nwse-resize" }],
                  ].map(([handle, style]) => (
                    <span
                      key={handle as string}
                      aria-hidden="true"
                      onPointerDown={(event) => startCropDrag(
                        event,
                        "resize",
                        handle as PostgresImageCropResizeHandle,
                      )}
                      style={{
                        position: "absolute",
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        background: "#fff",
                        border: "1px solid rgba(53, 80, 112, 0.5)",
                        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.22)",
                        cursor: busy ? "default" : (style as React.CSSProperties).cursor,
                        ...(style as React.CSSProperties),
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <img
                src={draft.upload.previewUrl}
                alt=""
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: 360,
                  width: "auto",
                  height: "auto",
                  borderRadius: 8,
                }}
              />
            )}
          </div>
          <div className="form" style={{ gap: 12 }}>
            <p className="auth-hint" style={{ margin: 0 }}>
              {draft.upload.originalFileName} - {formatPostgresFileSize(draft.upload.fileSizeBytes)}
            </p>
            {imageDimensions ? (
              <p className="auth-hint" style={{ margin: 0 }}>
                {imageDimensions.width} x {imageDimensions.height}px
              </p>
            ) : null}
            {draft.mode === "crop" ? (
              <>
                <label className="form-label">
                  {t("sharedModals.imageCrop.aspect")}
                  <select
                    className="form-input"
                    value={draft.aspect}
                    onChange={(event) => updateDraft({
                      aspect: event.target.value as PostgresImageCropAspect,
                      sizePercent: 100,
                      xPercent: 50,
                      yPercent: 50,
                    })}
                    disabled={busy}
                  >
                    <option value="original">{t("sharedModals.imageCrop.original")}</option>
                    <option value="1:1">{t("sharedModals.imageCrop.square")}</option>
                    <option value="4:3">4:3</option>
                    <option value="16:9">16:9</option>
                  </select>
                </label>
                <p className="auth-hint" style={{ margin: 0 }}>
                  {t("sharedModals.imageCrop.dragHelp")}
                </p>
              </>
            ) : (
              <p className="auth-hint" style={{ margin: 0 }}>
                {t("sharedModals.imageCrop.fullImageHelp")}
              </p>
            )}
            {draft.error ? <p className="modal-warning-text" style={{ margin: 0 }}>{draft.error}</p> : null}
          </div>
        </div>
      </div>
        <div className="app-settings-modal-footer">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </button>
          {draft.mode === "full" ? (
            <button type="button" className="btn btn--primary" onClick={onUseFullImage} disabled={busy}>
              {t("sharedModals.imageCrop.useFullImage")}
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={onUseCrop} disabled={busy}>
              {busy ? t("sharedModals.imageCrop.cropping") : t("sharedModals.imageCrop.useSelectedRegion")}
            </button>
          )}
        </div>
    </SettingsModal>
  );
}
