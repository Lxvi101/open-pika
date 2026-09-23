import type { GenerationPlane, ModelEntry } from "../types";

/* Kling 3.0's text-to-video and image-to-video share duration, resolution,
   the native-audio toggle and multi-shot; only text-to-video also carries
   aspect_ratio (image-to-video takes its frame's aspect ratio instead). */
const KLING3_RESOLUTION = ["720p", "1080p", "4k"] as const;
const KLING3_ASPECT = ["16:9", "9:16", "1:1"] as const;

const kling3CommonParams = {
  resolution: "resolution",
  duration: "duration",
  audio: "audio",
  multiShot: "multi_shot",
} as const;

export const kling3Video: ModelEntry = {
  id: "kling-3.0",
  surface: "video",
  label: "Kling 3.0",
  vendor: "kling",
  prompt: "optional",
  roles: { start: 1, end: 1 },
  settings: {
    aspectRatio: { type: "enum", values: KLING3_ASPECT, default: "16:9" },
    resolution: { type: "enum", values: KLING3_RESOLUTION, default: "720p" },
    duration: { type: "range", min: 3, max: 15, default: 5 },
    audio: { type: "enum", values: ["native", "off"], default: "off" },
    multiShot: { type: "boolean", default: false },
  },
  operations: [
    {
      apiId: "kling/kling-3.0/image-to-video",
      media: {
        start: { field: "image_url", required: true },
        end: { field: "last_frame_url" },
      },
      params: kling3CommonParams,
    },
    {
      apiId: "kling/kling-3.0/text-to-video",
      params: { ...kling3CommonParams, aspectRatio: "aspect_ratio" },
    },
  ],
};

/* Omni-video has no top-level prompt or media fields at all: everything —
   words, first/last frame, reference images, a reference video — is one
   ordered `contents` list of typed items. Bind the roles anyway so selection
   and the check script see them, then rebuild `contents` from the plane. */
function omniContents(plane: GenerationPlane, body: Record<string, unknown>) {
  const contents: Record<string, unknown>[] = [];
  const text = plane.prompt.text.trim();
  if (text) contents.push({ type: "prompt", text });
  for (const item of plane.media.start ?? []) contents.push({ type: "first_frame", url: item.url });
  for (const item of plane.media.end ?? []) contents.push({ type: "last_frame", url: item.url });
  for (const item of plane.media.reference ?? [])
    contents.push({ type: "refer_image", url: item.url });
  for (const item of plane.media.video ?? []) contents.push({ type: "base_video", url: item.url });
  return { ...body, contents };
}

export const kling3OmniVideo: ModelEntry = {
  id: "kling-3.0-omni-video",
  surface: "video",
  label: "Kling 3.0",
  vendor: "kling",
  description: "Combine a prompt, images and a reference video in one generation",
  prompt: "optional",
  roles: { start: 1, end: 1, reference: 6, video: 1 },
  settings: {
    aspectRatio: { type: "enum", values: KLING3_ASPECT, default: "16:9" },
    resolution: { type: "enum", values: KLING3_RESOLUTION, default: "720p" },
    duration: { type: "range", min: 3, max: 15, default: 5 },
    audio: { type: "enum", values: ["native", "original", "off"], default: "off" },
    multiShot: { type: "boolean", default: false },
  },
  operations: [
    {
      apiId: "kling/kling-3.0/omni-video",
      prompt: null,
      media: {
        start: { field: "contents" },
        end: { field: "contents" },
        reference: { field: "contents", many: true },
        video: { field: "contents" },
      },
      params: {
        aspectRatio: "aspect_ratio",
        resolution: "resolution",
        duration: "duration",
        audio: "audio",
        multiShot: "multi_shot",
      },
      build: omniContents,
    },
  ],
};

export const kling3MotionControl: ModelEntry = {
  id: "kling-3.0-motion-control",
  surface: "video",
  label: "Kling 3.0",
  vendor: "kling",
  description: "Drive a character image with a reference video",
  prompt: "optional",
  roles: { reference: 1, video: 1 },
  settings: {
    characterOrientation: { type: "enum", values: ["image", "video"], default: "video" },
    resolution: { type: "enum", values: ["720p", "1080p"], default: "720p" },
    audio: { type: "enum", values: ["original", "off"], default: "original" },
  },
  operations: [
    {
      apiId: "kling/kling-3.0/motion-control",
      media: {
        reference: { field: "image_url", required: true },
        video: { field: "video_url", required: true },
      },
      params: {
        characterOrientation: "character_orientation",
        resolution: "resolution",
        audio: "audio",
      },
    },
  ],
};

/* Turbo drops aspect_ratio from image-to-video (the frame decides it) and
   has no audio toggle at all: the model always generates native audio. */
export const kling3TurboVideo: ModelEntry = {
  id: "kling-3.0-turbo",
  surface: "video",
  label: "Kling 3.0 Turbo",
  vendor: "kling",
  prompt: "optional",
  roles: { start: 1 },
  settings: {
    aspectRatio: { type: "enum", values: KLING3_ASPECT, default: "16:9" },
    resolution: { type: "enum", values: ["720p", "1080p"], default: "720p" },
    duration: { type: "range", min: 3, max: 15, default: 5 },
  },
  operations: [
    {
      apiId: "kling/kling-3.0-turbo/image-to-video",
      media: { start: { field: "image_url", required: true } },
      params: { resolution: "resolution", duration: "duration" },
    },
    {
      apiId: "kling/kling-3.0-turbo/text-to-video",
      params: { aspectRatio: "aspect_ratio", resolution: "resolution", duration: "duration" },
    },
  ],
};

export const klingAiAvatarV2: ModelEntry = {
  id: "kling-ai-avatar-v2",
  surface: "video",
  label: "Kling AI Avatar V2",
  vendor: "kling",
  description: "Animate a portrait to speak a driving audio track",
  prompt: "optional",
  roles: { reference: 1, audio: 1 },
  settings: {
    mode: { type: "enum", values: ["std", "pro"], default: "pro" },
  },
  operations: [
    {
      apiId: "kling/kling-ai-avatar-v2/avatar",
      media: {
        reference: { field: "image_url", required: true },
        audio: { field: "sound_file", required: true },
      },
      params: { mode: "mode" },
    },
  ],
};

export const klingLipsync: ModelEntry = {
  id: "kling-lipsync",
  surface: "video",
  label: "Kling Lipsync",
  vendor: "kling",
  description: "Sync a video's lips to a driving audio track",
  prompt: "none",
  roles: { video: 1, audio: 1 },
  settings: {
    /* sound_end_time is the one field the schema marks required with no
       default; the platform's own example sends 0, so that's the default. */
    soundEndTime: { type: "range", min: 0, max: 600_000, default: 0 },
    soundVolume: { type: "range", min: 0, max: 1, step: 0.1, default: 1 },
    originalAudioVolume: { type: "range", min: 0, max: 1, step: 0.1, default: 1 },
  },
  operations: [
    {
      apiId: "kling/kling-lipsync/avatar",
      prompt: null,
      media: {
        video: { field: "video_url", required: true },
        audio: { field: "audio_url", required: true },
      },
      params: {
        soundEndTime: { field: "sound_end_time", as: "number" },
        soundVolume: "sound_volume",
        originalAudioVolume: "original_audio_volume",
      },
    },
  ],
};

export const klingVideo: readonly ModelEntry[] = [
  kling3Video,
  kling3TurboVideo,
  kling3OmniVideo,
  kling3MotionControl,
  klingAiAvatarV2,
  klingLipsync,
];
