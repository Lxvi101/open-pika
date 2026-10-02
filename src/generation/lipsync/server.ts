import { cookies } from "next/headers";
import { decodeCredentials, PLATFORM_KEY_COOKIE } from "../credentials";
import { speechCredentials, type SpeechCredentials } from "./azure";
import { SAMPLE_RATE, validateWave } from "./audio";
export { validateWave } from "./audio";

export const SPEECH_COOKIE = "pika_azure_speech";

export async function readSpeechCredentials(): Promise<SpeechCredentials | null> {
  const raw = (await cookies()).get(SPEECH_COOKIE)?.value;
  try {
    if (raw) {
      const value = JSON.parse(raw);
      return speechCredentials(value.endpoint, value.key);
    }
    if (process.env.AZURE_SPEECH_ENDPOINT && process.env.AZURE_SPEECH_KEY) {
      return speechCredentials(process.env.AZURE_SPEECH_ENDPOINT, process.env.AZURE_SPEECH_KEY);
    }
  } catch { /* Invalid credentials are reported as unconfigured; never echoed. */ }
  return null;
}

export async function requireLipSyncRequest(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new Error("Use the lip-sync editor to prepare audio.");
  if (!decodeCredentials((await cookies()).get(PLATFORM_KEY_COOKIE)?.value)) throw new Error("Add your platform key before preparing lip sync.");
}

export async function readWave(request: Request): Promise<ArrayBuffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing audio.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 44 + SAMPLE_RATE * 30 * 2) { await reader.cancel(); throw new Error("Lip-sync clip is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  validateWave(bytes.buffer);
  return bytes.buffer;
}

export function lipSyncError(error: unknown): Response {
  return Response.json({ message: error instanceof Error ? error.message : "Lip-sync preparation failed." }, { status: 400 });
}
