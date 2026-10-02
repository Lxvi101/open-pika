import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel, parseSettings } from "../src/generation/catalog";
import type { GenerationPlane } from "../src/generation/catalog";
import { toPlatform } from "../src/generation/to-platform";
import { generationValidation } from "../src/generation/validation";
import { estimateCost } from "../src/generation/cost";
import { applyLipSync } from "../src/generation/lipsync/adapters";
import { encodeClip, SAMPLE_RATE, validateWave } from "../src/generation/lipsync/audio";
import { speechCredentials, transcribe, transcriptText, transcriptionDefinition } from "../src/generation/lipsync/azure";
import { carrierSizes, createVideoCarrier } from "../src/generation/lipsync/video";

const model = getModel("seedance-2.5");
const plane: GenerationPlane = {
  model: model.id, prompt: { text: "A woman speaking to camera, wearing @Image1." },
  media: {
    reference: [{ id: "clothes", role: "reference", url: "https://example.com/clothes.jpg" }],
    start: [{ id: "face", role: "start", url: "https://example.com/face.jpg" }],
    audio: [{ id: "ambience", role: "audio", url: "https://example.com/ambience.wav", duration: 2 }],
  },
  settings: { ...parseSettings(model, {}), generateAudio: false, omniReferenceTaskType: "edit" },
  lipSync: { mode: "audio", url: "https://example.com/voice.wav", duration: 8, transcript: '[0.00–2.20s] Nora: "Hello, um, how are you?"' },
};
const original = structuredClone(plane);
const request = toPlatform(plane);
assert.deepEqual(plane, original, "mapping must not mutate the stored plane");
assert.equal(request.path, "/v1/media/bytedance/seedance-2.5/reference-to-video");
assert.equal(request.body.generate_audio, true);
assert.equal(request.body.duration, 8);
assert.equal(request.body.omni_reference_task_type, "reference");
assert.deepEqual(request.body.audio_urls, ["https://example.com/ambience.wav", "https://example.com/voice.wav"]);
assert.deepEqual(request.body.image_urls, ["https://example.com/clothes.jpg", "https://example.com/face.jpg"]);
assert.match(String(request.body.prompt), /Begin with the composition in @Image2/);
assert.match(String(request.body.prompt), /soundtrack is @Audio2/);
assert.match(String(request.body.prompt), /Hello, um, how are you/);
assert.equal(generationValidation(plane), null);
assert.equal(toPlatform({ ...plane, settings: parseSettings(model, plane.settings) }).body.duration, 8);
assert.throws(() => toPlatform({ ...plane, lipSync: { ...plane.lipSync!, duration: 8.2 } }), /whole-second/);
assert.throws(() => toPlatform({ ...plane, lipSync: { ...plane.lipSync!, transcript: "" } }), /transcript/);
assert.throws(() => toPlatform({ ...plane, model: "seedance-2.0" }), /not supported/);
assert.throws(() => toPlatform({ ...plane, lipSync: { ...plane.lipSync!, duration: 30 } }), /total at most/);
const pro: GenerationPlane = { ...plane, media: { start: plane.media.start }, lipSync: { ...plane.lipSync!, mode: "video", aspectRatio: "9:16" } };
const proRequest = toPlatform(pro);
assert.equal(proRequest.body.ratio, "9:16");
assert.deepEqual(proRequest.body.video_urls, ["https://example.com/voice.wav"]);
assert.equal(proRequest.body.audio_urls, undefined);
assert.match(String(proRequest.body.prompt), /audio track from @Video1/);
assert.equal(generationValidation(pro), null);
assert.throws(() => toPlatform({ ...pro, lipSync: { ...pro.lipSync!, aspectRatio: "adaptive" } }), /explicit aspect ratio/);
const audioEstimate = estimateCost({ ...plane, media: {} }, { requests: 1, outputs: 1 });
const proEstimate = estimateCost(pro, { requests: 1, outputs: 1 });
assert.equal(audioEstimate?.kind, "total"); assert.equal(proEstimate?.kind, "total");
if (audioEstimate?.kind === "total" && proEstimate?.kind === "total") assert.ok(proEstimate.usd > audioEstimate.usd, "Pro uses video-input pricing");
assert.equal(applyLipSync(plane).lipSync, undefined);

const samples = new Float32Array(SAMPLE_RATE * 6);
for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / SAMPLE_RATE * Math.PI * 2 * 440) * .2;
const wav = encodeClip(samples, 1.251, 4);
assert.equal(wav.byteLength, 44 + SAMPLE_RATE * 4 * 2);
assert.equal(validateWave(wav), 4);
assert.throws(() => validateWave(wav.slice(0, -2)), /Prepare a WAV/);
assert.throws(() => validateWave(new ArrayBuffer(8)), /size/);
assert.throws(() => encodeClip(samples, -1, 4), /valid start/);
assert.throws(() => encodeClip(samples, 0, 4.2), /whole-second/);
const firstSample = samples[Math.round(1.251 * SAMPLE_RATE)]!;
assert.equal(new DataView(wav).getInt16(44, true), Math.round(firstSample * (firstSample < 0 ? 32768 : 32767)));
const padded = new DataView(encodeClip(samples, 5, 4));
assert.equal(padded.getInt16(44 + SAMPLE_RATE * 3 * 2, true), 0, "short recording padded with silence");
assert.throws(() => speechCredentials("https://example.com", "test"), /resource endpoint/);
assert.throws(() => speechCredentials("http://my-resource.cognitiveservices.azure.com", "test"), /resource endpoint/);
assert.throws(() => speechCredentials("https://my-resource.cognitiveservices.azure.com/path", "test"), /resource endpoint/);
assert.throws(() => speechCredentials("https://my-resource.cognitiveservices.azure.com", "line\nbreak"), /valid Azure/);
assert.equal(transcriptText({ phrases: [{ text: "Hello", speaker: 0, offsetMilliseconds: 250, durationMilliseconds: 750 }] }), "[0.25–1.00s] Speaker 1: Hello");
assert.throws(() => transcriptText({ phrases: [] }), /No speech/);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "https://test-resource.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15");
    const form = init?.body as FormData;
    assert.deepEqual(JSON.parse(String(form.get("definition"))), transcriptionDefinition);
    assert.equal((form.get("audio") as File).size, wav.byteLength);
    assert.equal((init?.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"], "fake-test-key");
    return Response.json({ combinedPhrases: [{ text: "Hello" }] });
  };
  assert.equal(await transcribe(new Blob([wav]), speechCredentials("https://test-resource.cognitiveservices.azure.com", "fake-test-key")), "Hello");
} finally { globalThis.fetch = originalFetch; }

const directory = await mkdtemp(join(tmpdir(), "lip-sync-check-"));
try {
  for (const [ratio, size] of Object.entries(carrierSizes)) {
    const bytes = await createVideoCarrier(new Uint8Array(wav), 4, ratio);
    const path = join(directory, `${ratio.replace(":", "-")}.mp4`);
    await writeFile(path, bytes);
    const { stdout } = await promisify(execFile)(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]);
    const metadata = JSON.parse(stdout);
    const video = metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
    const audio = metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
    assert.equal(`${video.width}x${video.height}`, size);
    assert.equal(video.r_frame_rate, "30/1");
    assert.equal(Number(video.duration), 4);
    assert.equal(Number(audio.duration), 4);
    assert.equal(Number(metadata.format.duration), 4);
    assert.equal(Number(audio.start_time), 0);
    assert.ok(video.width * video.height >= 407696);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("Lip sync: routing, timing, reference indices, prompt, pricing, Azure request and all 6 MP4 aspect ratios passed. No paid APIs called.");
