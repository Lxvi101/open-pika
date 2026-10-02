import type { GenerationPlane, Surface } from "@/generation/catalog";
import { defaultKv, browserLegacy, type Kv, type LegacyStore } from "./idb";

export type RunDraft = {
  surface: Surface;
  modelId: string;
  modelLabel: string;
  prompt: string;
  ratio: string;
  meta: string;
  badge?: string;
  settings?: Record<string, unknown>;
  media?: GenerationPlane["media"];
  createdAt: number;
};

export type PendingSubmission = {
  key: string;
  requestId?: string;
  plane: GenerationPlane;
  draft: RunDraft;
  expected: number;
  request: { path: string; body: Record<string, unknown> };
};

const KEY = "openpika.pending-submissions.v1";

function valid(value: unknown): value is PendingSubmission {
  if (!value || typeof value !== "object") return false;
  const row = value as PendingSubmission;
  return typeof row.key === "string" && typeof row.plane?.model === "string" &&
    typeof row.plane?.prompt?.text === "string" && typeof row.draft?.createdAt === "number" &&
    Number.isInteger(row.expected) && row.expected > 0 && typeof row.request?.path === "string" &&
    row.request.body !== null && typeof row.request.body === "object";
}

let lastWrite = 0;
type Saved = { updatedAt: number; rows: PendingSubmission[] };
function saved(value: unknown): Saved | null {
  if (Array.isArray(value)) return { updatedAt: 0, rows: value.filter(valid) };
  if (!value || typeof value !== "object") return null;
  const entry = value as Saved;
  if (!Number.isFinite(entry.updatedAt) || !Array.isArray(entry.rows)) return null;
  return { updatedAt: entry.updatedAt, rows: entry.rows.filter(valid) };
}
export async function loadSubmissions(kv: Kv = defaultKv(), legacy: LegacyStore | undefined = browserLegacy()): Promise<PendingSubmission[]> {
  let primary: Saved | null = null;
  let fallback: Saved | null = null;
  try { primary = saved(await kv.get<unknown>(KEY)); } catch { /* Try the fallback. */ }
  try { fallback = saved(JSON.parse(legacy?.getItem(KEY) ?? "null")); } catch { /* Ignore a corrupt cache. */ }
  const latest = !primary ? fallback : !fallback ? primary : primary.updatedAt >= fallback.updatedAt ? primary : fallback;
  if (!latest) return [];
  lastWrite = Math.max(lastWrite, latest.updatedAt);
  return latest.rows;
}

/** Finish durable storage before submitting. Never discard an unresolved key
    because a library-size cap was reached. */
export async function saveSubmissions(rows: PendingSubmission[], kv: Kv = defaultKv(), legacy: LegacyStore | undefined = browserLegacy()): Promise<void> {
  const snapshot: Saved = { updatedAt: lastWrite = Math.max(Date.now(), lastWrite + 1), rows };
  let saved = false;
  try { await kv.set(KEY, snapshot); saved = typeof window === "undefined" || typeof indexedDB !== "undefined"; } catch { /* Try the fallback. */ }
  try {
    if (legacy) { legacy.setItem(KEY, JSON.stringify(snapshot)); saved = true; }
  } catch { /* Keep the request unsent if both durable stores refuse it. */ }
  if (!saved) throw new Error("This browser cannot save recovery information. Enable browser storage before generating.");
}
