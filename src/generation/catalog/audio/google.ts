import type { ModelEntry } from "../types";

/* Lyria 3, 3.5, and 3-pro take nothing but a prompt: length, BPM, structure,
   and lyrics are all driven by the words the visitor types (timestamp ranges
   and [Verse]/[Chorus] tags for 3 and 3.5), and the schemas carry no other
   field at all — no duration, seed, or negative prompt. */
export const lyria3Pro: ModelEntry = {
  id: "lyria-3-pro",
  surface: "audio",
  label: "Lyria 3 Pro",
  vendor: "google",
  roles: {},
  settings: {},
  operations: [{ apiId: "google/lyria-3-pro/text-to-audio" }],
};

export const lyria35: ModelEntry = {
  id: "lyria-3.5",
  surface: "audio",
  label: "Lyria 3.5",
  vendor: "google",
  roles: {},
  settings: {},
  operations: [{ apiId: "google/lyria-3.5/text-to-audio" }],
};

export const lyria3: ModelEntry = {
  id: "lyria-3",
  surface: "audio",
  label: "Lyria 3",
  vendor: "google",
  roles: {},
  settings: {},
  operations: [{ apiId: "google/lyria-3/text-to-audio" }],
};

/* Sound effects, not music: a separate Lyria 2 function with its own schema
   (negative prompt, seed). `sample_count` is capped at 1 by the schema
   (minimum and maximum both 1) — not a real choice, so it is left off the
   rail entirely, the same way Flash Lite's constant `resolution` is. */
export const lyria2: ModelEntry = {
  id: "lyria-2",
  surface: "audio",
  label: "Lyria 2",
  vendor: "google",
  description: "Short sound effects and ambience, not music",
  roles: {},
  settings: {
    negativePrompt: { type: "text", default: "" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "google/lyria-2/sound-effects",
      params: {
        negativePrompt: "negative_prompt",
        seed: { field: "seed", as: "number" },
      },
    },
  ],
};

export const googleAudio: readonly ModelEntry[] = [lyria3Pro, lyria35, lyria3, lyria2];
