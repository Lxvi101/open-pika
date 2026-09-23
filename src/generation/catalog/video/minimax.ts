import type { ModelEntry } from "../types";

/* Hailuo 2.3 and 2.3 Fast share every field: duration is an integer enum, so
   it travels as a string setting sent back as a number. */
const HAILUO_DURATION = ["6", "10"] as const;
const HAILUO_RESOLUTION = ["768p", "1080p"] as const;

const hailuoParams = {
  duration: { field: "duration", as: "number" },
  resolution: "resolution",
  enhancePrompt: "prompt_optimizer",
} as const;

const hailuoSettings = {
  resolution: { type: "enum", values: HAILUO_RESOLUTION, default: "768p" },
  duration: { type: "enum", values: HAILUO_DURATION, default: "6" },
  enhancePrompt: { type: "boolean", default: true },
} as const;

export const hailuo23Video: ModelEntry = {
  id: "hailuo-2.3",
  surface: "video",
  label: "Hailuo 2.3",
  vendor: "minimax",
  roles: { start: 1 },
  settings: hailuoSettings,
  operations: [
    {
      apiId: "minimax/hailuo-2.3/image-to-video",
      media: { start: { field: "first_frame_image", required: true } },
      params: hailuoParams,
    },
    {
      apiId: "minimax/hailuo-2.3/text-to-video",
      params: hailuoParams,
    },
  ],
};

export const hailuo23FastVideo: ModelEntry = {
  id: "hailuo-2.3-fast",
  surface: "video",
  label: "Hailuo 2.3 Fast",
  vendor: "minimax",
  roles: { start: 1 },
  settings: hailuoSettings,
  operations: [
    {
      apiId: "minimax/hailuo-2.3-fast/image-to-video",
      media: { start: { field: "first_frame_image", required: true } },
      params: hailuoParams,
    },
  ],
};

/* H3's three functions differ only by attachment: reference images/video/
   audio pick reference-to-video, a first frame picks image-to-video, nothing
   attached falls to text-to-video. `ratio` has no effect once an image
   decides the frame, so image-to-video drops it. */
const H3_RATIO = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

const h3ScalarParams = {
  resolution: "resolution",
  duration: "duration",
  seed: { field: "seed", as: "number" },
} as const;

export const h3Video: ModelEntry = {
  id: "h3",
  surface: "video",
  label: "H3",
  vendor: "minimax",
  roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 },
  settings: {
    resolution: { type: "enum", values: ["768P", "2K"], default: "2K" },
    duration: { type: "range", min: 4, max: 15, default: 5 },
    aspectRatio: { type: "enum", values: H3_RATIO, default: "16:9" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "minimax/h3/reference-to-video",
      media: {
        reference: { field: "image_urls", many: true },
        video: { field: "video_urls", many: true },
        audio: { field: "audio_urls", many: true },
      },
      requireAny: ["reference", "video", "audio"],
      params: { ...h3ScalarParams, aspectRatio: "ratio" },
    },
    {
      apiId: "minimax/h3/image-to-video",
      media: {
        start: { field: "first_frame_image", required: true },
        end: { field: "last_frame_image" },
      },
      params: h3ScalarParams,
    },
    {
      /* text-to-video's own ratio enum has no "adaptive" value — that choice
         only makes sense once a reference decides the frame, so omit it and
         let the platform fall back to its own default. */
      apiId: "minimax/h3/text-to-video",
      params: { ...h3ScalarParams, aspectRatio: { field: "ratio", omit: ["adaptive"] } },
    },
  ],
};

export const minimaxVideo: readonly ModelEntry[] = [hailuo23Video, hailuo23FastVideo, h3Video];
