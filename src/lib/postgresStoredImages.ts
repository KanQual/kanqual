import { useEffect, useMemo, useState } from "react";
import { readFile as readTauriFile } from "@tauri-apps/plugin-fs";

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
  if (/^[a-zA-Z]:[\\/]/.test(trimmedRelativePath) || trimmedRelativePath.startsWith("\\\\")) {
    return trimmedRelativePath;
  }
  const trimmedProjectPath = projectStoragePath.trim().replace(/[\\/]+$/, "");
  const normalizedRelativePath = trimmedRelativePath.replace(/^[\\/]+/, "");
  return trimmedProjectPath ? `${trimmedProjectPath}\\${normalizedRelativePath}` : normalizedRelativePath;
}

export function usePostgresStoredImageUrl(projectStoragePath: string, imageStoragePath: string): string {
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const resolvedPath = resolvePostgresStoragePath(projectStoragePath, imageStoragePath);
    if (!resolvedPath) {
      setImageUrl("");
      return;
    }
    void readTauriFile(resolvedPath)
      .then((bytes) => {
        if (!active) return;
        const blob = new Blob([bytes], { type: getPostgresImageMimeType(imageStoragePath) });
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (active) setImageUrl("");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectStoragePath, imageStoragePath]);

  return imageUrl;
}

export function usePostgresStoredImageUrlMap(projectStoragePath: string, imageStoragePaths: string[]): Map<string, string> {
  const [imageUrlEntries, setImageUrlEntries] = useState<Array<[string, string]>>([]);
  const imageStoragePathKey = useMemo(
    () => Array.from(new Set(imageStoragePaths.map((path) => path.trim()).filter(Boolean))).sort().join("\n"),
    [imageStoragePaths],
  );

  useEffect(() => {
    const paths = imageStoragePathKey.split("\n").filter(Boolean);
    let active = true;
    const objectUrls: string[] = [];

    if (!projectStoragePath || paths.length === 0) {
      setImageUrlEntries([]);
      return;
    }

    void Promise.all(paths.map(async (imageStoragePath) => {
      const resolvedPath = resolvePostgresStoragePath(projectStoragePath, imageStoragePath);
      if (!resolvedPath) return null;
      try {
        const bytes = await readTauriFile(resolvedPath);
        if (!active) return null;
        const blob = new Blob([bytes], { type: getPostgresImageMimeType(imageStoragePath) });
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        return [imageStoragePath, objectUrl] as [string, string];
      } catch {
        return null;
      }
    })).then((entries) => {
      if (!active) return;
      setImageUrlEntries(entries.filter((entry): entry is [string, string] => Boolean(entry)));
    });

    return () => {
      active = false;
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    };
  }, [imageStoragePathKey, projectStoragePath]);

  return useMemo(() => new Map(imageUrlEntries), [imageUrlEntries]);
}
