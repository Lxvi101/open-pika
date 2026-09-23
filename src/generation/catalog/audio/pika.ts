import type { GenerationPlane, ModelEntry } from "../types";

const PIKA_MUSIC_MODE = [
  "text_to_music",
  "voice_conditioned_text_to_music",
  "music_cover",
] as const;

/* Pika Music takes one audio attachment, but its meaning depends on `mode`:
   voice_conditioned_text_to_music clones a voice from it (reference_audio),
   music_cover restyles it as the source track (source_audio). The role always
   binds to reference_audio; build() moves the URL to source_audio when the
   visitor picked the cover mode. */
function pikaMusicAudioField(
  plane: GenerationPlane,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (plane.settings.mode !== "music_cover") return body;
  const { reference_audio, ...rest } = body;
  if (reference_audio === undefined) return body;
  return { ...rest, source_audio: reference_audio };
}

const pikaMusic: ModelEntry = {
  id: "pika-music",
  surface: "audio",
  label: "Pika Music",
  vendor: "pika",
  roles: { audio: 1 },
  settings: {
    mode: { type: "enum", values: PIKA_MUSIC_MODE, default: "text_to_music" },
    lyrics: { type: "text", default: "", multiline: true },
    voiceConsentAttested: { type: "boolean", default: false },
    rewritePrompt: { type: "boolean", default: false },
    duration: { type: "range", min: 10, max: 360, default: 30 },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "pika/pika-audio/pika-music",
      media: { audio: { field: "reference_audio" } },
      params: {
        mode: "mode",
        lyrics: "lyrics",
        voiceConsentAttested: "voice_consent_attested",
        rewritePrompt: "rewrite_prompt",
        duration: "duration",
        seed: { field: "seed", as: "number" },
      },
      build: pikaMusicAudioField,
    },
  ],
};

const pikaSfx: ModelEntry = {
  id: "pika-sfx",
  surface: "audio",
  label: "Pika SFX",
  vendor: "pika",
  roles: {},
  settings: {
    duration: { type: "range", min: 1, max: 20, default: 10 },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "pika/pika-audio/pika-sfx",
      params: {
        duration: "duration",
        seed: { field: "seed", as: "number" },
      },
    },
  ],
};

/* Pika Speech's 76 presets, in schema order. Attach a reference recording
   instead to clone a voice; the two are mutually exclusive but both optional,
   so nothing stops the studio from offering both. */
const PIKA_SPEECH_VOICES = [
  "deep_trailer_bass",
  "warm_honey_drawl",
  "fast_talking_wiseguy",
  "graceful_elder_storyteller",
  "chill_surfer_dude",
  "bubbly_it_girl",
  "roaring_locker_room_coach",
  "calm_documentary_narrator",
  "velvet_radio_alto",
  "gruff_slow_drawl",
  "brassy_sharp_wit",
  "vintage_radio_showman",
  "gentle_hushed_librarian",
  "rapid_sports_caller",
  "warm_playful_spark",
  "folksy_porch_storyteller",
  "crisp_founder_pitch",
  "smoky_noir_monotone",
  "sunny_morning_host",
  "cozy_grandpa_storyteller",
  "plummy_posh_gentleman",
  "cheeky_bright_charmer",
  "rapid_market_banter",
  "stern_clipped_headmistress",
  "hearty_fireside_rumble",
  "soft_thoughtful_lilt",
  "musical_poetic_lilt",
  "melodic_quick_storyteller",
  "gravelly_deadpan",
  "imperious_grande_dame",
  "dry_cheerful_joker",
  "polished_news_anchor",
  "warm_grounded_friend",
  "commanding_safari_guide",
  "rhythmic_radio_charmer",
  "mellow_wise_elder",
  "lilting_warm_hostess",
  "articulate_tech_lead",
  "booming_epic_showman",
  "cool_minimal_designer",
  "precise_stern_engineer",
  "breathy_chic_charm",
  "slow_heavy_brooder",
  "fiery_passionate_cook",
  "loving_loud_grandma",
  "gentle_careful_sweetness",
  "velvet_worldly_narrator",
  "deep_night_storyteller",
  "bright_peppy_vlogger",
  "poised_documentary_calm",
  "grumpy_soft_heart",
  "zany_kid_inventor",
  "hammy_pirate_captain",
  "theatrical_scheming_villain",
  "slow_goofy_giant",
  "wheezy_batty_wizard",
  "raspy_scrappy_kid",
  "chatty_beauty_bestie",
  "hyped_gym_motivator",
  "soft_cozy_aesthetic",
  "smooth_hype_unboxer",
  "bored_chic_trendsetter",
  "joyful_food_fanatic",
  "deadpan_ironic_fry",
  "mellow_road_tripper",
  "breathy_luxe_diva",
  "fast_nerdy_reviewer",
  "unhinged_arena_hype",
  "abyssal_doom_growl",
  "airhorn_club_mc",
  "barking_drill_fury",
  "smoky_mystic_drama",
  "booming_ring_announcer",
  "feather_whisper_asmr",
  "seismic_boss_god",
  "thunderous_revival_preacher",
] as const;

const pikaSpeech: ModelEntry = {
  id: "pika-speech",
  surface: "audio",
  label: "Pika Speech",
  vendor: "pika",
  roles: { audio: 1 },
  settings: {
    voice: { type: "enum", values: PIKA_SPEECH_VOICES, default: "deep_trailer_bass" },
    voiceConsentAttested: { type: "boolean", default: false },
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "pika/pika-audio/pika-speech",
      prompt: "script",
      media: { audio: { field: "reference_audio" } },
      params: {
        voice: "voice_preset",
        voiceConsentAttested: "voice_consent_attested",
        seed: { field: "seed", as: "number" },
      },
    },
  ],
};

/* Pika Soundtrack keeps a video's picture and duration untouched and only
   replaces its audio track — the studio surfaces it as audio (this vendor's
   catalog category) even though the operation hands back a video. */
const pikaSoundtrack: ModelEntry = {
  id: "pika-soundtrack",
  surface: "audio",
  label: "Pika Soundtrack",
  vendor: "pika",
  description: "Score a video with a new, synchronized soundtrack",
  prompt: "optional",
  roles: { video: 1 },
  settings: {
    seed: { type: "text", default: "", placeholder: "Random" },
  },
  operations: [
    {
      apiId: "pika/pika-audio/pika-soundtrack",
      prompt: "instruction",
      media: { video: { field: "video", required: true } },
      params: {
        seed: { field: "seed", as: "number" },
      },
    },
  ],
};

export const pikaAudio: readonly ModelEntry[] = [pikaMusic, pikaSfx, pikaSpeech, pikaSoundtrack];
