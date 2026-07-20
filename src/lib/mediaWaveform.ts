const DEFAULT_WAVEFORM_PEAK_COUNT = 4000;
const WAVEFORM_CACHE_VERSION = 1;

export type MediaWaveformCache = {
  version: number;
  durationSeconds: number;
  channels: number;
  peakCount: number;
  sampleRate: number;
  sourceByteLength: number;
  sourceFingerprintSha256: string;
  generatedAt: string;
  peaks: number[][];
};

function clampPeakValue(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function roundPeakValue(value: number) {
  return Math.round(clampPeakValue(value) * 10000) / 10000;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function exportWaveformPeaks(buffer: AudioBuffer, maxLength: number) {
  const channelCount = Math.max(1, buffer.numberOfChannels);
  const peakCount = Math.max(32, Math.min(maxLength, buffer.length || maxLength));
  const peaks: number[][] = [];

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    const data: number[] = [];
    const sampleSize = channel.length / peakCount;
    for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
      const sampleStart = Math.floor(peakIndex * sampleSize);
      const sampleEnd = Math.max(sampleStart + 1, Math.ceil((peakIndex + 1) * sampleSize));
      let max = 0;
      for (let sampleIndex = sampleStart; sampleIndex < sampleEnd; sampleIndex += 1) {
        const nextValue = channel[sampleIndex] ?? 0;
        if (Math.abs(nextValue) > Math.abs(max)) {
          max = nextValue;
        }
      }
      data.push(roundPeakValue(max));
    }
    peaks.push(data);
  }

  return peaks;
}

export async function createMediaWaveformCache(
  bytes: Uint8Array,
  options?: {
    peakCount?: number;
  },
): Promise<MediaWaveformCache | null> {
  const peakCount = Math.max(128, options?.peakCount ?? DEFAULT_WAVEFORM_PEAK_COUNT);
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const audioContext = new AudioContextCtor();
  try {
    const decoded = await audioContext.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const peaks = exportWaveformPeaks(decoded, peakCount);
    return {
      version: WAVEFORM_CACHE_VERSION,
      durationSeconds: decoded.duration,
      channels: decoded.numberOfChannels,
      peakCount: peaks[0]?.length ?? peakCount,
      sampleRate: decoded.sampleRate,
      sourceByteLength: bytes.byteLength,
      sourceFingerprintSha256: await sha256Hex(bytes),
      generatedAt: new Date().toISOString(),
      peaks,
    };
  } catch {
    return null;
  } finally {
    void audioContext.close().catch(() => {});
  }
}

export function serializeMediaWaveformCache(cache: MediaWaveformCache | null) {
  if (!cache) return "";
  return JSON.stringify(cache);
}

export function parseMediaWaveformCache(raw: string | null | undefined): MediaWaveformCache | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MediaWaveformCache> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.peaks) || !parsed.peaks.every((channel) => Array.isArray(channel))) return null;
    if (!Number.isFinite(parsed.durationSeconds) || parsed.durationSeconds! <= 0) return null;
    return {
      version: Number(parsed.version) || WAVEFORM_CACHE_VERSION,
      durationSeconds: Number(parsed.durationSeconds),
      channels: Math.max(1, Number(parsed.channels) || parsed.peaks.length || 1),
      peakCount: Math.max(1, Number(parsed.peakCount) || parsed.peaks[0]?.length || 1),
      sampleRate: Math.max(1, Number(parsed.sampleRate) || 1),
      sourceByteLength: Math.max(0, Number(parsed.sourceByteLength) || 0),
      sourceFingerprintSha256: typeof parsed.sourceFingerprintSha256 === "string" ? parsed.sourceFingerprintSha256 : "",
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      peaks: parsed.peaks.map((channel) => channel.map((value) => roundPeakValue(Number(value)))),
    };
  } catch {
    return null;
  }
}
