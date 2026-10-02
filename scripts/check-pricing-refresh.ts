/* Verifies refreshed catalog prices reach the shipped table and that Topaz's
   usage-priced video upscales are presented without guessing output usage. */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { MODELS, parseSettings } from "../src/generation/catalog";
import type { GenerationPlane } from "../src/generation/catalog";
import { estimateCost } from "../src/generation/cost";
import pricing from "../src/generation/catalog/pricing.json";

const dir = new URL("./pika-catalog/", import.meta.url);
const snapshots = readdirSync(dir).filter((file) => file.endsWith(".json"));
const withPricing = snapshots
  .map((file) => JSON.parse(readFileSync(new URL(file, dir), "utf8")))
  .filter((api) => api.display_pricing?.components?.length);
assert.ok(snapshots.length >= 154, "snapshot set should retain the existing catalog records");
const expected = Object.fromEntries(withPricing.map((api) => [
  api.api_id,
  api.display_pricing.components.map((component: any) => ({
    role: component.role,
    unit: component.unit.type,
    per: component.unit.quantity,
    ...(component.unit.included ? { included: component.unit.included } : {}),
    tiers: component.price_tiers.map((tier: any) => ({
      spec: Object.fromEntries(Object.entries(tier.spec).map(([key, value]) => [key, String(value)])),
      usd: tier.micro_usd / 1_000_000,
    })),
  })),
]));
assert.deepEqual(pricing, expected, "shipped pricing must match every expanded snapshot component");

function topazEstimate(engine: string) {
  const model = MODELS.find((entry) => entry.id === "topaz-video-upscale")!;
  const plane: GenerationPlane = {
    model: model.id,
    prompt: { text: "" },
    media: {
      video: [{ id: "clip", role: "video", url: "https://x.test/clip.mp4", duration: 10 }],
    },
    settings: parseSettings(model, { model: engine }),
  };
  return estimateCost(plane, { requests: 1, outputs: 1 });
}

const proteus = topazEstimate("proteus");
assert.equal(proteus?.kind, "rate");
assert.match(proteus.label, /output megapixels/);
for (const engine of ["starlight-mini", "starlight-fast-2", "starlight-precise-2.6"]) {
  const estimate = topazEstimate(engine);
  assert.equal(estimate?.kind, "rate", `${engine} must remain usage based without output dimensions`);
  assert.match(estimate.label, /output frames and size tier/);
  assert.match(estimate.label, /platform quote/);
}

const video = JSON.parse(
  readFileSync(new URL("./pika-catalog/topaz__topaz-video-upscale__video-upscale.json", import.meta.url), "utf8"),
);
assert.deepEqual(
  video.display_pricing.components.map((component: { unit: { type: string } }) => component.unit.type),
  ["output_megapixel", "output_frame_1080p", "output_frame_4k"],
);

const compose = MODELS.find((entry) => entry.id === "pika-video-compose")!;
const composeCost = estimateCost(
  {
    model: compose.id,
    prompt: { text: "" },
    media: {},
    settings: parseSettings(compose, {
      tracksJson: '[{"id":"main","type":"video","keyframes":[{"timestamp":0,"duration":5000,"url":"https://x.test/clip.mp4"}]}]',
    }),
  },
  { requests: 1, outputs: 1 },
);
assert.equal(composeCost?.kind, "total");
assert.equal(composeCost.usd, 0.001, "timeline duration should price the composed output seconds");
console.log(`${snapshots.length} snapshots, ${withPricing.length} priced records, Topaz usage labels passed`);
