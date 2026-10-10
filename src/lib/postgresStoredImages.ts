import { useEffect, useMemo, useRef, useState } from "react";
import { openImagePreview, useImageRevision, usePreviewVisibility } from "./imagePreviews";
import { releaseMediaUrl } from "./mediaStream";

export function getPostgresImageMimeType(storagePath: string): string {
  const extension = storagePath.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/jpeg";
}

export function resolvePostgresStoragePath(projectStoragePath: string, relativeStoragePath: string): string {
  const trimmedRelativePath = relativeStoragePath.trim();
  if (!trimmedRelativePath) return "";
  if (/^[a-zA-Z]:[\\/]/.test(trimmedRelativePath) || trimmedRelativePath.startsWith("\\\\") || trimmedRelativePath.startsWith("/")) {
    return trimmedRelativePath;
  }
  const trimmedProjectPath = projectStoragePath.trim().replace(/[\\/]+$/, "");
  const normalizedRelativePath = trimmedRelativePath.replace(/^[\\/]+/, "");
  return trimmedProjectPath ? `${trimmedProjectPath}\\${normalizedRelativePath}` : normalizedRelativePath;
}

export function usePostgresStoredImage(projectStoragePath: string, imageStoragePath: string, size = 128) {
  const { ref, visible } = usePreviewVisibility<HTMLElement>();
  const revision = useImageRevision();
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl("");
    const path = resolvePostgresStoragePath(projectStoragePath, imageStoragePath);
    if (!path || !visible) return;
    const controller = new AbortController();
    let loaded = "";
    void openImagePreview(path, size, controller.signal).then((next) => {
      if (controller.signal.aborted) { releaseMediaUrl(next); return; }
      loaded = next; setUrl(next);
    }).catch(() => {});
    return () => { controller.abort(); releaseMediaUrl(loaded); };
  }, [projectStoragePath, imageStoragePath, visible, size, revision]);
  return { url, ref };
}

/** Callers supply only viewport-visible paths. The graph retains at most 48 previews. */
export function usePostgresStoredImageUrlMap(projectStoragePath: string, imageStoragePaths: string[], size: number | null = 128): Map<string, string> {
  const [entries, setEntries] = useState<Array<[string, string]>>([]);
  const active = useRef(new Map<string, { controller: AbortController; url: string }>());
  const revision = useImageRevision();
  const identity = `${projectStoragePath}:${revision}:${size}`;
  const previousIdentity = useRef(identity);
  const key = JSON.stringify([...new Set(imageStoragePaths.filter(Boolean))].slice(0, 48).sort());
  useEffect(() => {
    const paths = new Set(JSON.parse(key) as string[]);
    for (const [path, entry] of active.current) {
      if (!paths.has(path) || previousIdentity.current !== identity) {
        entry.controller.abort(); releaseMediaUrl(entry.url); active.current.delete(path);
      }
    }
    previousIdentity.current = identity;
    const publish = () => setEntries([...active.current].flatMap(([path, entry]) => entry.url ? [[path, entry.url] as [string, string]] : []));
    publish();
    for (const path of paths) {
      if (active.current.has(path)) continue;
      const entry = { controller: new AbortController(), url: "" };
      active.current.set(path, entry);
      void openImagePreview(resolvePostgresStoragePath(projectStoragePath, path), size, entry.controller.signal).then((url) => {
        if (entry.controller.signal.aborted) { releaseMediaUrl(url); return; }
        entry.url = url; publish();
      }).catch(() => {});
    }
  }, [key, projectStoragePath, identity, size]);
  useEffect(() => () => {
    for (const entry of active.current.values()) { entry.controller.abort(); releaseMediaUrl(entry.url); }
    active.current.clear();
  }, []);
  return useMemo(() => new Map(entries), [entries]);
}
