import type { ModelEntry } from "../types";

export const whisper: ModelEntry = {
  id: "whisper",
  surface: "audio",
  label: "Whisper",
  vendor: "openai",
  description: "transcribes speech to text",
  /* The words are Whisper's decoder hint: names and spellings to expect. */
  prompt: "optional",
  roles: { audio: 1 },
  settings: {
    language: { type: "text", default: "", placeholder: "Auto-detect" },
    responseFormat: {
      type: "enum",
      values: ["json", "text", "srt", "verbose_json", "vtt"],
      default: "json",
    },
  },
  operations: [
    {
      apiId: "openai/whisper/transcription",
      media: {
        audio: { field: "audio_url", required: true, durationField: "duration_seconds" },
      },
      params: {
        language: "language",
        responseFormat: "response_format",
      },
    },
  ],
};

export const openaiAudio: readonly ModelEntry[] = [whisper];
