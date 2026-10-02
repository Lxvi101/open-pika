import assert from "node:assert/strict";
import { getModel, parseSettings } from "../src/generation/catalog";
import { toPlatform } from "../src/generation/to-platform";
import { memoryKv, type Kv, type LegacyStore } from "../src/openhiggsfield/idb";
import { saveHistory, loadHistory, type RunRecord } from "../src/openhiggsfield/history";
import { loadSubmissions, saveSubmissions, type PendingSubmission } from "../src/openhiggsfield/submissions";
import { ApiActionError, apiErrorMessage, uncertainSubmission } from "../src/openhiggsfield/api-result";

const model = getModel("pika-2.5");
const plane = { model: model.id, prompt: { text: "Local recovery fixture" }, settings: parseSettings(model, {}), media: {} };
const pending: PendingSubmission = {
  key: "original-submit-key", plane, request: toPlatform(plane), expected: 1,
  draft: { surface: "video", modelId: model.id, modelLabel: model.label, prompt: plane.prompt.text, ratio: "16 / 9", meta: "", createdAt: 1 },
};
const kv = memoryKv();
await saveSubmissions([pending], kv, undefined);
assert.deepEqual(await loadSubmissions(kv, undefined), [pending]);
await saveSubmissions([{ ...pending, requestId: "media_existing" }], kv, undefined);
assert.equal((await loadSubmissions(kv, undefined))[0]!.key, pending.key);
assert.equal((await loadSubmissions(kv, undefined))[0]!.requestId, "media_existing");
const denied: Kv = { async get() { throw new Error("denied"); }, async set() { throw new Error("denied"); } };
await assert.rejects(saveSubmissions([pending], denied, undefined), /cannot save recovery/);
const cache = new Map<string, string>();
const legacy: LegacyStore = { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => { cache.set(key, value); }, removeItem: (key) => { cache.delete(key); } };
await saveSubmissions([pending], denied, legacy);
assert.deepEqual(await loadSubmissions(denied, legacy), [pending]);
// A stale fallback cannot resurrect a key removed from the newer primary.
await saveSubmissions([pending], kv, legacy);
await saveSubmissions([], kv, undefined);
assert.deepEqual(await loadSubmissions(kv, legacy), []);
const row: RunRecord = { ...pending.draft, id: "media_existing", requestId: "media_existing", kind: "video", status: "running", urls: [], art: "" };
await assert.rejects(saveHistory([row], denied, undefined, true), /recovery key has been retained/);
await saveHistory([row], kv, undefined, true);
assert.equal((await loadHistory(kv, undefined))[0]?.requestId, "media_existing");
await saveSubmissions([], kv, undefined);
assert.deepEqual(await loadSubmissions(kv, undefined), []);
assert.equal(uncertainSubmission(new Error("Connection lost")), true);
assert.equal(uncertainSubmission(new ApiActionError({ status: 409, code: "saved_mapping_changed", message: "Mapping changed" })), true);
assert.equal(uncertainSubmission(new ApiActionError({ status: 408, message: "Timed out" })), true);
assert.equal(uncertainSubmission(new ApiActionError({ status: 503, message: "Dispatch unavailable" })), true);
assert.equal(uncertainSubmission(new ApiActionError({ status: 503, requestId: "req-http-trace", message: "Dispatch unavailable" })), true);
assert.equal(uncertainSubmission(new ApiActionError({ status: 402, code: "cycle_limit", message: "Cycle full" })), false);
assert.equal(uncertainSubmission(new ApiActionError({ status: 400, code: "invalid_input", message: "Invalid input" })), false);
assert.equal(uncertainSubmission(new ApiActionError({ status: 502, requestId: "media_failed", message: "Failed job" })), false);
assert.match(apiErrorMessage(new ApiActionError({ status: 429, retryAfter: 7, message: "Slow down" })), /7 seconds/);
assert.match(apiErrorMessage(new ApiActionError({ code: "cycle_limit", message: "Cycle full" })), /invoice cycle/);
console.log("Submission durability, accepted job recovery, metadata, and retry classification checks passed.");
