export const PLATFORM_KEY_COOKIE = "pika_api_key";

export const PLATFORM_KEY_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export class MissingCredentialsError extends Error {
  constructor() {
    super("Missing platform key");
    this.name = "MissingCredentialsError";
  }
}

export function encodeCredentials(apiKey: string): string {
  return JSON.stringify({ apiKey });
}

export function decodeCredentials(raw: string | undefined): { apiKey: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const apiKey = (parsed as { apiKey?: unknown }).apiKey;
    if (typeof apiKey !== "string" || !apiKey.trim()) return null;
    return { apiKey: requireKey(apiKey.trim()) };
  } catch {
    return null;
  }
}

export function parseCredentialInput(data: unknown): { apiKey: string } {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Enter an API key");
  }
  const record = data as { apiKey?: unknown; api_key?: unknown };
  const apiKey = record.apiKey ?? record.api_key;
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Enter an API key");
  return { apiKey: requireKey(apiKey.trim()) };
}

/* The key travels in a header, so anything a header cannot carry is a paste
   accident — a trailing newline, a quoted value, the whole curl line. */
function requireKey(apiKey: string): string {
  if (!/^[\x21-\x7e]+$/.test(apiKey)) throw new Error("API key must be a single token");
  return apiKey;
}
