import type { ChatProtocol } from "./catalog/types";

const MEDIA_PATH = /^\/v1\/media\/[a-z0-9][a-z0-9._/-]*$/i;
const TRANSCRIPT_MAX_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 30_000;
const CHAT_STREAM_TIMEOUT_MS = 10 * 60_000;

export type ActionError = {
  message: string;
  status?: number;
  code?: string;
  retryAfter?: number;
  requestId?: string;
};
export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: ActionError };

export class PlatformError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly retryAfter?: number;
  readonly requestId?: string;

  constructor(error: ActionError) {
    super(error.message);
    this.name = "PlatformError";
    this.status = error.status;
    this.code = error.code;
    this.retryAfter = error.retryAfter;
    this.requestId = error.requestId;
  }
}

export type QueuedGeneration = { status: string; requestId: string };
export type GenerationStatus = {
  status: string;
  requestId: string;
  images?: Array<{ url: string }>;
  videos?: Array<{ url: string }>;
  video?: { url: string };
  audio?: { url: string };
  transcript?: { url: string };
  text?: string;
  errorCode?: string;
  error?: unknown;
  usage?: Record<string, unknown>;
  /** Billing is retained only after the platform marks it durable. */
  billing?: BillingSettled;
  billingState?: "pending" | "unavailable";
};
export type BillingSettled = { state: "settled"; charge_micro_usd: number };
export type BillingPending = { state: "pending" };
export type BillingUnavailable = { state: "unavailable" };
export type ChatRequest = {
  protocol: ChatProtocol;
  model: string;
  prompt: string;
  system?: string;
  maxTokens: number;
  images?: string[];
};
export type StatusResult =
  | { requestId: string; status: GenerationStatus }
  | { requestId: string; error: ActionError };
export type PlatformClientOptions = { apiKey: string; baseUrl: string; fetch?: typeof fetch };
export type DailySpendParams = {
  startDate: string;
  endDate: string;
  apiKeyId?: string;
  model?: string;
};
export type WebhookDeliveryParams = {
  endpointId?: string;
  status?: string;
  sourceId?: string;
  limit?: number;
  cursor?: string;
};

export function isMediaPath(path: string): boolean {
  return MEDIA_PATH.test(path) && !path.includes("..");
}

export function createPlatformClient(options: PlatformClientOptions) {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "https:" && !(isLocalhost(base.hostname) && base.protocol === "http:")) {
    throw new PlatformError({ message: "Platform API must use HTTPS" });
  }
  const baseUrl = base.toString().replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;

  async function send(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
    headers?: Record<string, string>,
    query?: URLSearchParams,
    retryNetwork = method === "GET",
  ): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`);
    query?.forEach((value, key) => url.searchParams.set(key, value));
    const init: RequestInit = {
      method,
      headers: {
        ...(options.apiKey ? { "X-API-Key": options.apiKey } : {}),
        ...headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (retryNetwork) {
        try {
          response = await fetchImpl(url, init);
        } catch {
          throw new PlatformError({ message: "Network request failed; retry safely using the same request key" });
        }
      } else {
        throw new PlatformError({ message: "Network request failed; the result may be uncertain" });
      }
    }
    const payload = await readJson(response);
    if (!response.ok) throw platformError(response, payload);
    return payload;
  }

  return {
    async submit(path: string, input: Record<string, unknown>, idempotencyKey: string): Promise<QueuedGeneration> {
      if (!isMediaPath(path)) throw new PlatformError({ status: 400, message: "Invalid operation" });
      return mapQueued(await send("POST", path, input, { "Idempotency-Key": idempotencyKey }, undefined, true));
    },
    async status(requestId: string): Promise<GenerationStatus> {
      if (!requestId) throw new PlatformError({ status: 400, message: "Missing request id" });
      return mapStatus(await send("GET", `/v1/media/jobs/${encodeURIComponent(requestId)}`));
    },
    async upload(contentType: string, sizeBytes: number): Promise<UploadTicket> {
      return mapUpload(await send("POST", "/v1/media/uploads", { content_type: contentType, size_bytes: sizeBytes }, undefined, undefined, false));
    },
    async quote(apiId: string, input: Record<string, unknown>): Promise<unknown> {
      if (!apiId || apiId.includes("..")) throw new PlatformError({ status: 400, message: "Invalid API id" });
      return send("POST", `/catalog/apis/${encodeURIComponent(apiId)}/quote`, input, undefined, undefined, false);
    },
    balance(): Promise<unknown> { return send("GET", "/billing/balance"); },
    spendDaily(params: DailySpendParams): Promise<unknown> {
      const query = new URLSearchParams({ start_date: params.startDate, end_date: params.endDate });
      if (params.apiKeyId) query.set("api_key_id", params.apiKeyId);
      if (params.model) query.set("model", params.model);
      return send("GET", "/billing/spend/daily", undefined, undefined, query);
    },
    monthly(month: string): Promise<unknown> { return send("GET", `/billing/monthly/${encodeURIComponent(validMonth(month))}`); },
    monthlyCsv(month: string): Promise<string> { return sendText("GET", `/billing/monthly/${encodeURIComponent(validMonth(month))}/csv`); },
    jobContent(id: string): Promise<unknown> { return send("GET", `/v1/media/jobs/${encodeURIComponent(validId(id))}/content`); },
    deleteJob(id: string): Promise<null> { return send("DELETE", `/v1/media/jobs/${encodeURIComponent(validId(id))}`).then(() => null); },
    deleteUpload(url: string): Promise<null> {
      const query = new URLSearchParams({ url });
      return send("DELETE", "/v1/media/uploads", undefined, undefined, query).then(() => null);
    },
    webhookDeliveries(params: WebhookDeliveryParams = {}): Promise<unknown> {
      const query = new URLSearchParams();
      if (params.endpointId) query.set("endpoint_id", params.endpointId);
      if (params.status) query.set("status", params.status);
      if (params.sourceId) query.set("source_id", params.sourceId);
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      if (params.cursor) query.set("cursor", params.cursor);
      return send("GET", "/v1/webhooks/deliveries", undefined, undefined, query);
    },
    async chat(request: ChatRequest): Promise<string> {
      const { path, body, headers } = chatRequest(request);
      const text = chatText(request.protocol, await send("POST", path, body, headers, undefined, false));
      if (!text) throw new PlatformError({ status: 502, message: "The model returned no text" });
      return text;
    },
    async chatStream(request: ChatRequest, signal?: AbortSignal): Promise<Response> {
      const { path, body: requestBody, headers } = chatRequest(request);
      const genai = request.protocol === "genai";
      const streamPath = genai
        ? `${path.replace(":generateContent", ":streamGenerateContent")}?alt=sse`
        : path;
      const body = genai ? requestBody : { ...requestBody, stream: true };
      const url = new URL(`${baseUrl}${streamPath}`);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST", headers: {
            ...(options.apiKey ? { "X-API-Key": options.apiKey } : {}), ...headers,
            "Content-Type": "application/json", Accept: "text/event-stream",
          },
          body: JSON.stringify(body), redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(CHAT_STREAM_TIMEOUT_MS)]) : AbortSignal.timeout(CHAT_STREAM_TIMEOUT_MS),
        });
      } catch { throw new PlatformError({ status: 502, code: "upstream_unavailable", message: "Network request failed" }); }
      if (!response.ok) throw platformError(response, await readJson(response));
      return response;
    },
  };

  async function sendText(method: "GET", path: string): Promise<string> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method, headers: { "X-API-Key": options.apiKey }, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch { throw new PlatformError({ message: "Network request failed" }); }
    if (!response.ok) throw platformError(response, await readJson(response));
    return response.text();
  }
}

export type UploadTicket = { uploadUrl: string; headers: Record<string, string>; url: string };

function mapUpload(payload: unknown): UploadTicket {
  const data = asRecord(payload);
  const uploadUrl = stringField(data, "upload_url");
  const url = stringField(data, "url");
  if (!uploadUrl || !url) throw new PlatformError({ status: 502, message: "Upload response missing a URL" });
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(data.headers))) if (typeof value === "string") headers[key] = value;
  return { uploadUrl, headers, url };
}

function chatRequest(request: ChatRequest): { path: string; body: Record<string, unknown>; headers?: Record<string, string> } {
  const images = request.images ?? [];
  if (request.protocol === "anthropic") return {
    path: "/anthropic/v1/messages", headers: { "anthropic-version": "2023-06-01" }, body: {
      model: request.model, max_tokens: request.maxTokens, ...(request.system ? { system: request.system } : {}),
      messages: [{ role: "user", content: [...images.map((url) => ({ type: "image", source: { type: "url", url } })), { type: "text", text: request.prompt }] }],
    },
  };
  if (request.protocol === "genai") {
    const model = request.model.split("/").pop()!;
    return { path: `/genai/v1beta/models/${encodeURIComponent(model)}:generateContent`, body: {
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: request.prompt }] }], generationConfig: { maxOutputTokens: request.maxTokens },
    } };
  }
  return { path: "/v1/chat/completions", body: {
    model: request.model, max_completion_tokens: request.maxTokens,
    messages: [...(request.system ? [{ role: "system", content: request.system }] : []), {
      role: "user", content: images.length ? [{ type: "text", text: request.prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] : request.prompt,
    }],
  } };
}

function chatText(protocol: ChatProtocol, payload: unknown): string {
  const data = asRecord(payload);
  if (protocol === "anthropic") return joinText(data.content);
  if (protocol === "genai") {
    const candidate = asRecord(Array.isArray(data.candidates) ? data.candidates[0] : {});
    return joinText(asRecord(candidate.content).parts);
  }
  const choice = asRecord(Array.isArray(data.choices) ? data.choices[0] : {});
  const content = asRecord(choice.message).content;
  return typeof content === "string" ? content : joinText(content);
}
function joinText(parts: unknown): string { return Array.isArray(parts) ? parts.map((part) => asRecord(part).text).filter((text): text is string => typeof text === "string").join("") : ""; }

function mapQueued(payload: unknown): QueuedGeneration {
  const data = asRecord(payload);
  const requestId = stringField(data, "id");
  if (!requestId) throw new PlatformError({ status: 502, message: "Platform response missing a job id" });
  const status = stringField(data, "status") ?? "queued";
  if (status === "failed") throw new PlatformError(errorFromPayload(data, 402));
  return { status, requestId };
}

function mapStatus(payload: unknown): GenerationStatus {
  const data = asRecord(payload); const output = asRecord(data.output);
  const collect = (list: unknown) => Array.isArray(list) ? list.flatMap((item) => typeof asRecord(item).url === "string" ? [{ url: asRecord(item).url as string }] : []) : undefined;
  const images = collect(output.images); const videos = collect(output.videos);
  const urlOf = (key: string) => typeof asRecord(output[key]).url === "string" ? { url: asRecord(output[key]).url as string } : undefined;
  const billing = asRecord(data.billing);
  const error = asRecord(data.error);
  return {
    status: stringField(data, "status") ?? "unknown", requestId: stringField(data, "id") ?? "",
    ...(images?.length ? { images } : {}), ...(videos?.length ? { videos } : {}),
    ...(urlOf("video") ? { video: urlOf("video") } : {}), ...(urlOf("audio") ? { audio: urlOf("audio") } : {}), ...(urlOf("transcript") ? { transcript: urlOf("transcript") } : {}),
    ...(typeof error.code === "string" ? { errorCode: error.code } : {}), ...(data.error != null ? { error: stringField(error, "message") ?? data.error } : {}),
    ...(data.usage && typeof data.usage === "object" ? { usage: asRecord(data.usage) } : {}),
    ...(billing.state === "settled" && typeof billing.charge_micro_usd === "number"
      ? { billing: { state: "settled" as const, charge_micro_usd: billing.charge_micro_usd } }
      : billing.state === "pending" || billing.state === "unavailable" ? { billingState: billing.state } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringField(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === "string" ? value[key] as string : undefined; }
async function readJson(response: Response): Promise<unknown> { const text = await response.text(); if (!text) return null; try { return JSON.parse(text) as unknown; } catch { return text; } }
function errorFromPayload(payload: unknown, status?: number): ActionError {
  const data = asRecord(payload); const nested = asRecord(data.error);
  const retryHeader = data.retry_after ?? data.retryAfter;
  const retryAfter = typeof retryHeader === "number" && Number.isFinite(retryHeader)
    ? retryHeader
    : typeof retryHeader === "string" && Number.isFinite(Number(retryHeader)) ? Number(retryHeader) : undefined;
  return {
    message: stringField(nested, "message") ?? stringField(data, "message") ?? "Platform request failed",
    ...(status !== undefined ? { status } : {}), ...(stringField(nested, "code") ?? stringField(data, "code") ? { code: stringField(nested, "code") ?? stringField(data, "code") } : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(stringField(data, "request_id") ?? stringField(data, "requestId") ?? stringField(data, "id")
      ? { requestId: stringField(data, "request_id") ?? stringField(data, "requestId") ?? stringField(data, "id") }
      : {}),
  };
}
function platformError(response: Response, payload: unknown): PlatformError {
  const error = errorFromPayload(payload, response.status);
  const retry = response.headers.get("Retry-After");
  const requestId = response.headers.get("X-Request-ID") ?? response.headers.get("X-Request-Id");
  if (error.retryAfter === undefined && retry) {
    const seconds = Number(retry);
    const dateSeconds = (Date.parse(retry) - Date.now()) / 1000;
    if (Number.isFinite(seconds)) error.retryAfter = Math.max(0, seconds);
    else if (Number.isFinite(dateSeconds)) error.retryAfter = Math.max(0, dateSeconds);
  }
  if (!error.requestId && requestId) error.requestId = requestId;
  return new PlatformError(error);
}
export function toActionError(error: unknown): ActionError {
  if (error instanceof PlatformError) return { message: error.message, ...(error.status !== undefined ? { status: error.status } : {}), ...(error.code ? { code: error.code } : {}), ...(error.retryAfter !== undefined ? { retryAfter: error.retryAfter } : {}), ...(error.requestId ? { requestId: error.requestId } : {}) };
  const detail = error instanceof Error ? error as Error & Partial<ActionError> : undefined;
  return {
    message: detail?.message ?? "Request failed",
    ...(typeof detail?.status === "number" ? { status: detail.status } : {}),
    ...(typeof detail?.code === "string" ? { code: detail.code } : {}),
    ...(typeof detail?.retryAfter === "number" ? { retryAfter: detail.retryAfter } : {}),
    ...(typeof detail?.requestId === "string" ? { requestId: detail.requestId } : {}),
  };
}
function isLocalhost(host: string): boolean { return host === "localhost" || host === "127.0.0.1" || host === "[::1]"; }
function validId(id: string): string { if (!id || id.length > 256) throw new PlatformError({ status: 400, message: "Invalid id" }); return id; }
function validMonth(month: string): string { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new PlatformError({ status: 400, message: "Month must be YYYY-MM" }); return month; }

export async function safeTranscriptText(url: string, baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  let target: URL; let base: URL;
  try { target = new URL(url); base = new URL(baseUrl); } catch { return undefined; }
  const allowedHost = target.origin === base.origin || target.hostname === "pika.art" || target.hostname.endsWith(".pika.art");
  const allowedScheme = target.protocol === "https:" || (target.protocol === "http:" && isLocalhost(target.hostname) && target.origin === base.origin);
  if (!allowedHost || !allowedScheme || target.username || target.password) return undefined;
  try {
    const response = await fetchImpl(target, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return undefined;
    const text = await readBoundedText(response, TRANSCRIPT_MAX_BYTES);
    if (text === undefined) return undefined;
    const body = JSON.parse(text) as unknown;
    if (typeof body === "string") return body;
    const record = asRecord(body);
    if (typeof record.text === "string") return record.text;
    if (Array.isArray(record.segments)) return record.segments.map((segment) => stringField(asRecord(segment), "text")).filter((part): part is string => !!part).join(" ");
    return JSON.stringify(body, null, 2);
  } catch { return undefined; }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | undefined> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}
