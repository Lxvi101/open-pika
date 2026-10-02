import assert from "node:assert/strict";

import { MODELS } from "../src/generation/catalog";
import type { GenerationPlane, MediaItem } from "../src/generation/catalog/types";
import { toPlatform } from "../src/generation/to-platform";

const image = (id: string, url: string): MediaItem => ({ id, url, role: "reference" });
const video = (id: string, url: string): MediaItem => ({ id, url, role: "video" });
const audio = (id: string, url: string): MediaItem => ({ id, url, role: "audio" });
const plane = (
  model: string,
  options: Partial<Omit<GenerationPlane, "model">> = {},
): GenerationPlane => ({
  model,
  prompt: { text: "A paper kite over the sea" },
  media: {},
  settings: {},
  ...options,
});
const operationIds = new Set(MODELS.flatMap((model) => model.operations?.map((op) => op.apiId) ?? []));

for (const id of [
  "bytedance/seedance-2.5/draft-to-video",
  "ideogram/ideogram-4.5/text-to-image",
  "ideogram/ideogram-4.5/image-to-image",
  "pika/video-compose/compose-video",
  "pika/video-merge/merge-videos",
  "sync/lipsync-2/avatar",
  "sync/lipsync-2-pro/avatar",
  "sync/sync-3/avatar",
]) assert(operationIds.has(id), `catalog must register ${id}`);

const draft = toPlatform(plane("seedance-2.5", {
  settings: { duration: "auto", draft: true },
}));
assert.equal(draft.body.duration, "auto");
assert.equal(draft.body.draft, true);
const editDraft = toPlatform(plane("seedance-2.5", {
  media: { video: [video("source", "https://cdn.test/source.mp4")] },
  settings: {
    duration: "auto",
    aspectRatio: "adaptive",
    omniReferenceTaskType: "edit",
  },
}));
assert.equal(editDraft.body.omni_reference_task_type, "edit");
assert.equal(editDraft.body.duration, "auto");
const finalize = toPlatform(plane("seedance-2.5-finalize-draft", {
  prompt: { text: "" },
  settings: { draftJobId: " job_123 ", outputFormat: "mov" },
}));
assert.equal(finalize.body.draft_job_id, "job_123");
assert.equal(finalize.body.output_format, "mov");
assert.throws(() => toPlatform(plane("seedance-2.5-finalize-draft", { prompt: { text: "" } })), /draft job ID/);
assert.throws(() => toPlatform(plane("seedance-2.5", {
  settings: { duration: "5", aspectRatio: "adaptive", omniReferenceTaskType: "edit" },
  media: { video: [video("v1", "https://cdn.test/source.mp4")] },
})), /Auto duration/);
assert.throws(() => toPlatform(plane("seedance-2.5", {
  settings: { duration: "auto", aspectRatio: "adaptive", omniReferenceTaskType: "extend" },
  media: { video: [video("v1", "https://cdn.test/source.mp4")] },
})), /numeric continuation duration/);

const ideogramEdit = toPlatform(plane("ideogram-4.5-image-to-image", {
  media: { reference: [image("i1", "https://cdn.test/edit.png"), image("i2", "https://cdn.test/ref.png")] },
  settings: { quality: "high", size: "source" },
}));
assert.deepEqual(ideogramEdit.body.image_urls, ["https://cdn.test/edit.png", "https://cdn.test/ref.png"]);
assert.equal(ideogramEdit.body.quality, "high");
assert.throws(() => toPlatform(plane("ideogram-4.5-image-to-image", {
  media: { reference: [image("i1", "https://cdn.test/edit.png")] },
  settings: { size: "300x300" },
})), /multiples of 32/);

const composeJson = JSON.stringify([{
  id: "main",
  type: "video",
  keyframes: [{ timestamp: 0, duration: 5000, url: "https://cdn.test/clip.mp4" }],
}]);
const compose = toPlatform(plane("pika-video-compose", { settings: { tracksJson: composeJson } }));
assert.deepEqual(compose.body.tracks, JSON.parse(composeJson));
assert.throws(() => toPlatform(plane("pika-video-compose", {
  settings: { tracksJson: '[{"id":"main","type":"video","keyframes":[{}]}]' },
})), /keyframes need timestamp/);

const merge = toPlatform(plane("pika-video-merge", {
  prompt: { text: "" },
  media: { video: [video("v1", "https://cdn.test/one.mp4"), video("v2", "https://cdn.test/two.mp4")] },
  settings: { targetFps: "24", referenceVideoIndex: "1" },
}));
assert.deepEqual(merge.body.videos, ["https://cdn.test/one.mp4", "https://cdn.test/two.mp4"]);
assert.equal(merge.body.target_fps, 24);
assert.equal(merge.body.reference_video_index, 1);
assert.throws(() => toPlatform(plane("pika-video-merge", {
  prompt: { text: "" },
  media: { video: [video("v1", "https://cdn.test/one.mp4")] },
})), /2–10 video clips/);

const lipsync = toPlatform(plane("sync-3-lipsync", {
  prompt: { text: "" },
  media: {
    video: [video("v1", "https://cdn.test/speaker.mp4")],
    audio: [audio("a1", "https://cdn.test/voice.wav")],
  },
  settings: { syncMode: "remap", temperature: 0.7, activeSpeakerDetection: true },
}));
assert.equal(lipsync.body.video_url, "https://cdn.test/speaker.mp4");
assert.equal(lipsync.body.audio_url, "https://cdn.test/voice.wav");
assert.equal(lipsync.body.sync_mode, "remap");
assert.equal(toPlatform(plane("sync-lipsync-2", {
  prompt: { text: "" },
  media: {
    video: [video("v1", "https://cdn.test/speaker.mp4")],
    audio: [audio("a1", "https://cdn.test/voice.wav")],
  },
})).path, "/v1/media/sync/lipsync-2/avatar");
assert.equal(toPlatform(plane("sync-lipsync-2-pro", {
  prompt: { text: "" },
  media: {
    video: [video("v1", "https://cdn.test/speaker.mp4")],
    audio: [audio("a1", "https://cdn.test/voice.wav")],
  },
})).path, "/v1/media/sync/lipsync-2-pro/avatar");

console.log("new catalog operations passed (payload mapping and operation constraints)");
