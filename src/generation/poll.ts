import { getGenerationStatuses } from "./actions";
import type { GenerationStatus, StatusResult } from "./platform";

/** Statuses the platform never moves off again. */
const TERMINAL = new Set(["completed", "failed"]);

export const POLL_INTERVAL_MS = 4000;
export const POLL_DEADLINE_MS = 10 * 60_000;
/** Rounds allowed to fail back to back before the watches are given up on. One
    dropped round must not end every generation in flight. */
const MAX_MISSES = 3;

type Waiter = {
  deadline: number;
  failures: number;
  retryAt?: number;
  resolve: (status: GenerationStatus) => void;
  reject: (reason: Error) => void;
};

/** The upstream job may still be running; only local tracking has paused. */
export class TrackingPausedError extends Error {
  readonly code = "tracking_paused";
  constructor(message: string) { super(message); this.name = "TrackingPausedError"; }
}

const waiting = new Map<string, Waiter>();
const inflight = new Map<string, Promise<GenerationStatus>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
let misses = 0;

/** Resolves when the platform reports a terminal status for this request.
    Every request in flight is asked for together, in one server action per
    interval: Next dispatches server actions one at a time per client, so a
    poll per run would queue ahead of the next submit and the composer would
    stall again — with the lock gone and the queue doing the same work. */
export function watchRequest(
  requestId: string,
  opts?: { deadline?: number },
): Promise<GenerationStatus> {
  const existing = inflight.get(requestId);
  if (existing) return existing;
  const promise = new Promise<GenerationStatus>((resolve, reject) => {
    waiting.set(requestId, {
      deadline: opts?.deadline && opts.deadline > Date.now() ? opts.deadline : Date.now() + POLL_DEADLINE_MS,
      failures: 0,
      resolve: (status) => {
        inflight.delete(requestId);
        resolve(status);
      },
      reject: (reason) => {
        inflight.delete(requestId);
        reject(reason);
      },
    });
    schedule();
  });
  inflight.set(requestId, promise);
  return promise;
}

/** Drops every watch without settling it: the studio unmounted and there is
    nobody left to hand a result to. In-flight jobs stay in history and the
    next mount starts a fresh watch. */
export function stopWatching(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  misses = 0;
  waiting.clear();
  inflight.clear();
}

function schedule(): void {
  if (timer !== null || polling || waiting.size === 0) return;
  timer = setTimeout(() => void round(), POLL_INTERVAL_MS);
}

async function round(): Promise<void> {
  timer = null;
  polling = true;
  try {
    const requestIds = [...waiting.entries()]
      .filter(([, waiter]) => waiter.retryAt === undefined || Date.now() >= waiter.retryAt)
      .map(([requestId]) => requestId);
    const results = requestIds.length ? await getGenerationStatuses({ requestIds }) : [];
    misses = 0;
    for (const result of results) deliver(result);
    sweep();
  } catch (caught) {
    if (++misses < MAX_MISSES) return;
    settleAll(caught instanceof Error ? caught : new Error(String(caught)));
  } finally {
    polling = false;
    schedule();
  }
}

function deliver(result: StatusResult): void {
  const waiter = waiting.get(result.requestId);
  if (!waiter) return;
  if ("error" in result) {
    waiter.failures += 1;
    const transient = !result.error.status || result.error.status === 408 || result.error.status === 429 || result.error.status >= 500;
    const maxRetries = transient ? 4 : 0;
    if (waiter.failures > maxRetries) pause(result.requestId, result.error.message);
    else if (result.error.retryAfter !== undefined && result.error.retryAfter > 0) {
      waiter.retryAt = Date.now() + Math.min(result.error.retryAfter, 600) * 1000;
    }
    return;
  }
  waiter.failures = 0;
  waiter.retryAt = undefined;
  if (!TERMINAL.has(result.status.status)) return;
  waiting.delete(result.requestId);
  waiter.resolve(result.status);
}

/* Stop local polling on deadline while preserving the upstream running state. */
function sweep(): void {
  const now = Date.now();
  for (const [requestId, waiter] of [...waiting]) {
    if (now <= waiter.deadline) continue;
    pause(requestId, "Tracking paused after the status deadline; resume to keep checking this run.");
  }
}

function pause(requestId: string, message: string): void {
  const waiter = waiting.get(requestId);
  if (!waiter) return;
  waiting.delete(requestId);
  waiter.reject(new TrackingPausedError(message));
}

function settleAll(reason: Error): void {
  const ids = [...waiting.keys()];
  misses = 0;
  for (const requestId of ids) pause(requestId, reason.message);
}
