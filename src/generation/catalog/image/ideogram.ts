import type { ModelEntry } from "../types";

/* Ideogram bills and renders on a speed tier rather than a generic quality
   slider, but it's the same slower-for-better trade-off that setting name
   covers elsewhere. Shared because ideogram-4.0 and its transparent sibling
   expose the identical three tiers. */
const RENDERING_SPEED = ["TURBO", "DEFAULT", "QUALITY"] as const;

export const ideogram40: ModelEntry = {
  id: "ideogram-4.0",
  surface: "image",
  label: "Ideogram 4.0",
  vendor: "ideogram",
  roles: {},
  settings: {
    quality: { type: "enum", values: RENDERING_SPEED, default: "DEFAULT" },
    /* The schema's own "resolution" is 40 exact WxH pairs and no separate
       aspect ratio field; a curated, aspect-varied slice keeps the rail
       usable while staying inside the schema's allowed values. */
    size: {
      type: "enum",
      values: ["2048x2048", "1024x1024", "864x1152", "1152x864", "720x1280", "1280x720"],
      default: "1024x1024",
    },
  },
  operations: [
    {
      apiId: "ideogram/ideogram-4.0/text-to-image",
      prompt: "text_prompt",
      params: { quality: "rendering_speed", size: "resolution" },
    },
  ],
};

export const ideogram40Transparent: ModelEntry = {
  id: "ideogram-4.0-transparent",
  surface: "image",
  label: "Ideogram 4.0 Transparent",
  vendor: "ideogram",
  roles: {},
  settings: {
    quality: { type: "enum", values: RENDERING_SPEED, default: "DEFAULT" },
    aspectRatio: {
      type: "enum",
      values: ["AUTO", "9x16", "3x4", "1x1", "4x3", "16x9"],
      default: "AUTO",
    },
    resolution: { type: "enum", values: ["1K", "2K", "4K", "8K"], default: "1K" },
  },
  operations: [
    {
      apiId: "ideogram/ideogram-4.0-transparent/text-to-image",
      prompt: "text_prompt",
      params: {
        quality: "rendering_speed",
        aspectRatio: "aspect_ratio",
        resolution: "output_resolution",
      },
    },
  ],
};

export const pImage: ModelEntry = {
  id: "p-image",
  surface: "image",
  label: "P-Image",
  vendor: "ideogram",
  roles: {},
  settings: {
    quality: { type: "enum", values: ["VERY_LOW", "LOW", "MEDIUM", "HIGH"], default: "MEDIUM" },
    resolution: { type: "enum", values: ["1K", "2K"], default: "1K" },
    aspectRatio: {
      type: "enum",
      values: ["1x1", "4x3", "3x4", "16x9", "9x16", "3x2", "2x3"],
      default: "1x1",
    },
    enhancePrompt: { type: "enum", values: ["AUTO", "ON", "OFF"], default: "AUTO" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "ideogram/p-image/text-to-image",
      params: {
        quality: "quality",
        resolution: "resolution",
        aspectRatio: "aspect_ratio",
        enhancePrompt: "prompt_upsampling",
        seed: { field: "seed", as: "number" },
      },
    },
  ],
};

export const ideogramImage: readonly ModelEntry[] = [ideogram40, ideogram40Transparent, pImage];
