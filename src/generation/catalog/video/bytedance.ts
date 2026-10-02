import type { GenerationPlane, ModelEntry } from "../types";

/* Every Seedance version shares field names (image_url/end_image_url,
   image_urls/video_urls/audio_urls, ratio, generate_audio); only the
   resolution ceiling, duration ceiling and reference caps change per
   version. 2.5 alone exposes output_format, and 2.5's image-to-video
   restricts ratio to "adaptive" (the platform locks it to the source
   frame's shape), so 2.5 gets its own params maps. */

const RATIO = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"] as const;

/* -------------------------------------------------------------------- */
/* Seedance 2.5                                                          */
/* -------------------------------------------------------------------- */

const seedance25Params = {
  resolution: "resolution",
  aspectRatio: "ratio",
  generateAudio: "generate_audio",
  outputFormat: "output_format",
  draft: "draft",
} as const;

/* Image-to-video's own schema only accepts "adaptive" for ratio (the
   output keeps the starting frame's shape), so this operation drops
   aspectRatio from its params rather than offering values the platform
   would reject. */
const seedance25ImageParams = {
  resolution: "resolution",
  generateAudio: "generate_audio",
  outputFormat: "output_format",
  draft: "draft",
} as const;

const SEEDANCE25_DURATIONS = ["auto", ...Array.from({ length: 27 }, (_, i) => String(i + 4))] as const;

function seedance25Duration(plane: GenerationPlane, body: Record<string, unknown>) {
  const value = plane.settings.duration;
  const duration = value === "auto" ? "auto" : Number(value);
  if (duration !== "auto" && (!Number.isInteger(duration) || duration < 4 || duration > 30)) {
    throw new Error("Seedance 2.5 duration must be auto or 4–30 seconds");
  }
  return { ...body, duration };
}

function seedance25Reference(plane: GenerationPlane, body: Record<string, unknown>) {
  const taskType = plane.settings.omniReferenceTaskType;
  const duration = plane.settings.duration;
  const hasVideo = (plane.media.video?.length ?? 0) > 0;
  const ratio = plane.settings.aspectRatio;
  if (taskType === "edit" && (!hasVideo || duration !== "auto" || ratio !== "adaptive")) {
    throw new Error("Seedance edit needs a source video, Auto duration, and Adaptive aspect ratio");
  }
  if (taskType === "extend" && (!hasVideo || ratio !== "adaptive" || duration === "auto")) {
    throw new Error("Seedance extend needs a source video, Adaptive aspect ratio, and a numeric continuation duration");
  }
  return seedance25Duration(plane, body);
}

export const seedance25Video: ModelEntry = {
  id: "seedance-2.5",
  surface: "video",
  label: "Seedance 2.5",
  vendor: "bytedance",
  roles: { start: 1, end: 1, reference: 30, video: 10, audio: 10 },
  settings: {
    aspectRatio: { type: "enum", values: RATIO, default: "adaptive" },
    resolution: { type: "enum", values: ["480p", "720p", "1080p"], default: "720p" },
    duration: { type: "enum", values: SEEDANCE25_DURATIONS, default: "5" },
    generateAudio: { type: "boolean", default: true },
    outputFormat: { type: "enum", values: ["mp4", "mov"], default: "mp4" },
    draft: { type: "boolean", default: false },
    omniReferenceTaskType: {
      type: "enum",
      values: ["auto", "reference", "edit", "extend"],
      default: "auto",
    },
  },
  operations: [
    {
      apiId: "bytedance/seedance-2.5/image-to-video",
      media: {
        start: { field: "image_url", required: true },
        end: { field: "end_image_url" },
      },
      params: seedance25ImageParams,
      build: seedance25Duration,
    },
    {
      apiId: "bytedance/seedance-2.5/reference-to-video",
      media: {
        reference: { field: "image_urls", many: true },
        video: { field: "video_urls", many: true },
        audio: { field: "audio_urls", many: true },
      },
      requireAny: ["reference", "video", "audio"],
      params: { ...seedance25Params, omniReferenceTaskType: "omni_reference_task_type" },
      build: seedance25Reference,
    },
    {
      apiId: "bytedance/seedance-2.5/text-to-video",
      params: seedance25Params,
      build: seedance25Duration,
    },
  ],
};

export const seedance25FinalizeVideo: ModelEntry = {
  id: "seedance-2.5-finalize-draft",
  surface: "video",
  label: "Seedance 2.5 Draft Final",
  vendor: "bytedance",
  description: "Render a completed Seedance draft at 1080p",
  prompt: "none",
  roles: {},
  settings: {
    draftJobId: {
      type: "text",
      default: "",
      placeholder: "Completed draft job ID (available for 7 days)",
    },
    outputFormat: { type: "enum", values: ["mp4", "mov"], default: "mp4" },
  },
  operations: [
    {
      apiId: "bytedance/seedance-2.5/draft-to-video",
      prompt: null,
      params: { draftJobId: "draft_job_id", outputFormat: "output_format" },
      build: (_plane, body) => {
        if (typeof body.draft_job_id !== "string" || !body.draft_job_id.trim()) {
          throw new Error("Enter the completed Seedance draft job ID to render its 1080p final");
        }
        return { ...body, draft_job_id: body.draft_job_id.trim() };
      },
    },
  ],
};

/* -------------------------------------------------------------------- */
/* Seedance 2.0 family (2.0, 2.0 Fast, 2.0 Mini)                         */
/* -------------------------------------------------------------------- */

const seedanceParams = {
  resolution: "resolution",
  duration: "duration",
  aspectRatio: "ratio",
  generateAudio: "generate_audio",
} as const;

export const seedance20Video: ModelEntry = {
  id: "seedance-2.0",
  surface: "video",
  label: "Seedance 2.0",
  vendor: "bytedance",
  roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 },
  settings: {
    aspectRatio: { type: "enum", values: RATIO, default: "adaptive" },
    resolution: { type: "enum", values: ["480p", "720p", "1080p", "4k"], default: "720p" },
    duration: { type: "range", min: 4, max: 15, default: 5 },
    generateAudio: { type: "boolean", default: true },
  },
  operations: [
    {
      apiId: "bytedance/seedance-2.0/image-to-video",
      media: {
        start: { field: "image_url", required: true },
        end: { field: "end_image_url" },
      },
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0/reference-to-video",
      media: {
        reference: { field: "image_urls", many: true },
        video: { field: "video_urls", many: true },
        audio: { field: "audio_urls", many: true },
      },
      requireAny: ["reference", "video", "audio"],
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0/text-to-video",
      params: seedanceParams,
    },
  ],
};

export const seedance20FastVideo: ModelEntry = {
  id: "seedance-2.0-fast",
  surface: "video",
  label: "Seedance 2.0 Fast",
  vendor: "bytedance",
  roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 },
  settings: {
    aspectRatio: { type: "enum", values: RATIO, default: "adaptive" },
    resolution: { type: "enum", values: ["480p", "720p"], default: "720p" },
    duration: { type: "range", min: 4, max: 15, default: 5 },
    generateAudio: { type: "boolean", default: true },
  },
  operations: [
    {
      apiId: "bytedance/seedance-2.0-fast/image-to-video",
      media: {
        start: { field: "image_url", required: true },
        end: { field: "end_image_url" },
      },
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0-fast/reference-to-video",
      media: {
        reference: { field: "image_urls", many: true },
        video: { field: "video_urls", many: true },
        audio: { field: "audio_urls", many: true },
      },
      requireAny: ["reference", "video", "audio"],
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0-fast/text-to-video",
      params: seedanceParams,
    },
  ],
};

export const seedance20MiniVideo: ModelEntry = {
  id: "seedance-2.0-mini",
  surface: "video",
  label: "Seedance 2.0 Mini",
  vendor: "bytedance",
  roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 },
  settings: {
    aspectRatio: { type: "enum", values: RATIO, default: "adaptive" },
    resolution: { type: "enum", values: ["480p", "720p"], default: "720p" },
    duration: { type: "range", min: 4, max: 15, default: 5 },
    generateAudio: { type: "boolean", default: true },
  },
  operations: [
    {
      apiId: "bytedance/seedance-2.0-mini/image-to-video",
      media: {
        start: { field: "image_url", required: true },
        end: { field: "end_image_url" },
      },
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0-mini/reference-to-video",
      media: {
        reference: { field: "image_urls", many: true },
        video: { field: "video_urls", many: true },
        audio: { field: "audio_urls", many: true },
      },
      requireAny: ["reference", "video", "audio"],
      params: seedanceParams,
    },
    {
      apiId: "bytedance/seedance-2.0-mini/text-to-video",
      params: seedanceParams,
    },
  ],
};

/* seedance-2.5 leads: it is the studio's default model. */
export const bytedanceVideo: readonly ModelEntry[] = [
  seedance25Video,
  seedance25FinalizeVideo,
  seedance20Video,
  seedance20FastVideo,
  seedance20MiniVideo,
];
