/* Builds a request for every media operation — each with exactly the roles it
   binds attached and the model's default settings — and checks the body against
   the platform schema: right route, no unknown or missing fields, legal values. */

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { MODELS, parseSettings } from "../src/generation/catalog";
import type { GenerationPlane, MediaRole } from "../src/generation/catalog";
import { toPlatform } from "../src/generation/to-platform";

let bad = 0,
  n = 0;
for (const model of MODELS) {
  if (!model.operations) continue;
  for (const op of model.operations) {
    // Exercise schema-required bindings and one requireAny role. Attaching every
    // optional role at once creates combinations the API itself forbids.
    const media: GenerationPlane["media"] = {};
    const api = JSON.parse(
      readFileSync(`scripts/pika-catalog/${op.apiId.replaceAll("/", "__")}.json`, "utf8"),
    );
    const requiredFields = new Set<string>(api.input_schema.required ?? []);
    const firstAny = op.requireAny?.[0];
    for (const role of Object.keys(op.media ?? {}) as MediaRole[]) {
      const binding = op.media![role]!;
      if (!binding.required && !requiredFields.has(binding.field.split(".")[0]!) && firstAny !== role) continue;
      const schema = api.input_schema.properties[binding.field.split(".")[0]!];
      const minimum = binding.many ? Math.max(1, schema?.minItems ?? 1) : 1;
      const count = binding.many ? Math.min(minimum, model.roles[role] ?? 1) : 1;
      media[role] = Array.from({ length: count }, (_, i) => ({
        id: `${role}${i}`,
        role,
        url: `https://x.test/${role}${i}.bin`,
        duration: 12.34,
      }));
    }
    const plane: GenerationPlane = {
      model: model.id,
      prompt: { text: "line one\nline two" },
      media,
      settings: parseSettings(model, {
        ...(model.id === "pika-video-compose"
          ? { tracksJson: '[{"id":"main","type":"video","keyframes":[{"timestamp":0,"duration":5000,"url":"https://x.test/clip.mp4"}]}]' }
          : {}),
        ...(model.id === "seedance-2.5-finalize-draft" ? { draftJobId: "job-fixture" } : {}),
        ...(model.id === "pika-speech" ? { voiceConsentAttested: true } : {}),
      }),
    };
    let mapped;
    try {
      mapped = toPlatform(plane);
    } catch (e) {
      console.log("THROW", model.id, op.apiId, (e as Error).message);
      bad++;
      continue;
    }
    n++;
    if (mapped.path !== `/v1/media/${op.apiId}`) {
      console.log("ROUTE", model.id, "wanted", op.apiId, "got", mapped.path);
      bad++;
      continue;
    }
    const schema = JSON.parse(
      readFileSync(`scripts/pika-catalog/${op.apiId.replaceAll("/", "__")}.json`, "utf8"),
    ).input_schema;
    for (const key of Object.keys(mapped.body))
      if (!schema.properties[key]) {
        console.log("UNKNOWN", op.apiId, key);
        bad++;
      }
    for (const key of schema.required ?? [])
      if (mapped.body[key] === undefined) {
        console.log("MISSING", op.apiId, key);
        bad++;
      }
    for (const [key, value] of Object.entries(mapped.body)) {
      const p = schema.properties[key];
      if (!p) continue;
      const variants = (p.anyOf ?? [p]) as any[];
      const enums = variants.flatMap((v) => v.enum ?? (v.const !== undefined ? [v.const] : []));
      const nums = variants.filter((v) => v.type === "integer" || v.type === "number");
      if (
        enums.length &&
        !enums.includes(value) &&
        !(
          typeof value === "number" &&
          nums.some((v) => (v.minimum ?? -1e9) <= value && value <= (v.maximum ?? 1e9))
        )
      ) {
        console.log("ENUM", op.apiId, key, value);
        bad++;
      }
      if (typeof value === "number")
        for (const v of nums)
          if (
            !enums.includes(value) &&
            (value < (v.minimum ?? -1e9) || value > (v.maximum ?? 1e9))
          ) {
            console.log("RANGE", op.apiId, key, value);
            bad++;
          }
      const types = variants.map((v) => v.type);
      const t = Array.isArray(value)
        ? "array"
        : typeof value === "number"
          ? Number.isInteger(value)
            ? "integer"
            : "number"
          : typeof value;
      if (
        !variants.some((v) => v.$ref) &&
        !types.includes(t) &&
        !(t === "integer" && types.includes("number"))
      ) {
        console.log("TYPE", op.apiId, key, t, "not in", types);
        bad++;
      }
    }
  }
}
// A start frame plus audio used to tie between two operations, silently
// choosing image-to-video and dropping the user's driving recording.
const seedance = MODELS.find((model) => model.id === "seedance-2.5")!;
const audioPlane: GenerationPlane = {
  model: seedance.id,
  prompt: { text: "A woman speaking to camera, following @Audio1." },
  media: { audio: [{ id: "audio", role: "audio", url: "https://x.test/voice.mp3" }] },
  settings: parseSettings(seedance, {}),
};
const audioRequest = toPlatform(audioPlane);
assert.equal(audioRequest.path, "/v1/media/bytedance/seedance-2.5/reference-to-video");
assert.deepEqual(audioRequest.body.audio_urls, ["https://x.test/voice.mp3"]);
assert.equal(audioRequest.body.generate_audio, true);
assert.throws(() => toPlatform({
  ...audioPlane,
  media: { ...audioPlane.media, start: [{ id: "face", role: "start", url: "https://x.test/face.jpg" }] },
}), /Use a reference image instead/);
const referenceRequest = toPlatform({
  ...audioPlane,
  media: { ...audioPlane.media, reference: [{ id: "face", role: "reference", url: "https://x.test/face.jpg" }] },
});
assert.deepEqual(referenceRequest.body.audio_urls, ["https://x.test/voice.mp3"]);
assert.deepEqual(referenceRequest.body.image_urls, ["https://x.test/face.jpg"]);

console.log(n, "bodies built,", bad, "problems; audio routing regressions passed");
process.exit(bad ? 1 : 0);
