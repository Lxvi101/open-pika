import type { GenerationPlane, ModelEntry, SettingField } from "../types";

/* Eleven Multilingual v2 and Eleven Turbo v2.5 are the same request shape —
   free text, a free-form ElevenLabs voice id (the schema has no enum to draw
   a picker from), an optional language override, and a reproducibility seed
   — differing only in quality/speed trade-off and the platform's own text
   length cap. `voice_settings` (stability, similarity boost, ...) is an open
   `additionalProperties: true` object with no declared shape, so there is no
   sane setting to hang it on and it is left out. */
const elevenSpeechParams = {
  voice: "voice_id",
  language: "language_code",
  seed: { field: "seed", as: "number" },
} as const;

const elevenSpeechSettings: Record<string, SettingField> = {
  voice: { type: "text", default: "21m00Tcm4TlvDq8ikWAM", placeholder: "ElevenLabs voice ID" },
  language: { type: "text", default: "", placeholder: "Auto-detect" },
  seed: { type: "text", default: "", placeholder: "Random" },
};

export const elevenMultilingualV2: ModelEntry = {
  id: "eleven-multilingual-v2",
  surface: "audio",
  label: "Eleven Multilingual v2",
  vendor: "elevenlabs",
  roles: {},
  settings: elevenSpeechSettings,
  operations: [
    {
      apiId: "elevenlabs/eleven-multilingual-v2/text-to-speech",
      prompt: "text",
      params: elevenSpeechParams,
    },
  ],
};

export const elevenTurboV25: ModelEntry = {
  id: "eleven-turbo-v2-5",
  surface: "audio",
  label: "Eleven Turbo v2.5",
  vendor: "elevenlabs",
  description: "faster and cheaper than Multilingual v2",
  roles: {},
  settings: elevenSpeechSettings,
  operations: [
    {
      apiId: "elevenlabs/eleven-turbo-v2-5/text-to-speech",
      prompt: "text",
      params: elevenSpeechParams,
    },
  ],
};

/* Two well-known ElevenLabs premade voice ids (Rachel, Adam) so a two-person
   dialogue sounds right without the visitor having to look anything up; both
   are plain text settings and either can be swapped for any other voice id. */
const DIALOGUE_VOICE_A = "21m00Tcm4TlvDq8ikWAM";
const DIALOGUE_VOICE_B = "pNInz6obpgDQGcFmaJgB";

/* The schema wants `inputs`: an ordered list of { text, voice_id } turns, not
   a single string, so there is no declarative `params` entry that can write
   it. Instead we read the Generate composer as a script — one turn per
   non-empty line, voices alternating A/B/A/B/... — and let `build` write the
   array once seed (the one plain param this operation has) is already on the
   body. Capped at the schema's 10-turn maximum. Because nothing attached to
   a role produces `inputs`, the check script can only warn, not verify, that
   the required field gets written — see the report for that warning. */
function dialogueTurns(plane: GenerationPlane, body: Record<string, unknown>) {
  const voices = [
    String(plane.settings.voice1 ?? DIALOGUE_VOICE_A).trim(),
    String(plane.settings.voice2 ?? DIALOGUE_VOICE_B).trim(),
  ];
  if (voices.some((voice) => !voice)) {
    throw new Error("Eleven Text to Dialogue requires a voice ID for each speaker");
  }
  const turns = plane.prompt.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (turns.length < 1) throw new Error("Add at least one dialogue turn");
  if (turns.length > 10) throw new Error("Eleven Text to Dialogue supports at most 10 turns");
  if (turns.some((text) => text.length > 3000)) {
    throw new Error("Each Eleven Text to Dialogue turn must be 3000 characters or fewer");
  }
  const inputs = turns.map((text, index) => ({ text, voice_id: voices[index % 2] }));
  return { ...body, inputs };
}

export const elevenTextToDialogue: ModelEntry = {
  id: "eleven-text-to-dialogue",
  surface: "audio",
  label: "Eleven Text to Dialogue",
  vendor: "elevenlabs",
  description: "one line of the prompt per turn, alternating between two voices",
  roles: {},
  settings: {
    voice1: { type: "text", default: DIALOGUE_VOICE_A, placeholder: "First speaker's voice ID" },
    voice2: { type: "text", default: DIALOGUE_VOICE_B, placeholder: "Second speaker's voice ID" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "elevenlabs/eleven-text-to-dialogue/text-to-speech",
      prompt: null,
      params: { seed: { field: "seed", as: "number" } },
      build: dialogueTurns,
    },
  ],
};

export const elevenTextToSound: ModelEntry = {
  id: "eleven-text-to-sound-v2",
  surface: "audio",
  label: "Eleven Text to Sound v2",
  vendor: "elevenlabs",
  description: "sound effects and ambience, not speech",
  roles: {},
  settings: {
    duration: { type: "range", min: 0.5, max: 30, default: 5 },
    promptInfluence: { type: "range", min: 0, max: 1, default: 0.3, step: 0.05 },
    loop: { type: "boolean", default: false },
  },
  operations: [
    {
      apiId: "elevenlabs/eleven-text-to-sound-v2/sound-effects",
      prompt: "text",
      params: {
        duration: "duration_seconds",
        promptInfluence: "prompt_influence",
        loop: "loop",
      },
    },
  ],
};

/* The four tools below work on an existing clip and are priced by its length,
   which the platform cannot measure from a URL: `durationField` has the studio
   measure the attachment and send it. */

export const elevenMultilingualSts: ModelEntry = {
  id: "eleven-multilingual-sts-v2",
  surface: "audio",
  label: "Eleven Multilingual STS v2",
  vendor: "elevenlabs",
  description: "re-voices an existing recording in a different ElevenLabs voice",
  prompt: "none",
  roles: { audio: 1 },
  settings: {
    voice: { type: "text", default: "21m00Tcm4TlvDq8ikWAM", placeholder: "ElevenLabs voice ID" },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "elevenlabs/eleven-multilingual-sts-v2/speech-to-speech",
      prompt: null,
      media: { audio: { field: "audio_url", required: true, durationField: "duration_seconds" } },
      params: {
        voice: "voice_id",
        seed: { field: "seed", as: "number" },
      },
    },
  ],
};

export const elevenScribe: ModelEntry = {
  id: "eleven-scribe",
  surface: "audio",
  label: "Eleven Scribe",
  vendor: "elevenlabs",
  description: "transcribes speech to text",
  prompt: "none",
  roles: { audio: 1 },
  settings: {
    language: { type: "text", default: "", placeholder: "Auto-detect" },
    diarize: { type: "boolean", default: false },
    useMultiChannel: { type: "boolean", default: false },
  },
  operations: [
    {
      apiId: "elevenlabs/eleven-scribe/transcription",
      prompt: null,
      media: { audio: { field: "audio_url", required: true, durationField: "duration_seconds" } },
      params: {
        language: "language_code",
        diarize: "diarize",
        useMultiChannel: "use_multi_channel",
      },
    },
  ],
};

export const elevenVoiceDubbing: ModelEntry = {
  id: "eleven-voice-dubbing",
  surface: "audio",
  label: "Eleven Voice Dubbing",
  vendor: "elevenlabs",
  description: "dubs a video (or audio track) into another language",
  prompt: "none",
  roles: { audio: 1, video: 1 },
  settings: {
    targetLang: { type: "text", default: "es", placeholder: "Target language code", maxLength: 8 },
    sourceLang: { type: "text", default: "", placeholder: "Auto-detect", maxLength: 8 },
    /* 0 is not a meaningful speaker count, so it doubles as "let the platform
       auto-detect speakers" and is omitted from the wire at that value. */
    numSpeakers: { type: "range", min: 0, max: 20, default: 0 },
    highestResolution: { type: "boolean", default: false },
    dropBackgroundAudio: { type: "boolean", default: false },
  },
  operations: (["audio", "video"] as const).map((role) => ({
    apiId: "elevenlabs/eleven-voice-dubbing/dubbing",
    prompt: null,
    media: { [role]: { field: "source_url", required: true, durationField: "duration_seconds" } },
    params: {
      targetLang: "target_lang",
      sourceLang: "source_lang",
      numSpeakers: { field: "num_speakers", omit: [0] },
      highestResolution: "highest_resolution",
      dropBackgroundAudio: "drop_background_audio",
    },
  })),
};

export const elevenVoiceIsolation: ModelEntry = {
  id: "eleven-voice-isolation",
  surface: "audio",
  label: "Eleven Voice Isolation",
  vendor: "elevenlabs",
  description: "strips background noise, keeping only the voice",
  prompt: "none",
  roles: { audio: 1 },
  settings: {
    fileFormat: { type: "enum", values: ["pcm_s16le_16", "other"], default: "other" },
  },
  operations: [
    {
      apiId: "elevenlabs/eleven-voice-isolation/voice-isolation",
      prompt: null,
      media: { audio: { field: "audio_url", required: true, durationField: "duration_seconds" } },
      params: {
        fileFormat: "file_format",
      },
    },
  ],
};

export const elevenlabsAudio: readonly ModelEntry[] = [
  elevenMultilingualV2,
  elevenTurboV25,
  elevenTextToDialogue,
  elevenTextToSound,
  elevenMultilingualSts,
  elevenScribe,
  elevenVoiceDubbing,
  elevenVoiceIsolation,
];
