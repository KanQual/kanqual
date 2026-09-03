import { useEffect, useState } from "react";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useI18n } from "../i18n/provider";
import type { PostgresAnnotationSummary } from "../lib/postgres";

let postgresHomePdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPostgresHomePdfJs() {
  if (!postgresHomePdfJsPromise) {
    postgresHomePdfJsPromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
      return module;
    });
  }
  return postgresHomePdfJsPromise;
}

function resolvePostgresStoragePath(projectStoragePath: string, relativeStoragePath: string): string {
  const normalizedRelativePath = relativeStoragePath.trim().replace(/\\/g, "/");
  if (!projectStoragePath.trim() || !normalizedRelativePath) return "";
  if (/^[a-zA-Z]:[\\/]/.test(normalizedRelativePath) || normalizedRelativePath.startsWith("/")) {
    return normalizedRelativePath;
  }
  return `${projectStoragePath.replace(/[\\/]+$/, "")}/${normalizedRelativePath.replace(/^\/+/, "")}`;
}

function canvasToPostgresBlob(canvas: HTMLCanvasElement, mimeType: string, renderFailedMessage: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error(renderFailedMessage));
        return;
      }
      resolve(blob);
    }, mimeType, quality);
  });
}

export function truncatePostgresHomeAnnotationPreview(value: string, maxLength = 100): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

export function PostgresHomeAnnotationImagePreview({
  projectStoragePath,
  sourceStoragePath,
  sourceKind,
  imageRegion,
}: {
  projectStoragePath: string;
  sourceStoragePath: string;
  sourceKind: string;
  imageRegion: NonNullable<PostgresAnnotationSummary["imageRegion"]>;
}) {
  const { t } = useI18n();
  const [imageUrl, setImageUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const resolvedPath = resolvePostgresStoragePath(projectStoragePath, sourceStoragePath);
  const isPdf = sourceKind.trim().toLowerCase() === "pdf";

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setLoadError("");
    setImageUrl("");
    if (!resolvedPath) {
      setLoadError(t("projectCore.graph.imageSourceUnavailable"));
      return;
    }

    async function buildPreviewUrl(bytes: Uint8Array): Promise<string> {
      if (!isPdf) return URL.createObjectURL(new Blob([bytes]));

      const pdfjsLib = await loadPostgresHomePdfJs();
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const safePage = Math.min(Math.max(imageRegion.pageNumber ?? 1, 1), pdf.numPages);
      const page = await pdf.getPage(safePage);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("projectCore.graph.preparePdfPreviewFailed"));
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await canvasToPostgresBlob(canvas, "image/png", t("projectCore.graph.renderImagePreviewFailed"));
      return URL.createObjectURL(blob);
    }

    void readTauriFile(resolvedPath)
      .then(async (bytes) => {
        objectUrl = await buildPreviewUrl(bytes);
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setImageUrl(objectUrl);
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : t("projectCore.graph.loadAnnotationPreviewFailed"));
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageRegion, isPdf, resolvedPath, t]);

  const safeRegionWidth = Math.max(imageRegion.width, 1);
  const safeRegionHeight = Math.max(imageRegion.height, 1);
  const safeImageWidth = Math.max(imageRegion.imageWidth, safeRegionWidth);
  const safeImageHeight = Math.max(imageRegion.imageHeight, safeRegionHeight);

  return (
    <div className="postgres-explore-inspector-preview">
      <div className="annotation-excerpt annotation-excerpt--clip">
        <div className="annotation-excerpt-label">
          {isPdf ? `${t("projectCore.graph.pageLabel", { page: imageRegion.pageNumber ?? 1 })} - ` : ""}
          {t("projectCore.graph.regionSize", { width: Math.round(imageRegion.width), height: Math.round(imageRegion.height) })}
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
              alt={t("projectCore.graph.annotationRegionPreview")}
              style={{
                width: `${(safeImageWidth / safeRegionWidth) * 100}%`,
                height: `${(safeImageHeight / safeRegionHeight) * 100}%`,
                transform: `translate(-${(Math.max(imageRegion.x, 0) / safeImageWidth) * 100}%, -${(Math.max(imageRegion.y, 0) / safeImageHeight) * 100}%)`,
              }}
            />
          </div>
        ) : (
          <p className="users-guide-copy" style={{ margin: 0 }}>{t("projectCore.graph.loadingAnnotationPreview")}</p>
        )}
      </div>
    </div>
  );
}
