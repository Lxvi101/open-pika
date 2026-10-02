/** The prepared recording is 48 kHz mono PCM. Padding adds silence, never
 * changes speech speed; whole-second lengths are exact in samples. */
export const SAMPLE_RATE = 48_000;

export function encodeClip(samples: Float32Array, start: number, duration: number): ArrayBuffer {
  if (!Number.isFinite(start) || start < 0 || !validClipDuration(duration)) throw new Error("Choose a valid start and a whole-second length from 4 to 30 seconds.");
  const count = Math.round(duration * SAMPLE_RATE);
  const offset = Math.round(start * SAMPLE_RATE);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const text = (position: number, value: string) => [...value].forEach((char, i) => view.setUint8(position + i, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const value = Math.max(-1, Math.min(1, samples[offset + i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

export async function decodeAudio(file: File): Promise<Float32Array> {
  if (file.size > 50 * 1024 * 1024) throw new Error("Choose an audio file under 50 MB.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 600) throw new Error("Choose a recording under 10 minutes.");
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * SAMPLE_RATE), SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally { await context.close(); }
}

export function waveformPeaks(samples: Float32Array, count = 240): number[] {
  return Array.from({ length: count }, (_, index) => {
    const first = Math.floor(index * samples.length / count);
    const last = Math.floor((index + 1) * samples.length / count);
    let peak = 0;
    for (let i = first; i < last; i += Math.max(1, Math.floor((last - first) / 200))) peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    return peak;
  });
}
import { validClipDuration } from "./types";

/** Accept only our small, canonical PCM clip, not arbitrary codecs/URLs. */
export function validateWave(bytes: ArrayBuffer): number {
  if (bytes.byteLength < 44 || bytes.byteLength > 44 + SAMPLE_RATE * 30 * 2) throw new Error("Invalid lip-sync audio size.");
  const view = new DataView(bytes);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(bytes, offset, 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data" ||
      view.getUint32(4, true) !== bytes.byteLength - 8 || view.getUint32(16, true) !== 16 ||
      view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 ||
      view.getUint32(24, true) !== SAMPLE_RATE || view.getUint32(28, true) !== SAMPLE_RATE * 2 ||
      view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.byteLength - 44) {
    throw new Error("Prepare a WAV clip using the lip-sync editor.");
  }
  const duration = (bytes.byteLength - 44) / (SAMPLE_RATE * 2);
  if (!validClipDuration(duration)) throw new Error("Lip-sync audio must be exactly 4–30 whole seconds.");
  return duration;
}
