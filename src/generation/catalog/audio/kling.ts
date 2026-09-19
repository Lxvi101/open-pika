import type { ModelEntry } from "../types";

/* One model, two functions the attachments pick between: a clip attached
   scores audio onto it (video required), nothing attached writes a clip from
   scratch. Video-to-audio has no single "prompt" field — it splits words into
   a sound-effect description and a separate background-music description, so
   the generic prompt box is wired to the sound-effect side and the music
   description rides along as its own setting. Neither is required there, so
   the model overall declares its prompt optional even though text-to-audio
   requires one. */
export const klingAudioModel: ModelEntry = {
  id: "kling-audio",
  surface: "audio",
  label: "Kling Audio",
  vendor: "kling",
  prompt: "optional",
  roles: { video: 1 },
  settings: {
    duration: { type: "range", min: 3, max: 10, default: 5 },
    bgmPrompt: { type: "text", default: "", placeholder: "Background music" },
    asmrMode: { type: "boolean", default: false },
  },
  operations: [
    {
      apiId: "kling/kling-audio/video-to-audio",
      prompt: "sound_effect_prompt",
      media: { video: { field: "video_url", required: true } },
      params: {
        bgmPrompt: "bgm_prompt",
        asmrMode: "asmr_mode",
      },
    },
    {
      apiId: "kling/kling-audio/text-to-audio",
      params: { duration: "duration" },
    },
  ],
};

export const klingAudio: readonly ModelEntry[] = [klingAudioModel];
