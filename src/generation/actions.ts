"use server";

import { cookies } from "next/headers";

import { getModel, parseSettings } from "./catalog";
import type { GenerationPlane } from "./catalog/types";
import {
  MissingCredentialsError,
  PLATFORM_KEY_COOKIE,
  PLATFORM_KEY_COOKIE_OPTIONS,
  decodeCredentials,
  encodeCredentials,
  parseCredentialInput,
} from "./credentials";
import { createPlatformClient, PlatformError, safeTranscriptText, toActionError } from "./platform";
import type {
  ActionError, ActionResult, GenerationStatus, StatusResult,
} from "./platform";
import { toPlatform } from "./to-platform";
import { validateRequestBody } from "./validation";
import { createSignedUploadTicket } from "./relay-ticket";

const DEFAULT_BASE_URL = "https://api.dev.pika.art";
type SafeOptions = { baseUrl: string };
type Quote = { micro_usd: number; sell_usd: string };
export type { Quote };
export type ExpectedGenerationRequest = { path: string; body: Record<string, unknown> };
type BillingBalance = {
  balance_micro_usd: number;
  postpaid?: { active: boolean; cycle?: { remaining_micro_usd?: number } | null } | null;
};
type PreflightResult = {
  quote: Quote;
  required_micro_usd: number;
  available_micro_usd: number;
  billingMode: "prepaid" | "postpaid";
  withinListPriceCapacity: boolean;
  advisory?: { code: "list_price_exceeds_capacity"; message: string };
};

export async function savePlatformCredentials(data: unknown) {
  const { apiKey } = parseCredentialInput(data);
  const jar = await cookies();
  jar.set(PLATFORM_KEY_COOKIE, encodeCredentials(apiKey), PLATFORM_KEY_COOKIE_OPTIONS);
}
export async function clearPlatformCredentials() {
  const jar = await cookies();
  jar.set(PLATFORM_KEY_COOKIE, "", { ...PLATFORM_KEY_COOKIE_OPTIONS, maxAge: 0 });
}
export async function hasPlatformCredentials() { return (await readStoredCredentials()) !== null; }

/** Contains no credential material and is safe for route handlers that need the configured origin. */
export async function readPlatformOptions(): Promise<SafeOptions> {
  return { baseUrl: process.env.PIKA_API_BASE_URL || DEFAULT_BASE_URL };
}

export async function submitGeneration(
  plane: GenerationPlane,
  idempotencyKey?: string,
  expectedRequest?: ExpectedGenerationRequest,
): Promise<ActionResult<{ status: string; requestId: string }>> {
  return result(async () => {
    const { path, body } = prepareRequest(plane);
    if (expectedRequest && (expectedRequest.path !== path || canonical(expectedRequest.body) !== canonical(body))) {
      throw new ResultError({ message: "This saved submission needs its original request mapping to recover. Its recovery key has been retained.", status: 409, code: "saved_mapping_changed" });
    }
    const stableKey = validateIdempotencyKey(idempotencyKey) ?? crypto.randomUUID();
    return createPlatformClient(await readCredentials()).submit(path, body, stableKey);
  });
}

export async function submitChat(plane: GenerationPlane): Promise<ActionResult<{ text: string }>> {
  return result(async () => {
    const model = getModel(plane.model);
    if (!model.chat) throw new Error(`${model.label} is not a language model`);
    const settings = parseSettings(model, plane.settings);
    const system = typeof settings.system === "string" ? settings.system.trim() : "";
    const text = await createPlatformClient(await readCredentials()).chat({
      ...model.chat, prompt: plane.prompt.text, ...(system ? { system } : {}),
      maxTokens: typeof settings.maxTokens === "number" ? settings.maxTokens : 2048,
      images: (plane.media.reference ?? []).map((item) => item.url),
    });
    return { text };
  });
}

/** Public quote action: no API key is required by the catalog quote endpoint. */
export async function getGenerationQuote(plane: GenerationPlane): Promise<ActionResult<Quote>> {
  return result(async () => {
    const { path, body } = prepareRequest(plane);
    const apiId = path.replace(/^\/v1\/media\//, "");
    const quote = await publicClient().quote(apiId, body);
    const data = asObject(quote);
    if (typeof data.micro_usd !== "number" || typeof data.sell_usd !== "string") throw new Error("Quote response was invalid");
    return { micro_usd: data.micro_usd, sell_usd: data.sell_usd };
  });
}

/** Compare the public list-price quote with capacity for guidance; org discounts make it non-authoritative. */
export async function preflightGeneration(plane: GenerationPlane, requests: number): Promise<ActionResult<PreflightResult>> {
  return result(async () => {
    if (!Number.isSafeInteger(requests) || requests < 1 || requests > 100) throw new Error("Request count must be an integer from 1 to 100");
    const quoteResult = await getGenerationQuote(plane);
    if (!quoteResult.ok) throw new ResultError(quoteResult.error);
    const required = quoteResult.value.micro_usd * requests;
    if (!Number.isSafeInteger(required)) throw new Error("Requested total exceeds the supported billing range");
    const balance = asObject(await createPlatformClient(await readCredentials()).balance()) as BillingBalance;
    const postpaid = balance.postpaid;
    if (postpaid?.active) {
      const available = postpaid.cycle?.remaining_micro_usd;
      if (typeof available !== "number") throw new Error("Postpaid cycle capacity is unavailable");
      return preflightValue(quoteResult.value, required, available, "postpaid");
    }
    const available = balance.balance_micro_usd;
    if (typeof available !== "number") throw new Error("Billing balance is unavailable");
    return preflightValue(quoteResult.value, required, available, "prepaid");
  });
}

export async function createUpload(data: unknown): Promise<ActionResult<Awaited<ReturnType<typeof createSignedUploadTicket>>>> {
  return result(async () => {
    const payload = asObject(data); const { contentType, sizeBytes } = payload;
    if (typeof contentType !== "string" || !/^(image|video|audio)\/[a-z0-9.+-]+$/i.test(contentType)) throw new Error("Unsupported file type");
    if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error("Invalid file size");
    return createSignedUploadTicket(await readCredentials(), contentType, sizeBytes);
  });
}

export async function getGenerationStatuses(data: unknown): Promise<StatusResult[]> {
  const requestIds = parseRequestIds(data);
  const client = createPlatformClient(await readCredentials());
  return Promise.all(requestIds.map(async (requestId): Promise<StatusResult> => {
    try { return { requestId, status: await readCompleteStatus(client, requestId) }; }
    catch (error) { return { requestId, error: toActionError(error) }; }
  }));
}

/** Explicit one-shot status refresh used to re-read durable billing settlement. */
export async function getGenerationStatus(requestId: string): Promise<ActionResult<GenerationStatus>> {
  return result(async () => readCompleteStatus(createPlatformClient(await readCredentials()), validateRequestId(requestId)));
}

export async function getBillingBalance(): Promise<ActionResult<unknown>> {
  return result(async () => createPlatformClient(await readCredentials()).balance());
}
export async function getSpendDaily(params: { start_date: string; end_date: string; api_key_id?: string; model?: string }): Promise<ActionResult<unknown>> {
  return result(async () => createPlatformClient(await readCredentials()).spendDaily({ startDate: params.start_date, endDate: params.end_date, apiKeyId: params.api_key_id, model: params.model }));
}
export async function getMonthlyReport(month: string): Promise<ActionResult<unknown>> {
  return result(async () => createPlatformClient(await readCredentials()).monthly(month));
}
export async function getMonthlyCsv(month: string): Promise<ActionResult<string>> {
  return result(async () => createPlatformClient(await readCredentials()).monthlyCsv(month));
}
export async function getWebhookDeliveries(params: { limit?: number; cursor?: string }): Promise<ActionResult<unknown>> {
  return result(async () => createPlatformClient(await readCredentials()).webhookDeliveries({ limit: params.limit ?? 20, cursor: params.cursor }));
}
export async function getJobContent(id: string): Promise<ActionResult<unknown>> {
  return result(async () => createPlatformClient(await readCredentials()).jobContent(id));
}
export async function deleteRemoteJob(id: string): Promise<ActionResult<{ pending: boolean }>> {
  return result(async () => {
    try {
      await createPlatformClient(await readCredentials()).deleteJob(id);
      return { pending: false };
    } catch (error) {
      // The API accepts the purge and finishes it in the background on this specific 503 response.
      if (error instanceof PlatformError && error.status === 503) return { pending: true };
      throw error;
    }
  });
}
export async function deleteRemoteUpload(url: string): Promise<ActionResult<null>> {
  return result(async () => createPlatformClient(await readCredentials()).deleteUpload(url));
}

async function readCompleteStatus(client: ReturnType<typeof createPlatformClient>, requestId: string): Promise<GenerationStatus> {
  let status = await client.status(requestId);
  if (status.transcript && status.status === "completed") {
    const text = await safeTranscriptText(status.transcript.url, (await readPlatformOptions()).baseUrl);
    if (text) status = { ...status, text };
  }
  return status;
}

function preparePlane(plane: GenerationPlane): GenerationPlane {
  const model = getModel(plane.model);
  return { ...plane, settings: parseSettings(model, plane.settings) };
}
function preflightValue(quote: Quote, required: number, available: number, billingMode: PreflightResult["billingMode"]): PreflightResult {
  const withinListPriceCapacity = required <= available;
  return {
    quote,
    required_micro_usd: required,
    available_micro_usd: available,
    billingMode,
    withinListPriceCapacity,
    ...(!withinListPriceCapacity ? {
      advisory: {
        code: "list_price_exceeds_capacity" as const,
        message: "The public list-price quote exceeds the displayed capacity; organization discounts may apply, so generation can still be attempted.",
      },
    } : {}),
  };
}
function prepareRequest(plane: GenerationPlane): { path: string; body: Record<string, unknown> } {
  let mapped: ReturnType<typeof toPlatform>;
  try {
    mapped = toPlatform(preparePlane(plane));
  } catch (error) {
    if (error instanceof ResultError) throw error;
    throw new ResultError({ message: error instanceof Error ? error.message : "Invalid generation request", status: 400, code: "invalid_input" });
  }
  const apiId = mapped.path.replace(/^\/v1\/media\//, "");
  const issue = validateRequestBody(apiId, mapped.body);
  if (issue) throw new ResultError({ message: issue, status: 400, code: "invalid_input" });
  return mapped;
}
function validateIdempotencyKey(key?: string): string | undefined {
  if (key === undefined) return undefined;
  if (typeof key !== "string" || key.length < 1 || key.length > 200 || /[\r\n]/.test(key)) throw new Error("Invalid idempotency key");
  return key;
}
function validateRequestId(id: string): string { if (typeof id !== "string" || !id || id.length > 256) throw new Error("Invalid request id"); return id; }
function parseRequestIds(data: unknown): string[] {
  const payload = asObject(data); const ids = payload.requestIds;
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("Invalid request ids");
  return ids.map((id) => validateRequestId(id as string));
}
function asObject(data: unknown): Record<string, any> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid request payload");
  return data as Record<string, any>;
}
async function result<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try { return { ok: true, value: await fn() }; }
  catch (error) { return { ok: false, error: error instanceof ResultError ? error.details : toActionError(error) }; }
}
class ResultError extends Error {
  constructor(readonly details: ActionError) { super(details.message); }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function publicClient() {
  return createPlatformClient({ apiKey: "", baseUrl: process.env.PIKA_API_BASE_URL || DEFAULT_BASE_URL });
}
async function readStoredCredentials() {
  const jar = await cookies();
  return decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value);
}
async function readCredentials() {
  const stored = await readStoredCredentials();
  if (!stored) throw new MissingCredentialsError();
  return { ...stored, baseUrl: process.env.PIKA_API_BASE_URL || DEFAULT_BASE_URL };
}
