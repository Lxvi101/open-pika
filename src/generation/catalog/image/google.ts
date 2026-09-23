import type { ModelEntry } from "../types";

const GOOGLE_ASPECT_RATIO = [
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
  "auto",
] as const;

const GOOGLE_OUTPUT_FORMAT = ["png", "jpeg", "webp"] as const;

/* Shared by every Gemini image model: aspect ratio and output format never
   change field or value set across the family. Resolution and thinking level
   are added per model below, where the schemas actually diverge. */
const geminiBaseParams = {
  aspectRatio: "aspect_ratio",
  outputFormat: "output_format",
} as const;

const geminiProParams = {
  ...geminiBaseParams,
  resolution: "resolution",
} as const;

const geminiFlashParams = {
  ...geminiBaseParams,
  resolution: "resolution",
  thinkingLevel: "thinking_level",
} as const;

/* Flash Lite's `resolution` is a schema `const` of "1K" — not a real choice,
   so it is left off the rail entirely (only aspect ratio, format, and
   thinking level are). */
const geminiFlashLiteParams = {
  ...geminiBaseParams,
  thinkingLevel: "thinking_level",
} as const;

export const geminiProImage: ModelEntry = {
  id: "gemini-3-pro-image",
  surface: "image",
  label: "Nano Banana Pro",
  vendor: "google",
  roles: { reference: 16 },
  settings: {
    aspectRatio: { type: "enum", values: GOOGLE_ASPECT_RATIO, default: "1:1" },
    outputFormat: { type: "enum", values: GOOGLE_OUTPUT_FORMAT, default: "png" },
    resolution: { type: "enum", values: ["1K", "2K", "4K"], default: "1K" },
  },
  operations: [
    {
      apiId: "google/gemini-3-pro-image/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: geminiProParams,
    },
    {
      apiId: "google/gemini-3-pro-image/text-to-image",
      params: geminiProParams,
    },
  ],
};

export const geminiFlashImage: ModelEntry = {
  id: "gemini-3.1-flash-image",
  surface: "image",
  label: "Nano Banana",
  vendor: "google",
  roles: { reference: 16 },
  settings: {
    aspectRatio: { type: "enum", values: GOOGLE_ASPECT_RATIO, default: "1:1" },
    outputFormat: { type: "enum", values: GOOGLE_OUTPUT_FORMAT, default: "png" },
    resolution: { type: "enum", values: ["512", "1K", "2K", "4K"], default: "1K" },
    thinkingLevel: { type: "enum", values: ["minimal", "high"], default: "minimal" },
  },
  operations: [
    {
      apiId: "google/gemini-3.1-flash-image/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: geminiFlashParams,
    },
    {
      apiId: "google/gemini-3.1-flash-image/text-to-image",
      params: geminiFlashParams,
    },
  ],
};

export const geminiFlashLiteImage: ModelEntry = {
  id: "gemini-3.1-flash-lite-image",
  surface: "image",
  label: "Gemini 3.1 Flash Lite Image",
  vendor: "google",
  roles: { reference: 16 },
  settings: {
    aspectRatio: { type: "enum", values: GOOGLE_ASPECT_RATIO, default: "1:1" },
    outputFormat: { type: "enum", values: GOOGLE_OUTPUT_FORMAT, default: "png" },
    thinkingLevel: { type: "enum", values: ["minimal", "high"], default: "minimal" },
  },
  operations: [
    {
      apiId: "google/gemini-3.1-flash-lite-image/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: geminiFlashLiteParams,
    },
    {
      apiId: "google/gemini-3.1-flash-lite-image/text-to-image",
      params: geminiFlashLiteParams,
    },
  ],
};

export const googleImage: readonly ModelEntry[] = [
  geminiProImage,
  geminiFlashImage,
  geminiFlashLiteImage,
];
