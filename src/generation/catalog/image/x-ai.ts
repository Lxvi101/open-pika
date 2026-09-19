import type { ModelEntry } from "../types";

/* The Quality and base tiers share one aspect-ratio catalog; 2.0 adds two
   ultra-wide ratios (21:9, 5:2) the older tiers don't offer. Every schema
   defaults to "1:1" on text-to-image but "auto" on image-to-image — since one
   entry covers both functions, "auto" (a real, sendable value in every tier)
   is the shared default: it preserves the source image's shape when editing
   and still lets the model pick freely with nothing attached. */
const GROK_ASPECT = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "1:2",
  "2:1",
  "auto",
] as const;

const GROK_2_ASPECT = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "1:2",
  "2:1",
  "21:9",
  "5:2",
  "auto",
] as const;

const GROK_RESOLUTION = ["1K", "2K"] as const;

/* Every tier writes resolution, aspect ratio and the batch count the same
   way on both functions. */
const grokParams = {
  resolution: "resolution",
  aspectRatio: "aspect_ratio",
  numImages: "num_images",
} as const;

/* 2.0 alone exposes a low/medium quality dial (its schema default is `null`,
   but "auto" is itself a legal value, so it is sent explicitly rather than
   omitted). */
const grok2Params = {
  ...grokParams,
  quality: "quality",
} as const;

export const grokImagineImage2: ModelEntry = {
  id: "grok-imagine-image-2.0",
  surface: "image",
  label: "Grok Imagine Image 2.0",
  vendor: "x-ai",
  roles: { reference: 5 },
  settings: {
    resolution: { type: "enum", values: GROK_RESOLUTION, default: "1K" },
    aspectRatio: { type: "enum", values: GROK_2_ASPECT, default: "auto" },
    numImages: { type: "range", min: 1, max: 10, default: 1 },
    quality: { type: "enum", values: ["low", "medium", "auto"], default: "auto" },
  },
  operations: [
    {
      apiId: "x-ai/grok-imagine-image-2.0/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: grok2Params,
    },
    {
      apiId: "x-ai/grok-imagine-image-2.0/text-to-image",
      params: grok2Params,
    },
  ],
};

export const grokImagineImageQuality: ModelEntry = {
  id: "grok-imagine-image-quality",
  surface: "image",
  label: "Grok Imagine Image Quality",
  vendor: "x-ai",
  roles: { reference: 3 },
  settings: {
    resolution: { type: "enum", values: GROK_RESOLUTION, default: "1K" },
    aspectRatio: { type: "enum", values: GROK_ASPECT, default: "auto" },
    numImages: { type: "range", min: 1, max: 10, default: 1 },
  },
  operations: [
    {
      apiId: "x-ai/grok-imagine-image-quality/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: grokParams,
    },
    {
      apiId: "x-ai/grok-imagine-image-quality/text-to-image",
      params: grokParams,
    },
  ],
};

export const grokImagineImage: ModelEntry = {
  id: "grok-imagine-image",
  surface: "image",
  label: "Grok Imagine Image",
  vendor: "x-ai",
  roles: { reference: 3 },
  settings: {
    resolution: { type: "enum", values: GROK_RESOLUTION, default: "1K" },
    aspectRatio: { type: "enum", values: GROK_ASPECT, default: "auto" },
    numImages: { type: "range", min: 1, max: 10, default: 1 },
  },
  operations: [
    {
      apiId: "x-ai/grok-imagine-image/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: grokParams,
    },
    {
      apiId: "x-ai/grok-imagine-image/text-to-image",
      params: grokParams,
    },
  ],
};

/* Newest tier first. */
export const xaiImage: readonly ModelEntry[] = [
  grokImagineImage2,
  grokImagineImageQuality,
  grokImagineImage,
];
