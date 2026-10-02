import type { GenerationPlane } from "./catalog/types";

export type ChatStreamEvent = { type: "text"; text: string } | { type: "done" } | { type: "error"; message: string; code?: string; status?: number; retryAfter?: number };

/** Consume the app's newline-delimited stream and report cumulative assistant text. */
export async function consumeChatStream(
  plane: GenerationPlane,
  onText: (cumulativeText: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string }> {
  const response = await fetchImpl("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(plane),
  });
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error("Chat stream returned no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let completed = false;
  const acceptLine = (line: string) => {
    if (!line.trim()) return;
    let event: ChatStreamEvent;
    try { event = JSON.parse(line) as ChatStreamEvent; }
    catch { throw new Error("Chat stream returned invalid data"); }
    if (event.type === "text" && typeof event.text === "string") {
      text += event.text;
      onText(text);
    } else if (event.type === "error") {
      throw Object.assign(new Error(typeof event.message === "string" ? event.message : "Chat stream failed"), { code: event.code, status: event.status, retryAfter: event.retryAfter });
    } else if (event.type === "done") completed = true;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).trimEnd();
        pending = pending.slice(newline + 1);
        acceptLine(line);
      }
      if (done) break;
    }
    if (pending) acceptLine(pending);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!completed) throw new Error("Chat stream ended before completion");
  return { text };
}

export async function* chatTextDeltas(
  response: Response,
  protocol: "openai" | "anthropic" | "genai",
): AsyncGenerator<string> {
  if (!response.body) throw new Error("The model returned no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  const inspect = (line: string) => {
    const raw = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (raw === "[DONE]") { completed = true; return ""; }
    let record: Record<string, unknown> = {};
    try { record = JSON.parse(raw) as Record<string, unknown>; } catch {
      if (line.startsWith("data:")) throw new Error("The model returned malformed stream data");
      return "";
    }
    if (!record || typeof record !== "object") return "";
    if (record.error || record.type === "error") {
      const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : record;
      throw Object.assign(new Error(typeof error.message === "string" ? error.message : "The model stream failed"), { code: error.code ?? error.type, status: 502 });
    }
    if (protocol === "anthropic" && record.type === "message_stop") completed = true;
    if (protocol === "genai" && Array.isArray(record.candidates) && record.candidates.some((candidate) => candidate && typeof candidate === "object" && typeof candidate.finishReason === "string")) completed = true;
    if (protocol === "openai" && Array.isArray(record.choices) && record.choices.some((choice) => choice && typeof choice === "object" && choice.finish_reason != null)) completed = true;
    return parseUpstreamLine(line, protocol);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 1_048_576) throw new Error("The model stream event exceeds 1 MB");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        const delta = inspect(line);
        if (delta) yield delta;
      }
      if (done) break;
    }
    const delta = inspect(pending.trim());
    if (delta) yield delta;
    if (!completed) throw new Error("The model stream ended before completion");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function parseUpstreamLine(line: string, protocol: "openai" | "anthropic" | "genai"): string {
  if (!line || line.startsWith(":")) return "";
  const raw = line.startsWith("data:") ? line.slice(5).trim() : line;
  if (!raw || raw === "[DONE]") return "";
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return ""; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  if (protocol === "anthropic") {
    const delta = record.delta;
    return delta && typeof delta === "object" && typeof (delta as Record<string, unknown>).text === "string"
      ? (delta as Record<string, string>).text : "";
  }
  if (protocol === "genai") {
    const candidates = record.candidates;
    const content = Array.isArray(candidates) ? (candidates[0] as Record<string, unknown> | undefined)?.content : undefined;
    const parts = content && typeof content === "object" ? (content as Record<string, unknown>).parts : undefined;
    return Array.isArray(parts) ? parts.map((part) => part && typeof part === "object" ? (part as Record<string, unknown>).text : "").filter((part): part is string => typeof part === "string").join("") : "";
  }
  const choices = record.choices;
  const delta = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined)?.delta : undefined;
  const content = delta && typeof delta === "object" ? (delta as Record<string, unknown>).content : undefined;
  return typeof content === "string" ? content : "";
}

async function responseError(response: Response): Promise<Error> {
  let body: Record<string, unknown> = {};
  try { body = await response.json() as Record<string, unknown>; } catch { /* May be non-JSON. */ }
  const retry = Number(response.headers.get("retry-after"));
  return Object.assign(new Error(typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : `Chat request failed (${response.status})`), {
    status: response.status,
    code: typeof body.code === "string" ? body.code : undefined,
    retryAfter: typeof body.retryAfter === "number" ? body.retryAfter : retry > 0 ? retry : undefined,
  });
}
