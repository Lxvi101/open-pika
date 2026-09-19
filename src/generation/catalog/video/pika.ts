import type { ModelEntry } from "../types";

/* Shared across the plain edit/animate operations: an output resolution, a
   random-or-fixed seed, and a negative prompt. Pikaffects (a named preset,
   not a free edit) does not take any of these. */
const pikaCommonParams = {
  resolution: "resolution",
  seed: { field: "seed", as: "number" },
  negativePrompt: "negative_prompt",
} as const;

const pikaCommonSettings = {
  resolution: { type: "enum", values: ["720p", "1080p"], default: "1080p" },
  seed: { type: "text", default: "", placeholder: "Random" },
  negativePrompt: { type: "text", default: "" },
} as const;

/* Duration is a 5 | 10 second integer enum on every op that has it; Pika
   sends it as a number, the studio shows it as a string enum. */
const pikaDuration = { type: "enum", values: ["5", "10"], default: "5" } as const;

/** Pika 2.5: animate a still (image-to-video, optional prompt) or generate
    from words alone (text-to-video, prompt required, fixed 5s). The image
    variant is more specific, so it leads; text-only is the fallback. */
export const pika25Video: ModelEntry = {
  id: "pika-2.5",
  surface: "video",
  label: "Pika 2.5",
  vendor: "pika",
  prompt: "optional",
  roles: { start: 1 },
  settings: {
    ...pikaCommonSettings,
    duration: pikaDuration,
  },
  operations: [
    {
      apiId: "pika/pika-2.5/image-to-video",
      media: { start: { field: "image", required: true } },
      params: { ...pikaCommonParams, duration: { field: "duration_s", as: "number" } },
    },
    {
      apiId: "pika/pika-2.5/text-to-video",
      /* duration_s is a const 5 for this op; leave it unwritten and let the
         platform default apply rather than risk sending 10. */
      params: pikaCommonParams,
    },
  ],
};

/** Pikadditions: add a described (optionally pictured) subject into a video.
    Its own tool, own entry. */
export const pikadditionsVideo: ModelEntry = {
  id: "pikadditions",
  surface: "video",
  label: "Pikadditions",
  vendor: "pika",
  description: "Add a described subject into a source video",
  roles: { video: 1, reference: 1 },
  settings: {
    ...pikaCommonSettings,
    duration: pikaDuration,
  },
  operations: [
    {
      apiId: "pika/pikadditions/video-to-video",
      media: {
        video: { field: "video", required: true },
        reference: { field: "image" },
      },
      params: { ...pikaCommonParams, duration: { field: "duration_s", as: "number" } },
    },
  ],
};

/** Pikaswaps: replace a region of a video, named by text and/or shown by a
    reference image. The schema also takes a mask image
    (`modify_region_mask`) as a second way to pick the region, but roles only
    has one reference slot and `image` (the replacement subject's likeness)
    is the more broadly useful binding for it, so the mask field is left out. */
export const pikaswapsVideo: ModelEntry = {
  id: "pikaswaps",
  surface: "video",
  label: "Pikaswaps",
  vendor: "pika",
  description: "Replace a region of a source video",
  roles: { video: 1, reference: 1 },
  settings: {
    ...pikaCommonSettings,
    duration: pikaDuration,
    modifyRegionRoi: { type: "text", default: "", placeholder: "Region to replace" },
  },
  operations: [
    {
      apiId: "pika/pikaswaps/video-to-video",
      media: {
        video: { field: "video", required: true },
        reference: { field: "image" },
      },
      params: {
        ...pikaCommonParams,
        duration: { field: "duration_s", as: "number" },
        modifyRegionRoi: "modify_region_roi",
      },
    },
  ],
};

/* Pikaffects' two functions share a name but nothing else: the image and
   video variants each pick from their own, disjoint list of named presets,
   so a single "mode" setting can't serve both (a value valid for one would
   be rejected by the other). Split by media type instead — README calls out
   "effects" by name as a case that earns its own entry per function. */

const PIKAFFECTS_IMAGE_MODES = [
  "90s Me",
  "Action Me",
  "Arcade Winner",
  "Baby Me",
  "Bald Me",
  "Balloonify it",
  "CCTV Me",
  "Cake-ify",
  "Captain Me",
  "Choco Me",
  "Classy Me",
  "Clown Fit",
  "Crazy in Love",
  "Crumble",
  "Crush",
  "Cupid Strike",
  "Decapitate",
  "Deflate",
  "Dissolve",
  "Doom Stroll",
  "Eat a Rat",
  "Epic Me",
  "Everythings Bonsai",
  "Explode",
  "Eye-pop",
  "Eyes Zoom in",
  "Fairytale Me",
  "Goth Dream",
  "Hazmat Fit",
  "Hearts Bouquet",
  "Hero Me",
  "Human Pet",
  "Inflate",
  "Jungle Me",
  "Labubu Style",
  "Leprechaun Me",
  "Levitate",
  "Lo-Fi Me",
  "Looong Hair",
  "Love Bomb",
  "Magic Polaroid",
  "Make it Real",
  "Melt",
  "Mona Me",
  "Mrs Me",
  "Museum Me",
  "Peel",
  "Pick Me",
  "Poke",
  "Princess Me",
  "Proposal",
  "Puppy Me",
  "Rose",
  "Royal Me",
  "Squish",
  "Ta-da",
  "Tarot Transform",
  "Tear",
  "VIP Me",
  "Warrior Me",
  "Yarn Charm",
  "Zen Me",
] as const;

const PIKAFFECTS_VIDEO_MODES = [
  "Anime Cat",
  "Cute Shroom",
  "Duplicate it",
  "Happy Asteroid",
  "Its Alive",
  "Its Computer",
  "Pink Hair",
  "Swan Head",
  "Wizard Cat",
] as const;

/** Pikaffects on an image: apply a named preset effect. No free prompt field
    — `prompt_override` is an advanced escape hatch into the preset's own
    editable recipe, not a description of the shot. */
export const pikaffectsImageVideo: ModelEntry = {
  id: "pikaffects-image",
  surface: "video",
  label: "Pikaffects (Image)",
  vendor: "pika",
  description: "Apply a named preset effect to an image",
  prompt: "none",
  roles: { start: 1 },
  settings: {
    /* Schema has no default for this required enum; the first listed
       preset is as good a starting selection as any. */
    mode: { type: "enum", values: PIKAFFECTS_IMAGE_MODES, default: PIKAFFECTS_IMAGE_MODES[0] },
    seed: { type: "text", default: "", placeholder: "Random" },
    promptOverride: { type: "text", default: "", multiline: true },
  },
  operations: [
    {
      apiId: "pika/pikaffects/image-to-video",
      prompt: null,
      media: { start: { field: "image", required: true } },
      params: {
        mode: "pikaffect",
        seed: { field: "seed", as: "number" },
        promptOverride: "prompt_override",
      },
    },
  ],
};

/** Pikaffects on a video: same idea, a smaller and entirely different preset
    list, no prompt override. */
export const pikaffectsVideoVideo: ModelEntry = {
  id: "pikaffects-video",
  surface: "video",
  label: "Pikaffects (Video)",
  vendor: "pika",
  description: "Apply a named preset effect to a video",
  prompt: "none",
  roles: { video: 1 },
  settings: {
    mode: { type: "enum", values: PIKAFFECTS_VIDEO_MODES, default: PIKAFFECTS_VIDEO_MODES[0] },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "pika/pikaffects/video-to-video",
      prompt: null,
      media: { video: { field: "video", required: true } },
      params: { mode: "pikaffect", seed: { field: "seed", as: "number" } },
    },
  ],
};

/** Pikaframes: animate through 2-5 ordered keyframes in one shot. The
    `images` field is a single flat ordered array (no separate start/end
    fields to interpolate between), so it binds directly to `reference` with
    `many: true` — no `build()` needed. */
export const pikaframesVideo: ModelEntry = {
  id: "pikaframes",
  surface: "video",
  label: "Pika 2.5 Keyframe",
  vendor: "pika",
  description: "Animate between 2-5 ordered keyframes",
  prompt: "optional",
  roles: { reference: 5 },
  settings: {
    ...pikaCommonSettings,
    transitionDurationS: { type: "range", min: 1, max: 10, default: 5 },
  },
  operations: [
    {
      apiId: "pika/pikaframes/image-to-video",
      media: { reference: { field: "images", many: true, required: true } },
      params: { ...pikaCommonParams, transitionDurationS: "transition_duration_s" },
    },
  ],
};

export const pikaVideo: readonly ModelEntry[] = [
  pika25Video,
  pikadditionsVideo,
  pikaswapsVideo,
  pikaffectsImageVideo,
  pikaffectsVideoVideo,
  pikaframesVideo,
];
