import { useCallback, useEffect, useRef, useState } from "react";
import { openMediaStream, releaseMediaUrl } from "./mediaStream";

/** Owns the stream grant and DOM attachment independently of coding UI state. */
export function useSourceMedia(path: string, mediaKind: "audio" | "video") {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mediaElement, setMediaElement] = useState<HTMLMediaElement | null>(null);
  const elementRef = useRef<HTMLMediaElement | null>(null);

  // Only React's attachment callback may change the player reference. Effects
  // must not clear it after a new player has already mounted.
  const mediaElementCallbackRef = useCallback((element: HTMLMediaElement | null) => {
    elementRef.current = element;
    setMediaElement(element);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(Boolean(path));

    if (path) {
      void openMediaStream(path)
        .then((openedUrl) => {
          if (cancelled) {
            releaseMediaUrl(openedUrl);
            return;
          }
          url = openedUrl;
          setPreviewUrl(openedUrl);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setPreviewError(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }

    return () => {
      cancelled = true;
      releaseMediaUrl(url);
    };
  }, [path, mediaKind]);

  return {
    previewUrl, previewError, previewLoading, setPreviewError,
    mediaElement, mediaElementCallbackRef,
    // Callers can read the current player for user actions, but attachment is
    // private to this hook so view effects cannot reset it.
    mediaElementRef: elementRef as Readonly<{ current: HTMLMediaElement | null }>,
  };
}
