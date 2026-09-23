import type { ModelEntry } from "../types";

/* All four Seedream models take num_images (1-6), an output size and a
   reproducible seed the same way; 5.0 Lite and 5.0 Pro additionally take an
   aspect ratio hint for when the prompt doesn't imply one. */
const seedreamBasicParams = {
  numImages: "num_images",
  size: "size",
  seed: { field: "seed", as: "number" },
} as const;

const seedreamAspectParams = {
  ...seedreamBasicParams,
  aspectRatio: "aspect_ratio",
} as const;

const SEEDREAM_ASPECT = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"] as const;

export const seedream50Pro: ModelEntry = {
  id: "seedream-5.0-pro",
  surface: "image",
  label: "Seedream 5.0 Pro",
  vendor: "bytedance",
  roles: { reference: 10 },
  settings: {
    numImages: { type: "range", min: 1, max: 6, default: 1 },
    size: { type: "enum", values: ["1K", "1.5K", "2K"], default: "2K" },
    aspectRatio: { type: "enum", values: SEEDREAM_ASPECT, default: "1:1" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "bytedance/seedream-5.0-pro/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: seedreamAspectParams,
    },
    {
      apiId: "bytedance/seedream-5.0-pro/text-to-image",
      params: seedreamAspectParams,
    },
  ],
};

export const seedream50Lite: ModelEntry = {
  id: "seedream-5.0-lite",
  surface: "image",
  label: "Seedream 5.0 Lite",
  vendor: "bytedance",
  roles: { reference: 14 },
  settings: {
    numImages: { type: "range", min: 1, max: 6, default: 1 },
    size: { type: "enum", values: ["2K", "3K", "4K"], default: "2K" },
    aspectRatio: { type: "enum", values: SEEDREAM_ASPECT, default: "1:1" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "bytedance/seedream-5.0-lite/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: seedreamAspectParams,
    },
    {
      apiId: "bytedance/seedream-5.0-lite/text-to-image",
      params: seedreamAspectParams,
    },
  ],
};

export const seedream45: ModelEntry = {
  id: "seedream-4.5",
  surface: "image",
  label: "Seedream 4.5",
  vendor: "bytedance",
  roles: {},
  settings: {
    numImages: { type: "range", min: 1, max: 6, default: 1 },
    size: { type: "enum", values: ["2K", "4K"], default: "2K" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "bytedance/seedream-4.5/text-to-image",
      params: seedreamBasicParams,
    },
  ],
};

export const seedream40: ModelEntry = {
  id: "seedream-4.0",
  surface: "image",
  label: "Seedream 4.0",
  vendor: "bytedance",
  roles: { reference: 10 },
  settings: {
    numImages: { type: "range", min: 1, max: 6, default: 1 },
    size: { type: "enum", values: ["1K", "2K", "4K"], default: "1K" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "bytedance/seedream-4.0/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: seedreamBasicParams,
    },
    {
      apiId: "bytedance/seedream-4.0/text-to-image",
      params: seedreamBasicParams,
    },
  ],
};

export const bytedanceImage: readonly ModelEntry[] = [
  seedream50Pro,
  seedream50Lite,
  seedream45,
  seedream40,
];
