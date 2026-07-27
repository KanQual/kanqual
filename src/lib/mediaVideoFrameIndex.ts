import { createFile, type MP4BoxBuffer, type Sample, type Track } from "mp4box";

const VIDEO_FRAME_INDEX_CACHE_VERSION = 1;

export type MediaVideoFrameIndexCache = {
  version: number;
  durationSeconds: number;
  trackId: number;
  timescale: number;
  frameCount: number;
  sourceByteLength: number;
  sourceFingerprintSha256: string;
  generatedAt: string;
  timestampsSeconds: number[];
};

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function roundTimestamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 1000000) / 1000000);
}

function trackDurationSeconds(track: Track, fallbackDurationSeconds: number) {
  if (Number.isFinite(track.movie_duration) && Number.isFinite(track.movie_timescale) && track.movie_timescale > 0) {
    return Math.max(0, track.movie_duration / track.movie_timescale);
  }
  if (Number.isFinite(track.duration) && Number.isFinite(track.timescale) && track.timescale > 0) {
    return Math.max(0, track.duration / track.timescale);
  }
  return fallbackDurationSeconds;
}

function sampleTimestampSeconds(sample: Sample, fallbackTimescale: number) {
  const timescale = Number.isFinite(sample.timescale) && sample.timescale > 0
    ? sample.timescale
    : fallbackTimescale;
  const timestamp = Number.isFinite(sample.cts) ? sample.cts : sample.dts;
  return roundTimestamp(timestamp / Math.max(1, timescale));
}

function uniqueSortedTimestamps(samples: Sample[], fallbackTimescale: number) {
  const timestamps = samples
    .map((sample) => sampleTimestampSeconds(sample, fallbackTimescale))
    .filter((timestamp) => Number.isFinite(timestamp));
  timestamps.sort((left, right) => left - right);

  const unique: number[] = [];
  for (const timestamp of timestamps) {
    if (unique.length === 0 || Math.abs(timestamp - unique[unique.length - 1]) > 0.000001) {
      unique.push(timestamp);
    }
  }
  return unique;
}

export async function createMediaVideoFrameIndexCache(bytes: Uint8Array): Promise<MediaVideoFrameIndexCache | null> {
  try {
    const mp4File = createFile();
    let parserFailed = false;
    mp4File.onError = () => {
      parserFailed = true;
    };

    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as MP4BoxBuffer;
    buffer.fileStart = 0;
    mp4File.appendBuffer(buffer, true);
    mp4File.flush();

    if (parserFailed) return null;
    const info = mp4File.getInfo();
    const videoTrack = info.videoTracks[0];
    if (!videoTrack) return null;

    const samples = mp4File.getTrackSamplesInfo(videoTrack.id);
    const timestampsSeconds = uniqueSortedTimestamps(samples, videoTrack.timescale);
    if (timestampsSeconds.length === 0) return null;

    const movieDurationSeconds = info.timescale > 0 ? info.duration / info.timescale : 0;
    return {
      version: VIDEO_FRAME_INDEX_CACHE_VERSION,
      durationSeconds: trackDurationSeconds(videoTrack, movieDurationSeconds),
      trackId: videoTrack.id,
      timescale: Math.max(1, videoTrack.timescale || 1),
      frameCount: timestampsSeconds.length,
      sourceByteLength: bytes.byteLength,
      sourceFingerprintSha256: await sha256Hex(bytes),
      generatedAt: new Date().toISOString(),
      timestampsSeconds,
    };
  } catch {
    return null;
  }
}

export function serializeMediaVideoFrameIndexCache(cache: MediaVideoFrameIndexCache | null) {
  if (!cache) return "";
  return JSON.stringify(cache);
}

export function parseMediaVideoFrameIndexCache(raw: string | null | undefined): MediaVideoFrameIndexCache | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MediaVideoFrameIndexCache> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.timestampsSeconds)) return null;
    const timestampsSeconds = parsed.timestampsSeconds
      .map((value) => roundTimestamp(Number(value)))
      .filter((value) => Number.isFinite(value));
    if (timestampsSeconds.length === 0) return null;
    timestampsSeconds.sort((left, right) => left - right);
    return {
      version: Number(parsed.version) || VIDEO_FRAME_INDEX_CACHE_VERSION,
      durationSeconds: Math.max(0, Number(parsed.durationSeconds) || 0),
      trackId: Math.max(0, Number(parsed.trackId) || 0),
      timescale: Math.max(1, Number(parsed.timescale) || 1),
      frameCount: Math.max(1, Number(parsed.frameCount) || timestampsSeconds.length),
      sourceByteLength: Math.max(0, Number(parsed.sourceByteLength) || 0),
      sourceFingerprintSha256: typeof parsed.sourceFingerprintSha256 === "string" ? parsed.sourceFingerprintSha256 : "",
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      timestampsSeconds,
    };
  } catch {
    return null;
  }
}
