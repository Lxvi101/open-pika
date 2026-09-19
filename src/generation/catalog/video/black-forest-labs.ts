import type { GenerationPlane, ModelEntry } from "../types";

const FLUX_ASPECT = ["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

const flux3Params = {
  resolution: "resolution",
  duration: "duration",
  aspectRatio: "aspect_ratio",
  draft: "draft",
  generateAudio: "generate_audio",
} as const;

/* Flux takes its frames as one ordered keyframe list rather than a field per
   role: the start frame opens it, references are interpolated through, the end
   frame closes it. */
function keyframes(plane: GenerationPlane, body: Record<string, unknown>) {
  const frames = [
    ...(plane.media.start ?? []),
    ...(plane.media.reference ?? []),
    ...(plane.media.end ?? []),
  ];
  return { ...body, keyframes: frames.map((item) => ({ image_url: item.url })) };
}

export const flux3Video: ModelEntry = {
  id: "flux-3-video",
  surface: "video",
  label: "FLUX 3",
  vendor: "black-forest-labs",
  roles: { start: 1, end: 1, reference: 8, video: 1 },
  settings: {
    aspectRatio: { type: "enum", values: FLUX_ASPECT, default: "auto" },
    resolution: { type: "enum", values: ["720p", "1080p"], default: "720p" },
    duration: { type: "range", min: 5, max: 20, default: 5 },
    generateAudio: { type: "boolean", default: true },
    draft: { type: "boolean", default: false },
  },
  operations: [
    {
      apiId: "black-forest-labs/flux-3-video/video-to-video",
      media: { video: { field: "start_video_url", required: true } },
      params: flux3Params,
    },
    {
      apiId: "black-forest-labs/flux-3-video/image-to-video",
      media: {
        start: { field: "keyframes", required: true },
        end: { field: "keyframes" },
        reference: { field: "keyframes", many: true },
      },
      params: flux3Params,
      build: keyframes,
    },
    {
      apiId: "black-forest-labs/flux-3-video/text-to-video",
      params: flux3Params,
    },
  ],
};

export const blackForestLabsVideo: readonly ModelEntry[] = [flux3Video];
