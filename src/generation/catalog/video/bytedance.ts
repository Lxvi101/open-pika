import type { ModelEntry } from "../types";

/* Every Seedance version shares field names (image_url/end_image_url,
   image_urls/video_urls/audio_urls, ratio, generate_audio); only the
   resolution ceiling, duration ceiling and reference caps change per
   version. 2.5 alone exposes output_format, and 2.5's image-to-video
   restricts ratio to "adaptive" (the platform locks it to the source
   frame's shape), so 2.5 gets its own params maps. */

const RATIO = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"] as const;

/* -------------------------------------------------------------------- */
/* Seedance 2.5                                                          */
/* -------------------------------------------------------------------- */

const seedance25Params = {
  resolution: "resolution",
  duration: "duration",
  aspectRatio: "ratio",
  generateAudio: "generate_audio",
  outputFormat: "output_format",
} as const;

/* Image-to-video's own schema only accepts "adaptive" for ratio (the
   output keeps the starting frame's shape), so this operation drops
   aspectRatio from its params rather than offering values the platform
   would reject. */
const seedance25ImageParams = {
  resolution: "resolution",
  duration: "duration",
  generateAudio: "generate_audio",
  outputFormat: "output_format",
} as const;

export const seedance25Video: ModelEntry = {
  id: "seedance-2.5",
  surface: "video",
  label: "Seedance 2.5",
  vendor: "bytedance",
  roles: { start: 1, end: 1, reference: 30, video: 10, audio: 10 },
  settings: {
    aspectRatio: { type: "enum", values: RATIO, default: "adaptive" },
    resolution: { type: "enum", values: ["480p", "720p", "1080p"], default: "720p" },
    duration: { type: "range", min: 4, max: 30, default: 5 },
    generateAudio: { type: "boolean", default: true },
    outputFormat: { type: "enum", values: ["mp4", "mov"], default: "mp4" },
  },
  operations: [
    {
      apiId: "bytedance/seedance-2.5/image-to-video",
      media: {
        start: { field: "image_url", required: true },
        end: { field: "end_image_url" },
      },
      params: seedance25ImageParams,
    },
    {
      apiId: "bytedance/seedance-2.5/reference-to-video",
      media: {
        reference: { field: "image_urls", many: true },
        video: { field: "video_urls", many: true },
        audio: { field: "audio_urls", many: true },
      },
      requireAny: ["reference", "video", "audio"],
      params: seedance25Params,
    },
    {
      apiId: "bytedance/seedance-2.5/text-to-video",
      params: seedance25Params,
    },
  ],
};

/* -------------------------------------------------------------------- */
/* Seedance 2.0 family (2.0, 2.0 Fast, 2.0 Mini)                         */
/* -------------------------------------------------------------------- */

const seedanceParams = {
  resolution: "resolution",
  duration: "duration",
  aspectRatio: "ratio",
  generateAudio: "generate_audio",
} as const;

export const seedance20Video: ModelEntry = {
  id: "seedance-2.0",
  surface: "video",
  label: "Seedance 2.0",
  vendor: "bytedance",
  roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 },
  settings: {
    aspectRatio: { type: "enum", values: RATIO, default: "adaptive" },
    resolution: { type: "enum", values: ["480p", "720p", "1080p", "4k"], default: "720p" },
    duration: { type: "range", min: 4, max: 15, default: 5 },
    generateAudio: { type: "boolean", default: true },
  },
  operations: [
    {
      apiId: "bytedance/seedance-2.0/image-to-video",
      media: {
        start: { field: "image_url", required: true },
        end: { field: "end_image_url" },
      },
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0/reference-to-video",
      media: {
        reference: { field: "image_urls", many: true },
        video: { field: "video_urls", many: true },
        audio: { field: "audio_urls", many: true },
      },
      requireAny: ["reference", "video", "audio"],
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0/text-to-video",
      params: seedanceParams,
    },
  ],
};

export const seedance20FastVideo: ModelEntry = {
  id: "seedance-2.0-fast",
  surface: "video",
  label: "Seedance 2.0 Fast",
  vendor: "bytedance",
  roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 },
  settings: {
    aspectRatio: { type: "enum", values: RATIO, default: "adaptive" },
    resolution: { type: "enum", values: ["480p", "720p"], default: "720p" },
    duration: { type: "range", min: 4, max: 15, default: 5 },
    generateAudio: { type: "boolean", default: true },
  },
  operations: [
    {
      apiId: "bytedance/seedance-2.0-fast/image-to-video",
      media: {
        start: { field: "image_url", required: true },
        end: { field: "end_image_url" },
      },
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0-fast/reference-to-video",
      media: {
        reference: { field: "image_urls", many: true },
        video: { field: "video_urls", many: true },
        audio: { field: "audio_urls", many: true },
      },
      requireAny: ["reference", "video", "audio"],
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0-fast/text-to-video",
      params: seedanceParams,
    },
  ],
};

export const seedance20MiniVideo: ModelEntry = {
  id: "seedance-2.0-mini",
  surface: "video",
  label: "Seedance 2.0 Mini",
  vendor: "bytedance",
  roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 },
  settings: {
    aspectRatio: { type: "enum", values: RATIO, default: "adaptive" },
    resolution: { type: "enum", values: ["480p", "720p"], default: "720p" },
    duration: { type: "range", min: 4, max: 15, default: 5 },
    generateAudio: { type: "boolean", default: true },
  },
  operations: [
    {
      apiId: "bytedance/seedance-2.0-mini/image-to-video",
      media: {
        start: { field: "image_url", required: true },
        end: { field: "end_image_url" },
      },
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0-mini/reference-to-video",
      media: {
        reference: { field: "image_urls", many: true },
        video: { field: "video_urls", many: true },
        audio: { field: "audio_urls", many: true },
      },
      requireAny: ["reference", "video", "audio"],
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0-mini/text-to-video",
      params: seedanceParams,
    },
  ],
};

/* seedance-2.5 leads: it is the studio's default model. */
export const bytedanceVideo: readonly ModelEntry[] = [
  seedance25Video,
  seedance20Video,
  seedance20FastVideo,
  seedance20MiniVideo,
];
