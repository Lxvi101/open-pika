import type { ModelEntry } from "../types";

/* Neither `prompt` (style description) nor `lyrics` is required by the
   schema — a visitor can generate from lyrics alone, or instrumental-only —
   so the model's own prompt is optional. The nested `audio_setting` object
   also carries `sample_rate` and `bitrate`; those are output plumbing and
   left off the rail, but `format` is exposed as `outputFormat` since mp3 vs.
   wav is a real choice a visitor reaches for. */
export const minimaxMusic3: ModelEntry = {
  id: "minimax-music-3.0",
  surface: "audio",
  label: "MiniMax Music 3.0",
  vendor: "minimax",
  prompt: "optional",
  roles: {},
  settings: {
    lyrics: { type: "text", default: "", multiline: true },
    lyricsOptimizer: { type: "boolean", default: false },
    isInstrumental: { type: "boolean", default: false },
    outputFormat: { type: "enum", values: ["mp3", "wav", "pcm"], default: "mp3" },
  },
  operations: [
    {
      apiId: "minimax/minimax-music-3.0/text-to-audio",
      params: {
        lyrics: "lyrics",
        lyricsOptimizer: "lyrics_optimizer",
        isInstrumental: "is_instrumental",
        outputFormat: "audio_setting.format",
      },
    },
  ],
};

/* Shared by both Speech 2.8 models: identical schema (`text` + `voice_id`
   required, everything else optional). `voice_id` is a free string, not a
   schema enum (MiniMax's own voice library lives outside this schema), so
   per the free-voice-id convention it is a text setting defaulted to the
   platform's own example voice rather than an empty string, since it is
   required and an empty string is never sent. `vol`, `sample_rate`,
   `bitrate`, `format`, and `channel` are output plumbing and left off the
   rail to keep it to the settings a visitor actually reaches for. */
const minimaxSpeechSettings = {
  voice: { type: "text", default: "Wise_Woman" },
  speed: { type: "range", min: 0.5, max: 2, default: 1, step: 0.1 },
  pitch: { type: "range", min: -12, max: 12, default: 0, step: 1 },
  emotion: {
    type: "enum",
    values: [
      "auto",
      "fluent",
      "happy",
      "sad",
      "angry",
      "fearful",
      "disgusted",
      "surprised",
      "calm",
      "whisper",
    ],
    default: "auto",
  },
  language: { type: "text", default: "", placeholder: "Auto-detect" },
} as const;

const minimaxSpeechParams = {
  voice: "voice_id",
  speed: "speed",
  pitch: "pitch",
  emotion: { field: "emotion", omit: ["auto"] },
  language: "language_boost",
} as const;

export const minimaxSpeech28Hd: ModelEntry = {
  id: "minimax-speech-2.8-hd",
  surface: "audio",
  label: "MiniMax Speech 2.8 HD",
  vendor: "minimax",
  roles: {},
  settings: minimaxSpeechSettings,
  operations: [
    {
      apiId: "minimax/minimax-speech-2.8-hd/text-to-speech",
      prompt: "text",
      params: minimaxSpeechParams,
    },
  ],
};

export const minimaxSpeech28Turbo: ModelEntry = {
  id: "minimax-speech-2.8-turbo",
  surface: "audio",
  label: "MiniMax Speech 2.8 Turbo",
  vendor: "minimax",
  roles: {},
  settings: minimaxSpeechSettings,
  operations: [
    {
      apiId: "minimax/minimax-speech-2.8-turbo/text-to-speech",
      prompt: "text",
      params: minimaxSpeechParams,
    },
  ],
};

export const minimaxAudio: readonly ModelEntry[] = [
  minimaxMusic3,
  minimaxSpeech28Hd,
  minimaxSpeech28Turbo,
];
