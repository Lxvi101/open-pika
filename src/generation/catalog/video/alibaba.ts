import type { ModelEntry } from "../types";

const HAPPYHORSE_RESOLUTION = ["720P", "1080P"] as const;
const HAPPYHORSE_RATIO = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "4:5",
  "5:4",
  "9:21",
  "21:9",
] as const;

/* text-to-video, reference-to-video and image-to-video all take the same
   resolution/ratio/duration/seed quartet; only video-to-video (an edit, not a
   generation) drops ratio and duration and gains audio_setting instead. */
const happyhorseGenerateParams = {
  resolution: "resolution",
  aspectRatio: "ratio",
  duration: "duration",
  seed: { field: "seed", as: "number" },
} as const;

/* A start frame brings its own shape, so image-to-video leaves the ratio to
   the platform rather than cropping to the rail's pick. */
const happyhorseImageParams = {
  resolution: "resolution",
  duration: "duration",
  seed: { field: "seed", as: "number" },
} as const;

const happyhorseEditParams = {
  resolution: "resolution",
  seed: { field: "seed", as: "number" },
  audioSetting: "audio_setting",
} as const;

/* Happyhorse 1.0: the only version with a video-to-video (edit) function.
   image-to-video's prompt is nullable, so the model as a whole can run on an
   attachment alone; reference-to-video, video-to-video and text-to-video all
   require it. reference_image_urls tops out at 9 on reference-to-video but
   only 5 on video-to-video's optional reference array — the wider cap is
   used for the shared "reference" role since the type has one cap per role. */
const happyhorse10Video: ModelEntry = {
  id: "happyhorse-1.0",
  surface: "video",
  label: "Happyhorse 1.0",
  vendor: "alibaba",
  prompt: "optional",
  roles: { start: 1, reference: 9, video: 1 },
  settings: {
    resolution: { type: "enum", values: HAPPYHORSE_RESOLUTION, default: "1080P" },
    aspectRatio: { type: "enum", values: HAPPYHORSE_RATIO, default: "16:9" },
    duration: { type: "range", min: 3, max: 15, default: 5 },
    seed: { type: "text", default: "", placeholder: "Random" },
    audioSetting: { type: "enum", values: ["auto", "origin"], default: "auto" },
  },
  operations: [
    {
      apiId: "alibaba/happyhorse-1.0/video-to-video",
      media: {
        video: { field: "video_url", required: true },
        reference: { field: "reference_image_urls", many: true },
      },
      params: happyhorseEditParams,
    },
    {
      apiId: "alibaba/happyhorse-1.0/reference-to-video",
      media: { reference: { field: "reference_image_urls", required: true, many: true } },
      params: happyhorseGenerateParams,
    },
    {
      apiId: "alibaba/happyhorse-1.0/image-to-video",
      prompt: "prompt",
      media: { start: { field: "image_url", required: true } },
      params: happyhorseImageParams,
    },
    {
      apiId: "alibaba/happyhorse-1.0/text-to-video",
      params: happyhorseGenerateParams,
    },
  ],
};

/* Happyhorse 1.1: same shape as 1.0 minus the video-to-video edit function. */
const happyhorse11Video: ModelEntry = {
  id: "happyhorse-1.1",
  surface: "video",
  label: "Happyhorse 1.1",
  vendor: "alibaba",
  prompt: "optional",
  roles: { start: 1, reference: 9 },
  settings: {
    resolution: { type: "enum", values: HAPPYHORSE_RESOLUTION, default: "1080P" },
    aspectRatio: { type: "enum", values: HAPPYHORSE_RATIO, default: "16:9" },
    duration: { type: "range", min: 3, max: 15, default: 5 },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "alibaba/happyhorse-1.1/reference-to-video",
      media: { reference: { field: "reference_image_urls", required: true, many: true } },
      params: happyhorseGenerateParams,
    },
    {
      apiId: "alibaba/happyhorse-1.1/image-to-video",
      prompt: "prompt",
      media: { start: { field: "image_url", required: true } },
      params: happyhorseImageParams,
    },
    {
      apiId: "alibaba/happyhorse-1.1/text-to-video",
      params: happyhorseGenerateParams,
    },
  ],
};

const WAN_RESOLUTION = ["480p", "720p", "1080p"] as const;
const WAN_RATIO = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

/* duration is `integer(2-30) | "auto"` on every Wan operation; per the
   catalog convention for integer|"auto" fields, use a plain range and drop
   the "auto" branch entirely. */
const wanParams = {
  resolution: "resolution",
  aspectRatio: "ratio",
  duration: "duration",
  generateAudio: "audio",
  seed: { field: "seed", as: "number" },
} as const;

const wanOmniParams = {
  ...wanParams,
  fileUrl: "file_url",
  webUrl: "web_url",
} as const;

/* Wan 3.0: image-to-video and text-to-video share every setting and are
   told apart by the first frame alone, so they live in one entry. omni-video
   is a different tool — it references images, videos, audio and documents
   all at once instead of taking a start frame — so per the README it gets
   its own split entry below rather than a third branch here. */
const wan30Video: ModelEntry = {
  id: "wan3.0-video",
  surface: "video",
  label: "Wan 3.0",
  vendor: "alibaba",
  prompt: "optional",
  roles: { start: 1, end: 1 },
  settings: {
    resolution: { type: "enum", values: WAN_RESOLUTION, default: "1080p" },
    aspectRatio: { type: "enum", values: WAN_RATIO, default: "adaptive" },
    duration: { type: "range", min: 2, max: 30, default: 5 },
    generateAudio: { type: "boolean", default: true },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "alibaba/wan3.0-video/image-to-video",
      media: {
        start: { field: "first_frame_url", required: true },
        end: { field: "last_frame_url" },
      },
      params: wanParams,
    },
    {
      apiId: "alibaba/wan3.0-video/text-to-video",
      params: wanParams,
    },
  ],
};

/* file_url/web_url reference a document or web page rather than an image,
   video or audio clip, so they have no MediaRole to bind to; they are
   exposed as plain URL text settings instead. Nothing in the schema is
   required, so no role binding is marked required either. */
const wan30VideoOmni: ModelEntry = {
  id: "wan3.0-video-omni",
  surface: "video",
  label: "Wan 3.0 Omni",
  vendor: "alibaba",
  description: "combines reference images, video, audio and documents into one generation",
  prompt: "optional",
  roles: { reference: 10, video: 5, audio: 5 },
  settings: {
    resolution: { type: "enum", values: WAN_RESOLUTION, default: "1080p" },
    aspectRatio: { type: "enum", values: WAN_RATIO, default: "adaptive" },
    duration: { type: "range", min: 2, max: 30, default: 5 },
    generateAudio: { type: "boolean", default: true },
    seed: { type: "text", default: "", placeholder: "Random" },
    fileUrl: { type: "text", default: "" },
    webUrl: { type: "text", default: "" },
  },
  operations: [
    {
      apiId: "alibaba/wan3.0-video/omni-video",
      media: {
        reference: { field: "reference_image_urls", many: true },
        video: { field: "reference_video_urls", many: true },
        audio: { field: "reference_audio_urls", many: true },
      },
      params: wanOmniParams,
    },
  ],
};

/* Wan 3.0 Prime: same request shapes as Wan 3.0, up to 5x faster. */
const wan30VideoPrime: ModelEntry = {
  id: "wan3.0-video-prime",
  surface: "video",
  label: "Wan 3.0 Prime",
  vendor: "alibaba",
  description: "up to 5x faster than Wan 3.0",
  prompt: "optional",
  roles: { start: 1, end: 1 },
  settings: {
    resolution: { type: "enum", values: WAN_RESOLUTION, default: "1080p" },
    aspectRatio: { type: "enum", values: WAN_RATIO, default: "adaptive" },
    duration: { type: "range", min: 2, max: 30, default: 5 },
    generateAudio: { type: "boolean", default: true },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "alibaba/wan3.0-video-prime/image-to-video",
      media: {
        start: { field: "first_frame_url", required: true },
        end: { field: "last_frame_url" },
      },
      params: wanParams,
    },
    {
      apiId: "alibaba/wan3.0-video-prime/text-to-video",
      params: wanParams,
    },
  ],
};

const wan30VideoPrimeOmni: ModelEntry = {
  id: "wan3.0-video-prime-omni",
  surface: "video",
  label: "Wan 3.0 Prime Omni",
  vendor: "alibaba",
  description: "combines reference images, video, audio and documents into one generation",
  prompt: "optional",
  roles: { reference: 10, video: 5, audio: 5 },
  settings: {
    resolution: { type: "enum", values: WAN_RESOLUTION, default: "1080p" },
    aspectRatio: { type: "enum", values: WAN_RATIO, default: "adaptive" },
    duration: { type: "range", min: 2, max: 30, default: 5 },
    generateAudio: { type: "boolean", default: true },
    seed: { type: "text", default: "", placeholder: "Random" },
    fileUrl: { type: "text", default: "" },
    webUrl: { type: "text", default: "" },
  },
  operations: [
    {
      apiId: "alibaba/wan3.0-video-prime/omni-video",
      media: {
        reference: { field: "reference_image_urls", many: true },
        video: { field: "reference_video_urls", many: true },
        audio: { field: "reference_audio_urls", many: true },
      },
      params: wanOmniParams,
    },
  ],
};

export const alibabaVideo: readonly ModelEntry[] = [
  happyhorse10Video,
  happyhorse11Video,
  wan30Video,
  wan30VideoOmni,
  wan30VideoPrime,
  wan30VideoPrimeOmni,
];
