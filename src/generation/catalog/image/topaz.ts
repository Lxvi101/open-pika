import type { ModelEntry } from "../types";

const TOPAZ_UPSCALE_FACTOR = ["x2", "x3", "x4"] as const;
const TOPAZ_OUTPUT_FORMAT = ["jpeg", "png"] as const;

/* One endpoint, ten enhancement models behind the `model` field: five
   "standard" models that stay true to the input, five generative ones that
   add synthesized detail at a higher price. The rest of the schema is
   per-model fine-tuning a visitor reaching for "upscale this" doesn't need —
   face recovery strength/creativity, sharpen, denoise, compression fix,
   overall strength, and the generative prompt/autoprompt/creativity/texture/
   detail knobs — the platform auto-configures all of it when omitted. */
const TOPAZ_MODEL = [
  "standard-v2",
  "low-resolution-v2",
  "cgi",
  "high-fidelity-v2",
  "text-refine",
  "redefine",
  "standard-max",
  "wonder",
  "wonder-3",
  "wonder-3.5",
] as const;

export const topazImageUpscale: ModelEntry = {
  id: "topaz-image-upscale",
  surface: "image",
  label: "Topaz Image Upscale",
  vendor: "topaz",
  description: "Enlarge and enhance an image",
  /* The schema's `prompt` only steers the generative models (and is dropped
     entirely for wonder-3/wonder-3.5), so words are welcome but never
     required. */
  prompt: "optional",
  roles: { reference: 1 },
  settings: {
    upscaleFactor: { type: "enum", values: TOPAZ_UPSCALE_FACTOR, default: "x2" },
    model: { type: "enum", values: TOPAZ_MODEL, default: "standard-v2" },
    outputFormat: { type: "enum", values: TOPAZ_OUTPUT_FORMAT, default: "jpeg" },
  },
  operations: [
    {
      apiId: "topaz/topaz-image-upscale/image-upscale",
      media: { reference: { field: "image_url", required: true } },
      params: {
        upscaleFactor: "upscale_factor",
        model: "model",
        outputFormat: "output_format",
      },
    },
  ],
};

export const topazImage: readonly ModelEntry[] = [topazImageUpscale];
