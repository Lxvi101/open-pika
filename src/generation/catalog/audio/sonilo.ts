import type { ModelEntry } from "../types";

/* Both nullable containers below have no schema default; the first listed
   value is used as the studio's default in each case. */
const SONILO_MUSIC_FORMAT = ["m4a", "wav"] as const;
const SONILO_SFX_FORMAT = ["wav", "mp3", "aac", "flac"] as const;

/* text-to-music requires a prompt and a duration; video-to-music derives the
   duration from the clip and only needs a prompt to steer it, so the model as
   a whole can run on an attachment alone. `segments` (up to 30 timed cues) is
   left out on both — a list of objects the declarative fields can't express,
   and not required by either function. */
const soniloMusic: ModelEntry = {
  id: "sonilo-v1.1-music",
  surface: "audio",
  label: "Sonilo V1.1 Music",
  vendor: "sonilo",
  prompt: "optional",
  roles: { video: 1 },
  settings: {
    outputFormat: { type: "enum", values: SONILO_MUSIC_FORMAT, default: "m4a" },
    preserveSpeech: { type: "boolean", default: false },
    ducking: { type: "boolean", default: false },
    duration: { type: "range", min: 5, max: 360, default: 30 },
  },
  operations: [
    {
      apiId: "sonilo/sonilo-v1.1-music/video-to-music",
      media: { video: { field: "video_url", required: true } },
      params: {
        outputFormat: "output_format",
        preserveSpeech: "preserve_speech",
        ducking: "ducking",
      },
    },
    {
      apiId: "sonilo/sonilo-v1.1-music/text-to-music",
      params: {
        outputFormat: "output_format",
        duration: "duration",
      },
    },
  ],
};

/* Split from soniloMusic: video-to-scored-video also takes exactly one video,
   so it would collide with video-to-music on the same attachment (the mapper
   would have to guess which one the visitor wants). It is also a different
   tool — the result is the source video remuxed with the new soundtrack, not
   a standalone audio file, so the studio needs the description to say so even
   though the catalog category (and this model's surface) is audio. */
const soniloScoredVideo: ModelEntry = {
  id: "sonilo-v1.1-music-scored-video",
  surface: "audio",
  label: "Sonilo V1.1 Scored Video",
  vendor: "sonilo",
  description: "Score a video and return it remuxed with the new soundtrack",
  prompt: "optional",
  roles: { video: 1 },
  settings: {
    preserveSpeech: { type: "boolean", default: false },
  },
  operations: [
    {
      apiId: "sonilo/sonilo-v1.1-music/video-to-scored-video",
      media: { video: { field: "video_url", required: true } },
      params: {
        preserveSpeech: "preserve_speech",
      },
    },
  ],
};

/* sound-effects requires a prompt and a duration; video-to-sound-effects
   derives the duration from the clip and lets the prompt guide (or be left
   out to let Sonilo infer) the effects, so the model runs on an attachment
   alone. `segments` (up to 30 contiguous spans) is left out on both. */
const soniloSfx: ModelEntry = {
  id: "sonilo-v1.1-sfx",
  surface: "audio",
  label: "Sonilo V1.1 Sound Effects",
  vendor: "sonilo",
  prompt: "optional",
  roles: { video: 1 },
  settings: {
    audioFormat: { type: "enum", values: SONILO_SFX_FORMAT, default: "wav" },
    duration: { type: "range", min: 1, max: 180, default: 10 },
  },
  operations: [
    {
      apiId: "sonilo/sonilo-v1.1-sfx/video-to-sound-effects",
      media: { video: { field: "video_url", required: true } },
      params: {
        audioFormat: "audio_format",
      },
    },
    {
      apiId: "sonilo/sonilo-v1.1-sfx/sound-effects",
      params: {
        audioFormat: "audio_format",
        duration: "duration",
      },
    },
  ],
};

export const soniloAudio: readonly ModelEntry[] = [soniloMusic, soniloScoredVideo, soniloSfx];
