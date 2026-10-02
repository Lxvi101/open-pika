import type { GenerationPlane, ModelEntry } from "../types";

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

type ComposeTrack = {
  id: string;
  type: "video" | "image" | "audio";
  keyframes: Array<{ timestamp: number; duration: number; url: string }>;
};

function parseComposeTracks(plane: GenerationPlane): ComposeTrack[] {
  const raw = plane.settings.tracksJson;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error('Add timeline tracks as JSON, for example: [{"id":"main","type":"video","keyframes":[{"timestamp":0,"duration":5000,"url":"https://…"}]}]');
  }
  let tracks: unknown;
  try {
    tracks = JSON.parse(raw);
  } catch {
    throw new Error("Timeline tracks must be valid JSON");
  }
  if (!Array.isArray(tracks) || tracks.length < 1 || tracks.length > 8) {
    throw new Error("Pika Compose needs 1–8 timeline tracks");
  }
  let keyframeCount = 0;
  let hasVisualTrack = false;
  const ids = new Set<string>();
  for (const candidate of tracks) {
    if (!isObject(candidate) || typeof candidate.id !== "string" || !candidate.id.trim() || candidate.id.length > 64) {
      throw new Error("Each track needs a unique ID between 1 and 64 characters");
    }
    if (ids.has(candidate.id)) throw new Error(`Track ID ${candidate.id} is repeated`);
    ids.add(candidate.id);
    if (Object.keys(candidate).some((key) => !["id", "type", "keyframes"].includes(key))) {
      throw new Error(`Track ${candidate.id} has a field the Pika Compose schema does not accept`);
    }
    if (candidate.type !== "video" && candidate.type !== "image" && candidate.type !== "audio") {
      throw new Error(`Track ${candidate.id} type must be video, image, or audio`);
    }
    if (candidate.type !== "audio") hasVisualTrack = true;
    if (!Array.isArray(candidate.keyframes) || candidate.keyframes.length < 1 || candidate.keyframes.length > 32) {
      throw new Error(`Track ${candidate.id} needs 1–32 keyframes`);
    }
    keyframeCount += candidate.keyframes.length;
    let end = -1;
    for (const frame of candidate.keyframes) {
      if (!isObject(frame) || !Number.isFinite(frame.timestamp) || (frame.timestamp as number) < 0 ||
        !Number.isFinite(frame.duration) || (frame.duration as number) < 1 ||
        typeof frame.url !== "string" || frame.url.length > 4096 || !/^https?:\/\//.test(frame.url)) {
        throw new Error(`Track ${candidate.id} keyframes need timestamp, duration, and an HTTP(S) media URL`);
      }
      if (Object.keys(frame).some((key) => !["timestamp", "duration", "url"].includes(key))) {
        throw new Error(`Track ${candidate.id} keyframes accept only timestamp, duration, and url`);
      }
      if ((frame.timestamp as number) < end) throw new Error(`Track ${candidate.id} keyframes cannot overlap`);
      end = (frame.timestamp as number) + (frame.duration as number);
      if (end > 1_200_000) throw new Error("Pika Compose timeline must end within 1,200,000 ms");
    }
  }
  if (keyframeCount > 32) throw new Error("Pika Compose supports at most 32 keyframes across all tracks");
  if (!hasVisualTrack) throw new Error("Pika Compose needs at least one video or image track");
  return tracks as ComposeTrack[];
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function composeVideo(plane: GenerationPlane, body: Record<string, unknown>) {
  return { ...body, tracks: parseComposeTracks(plane) };
}

function mergeVideos(plane: GenerationPlane, body: Record<string, unknown>) {
  const videos = body.videos;
  if (!Array.isArray(videos) || videos.length < 2 || videos.length > 10) {
    throw new Error("Pika Merge needs 2–10 video clips, arranged in playback order");
  }
  const rawFps = plane.settings.targetFps;
  if (rawFps !== undefined && rawFps !== "") {
    const fps = Number(rawFps);
    if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error("Target frame rate must be between 1 and 60");
    body.target_fps = fps;
  }
  const rawIndex = plane.settings.referenceVideoIndex;
  if (rawIndex !== undefined && rawIndex !== "") {
    const index = Number(rawIndex);
    if (!Number.isInteger(index)) throw new Error("Reference clip index must be a whole number");
    body.reference_video_index = index;
  }
  const resolution = body.resolution;
  const referenceVideoIndex = body.reference_video_index;
  if (resolution && referenceVideoIndex !== undefined) {
    throw new Error("Choose either an output resolution or a reference clip, not both");
  }
  if (referenceVideoIndex !== undefined &&
    (!Number.isInteger(referenceVideoIndex) || Number(referenceVideoIndex) < 0 || Number(referenceVideoIndex) >= videos.length)) {
    throw new Error("Reference clip index must point to one of the attached videos (starting at 0)");
  }
  return body;
}

export const pikaComposeVideo: ModelEntry = {
  id: "pika-video-compose",
  surface: "video",
  label: "Pika Video Compose",
  vendor: "pika",
  description: "Build one video from ordered timeline tracks",
  prompt: "none",
  roles: {},
  settings: {
    tracksJson: {
      type: "text",
      default: "",
      multiline: true,
      placeholder: '[{"id":"main","type":"video","keyframes":[{"timestamp":0,"duration":5000,"url":"https://…"}]}] — times are milliseconds',
    },
  },
  operations: [
    {
      apiId: "pika/video-compose/compose-video",
      prompt: null,
      build: composeVideo,
    },
  ],
};

export const pikaMergeVideo: ModelEntry = {
  id: "pika-video-merge",
  surface: "video",
  label: "Pika Video Merge",
  vendor: "pika",
  description: "Join 2–10 clips in the order attached",
  prompt: "none",
  roles: { video: 10 },
  settings: {
    targetFps: { type: "text", default: "", placeholder: "Match the first clip unless specified" },
    resolution: {
      type: "enum",
      values: ["", "square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"],
      default: "",
    },
    referenceVideoIndex: { type: "text", default: "", placeholder: "0-based clip index (optional)" },
  },
  operations: [
    {
      apiId: "pika/video-merge/merge-videos",
      prompt: null,
      media: { video: { field: "videos", many: true, required: true } },
      params: {
        targetFps: { field: "target_fps", as: "number" },
        resolution: { field: "resolution", omit: [""] },
        referenceVideoIndex: { field: "reference_video_index", as: "number" },
      },
      build: mergeVideos,
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
  pikaComposeVideo,
  pikaMergeVideo,
];
