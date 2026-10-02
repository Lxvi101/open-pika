import assert from "node:assert/strict";
import { getModel, parseSettings } from "../src/generation/catalog";
import type { GenerationPlane } from "../src/generation/catalog";
import { toPlatform } from "../src/generation/to-platform";

function plane(modelId: string, options: Partial<GenerationPlane> = {}): GenerationPlane {
  const model = getModel(modelId);
  return {
    model: modelId,
    prompt: { text: "A sample line" },
    media: {},
    settings: parseSettings(model, {}),
    ...options,
  };
}

const seed = plane("seed-audio-1.0");
assert.throws(
  () => toPlatform({ ...seed, media: { audio: [{ id: "a", role: "audio", url: "https://x.test/a.mp3" }], reference: [{ id: "i", role: "reference", url: "https://x.test/i.jpg" }] } }),
  /cannot be combined/,
);
assert.throws(
  () => toPlatform({ ...seed, settings: { ...seed.settings, mode: "seed-audio-1.0-multilingual", voice: "en_female_jenny_uranus_bigtts" } }),
  /require the seed-audio-1.0 base variant/,
);
assert.throws(
  () => toPlatform({ ...seed, settings: { ...seed.settings, mode: "seed-audio-1.0" }, media: { audio: [{ id: "a", role: "audio", url: "https://x.test/a.mp3" }] } }),
  /cloning references require the multilingual variant/,
);
assert.throws(() => toPlatform({ ...seed, prompt: { text: "x".repeat(3001) } }), /3000 characters or fewer/);

const pika = plane("pika-speech", {
  prompt: { text: "Read this" },
  media: { audio: [{ id: "voice", role: "audio", url: "https://x.test/voice.mp3" }] },
});
assert.throws(() => toPlatform(pika), /Attest that you have permission/);
const clonedPika = toPlatform({ ...pika, settings: { ...pika.settings, voiceConsentAttested: true } });
assert.equal(clonedPika.body.reference_audio, "https://x.test/voice.mp3");
assert.equal(clonedPika.body.voice_preset, undefined);
assert.equal(toPlatform(plane("pika-speech")).body.voice_preset, "deep_trailer_bass");
assert.throws(() => toPlatform({ ...plane("pika-speech"), prompt: { text: "x".repeat(15001) } }), /15000 characters or fewer/);

for (const role of ["audio", "video"] as const) {
  const dubbing = plane("eleven-voice-dubbing", {
    media: { [role]: [{ id: "source", role, url: `https://x.test/source.${role === "audio" ? "mp3" : "mp4"}`, duration: 12 }] },
  });
  const request = toPlatform(dubbing);
  assert.equal(request.body.source_url, dubbing.media[role]![0]!.url);
  assert.equal(request.body.duration_seconds, 12);
}
const dubbingBoth = plane("eleven-voice-dubbing", {
  media: {
    audio: [{ id: "a", role: "audio", url: "https://x.test/a.mp3", duration: 12 }],
    video: [{ id: "v", role: "video", url: "https://x.test/v.mp4", duration: 12 }],
  },
});
assert.throws(() => toPlatform(dubbingBoth), /cannot use this combination of attachments/);
const dubbingSettings = getModel("eleven-voice-dubbing").settings;
assert.equal(dubbingSettings.targetLang?.type === "text" && dubbingSettings.targetLang.maxLength, 8);
assert.equal(dubbingSettings.sourceLang?.type === "text" && dubbingSettings.sourceLang.maxLength, 8);

const dialogue = plane("eleven-text-to-dialogue", { prompt: { text: "First line\nSecond line" } });
const dialogueRequest = toPlatform(dialogue);
assert.deepEqual(dialogueRequest.body.inputs, [
  { text: "First line", voice_id: "21m00Tcm4TlvDq8ikWAM" },
  { text: "Second line", voice_id: "pNInz6obpgDQGcFmaJgB" },
]);
assert.throws(() => toPlatform({ ...dialogue, prompt: { text: "\n \n" } }), /at least one dialogue turn/);
assert.throws(() => toPlatform({ ...dialogue, prompt: { text: Array(11).fill("line").join("\n") } }), /at most 10 turns/);
assert.throws(() => toPlatform({ ...dialogue, settings: { ...dialogue.settings, voice1: "  " } }), /voice ID for each speaker/);
assert.throws(() => toPlatform({ ...dialogue, prompt: { text: "x".repeat(3001) } }), /3000 characters or fewer/);

assert.equal(getModel("gemini-3.1-pro").description, undefined);
console.log("Audio request constraints passed");
