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
import { createPlatformClient } from "./platform";
import type { GenerationStatus, StatusResult } from "./platform";
import { toPlatform } from "./to-platform";

const DEFAULT_BASE_URL = "https://api.dev.pika.art";

export async function savePlatformCredentials(data: unknown) {
  const { apiKey } = parseCredentialInput(data);
  const jar = await cookies();
  jar.set(PLATFORM_KEY_COOKIE, encodeCredentials(apiKey), PLATFORM_KEY_COOKIE_OPTIONS);
}

export async function clearPlatformCredentials() {
  const jar = await cookies();
  jar.set(PLATFORM_KEY_COOKIE, "", { ...PLATFORM_KEY_COOKIE_OPTIONS, maxAge: 0 });
}

export async function hasPlatformCredentials() {
  return (await readStoredCredentials()) !== null;
}

export async function submitGeneration(plane: GenerationPlane) {
  const model = getModel(plane.model);
  const parsed: GenerationPlane = {
    ...plane,
    settings: parseSettings(model, plane.settings),
  };
  const { path, body } = toPlatform(parsed);
  return createPlatformClient(await readCredentials()).submit(path, body);
}

/** Language models answer in one round trip, so there is no job to watch: the
    text comes back from the press itself. */
export async function submitChat(plane: GenerationPlane): Promise<{ text: string }> {
  const model = getModel(plane.model);
  if (!model.chat) throw new Error(`${model.label} is not a language model`);
  const settings = parseSettings(model, plane.settings);
  const system = typeof settings.system === "string" ? settings.system.trim() : "";
  const text = await createPlatformClient(await readCredentials()).chat({
    ...model.chat,
    prompt: plane.prompt.text,
    ...(system ? { system } : {}),
    maxTokens: typeof settings.maxTokens === "number" ? settings.maxTokens : 2048,
    images: (plane.media.reference ?? []).map((item) => item.url),
  });
  return { text };
}

const UPLOAD_TYPE = /^(image|video|audio)\/[a-z0-9.+-]+$/i;

/** A presigned slot on the platform's own storage. The browser PUTs the bytes
    straight to it, so a file never passes through this server. */
export async function createUpload(data: unknown) {
  const payload = asObject(data, "Invalid upload payload");
  const { contentType, sizeBytes } = payload;
  if (typeof contentType !== "string" || !UPLOAD_TYPE.test(contentType)) {
    throw new Error("Unsupported file type");
  }
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("Invalid file size");
  }
  return createPlatformClient(await readCredentials()).upload(contentType, sizeBytes);
}

/** Every request in flight, answered in one round trip. Next dispatches server
    actions one at a time per client, so a poll per run would queue ahead of the
    next submit — the fan-out belongs on this side of the call, where it is
    genuinely parallel. */
export async function getGenerationStatuses(data: unknown): Promise<StatusResult[]> {
  const requestIds = parseRequestIds(data);
  const client = createPlatformClient(await readCredentials());
  return Promise.all(
    requestIds.map(async (requestId): Promise<StatusResult> => {
      try {
        return { requestId, status: await withTranscript(await client.status(requestId)) };
      } catch (caught) {
        return { requestId, error: caught instanceof Error ? caught.message : String(caught) };
      }
    }),
  );
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

/* A transcription delivers a URL to a JSON document; the studio shows words,
   so the document is read here, where the read is not a cross-origin one. */
async function withTranscript(status: GenerationStatus): Promise<GenerationStatus> {
  if (!status.transcript || status.status !== "completed") return status;
  try {
    const response = await fetch(status.transcript.url);
    if (!response.ok) return status;
    const body = (await response.json()) as unknown;
    const text = transcriptText(body);
    return text ? { ...status, text } : status;
  } catch {
    return status;
  }
}

function transcriptText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === null || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.segments)) {
    return record.segments
      .map((segment) => (segment as { text?: unknown })?.text)
      .filter((text): text is string => typeof text === "string")
      .join(" ");
  }
  return JSON.stringify(body, null, 2);
}

function parseRequestIds(data: unknown): string[] {
  const payload = asObject(data, "Invalid status payload");
  const requestIds = payload.requestIds;
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    throw new Error("Invalid request ids");
  }
  return requestIds.map((requestId) => {
    if (typeof requestId !== "string" || !requestId) throw new Error("Invalid request id");
    return requestId;
  });
}

function asObject(data: unknown, message: string): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error(message);
  return data as Record<string, unknown>;
}
