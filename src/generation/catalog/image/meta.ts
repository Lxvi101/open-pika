import type { ModelEntry } from "../types";

/* `size` is a freeform "WxH" string on the platform (only the ratio is read,
   the magnitude is ignored) rather than a schema enum, so these are the
   catalog's own examples rather than an exhaustive value list. */
const MUSE_SIZE = ["auto", "1x1", "16x9", "9x16", "4x3", "3x2", "21x9"] as const;
const MUSE_OUTPUT_FORMAT = ["png", "jpeg", "webp"] as const;

/* Both functions take the same knobs. `reasoning_strength` is priced the same
   either way — it trades refinement passes for speed rather than gating a
   price tier — so it gets its own name instead of the shared `quality` key.
   The built-in web/image/shell grounding toggles (`tool_enablement`) are left
   off the rail: they're a behind-the-scenes accuracy-vs-speed trade the model
   makes for itself, not a creative choice a visitor reaches for. */
const museParams = {
  size: "size",
  numImages: "num_images",
  outputFormat: "output_format",
  reasoningStrength: "reasoning_strength",
} as const;

export const museImage: ModelEntry = {
  id: "muse-image-1.0",
  surface: "image",
  label: "Muse Image",
  vendor: "meta",
  roles: { reference: 10 },
  settings: {
    size: { type: "enum", values: MUSE_SIZE, default: "auto" },
    numImages: { type: "range", min: 1, max: 10, default: 1 },
    outputFormat: { type: "enum", values: MUSE_OUTPUT_FORMAT, default: "webp" },
    reasoningStrength: { type: "enum", values: ["low", "high"], default: "high" },
  },
  operations: [
    {
      apiId: "meta/muse-image-1.0/image-to-image",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: museParams,
    },
    {
      apiId: "meta/muse-image-1.0/text-to-image",
      params: museParams,
    },
  ],
};

export const metaImage: readonly ModelEntry[] = [museImage];
