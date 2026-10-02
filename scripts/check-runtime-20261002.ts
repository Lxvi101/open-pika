import assert from "node:assert/strict";

import { createPlatformClient, PlatformError, safeTranscriptText } from "../src/generation/platform";

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

async function main() {
  const submitted: Array<{ key: string | null; body: string | null; redirect: RequestRedirect | undefined }> = [];
  let submitCalls = 0;
  const retryClient = createPlatformClient({
    apiKey: "test-only", baseUrl: "https://api.dev.pika.art",
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      submitCalls += 1;
      const headers = new Headers(init?.headers);
      submitted.push({ key: headers.get("Idempotency-Key"), body: typeof init?.body === "string" ? init.body : null, redirect: init?.redirect });
      if (submitCalls === 1) throw new TypeError("simulated dropped connection");
      return json({ id: "job-1", status: "queued" });
    }) as typeof fetch,
  });
  const queued = await retryClient.submit("/v1/media/pika/pika-2.5/text-to-video", { prompt: "private prompt" }, "stable-key");
  assert.deepEqual(queued, { requestId: "job-1", status: "queued" });
  assert.equal(submitCalls, 2);
  assert.equal(submitted[0]?.key, "stable-key");
  assert.equal(submitted[1]?.key, submitted[0]?.key);
  assert.equal(submitted[1]?.body, submitted[0]?.body);
  assert.equal(submitted[0]?.redirect, "error");

  let quotePath = "";
  const quoteClient = createPlatformClient({
    apiKey: "", baseUrl: "https://api.dev.pika.art",
    fetch: (async (input: RequestInfo | URL) => {
      quotePath = new URL(input instanceof Request ? input.url : input.toString()).pathname;
      return json({ micro_usd: 12500, sell_usd: "0.0125" });
    }) as typeof fetch,
  });
  assert.deepEqual(await quoteClient.quote("pika/pika-2.5/text-to-video", { prompt: "x" }), { micro_usd: 12500, sell_usd: "0.0125" });
  assert.equal(quotePath, "/catalog/apis/pika%2Fpika-2.5%2Ftext-to-video/quote");

  const api = createPlatformClient({
    apiKey: "test-only", baseUrl: "https://api.dev.pika.art",
    fetch: (async () => json({ error: { message: "slow down", code: "rate_limited" } }, 429, { "Retry-After": "7", "X-Request-ID": "req-7" })) as typeof fetch,
  });
  await assert.rejects(api.balance(), (error: unknown) => {
    assert.ok(error instanceof PlatformError);
    assert.equal(error.status, 429);
    assert.equal(error.code, "rate_limited");
    assert.equal(error.retryAfter, 7);
    assert.equal(error.requestId, "req-7");
    return true;
  });

  const statusClient = createPlatformClient({
    apiKey: "test-only", baseUrl: "https://api.dev.pika.art",
    fetch: (async () => json({
      id: "job-2", status: "completed", output: { media_type: "videos", videos: [{ url: "https://cdn.pika.art/a.mp4" }, { url: "https://cdn.pika.art/b.mp4" }] },
      usage: { output_frames: 120 }, billing: { state: "settled", charge_micro_usd: 49000 },
    })) as typeof fetch,
  });
  assert.deepEqual(await statusClient.status("job-2"), {
    requestId: "job-2", status: "completed", videos: [{ url: "https://cdn.pika.art/a.mp4" }, { url: "https://cdn.pika.art/b.mp4" }],
    usage: { output_frames: 120 }, billing: { state: "settled", charge_micro_usd: 49000 },
  });

  const pendingClient = createPlatformClient({
    apiKey: "test-only", baseUrl: "https://api.dev.pika.art",
    fetch: (async () => json({ id: "job-3", status: "completed", billing: { state: "pending" } })) as typeof fetch,
  });
  assert.deepEqual(await pendingClient.status("job-3"), { requestId: "job-3", status: "completed", billingState: "pending" });

  let transcriptFetches = 0;
  const transcriptFetch = (async () => { transcriptFetches += 1; return json({ text: "safe transcript" }); }) as typeof fetch;
  assert.equal(await safeTranscriptText("http://127.0.0.1/private", "https://api.dev.pika.art", transcriptFetch), undefined);
  assert.equal(transcriptFetches, 0);
  assert.equal(await safeTranscriptText("https://cdn.pika.art/transcript.json", "https://api.dev.pika.art", transcriptFetch), "safe transcript");
  assert.equal(transcriptFetches, 1);

  const streamCases = [
    { protocol: "openai" as const, model: "openai/gpt-5.5", path: "/v1/chat/completions" },
    { protocol: "anthropic" as const, model: "anthropic/claude-sonnet-5", path: "/anthropic/v1/messages" },
    { protocol: "genai" as const, model: "google/gemini-3.1-pro", path: "/genai/v1beta/models/gemini-3.1-pro:streamGenerateContent", search: "?alt=sse" },
  ];
  for (const testCase of streamCases) {
    let streamUrl = "";
    let streamBody: Record<string, unknown> = {};
    let streamHeaders = new Headers();
    const streamingClient = createPlatformClient({
      apiKey: "test-only", baseUrl: "https://api.dev.pika.art",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        streamUrl = url.pathname + url.search;
        streamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        streamHeaders = new Headers(init?.headers);
        return new Response('data: {"choices":[]}\n\n', { headers: { "content-type": "text/event-stream" } });
      }) as typeof fetch,
    });
    const response = await streamingClient.chatStream({
      protocol: testCase.protocol, model: testCase.model, prompt: "private prompt", maxTokens: 64,
    });
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(streamUrl, testCase.path + ("search" in testCase ? testCase.search : ""));
    if (testCase.protocol === "genai") assert.equal("stream" in streamBody, false);
    else assert.equal(streamBody.stream, true);
    assert.equal(streamHeaders.get("accept"), "text/event-stream");
    assert.equal(streamHeaders.get("x-api-key"), "test-only");
  }

  console.log("runtime checks passed: safe idempotent retry, structured errors, multi-video/billing mapping, transcript host checks, vendor SSE requests");
}

await main();
