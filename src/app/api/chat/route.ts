import { cookies } from "next/headers";

import { readPlatformOptions } from "@/generation/actions";
import { getModel, parseSettings } from "@/generation/catalog";
import { PLATFORM_KEY_COOKIE, decodeCredentials } from "@/generation/credentials";
import { createPlatformClient, toActionError } from "@/generation/platform";
import { chatTextDeltas } from "@/generation/stream";
import type { GenerationPlane } from "@/generation/catalog/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const jar = await cookies();
    const credentials = decodeCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value);
    if (!credentials) return Response.json({ message: "Missing platform key" }, { status: 401 });

    const raw = await readBoundedText(request, 1024 * 1024);
    const plane = parsePlane(JSON.parse(raw) as unknown);
    const model = getModel(plane.model);
    if (!model.chat) throw new Error(`${model.label} is not a language model`);
    const settings = parseSettings(model, plane.settings);
    const system = typeof settings.system === "string" ? settings.system.trim() : "";
    const chatRequest = {
      ...model.chat,
      prompt: plane.prompt.text,
      ...(system ? { system } : {}),
      maxTokens: typeof settings.maxTokens === "number" ? settings.maxTokens : 2048,
      images: (plane.media.reference ?? []).map((item) => item.url),
    };
    const options = await readPlatformOptions();
    const client = createPlatformClient({ ...credentials, ...options });

    /* Chat has no quote endpoint. Refuse an obviously empty prepaid account;
       streaming output size is unknown, so this cannot estimate total spend. */
    const balance = await client.balance();
    if (!hasAvailableCredit(balance)) {
      return Response.json({ message: "No available balance for chat" }, { status: 402 });
    }
    const abort = new AbortController();
    const upstream = await client.chatStream(chatRequest, AbortSignal.any([request.signal, abort.signal]));
    let cancelled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const text of chatTextDeltas(upstream, model.chat!.protocol)) {
            if (cancelled) break;
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "text", text })}\n`));
          }
          if (!cancelled) {
            controller.enqueue(encoder.encode('{"type":"done"}\n'));
            controller.close();
          }
        } catch (caught) {
          if (!cancelled) {
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", ...toActionError(caught) })}\n`));
            controller.close();
          }
        }
      },
      cancel() { cancelled = true; abort.abort(); },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-content-type-options": "nosniff" },
    });
  } catch (caught) {
    const error = toActionError(caught);
    const status = error.status ?? 400;
    return Response.json(error, { status, headers: error.retryAfter !== undefined ? { "retry-after": String(error.retryAfter) } : undefined });
  }
}

function parsePlane(data: unknown): GenerationPlane {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid chat request");
  const value = data as Record<string, unknown>;
  const prompt = value.prompt && typeof value.prompt === "object" ? value.prompt as Record<string, unknown> : {};
  const media = value.media && typeof value.media === "object" ? value.media as GenerationPlane["media"] : {};
  if (typeof value.model !== "string" || typeof prompt.text !== "string" || !prompt.text.trim()) {
    throw new Error("Model and prompt are required");
  }
  const settings = value.settings && typeof value.settings === "object" && !Array.isArray(value.settings)
    ? value.settings as Record<string, unknown> : {};
  return { model: value.model, prompt: { text: prompt.text }, media, settings };
}

async function readBoundedText(request: Request, maximum: number): Promise<string> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > maximum)) {
    throw Object.assign(new Error("Chat request exceeds 1 MB"), { status: 413 });
  }
  if (!request.body) throw new Error("Missing chat request body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw Object.assign(new Error("Chat request exceeds 1 MB"), { status: 413 });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function hasAvailableCredit(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const balance = value as Record<string, unknown>;
  const postpaid = balance.postpaid && typeof balance.postpaid === "object"
    ? balance.postpaid as Record<string, unknown> : {};
  if (postpaid.active === true) {
    const cycle = postpaid.cycle && typeof postpaid.cycle === "object" ? postpaid.cycle as Record<string, unknown> : {};
    return typeof cycle.remaining_micro_usd === "number" && cycle.remaining_micro_usd > 0;
  }
  return typeof balance.balance_micro_usd === "number" && balance.balance_micro_usd > 0;
}
