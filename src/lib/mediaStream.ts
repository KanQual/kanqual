import { invoke } from "@tauri-apps/api/core";

export function openMediaStream(path: string): Promise<string> {
  return invoke<string>("open_media_stream_command", { path });
}

const releaseCallbacks = new Map<string, () => void>();
export function registerMediaRelease(url: string, release: () => void) { releaseCallbacks.set(url, release); }

/** Also accepts image/PDF Blob URLs in mixed preview components. */
export function releaseMediaUrl(url: string | null | undefined) {
  if (!url) return;
  const release = releaseCallbacks.get(url);
  releaseCallbacks.delete(url);
  release?.();
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
    return;
  }
  for (const image of document.querySelectorAll<HTMLImageElement>("img")) {
    if (image.src === url) image.removeAttribute("src");
  }
  // Stop and detach every player using this grant before revoking it. This includes
  // offscreen frame/clip preview players and prevents downloads surviving navigation.
  for (const player of document.querySelectorAll<HTMLMediaElement>("audio, video")) {
    if (player.src === url || player.currentSrc === url || Array.from(player.querySelectorAll("source")).some((source) => source.src === url)) {
      player.pause();
      player.removeAttribute("src");
      player.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
      player.load();
    }
  }
  void invoke("close_media_stream_command", { url }).catch(() => {});
}

// Analysis is deliberately separate from playback. Call only from an explicit
// generation action; never keep the complete source bytes in component state.
let analysisQueue: Promise<unknown> = Promise.resolve();
export function runMediaAnalysis<T>(task: () => Promise<T>): Promise<T> {
  const next = analysisQueue.then(task, task);
  analysisQueue = next.catch(() => {});
  return next;
}
