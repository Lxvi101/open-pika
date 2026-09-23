import type { ModelEntry } from "../types";

const OPENAI_ASPECT_RATIO = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

const OPENAI_OUTPUT_FORMAT = ["png", "jpeg", "webp"] as const;
const OPENAI_BACKGROUND = ["auto", "opaque", "transparent"] as const;

/* Every GPT Image model and both its functions (edit, generate) share this
   exact field set. `size` (an explicit "WxH" string that overrides both
   aspect_ratio and resolution) and `mask_image_url` are left off the rail:
   `size` would fight with aspectRatio/resolution for the same decision, and
   a mask can't be expressed by the role vocabulary (roles is a set of image
   attachments, not "this one is a mask"). */
const openaiImageParams = {
  numImages: "num_images",
  aspectRatio: "aspect_ratio",
  outputFormat: "output_format",
  resolution: "resolution",
  background: "background",
  quality: "quality",
} as const;

export const gptImage2: ModelEntry = {
  id: "gpt-image-2",
  surface: "image",
  label: "GPT Image 2",
  vendor: "openai",
  roles: { reference: 16 },
  settings: {
    numImages: { type: "range", min: 1, max: 10, default: 1 },
    aspectRatio: { type: "enum", values: OPENAI_ASPECT_RATIO, default: "1:1" },
    outputFormat: { type: "enum", values: OPENAI_OUTPUT_FORMAT, default: "png" },
    resolution: { type: "enum", values: ["1K", "2K", "4K"], default: "1K" },
    background: { type: "enum", values: OPENAI_BACKGROUND, default: "auto" },
    quality: { type: "enum", values: ["auto", "low", "medium", "high"], default: "medium" },
  },
  operations: [
    {
      apiId: "openai/gpt-image-2/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: openaiImageParams,
    },
    {
      apiId: "openai/gpt-image-2/text-to-image",
      params: openaiImageParams,
    },
  ],
};

export const gptImage25Flare: ModelEntry = {
  id: "gpt-image-2.5-flare",
  surface: "image",
  label: "GPT Image 2.5 Flare",
  vendor: "openai",
  roles: { reference: 16 },
  settings: {
    numImages: { type: "range", min: 1, max: 10, default: 1 },
    aspectRatio: { type: "enum", values: OPENAI_ASPECT_RATIO, default: "1:1" },
    outputFormat: { type: "enum", values: OPENAI_OUTPUT_FORMAT, default: "png" },
    resolution: { type: "enum", values: ["1K", "2K", "4K"], default: "1K" },
    background: { type: "enum", values: OPENAI_BACKGROUND, default: "auto" },
    quality: { type: "enum", values: ["low", "medium", "high", "xhigh", "max"], default: "medium" },
  },
  operations: [
    {
      apiId: "openai/gpt-image-2.5-flare/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: openaiImageParams,
    },
    {
      apiId: "openai/gpt-image-2.5-flare/text-to-image",
      params: openaiImageParams,
    },
  ],
};

export const gptImage25Sunburst: ModelEntry = {
  id: "gpt-image-2.5-sunburst",
  surface: "image",
  label: "GPT Image 2.5 Sunburst",
  vendor: "openai",
  roles: { reference: 16 },
  settings: {
    numImages: { type: "range", min: 1, max: 10, default: 1 },
    aspectRatio: { type: "enum", values: OPENAI_ASPECT_RATIO, default: "1:1" },
    outputFormat: { type: "enum", values: OPENAI_OUTPUT_FORMAT, default: "png" },
    resolution: { type: "enum", values: ["1K", "2K", "4K"], default: "1K" },
    background: { type: "enum", values: OPENAI_BACKGROUND, default: "auto" },
    quality: { type: "enum", values: ["low", "medium", "high", "xhigh", "max"], default: "medium" },
  },
  operations: [
    {
      apiId: "openai/gpt-image-2.5-sunburst/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: openaiImageParams,
    },
    {
      apiId: "openai/gpt-image-2.5-sunburst/text-to-image",
      params: openaiImageParams,
    },
  ],
};

export const openaiImage: readonly ModelEntry[] = [gptImage2, gptImage25Flare, gptImage25Sunburst];
