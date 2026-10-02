import assert from "node:assert/strict";
import { MODELS, parseSettings } from "../src/generation/catalog";
import type { MediaItem } from "../src/generation/catalog";
import { completeReference, promptReferences, referenceQuery, supportsReferences } from "../src/generation/references";
import { planeOf } from "../src/generation/plane";
import { toPlatform } from "../src/generation/to-platform";

const item = (role: MediaItem["role"], id: string): MediaItem => ({
  id, role, url: `https://example.com/${id}`,
});
const attached = [item("video", "v1"), item("reference", "i1"), item("audio", "a1"), item("reference", "i2")];
const seedance = MODELS.filter(supportsReferences);
for (const model of seedance) {
  const refs = promptReferences(model, attached);
  assert.deepEqual(refs.map((ref) => ref.token), ["@Image1", "@Image2", "@Video1", "@Audio1"]);
  const plane = planeOf(model, refs.map((ref) => ref.token).join(" "), attached, parseSettings(model, {}));
  const mapped = toPlatform(plane);
  assert.equal(mapped.path, `/v1/media/bytedance/${model.id}/reference-to-video`);
  for (const ref of refs) {
    const [, type, index] = /^@(Image|Video|Audio)(\d+)$/.exec(ref.token)!;
    const field = { Image: "image_urls", Video: "video_urls", Audio: "audio_urls" }[type! as "Image" | "Video" | "Audio"];
    assert.equal((mapped.body[field] as string[])[Number(index) - 1], ref.item.url);
  }
  assert.deepEqual(promptReferences(model, [item("start", "start"), item("reference", "i1")]), []);
  assert.deepEqual(promptReferences(model, [item("start", "start"), ...attached]), refs);
  assert.deepEqual(promptReferences(model, []), []);
  const overflow = Array.from({ length: 40 }, (_, index) => item("reference", `i${index}`));
  assert.equal(promptReferences(model, overflow).length, model.roles.reference);
}
assert.deepEqual(promptReferences(MODELS.find((model) => model.id === "gpt-image-2")!, attached), []);
assert.equal(referenceQuery("person@example", 14), null);
assert.equal(referenceQuery("@Im", 0, 3), null);
assert.equal(referenceQuery("ordinary words", 14), null);
assert.deepEqual(referenceQuery("Walk with @im", 13), { start: 10, end: 13, query: "im" });
assert.deepEqual(referenceQuery("(@Video", 7), { start: 1, end: 7, query: "Video" });
assert.deepEqual(completeReference("Use @Im", referenceQuery("Use @Im", 7)!, "@Image2"), { text: "Use @Image2 ", caret: 12 });
assert.deepEqual(completeReference("Use @Imag99's pose", referenceQuery("Use @Imag99's pose", 7)!, "@Image1"), { text: "Use @Image1's pose", caret: 11 });
assert.deepEqual(completeReference("Use @Im behind", referenceQuery("Use @Im behind", 7)!, "@Image1"), { text: "Use @Image1 behind", caret: 11 });
console.log(`Reference ordering matches submitted arrays for ${seedance.length} Seedance models; caret, selection, email and replacement checks passed.`);
