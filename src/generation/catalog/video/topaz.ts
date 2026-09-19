import type { ModelEntry } from "../types";

/** An upscaler: no words, just a clip and a couple of dials. The schema also
    exposes five 0-1 fine-tune sliders (compression, noise, halo, grain,
    recover_detail — all "proteus only") and an `h264_output` codec toggle;
    none of them are what a visitor reaches for, so only the scale factor and
    the enhancement engine make the rail. */
export const topazVideoUpscale: ModelEntry = {
  id: "topaz-video-upscale",
  surface: "video",
  label: "Topaz Video Upscale",
  vendor: "topaz",
  description: "Upscale a video",
  prompt: "none",
  roles: { video: 1 },
  settings: {
    upscaleFactor: { type: "enum", values: ["x2", "x4"], default: "x2" },
    model: {
      type: "enum",
      values: [
        "proteus",
        "starlight-mini",
        "starlight-hq",
        "starlight-sharp",
        "starlight-fast-2",
        "starlight-precise-2.6",
      ],
      default: "proteus",
    },
  },
  operations: [
    {
      apiId: "topaz/topaz-video-upscale/video-upscale",
      prompt: null,
      media: { video: { field: "video_url", required: true } },
      params: { upscaleFactor: "upscale_factor", model: "model" },
    },
  ],
};

export const topazVideo: readonly ModelEntry[] = [topazVideoUpscale];
