import type { ModelEntry } from "../types";

const syncSettings = {
  syncMode: {
    type: "enum",
    values: ["bounce", "loop", "cut_off", "silence", "remap"],
    default: "bounce",
  },
  temperature: { type: "range", min: 0, max: 1, default: 0.5, step: 0.1 },
  activeSpeakerDetection: { type: "boolean", default: false },
  occlusionDetection: { type: "boolean", default: false },
} as const;

function lipsyncModel(id: string, label: string, apiId: string): ModelEntry {
  return {
    id,
    surface: "video",
    label,
    vendor: "sync",
    description: "Match a video's lip movement to an audio track",
    prompt: "none",
    roles: { video: 1, audio: 1 },
    settings: syncSettings,
    operations: [
      {
        apiId,
        prompt: null,
        media: {
          video: { field: "video_url", required: true },
          audio: { field: "audio_url", required: true },
        },
        params: {
          syncMode: "sync_mode",
          temperature: "temperature",
          activeSpeakerDetection: "active_speaker_detection",
          occlusionDetection: "occlusion_detection",
        },
      },
    ],
  };
}

/** Sync's three lip-sync versions share a request schema and distinct APIs. */
export const sync2Avatar = lipsyncModel(
  "sync-lipsync-2",
  "Sync Lipsync 2",
  "sync/lipsync-2/avatar",
);

export const sync2ProAvatar = lipsyncModel(
  "sync-lipsync-2-pro",
  "Sync Lipsync 2 Pro",
  "sync/lipsync-2-pro/avatar",
);

export const sync3Avatar = lipsyncModel(
  "sync-3-lipsync",
  "Sync 3 Lip Sync",
  "sync/sync-3/avatar",
);

export const syncVideo: readonly ModelEntry[] = [sync2Avatar, sync2ProAvatar, sync3Avatar];
