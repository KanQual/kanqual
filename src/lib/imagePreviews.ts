import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { registerMediaRelease, releaseMediaUrl } from "./mediaStream";

// At most 64 mounted previews, with four requests in flight. Native decoding is serialized.
let active = 0;
let inFlight = 0;
const pending: Array<() => void> = [];
function pump() { while (active < 64 && inFlight < 4 && pending.length) pending.shift()!(); }
export function openImagePreview(path: string, size: number | null = 384, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = pending.indexOf(start);
      if (index >= 0) { pending.splice(index, 1); reject(new DOMException("Cancelled", "AbortError")); }
    };
    const start = () => {
      if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
      active++; inFlight++;
      void invoke<string>("open_image_stream_command", { path, size }).then(async (url) => {
        let released = false;
        registerMediaRelease(url, () => { if (!released) { released = true; active--; pump(); } });
        const cancel = () => releaseMediaUrl(url);
        signal?.addEventListener("abort", cancel, { once: true });
        try {
          if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
          await new Promise<void>((done, fail) => {
            const image = new Image();
            const abortLoad = () => { image.src = ""; fail(new DOMException("Cancelled", "AbortError")); };
            signal?.addEventListener("abort", abortLoad, { once: true });
            const clear = () => { signal?.removeEventListener("abort", abortLoad); image.onload = null; image.onerror = null; image.removeAttribute("src"); };
            image.onload = () => { clear(); done(); };
            image.onerror = () => { clear(); fail(new Error("Image preview unavailable")); };
            image.src = url;
          });
          if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
          resolve(url);
        } catch (error) { releaseMediaUrl(url); reject(error); }
        finally { signal?.removeEventListener("abort", cancel); }
      }, (error) => { active--; reject(error); }).finally(() => { inFlight--; signal?.removeEventListener("abort", abort); pump(); });
    };
    signal?.addEventListener("abort", abort, { once: true });
    pending.push(start); pump();
  });
}
export function openOriginalImage(path: string): Promise<string> {
  return invoke("open_image_stream_command", { path, size: null });
}

/** Unloads previews outside the viewport; pending requests are cancelled by their owners. */
export function usePreviewVisibility<T extends Element = HTMLDivElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(0);
  const ref = useCallback((next: T | null) => setElement(next), []);
  useEffect(() => {
    setVisible(false);
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "150px" });
    observer.observe(element);
    // Retain the last footprint when a lazy annotation unmounts, avoiding scroll jumps.
    const resize = new ResizeObserver(() => {
      const measured = element.getBoundingClientRect().height;
      setHeight((current) => measured > current + 0.5 ? measured : current);
    });
    resize.observe(element);
    return () => { observer.disconnect(); resize.disconnect(); };
  }, [element]);
  return { ref, visible, height };
}

// A shared listener refreshes mounted previews after same-path asset replacements.
const subscribers = new Set<() => void>();
let unsubscribe: (() => void) | undefined;
let subscription: Promise<void> | undefined;
export function useImageRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    subscribers.add(changed);
    if (!subscription) subscription = listen<{ entityType: string }>("postgres-project-changed", ({ payload }) => {
      if (["source", "object", "object_type", "source_type", "source_type_setting"].includes(payload.entityType)) subscribers.forEach((notify) => notify());
    }).then((stop) => { unsubscribe = stop; if (!subscribers.size) { stop(); unsubscribe = undefined; subscription = undefined; } }).catch(() => { subscription = undefined; });
    return () => { subscribers.delete(changed); if (!subscribers.size && unsubscribe) { unsubscribe(); unsubscribe = undefined; subscription = undefined; } };
  }, []);
  return revision;
}
