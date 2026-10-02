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

const IDEOGRAM45_SIZES = [
  "auto", "2048x2048", "1440x2880", "2880x1440", "1664x2496", "2496x1664",
  "1792x2240", "2240x1792", "1440x2560", "2560x1440", "1600x2560", "2560x1600",
  "1728x2304", "2304x1728", "1296x3168", "3168x1296", "1152x2944", "2944x1152",
  "1248x3328", "3328x1248", "1280x3072", "3072x1280", "1024x3072", "3072x1024",
  "1024x1024", "896x1120", "1120x896", "864x1152", "1152x864", "832x1248",
  "1248x832", "800x1280", "1280x800", "720x1280", "1280x720", "720x1440", "1440x720",
] as const;

export const ideogram45Text: ModelEntry = {
  id: "ideogram-4.5",
  surface: "image",
  label: "Ideogram 4.5",
  vendor: "ideogram",
  roles: {},
  settings: {
    quality: { type: "enum", values: ["low", "medium", "high"], default: "high" },
    size: { type: "enum", values: IDEOGRAM45_SIZES, default: "auto" },
    magicPrompt: { type: "enum", values: ["auto", "on", "off"], default: "auto" },
    numImages: { type: "range", min: 1, max: 8, default: 1, step: 1 },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "ideogram/ideogram-4.5/text-to-image",
      params: {
        quality: "quality",
        size: "size",
        magicPrompt: "magic_prompt",
        numImages: { field: "num_images", as: "number" },
        seed: { field: "seed", as: "number" },
      },
    },
  ],
};

export const ideogram45Image: ModelEntry = {
  id: "ideogram-4.5-image-to-image",
  surface: "image",
  label: "Ideogram 4.5 Edit",
  vendor: "ideogram",
  roles: { reference: 5 },
  settings: {
    quality: { type: "enum", values: ["very_low", "low", "medium", "high"], default: "medium" },
    size: {
      type: "text",
      default: "",
      placeholder: "auto, source, or WIDTHxHEIGHT (not with a mask)",
    },
    numImages: { type: "range", min: 1, max: 8, default: 1, step: 1 },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "ideogram/ideogram-4.5/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: {
        quality: "quality",
        size: "size",
        numImages: { field: "num_images", as: "number" },
        seed: { field: "seed", as: "number" },
      },
      build: (plane, body) => {
        const count = plane.media.reference?.length ?? 0;
        if (count < 1 || count > 5) throw new Error("Ideogram 4.5 Edit needs 1–5 ordered images");
        const size = plane.settings.size;
        if (typeof size === "string" && size.trim() && size !== "auto" && size !== "source") {
          const match = /^(\d+)x(\d+)$/.exec(size.trim());
          if (!match) throw new Error("Image size must be auto, source, or WIDTHxHEIGHT");
          const width = Number(match[1]);
          const height = Number(match[2]);
          if (width < 256 || height < 256 || width % 32 || height % 32 || width * height > 4_194_304 ||
            Math.max(width / height, height / width) > 6) {
            throw new Error("Custom image size needs dimensions in multiples of 32, at least 256 pixels, within 4,194,304 pixels and a 6:1 ratio");
          }
        }
        return body;
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

export const ideogramImage: readonly ModelEntry[] = [
  ideogram40,
  ideogram40Transparent,
  ideogram45Text,
  ideogram45Image,
  pImage,
];
