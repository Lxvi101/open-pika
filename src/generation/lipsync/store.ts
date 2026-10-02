"use client";

import { create } from "zustand";
import type { GenerationPlane } from "../catalog/types";
import { uploadMedia } from "../upload";
import { encodeClip, SAMPLE_RATE } from "./audio";
import { lipSyncAdapter } from "./adapters";
import type { LipSyncReference } from "./types";

type LipSyncState = {
  enabled: boolean;
  name: string;
  sourceId: string;
  samples: Float32Array | null;
  start: number;
  duration: number;
  pro: boolean;
  ratio: string;
  transcript: string;
  transcriptKey: string;
  status: "idle" | "waiting" | "transcribing" | "ready" | "error";
  error: string | null;
  preparing: boolean;
  progress: string;
  retry: number;
  uploaded: { key: string; url: string } | null;
  setSource: (name: string, samples: Float32Array) => void;
  trim: (start: number, duration: number) => void;
};

// Recording bytes and credentials never enter localStorage. A reload starts
// a fresh session; uploaded media follows the app's normal Pika lifecycle.
export const useLipSync = create<LipSyncState>((set) => ({
  enabled: false, name: "", sourceId: "", samples: null, start: 0, duration: 5,
  pro: false, ratio: "16:9", transcript: "", transcriptKey: "", status: "idle",
  error: null, preparing: false, progress: "", retry: 0, uploaded: null,
  setSource: (name, samples) => set({
    name, samples, sourceId: crypto.randomUUID(), start: 0,
    duration: Math.min(30, Math.max(4, Math.ceil(samples.length / SAMPLE_RATE))),
    transcript: "", transcriptKey: "", status: "waiting", error: null, uploaded: null,
  }),
  trim: (start, duration) => set((state) => {
    if (!Number.isFinite(start) || !Number.isFinite(duration)) return state;
    const nextStart = Math.max(0, Math.min(Math.max(0, (state.samples?.length ?? 0) / SAMPLE_RATE - Math.min(duration, (state.samples?.length ?? 0) / SAMPLE_RATE)), Math.round(start * 100) / 100));
    const nextDuration = Math.max(4, Math.min(30, Math.round(duration)));
    if (nextStart === state.start && nextDuration === state.duration) return state;
    return { start: nextStart, duration: nextDuration, transcript: "", transcriptKey: "", status: "waiting", error: null, uploaded: null };
  }),
}));

export function clipKey(state: Pick<LipSyncState, "sourceId" | "start" | "duration">): string {
  return `${state.sourceId}:${state.start}:${state.duration}`;
}

export function lipSyncReady(state: LipSyncState): boolean {
  return Boolean(state.samples && state.transcript.trim() && state.transcriptKey === clipKey(state) && !state.preparing);
}

export function lipSyncPreview(plane: GenerationPlane, state: LipSyncState): GenerationPlane {
  if (!state.enabled || !lipSyncAdapter(plane.model)) return plane;
  return {
    ...plane,
    lipSync: {
      mode: state.pro ? "video" : "audio", url: "https://preview.invalid/lip-sync",
      duration: state.duration, transcript: state.transcript || "Spoken dialogue.",
      ...(state.pro ? { aspectRatio: state.ratio } : {}),
    },
  };
}

export async function responseError(response: Response): Promise<Error> {
  const data = await response.json().catch(() => ({}));
  return new Error(typeof data.message === "string" ? data.message : `Preparation failed (${response.status}).`);
}

export async function prepareLipSyncPlane(plane: GenerationPlane): Promise<GenerationPlane> {
  const state = useLipSync.getState();
  if (!state.enabled || !lipSyncAdapter(plane.model)) return plane;
  if (!lipSyncReady(state) || !state.samples) throw new Error("Finish preparing the lip-sync audio and transcript first.");
  const key = `${clipKey(state)}:${state.pro}:${state.ratio}`;
  const reference: LipSyncReference = {
    mode: state.pro ? "video" : "audio", url: "", duration: state.duration,
    transcript: state.transcript, ...(state.pro ? { aspectRatio: state.ratio } : {}),
  };
  useLipSync.setState({ preparing: true, progress: state.pro ? "Building black-video reference…" : "Uploading matched audio…" });
  try {
    let url = state.uploaded?.key === key ? state.uploaded.url : undefined;
    if (!url) {
      const audio = new Blob([encodeClip(state.samples, state.start, state.duration)], { type: "audio/wav" });
      let file = new File([audio], "lip-sync.wav", { type: "audio/wav" });
      if (state.pro) {
        const response = await fetch(`/api/lipsync/video?ratio=${encodeURIComponent(state.ratio)}`, {
          method: "POST", body: audio, signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw await responseError(response);
        file = new File([await response.blob()], "lip-sync-reference.mp4", { type: "video/mp4" });
      }
      useLipSync.setState({ progress: "Uploading matched reference…" });
      url = (await uploadMedia(file)).url;
      const current = useLipSync.getState();
      if (`${clipKey(current)}:${current.pro}:${current.ratio}` === key) useLipSync.setState({ uploaded: { key, url } });
    }
    return {
      ...plane,
      settings: { ...plane.settings, duration: state.duration, generateAudio: true, ...(state.pro ? { aspectRatio: state.ratio } : {}) },
      lipSync: { ...reference, url },
    };
  } finally { useLipSync.setState({ preparing: false, progress: "" }); }
}
