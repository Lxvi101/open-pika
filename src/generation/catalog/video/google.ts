import type { GenerationPlane, ModelEntry } from "../types";

/* Veo 3.1 and Veo 3.1 Fast share one text-to-video request shape: a numeric
   duration enum, an optional list of reference images (the platform only
   honors them at the default 8s duration — a cross-field rule the types have
   no way to express), and audio/prompt-rewrite toggles. Video extension is a
   different tool with a different duration shape (a 1-148s range, not an
   enum) and none of the text-to-video settings, so it gets its own entry per
   the README's split rule (id suffix "-extend"). */
const VEO_ASPECT = ["16:9", "9:16"] as const;
const VEO_DURATION = ["4", "6", "8"] as const;
const VEO_RESOLUTION = ["720p", "1080p", "4k"] as const;
const VEO_LITE_RESOLUTION = ["720p", "1080p"] as const;

const veoTextParams = {
  aspectRatio: "aspect_ratio",
  duration: { field: "duration", as: "number" },
  resolution: "resolution",
  generateAudio: "generate_audio",
  enhancePrompt: "enhance_prompt",
  negativePrompt: "negative_prompt",
  seed: { field: "seed", as: "number" },
} as const;

const veoTextSettings = {
  aspectRatio: { type: "enum", values: VEO_ASPECT, default: "16:9" },
  duration: { type: "enum", values: VEO_DURATION, default: "8" },
  resolution: { type: "enum", values: VEO_RESOLUTION, default: "720p" },
  generateAudio: { type: "boolean", default: true },
  enhancePrompt: { type: "boolean", default: true },
  negativePrompt: { type: "text", default: "" },
  seed: { type: "text", default: "", placeholder: "Random" },
} as const;

export const veo31Video: ModelEntry = {
  id: "veo-3.1",
  surface: "video",
  label: "Veo 3.1",
  vendor: "google",
  roles: { reference: 3 },
  settings: veoTextSettings,
  operations: [
    {
      apiId: "google/veo-3.1/text-to-video",
      media: { reference: { field: "reference_image_urls", many: true } },
      params: veoTextParams,
    },
  ],
};

export const veo31FastVideo: ModelEntry = {
  id: "veo-3.1-fast",
  surface: "video",
  label: "Veo 3.1 Fast",
  vendor: "google",
  roles: { reference: 3 },
  settings: veoTextSettings,
  operations: [
    {
      apiId: "google/veo-3.1-fast/text-to-video",
      media: { reference: { field: "reference_image_urls", many: true } },
      params: veoTextParams,
    },
  ],
};

export const veo31LiteVideo: ModelEntry = {
  id: "veo-3.1-lite",
  surface: "video",
  label: "Veo 3.1 Lite",
  vendor: "google",
  roles: { start: 1 },
  settings: {
    aspectRatio: { type: "enum", values: VEO_ASPECT, default: "16:9" },
    duration: { type: "enum", values: VEO_DURATION, default: "8" },
    resolution: { type: "enum", values: VEO_LITE_RESOLUTION, default: "720p" },
    generateAudio: { type: "boolean", default: true },
    enhancePrompt: { type: "boolean", default: true },
    negativePrompt: { type: "text", default: "" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "google/veo-3.1-lite/image-to-video",
      media: { start: { field: "image_url", required: true } },
      params: veoTextParams,
    },
  ],
};

/* Video extension: output length is the source clip plus the added segment,
   1-148s total with no schema default — 16s (roughly double a default 8s
   Veo clip) is a reasonable starting point for the rail. */
const veoExtendParams = {
  duration: "duration",
  generateAudio: "generate_audio",
} as const;

const veoExtendSettings = {
  duration: { type: "range", min: 1, max: 148, default: 16 },
  generateAudio: { type: "boolean", default: true },
} as const;

export const veo31ExtendVideo: ModelEntry = {
  id: "veo-3.1-extend",
  surface: "video",
  label: "Veo 3.1 Extend",
  vendor: "google",
  description: "Extend an existing video",
  prompt: "optional",
  roles: { video: 1 },
  settings: veoExtendSettings,
  operations: [
    {
      apiId: "google/veo-3.1/video-extension",
      media: { video: { field: "video_url", required: true } },
      params: veoExtendParams,
    },
  ],
};

export const veo31FastExtendVideo: ModelEntry = {
  id: "veo-3.1-fast-extend",
  surface: "video",
  label: "Veo 3.1 Fast Extend",
  vendor: "google",
  description: "Extend an existing video",
  prompt: "optional",
  roles: { video: 1 },
  settings: veoExtendSettings,
  operations: [
    {
      apiId: "google/veo-3.1-fast/video-extension",
      media: { video: { field: "video_url", required: true } },
      params: veoExtendParams,
    },
  ],
};

/* Gemini Omni's image-to-video takes the start (and optional end) frame as
   one ordered image_urls array rather than a field per role, same shape as
   FLUX's keyframes: bind the roles for selection, let build() write the
   array. Reference-to-video uses the same field name for up to 6 unordered
   reference images, so that one binds directly with many: true. */
function omniFrames(plane: GenerationPlane, body: Record<string, unknown>) {
  const frames = [...(plane.media.start ?? []), ...(plane.media.end ?? [])];
  return { ...body, image_urls: frames.map((item) => item.url) };
}

const OMNI_ASPECT = ["16:9", "9:16"] as const;

export const geminiOmniFlashVideo: ModelEntry = {
  id: "gemini-omni-flash",
  surface: "video",
  label: "Gemini Omni Flash",
  vendor: "google",
  roles: { start: 1, end: 1, reference: 6, video: 1 },
  settings: {
    aspectRatio: { type: "enum", values: OMNI_ASPECT, default: "16:9" },
    /* 3-10s; the schema also accepts 0 to mean "let the model pick a
       length from the prompt", which the rail leaves off. */
    duration: { type: "range", min: 3, max: 10, default: 10 },
  },
  operations: [
    {
      apiId: "google/gemini-omni-flash/video-to-video",
      media: { video: { field: "video_url", required: true } },
    },
    {
      apiId: "google/gemini-omni-flash/image-to-video",
      media: {
        start: { field: "image_urls", required: true },
        end: { field: "image_urls" },
      },
      params: { aspectRatio: "aspect_ratio", duration: "duration" },
      build: omniFrames,
    },
    {
      apiId: "google/gemini-omni-flash/reference-to-video",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: { aspectRatio: "aspect_ratio", duration: "duration" },
    },
    {
      apiId: "google/gemini-omni-flash/text-to-video",
      params: { aspectRatio: "aspect_ratio", duration: "duration" },
    },
  ],
};

export const geminiOmni11FlashVideo: ModelEntry = {
  id: "gemini-omni-1.1-flash",
  surface: "video",
  label: "Gemini Omni 1.1 Flash",
  vendor: "google",
  roles: { start: 1, end: 1, reference: 6, video: 1 },
  settings: {
    aspectRatio: { type: "enum", values: OMNI_ASPECT, default: "16:9" },
    resolution: { type: "enum", values: ["360p", "720p", "1080p", "4k"], default: "720p" },
  },
  operations: [
    {
      apiId: "google/gemini-omni-1.1-flash/video-to-video",
      media: { video: { field: "video_url", required: true } },
    },
    {
      apiId: "google/gemini-omni-1.1-flash/image-to-video",
      media: {
        start: { field: "image_urls", required: true },
        end: { field: "image_urls" },
      },
      params: { aspectRatio: "aspect_ratio", resolution: "resolution" },
      build: omniFrames,
    },
    {
      apiId: "google/gemini-omni-1.1-flash/reference-to-video",
      media: { reference: { field: "image_urls", many: true, required: true } },
      params: { aspectRatio: "aspect_ratio", resolution: "resolution" },
    },
    {
      apiId: "google/gemini-omni-1.1-flash/text-to-video",
      params: { aspectRatio: "aspect_ratio", resolution: "resolution" },
    },
  ],
};

export const googleVideo: readonly ModelEntry[] = [
  veo31Video,
  veo31FastVideo,
  veo31LiteVideo,
  veo31ExtendVideo,
  veo31FastExtendVideo,
  geminiOmniFlashVideo,
  geminiOmni11FlashVideo,
];
