import type { ModelEntry } from "../types";

const GROK_ASPECT = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;

/* Shared by every Grok Imagine op that takes them (video-to-video takes
   none of these three: its output inherits the source clip's length, ratio
   and resolution). */
const grokParams = {
  duration: "duration",
  aspectRatio: "aspect_ratio",
  resolution: "resolution",
} as const;

/* A start frame brings its own shape: sending a ratio would crop it, and
   leaving the field out lets the platform read it from the image. */
const grokImageParams = { duration: "duration", resolution: "resolution" } as const;

const grokSettings = {
  duration: { type: "range", min: 1, max: 15, default: 6 },
  aspectRatio: { type: "enum", values: GROK_ASPECT, default: "16:9" },
  resolution: { type: "enum", values: ["480p", "720p"], default: "720p" },
} as const;

/** Grok Imagine: words alone, a start frame, up to three reference images,
    or a source clip to re-render — four functions, four disjoint
    attachments, one entry. Video editing is the only function that drops
    duration/aspect/resolution (it inherits the source clip's), so its
    params omit them. */
export const grokImagineVideo: ModelEntry = {
  id: "grok-imagine-video",
  surface: "video",
  label: "Grok Imagine",
  vendor: "x-ai",
  roles: { start: 1, reference: 3, video: 1 },
  settings: grokSettings,
  operations: [
    {
      apiId: "x-ai/grok-imagine-video/image-to-video",
      media: { start: { field: "image_url", required: true } },
      params: grokImageParams,
    },
    {
      apiId: "x-ai/grok-imagine-video/reference-to-video",
      media: { reference: { field: "reference_image_urls", many: true, required: true } },
      params: grokParams,
    },
    {
      apiId: "x-ai/grok-imagine-video/video-to-video",
      media: { video: { field: "video_url", required: true } },
    },
    {
      apiId: "x-ai/grok-imagine-video/text-to-video",
      params: grokParams,
    },
  ],
};

/** Grok Imagine 1.5: currently exposes only image-to-video, same shape as
    the base model's. A separate model line (its own pricing and api_id),
    so its own entry rather than a split of the above. */
export const grokImagineVideo15: ModelEntry = {
  id: "grok-imagine-video-1.5",
  surface: "video",
  label: "Grok Imagine 1.5",
  vendor: "x-ai",
  roles: { start: 1 },
  settings: grokSettings,
  operations: [
    {
      apiId: "x-ai/grok-imagine-video-1.5/image-to-video",
      media: { start: { field: "image_url", required: true } },
      params: grokImageParams,
    },
  ],
};

export const xaiVideo: readonly ModelEntry[] = [grokImagineVideo, grokImagineVideo15];
