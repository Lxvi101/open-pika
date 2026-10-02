"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hasPlatformCredentials, preflightGeneration, submitGeneration, getGenerationStatuses, deleteRemoteJob } from "@/generation/actions";
import { MissingCredentialsError } from "@/generation/credentials";
import { MODELS, getModel } from "@/generation/catalog";
import type { GenerationPlane, Surface } from "@/generation/catalog";
import { applyLipSync } from "@/generation/lipsync/adapters";
import { lipSyncPreview, prepareLipSyncPlane, useLipSync } from "@/generation/lipsync/store";
import { toPlatform } from "@/generation/to-platform";
import { consumeChatStream } from "@/generation/stream";
import { assemblePlane, measurePlane } from "@/generation/plane";
import type { GenerationStatus } from "@/generation/platform";
import { POLL_DEADLINE_MS, stopWatching, watchRequest } from "@/generation/poll";
import { useActive } from "@/generation/stores/active";
import { PROMPT_STORES } from "@/generation/stores/prompt";
import { MEDIA_STORES } from "@/generation/stores/media";
import { useSettings } from "@/generation/stores/settings";

import { GRAIN_URI, artFor } from "./artwork";
import { Composer } from "./composer";
import { fileNameFor, saveFile, saveText } from "./download";
import { KeyModal } from "./key-modal";
import {
  CROSS_VIEWS,
  countSetting,
  SURFACE_RATIOS,
  durationBadge,
  metaOf,
  tileRatio,
  type GalleryView,
} from "./data";
import { Gallery } from "./gallery";
import {
  loadHistory,
  mergeHistory,
  replaceRequest,
  saveHistory,
  stepRun,
  type RunKind,
  type RunRecord,
} from "./history";
import { CloseIcon, UndoIcon } from "./icons";
import { SelectionBar, type SaveProgress } from "./selection-bar";
import { Topbar } from "./topbar";
import { Viewer } from "./viewer";
import { AccountPanel } from "./account-panel";
import { ApiActionError, apiErrorMessage, uncertainSubmission, unwrapResult } from "./api-result";
import { loadSubmissions, saveSubmissions, type PendingSubmission, type RunDraft } from "./submissions";

/* Long enough to read the bar and reach it; the drain line states the window. */
const UNDO_MS = 6000;

export interface ActiveRun {
  /** Identifies the skeleton this run occupies, so a batch clears one tile at
      a time as its own request settles. */
  id: string;
  surface: Surface;
  modelLabel: string;
  ratio: string;
  startedAt: number;
  text?: string;
  error?: string;
}

function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

function rowId(requestId: string, offset: number, count: number): string {
  return count > 1 ? `${requestId}#${offset}` : requestId;
}

function draftOf(record: RunRecord): RunDraft {
  return {
    surface: record.surface,
    modelId: record.modelId,
    modelLabel: record.modelLabel,
    prompt: record.prompt,
    ratio: record.ratio,
    meta: record.meta,
    badge: record.badge,
    settings: record.settings,
    media: record.media,
    createdAt: record.createdAt,
  };
}

function runningRows(requestId: string, count: number, draft: RunDraft): RunRecord[] {
  return Array.from({ length: count }, (_, offset) => {
    const id = rowId(requestId, offset, count);
    return {
      id,
      requestId,
      surface: draft.surface,
      modelId: draft.modelId,
      modelLabel: draft.modelLabel,
      prompt: draft.prompt,
      ratio: draft.ratio,
      meta: draft.meta,
      badge: draft.badge,
      kind: draft.surface,
      urls: [],
      status: "running",
      art: artFor(draft.surface, hueOf(id), id),
      createdAt: draft.createdAt,
      settings: draft.settings,
      media: draft.media,
    };
  });
}

/* What came back decides the tile, not the surface it was asked from: a scoring
   model on the audio surface delivers a video, a transcription delivers words. */
function deliveryOf(status: GenerationStatus): { kind: RunKind; urls: string[] } | null {
  if (status.images?.length)
    return { kind: "image", urls: status.images.map((image) => image.url) };
  if (status.videos?.length) return { kind: "video", urls: status.videos.map((video) => video.url) };
  if (status.video) return { kind: "video", urls: [status.video.url] };
  if (status.audio) return { kind: "audio", urls: [status.audio.url] };
  if (status.text !== undefined || status.transcript) return { kind: "text", urls: [] };
  return null;
}

function terminalRows(requestId: string, draft: RunDraft, status: GenerationStatus): RunRecord[] {
  const delivery = status.status === "completed" ? deliveryOf(status) : null;
  if (delivery?.kind === "text") {
    return [
      { ...textRow(status.requestId || requestId, draft, status.text ?? "", status.transcript?.url), billing: status.billing, usage: status.usage },
    ];
  }
  const urls = delivery?.urls ?? [];
  const completed = urls.length > 0;
  const base = status.requestId || requestId;
  const failure = completed ? undefined : failureText(status);
  const delivered: Array<string | null> = completed ? urls : [null];
  return delivered.map((url, offset) => {
    const id = rowId(base, offset, delivered.length);
    return {
      id,
      requestId: base,
      surface: draft.surface,
      modelId: draft.modelId,
      modelLabel: draft.modelLabel,
      prompt: draft.prompt,
      ratio: draft.ratio,
      meta: draft.meta,
      badge: draft.badge,
      kind: delivery?.kind ?? draft.surface,
      urls: url ? [url] : [],
      status: completed ? "completed" : "failed",
      error: failure,
      errorCode: status.errorCode,
      billing: status.billing,
      usage: status.usage,
      art: artFor(draft.surface, hueOf(id), id),
      createdAt: draft.createdAt,
      settings: draft.settings,
      media: draft.media,
    };
  });
}

function textRow(id: string, draft: RunDraft, text: string, url?: string): RunRecord {
  return {
    id,
    requestId: id,
    surface: draft.surface,
    modelId: draft.modelId,
    modelLabel: draft.modelLabel,
    prompt: draft.prompt,
    ratio: draft.ratio,
    meta: draft.meta,
    kind: "text",
    urls: url ? [url] : [],
    text,
    status: "completed",
    art: artFor(draft.surface, hueOf(id), id),
    createdAt: draft.createdAt,
    settings: draft.settings,
    media: draft.media,
  };
}

function failedRows(requestId: string, count: number, draft: RunDraft, error: string): RunRecord[] {
  return runningRows(requestId, count, draft).map((row) => ({
    ...row,
    status: "failed" as const,
    error,
  }));
}

function failureText(status: GenerationStatus): string {
  if (status.errorCode === "content_moderation")
    return "the provider’s moderation refused the request";
  if (status.errorCode === "insufficient_balance")
    return "the balance does not cover this run — top up at dev.pika.art/billing";
  if (status.errorCode === "cycle_limit_exceeded") return "the invoice cycle limit does not cover this run";
  if (status.errorCode === "rate_limited") return "the platform request limit was reached; wait before retrying";
  if (typeof status.error === "string" && status.error) return status.error;
  if (status.status === "completed") return "the platform finished without delivering a file";
  return "the platform reported a failure";
}

function describeError(caught: unknown): string {
  if (caught instanceof ApiActionError) return apiErrorMessage(caught);
  const message = caught instanceof Error ? caught.message : String(caught);
  if (caught instanceof MissingCredentialsError || message.includes("Missing platform key")) {
    return "Add your platform key to generate.";
  }
  if (/insufficient/i.test(message)) {
    return `Generation failed — ${message}. Top up at dev.pika.art/billing, then retry.`;
  }
  return `Generation failed — ${message}. Try again; if it repeats, check the key in the sidebar.`;
}

export function OpenHiggsfieldApp({ fontClassName = "" }: { fontClassName?: string }) {
  const surface = useActive((state) => state.surface);
  const modelId = useActive((state) => state.model);
  const setModel = useActive((state) => state.setModel);
  const model = getModel(modelId);
  const setSettings = useSettings((state) => state.set);

  const [history, setHistory] = useState<RunRecord[]>([]);
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<string[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [view, setView] = useState<GalleryView>(surface);
  const [focusNonce, setFocusNonce] = useState(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  /* Deleting drops the only copy of a run — the platform's result URLs are not
     re-derivable — so the records are held aside until the bar times out. */
  const [deleted, setDeleted] = useState<RunRecord[] | null>(null);
  /* Picked runs, in the order they were picked: the count stack shows the most
     recent sheets on top, and a range extends from the last one touched. */
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState<SaveProgress | null>(null);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [pendingSubmissions, setPendingSubmissions] = useState<PendingSubmission[]>([]);
  const pendingRef = useRef<PendingSubmission[]>([]);
  const submissionWrites = useRef<Promise<void>>(Promise.resolve());
  const [submissionsLoaded, setSubmissionsLoaded] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const persistPending = useCallback((update: (rows: PendingSubmission[]) => PendingSubmission[]) => {
    const rows = update(pendingRef.current);
    pendingRef.current = rows;
    setPendingSubmissions(rows);
    const write = submissionWrites.current.catch(() => {}).then(() => saveSubmissions(rows));
    submissionWrites.current = write;
    return write;
  }, []);

  useEffect(() => {
    let live = true;
    void loadSubmissions().then((rows) => {
      if (!live) return;
      pendingRef.current = rows;
      setPendingSubmissions(rows);
      setSubmissionsLoaded(true);
    });
    return () => { live = false; };
  }, []);

  const galleryRef = useRef<HTMLDivElement>(null);
  const rangeAnchor = useRef<number | null>(null);
  const visibleRef = useRef<RunRecord[]>([]);
  /* Presses number their own skeletons, so two batches in flight together can
     never claim the same tile. */
  const press = useRef(0);
  const alive = useRef(true);
  const freshTimers = useRef<number[]>([]);
  const historyRef = useRef(history);
  historyRef.current = history;

  /* The model picker can cross surfaces, so the scope follows it — unless the
     visitor parked on a scope that spans both. */
  useEffect(() => {
    setView((current) => (CROSS_VIEWS.has(current) ? current : surface));
  }, [surface]);

  /* Read once on mount. A load that finishes after unmount must not mark the
     next mount hydrated, or the empty initial list is written over the store. */
  useEffect(() => {
    let live = true;
    void loadHistory()
      .then((rows) => {
        if (!live) return;
        setHistory((current) => mergeHistory(rows.map((row) => row.status === "running" && row.requestId?.startsWith("chat-") ? { ...row, status: "failed" as const, error: "The text stream was interrupted. Partial text is saved; recreate to start a new answer." } : row), current));
        setHistoryLoaded(true);
      })
      .catch(() => {
        if (live) setHistoryLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (historyLoaded) void saveHistory(history);
  }, [historyLoaded, history]);

  useEffect(() => {
    void hasPlatformCredentials().then((ready) => {
      setKeyConfigured(ready);
      if (!ready) setKeysOpen(true);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopWatching();
      for (const timer of freshTimers.current) clearTimeout(timer);
    };
  }, []);

  /* Each arrival blooms on its own clock: a batch lands over several seconds,
     and one shared timer would cut the last tile's entrance short. */
  const markFresh = useCallback((ids: string[]) => {
    setFreshIds((prev) => [...prev, ...ids]);
    freshTimers.current.push(
      window.setTimeout(() => setFreshIds((prev) => prev.filter((id) => !ids.includes(id))), 900),
    );
  }, []);

  /* One watch per platform request, used both by Generate and by a reload that
     found running rows already in the log. */
  const resume = useCallback(
    async (requestId: string, draft: RunDraft, _expected: number) => {
      try {
        const status = await watchRequest(requestId, {
          deadline: Date.now() + POLL_DEADLINE_MS,
        });
        if (!alive.current) return;
        const records = terminalRows(requestId, draft, status);
        setHistory((prev) => {
          const next = replaceRequest(prev, requestId, records);
          void saveHistory(next);
          return next;
        });
        markFresh(
          records.filter((record) => record.status === "completed").map((record) => record.id),
        );
        if (records.some((record) => record.status === "failed")) {
          const failure = records[0]?.error ?? "the platform reported a failure";
          setError(
            (prev) =>
              prev ?? `Run not delivered — ${failure}. Adjust the prompt or settings and retry.`,
          );
        }
      } catch (caught) {
        if (!alive.current) return;
        const message = describeError(caught);
        if (message.includes("platform key")) setKeysOpen(true);
        setHistory((prev) => {
          const next = prev.map((row) => row.requestId === requestId && row.status === "running"
            ? { ...row, error: `Tracking paused: ${message}` } : row);
          void saveHistory(next);
          return next;
        });
        setError((prev) => prev ?? `Tracking paused — ${message}. Resume tracking to check the existing job.`);
      }
    },
    [markFresh],
  );

  const recoverSubmissions = useCallback(async () => {
    if (recovering || !keyConfigured) { if (!keyConfigured) setKeysOpen(true); return; }
    setRecovering(true);
    try {
      for (const pending of [...pendingRef.current]) {
        try {
          const queued = pending.requestId ? { requestId: pending.requestId } : unwrapResult(await submitGeneration(pending.plane, pending.key, pending.request));
          setHistory((rows) => rows.some((row) => row.requestId === queued.requestId) ? rows :
            [...runningRows(queued.requestId, pending.expected, pending.draft), ...rows]);
          await persistPending((rows) => rows.map((row) => row.key === pending.key ? { ...row, requestId: queued.requestId } : row)).catch((caught) => setError(describeError(caught)));
          void resume(queued.requestId, pending.draft, pending.expected);
        } catch (caught) {
          if (!uncertainSubmission(caught)) {
            await persistPending((rows) => rows.filter((row) => row.key !== pending.key));
            const requestId = caught instanceof ApiActionError ? caught.detail.requestId : undefined;
            if (requestId?.startsWith("media_")) setHistory((rows) => rows.some((row) => row.requestId === requestId) ? rows :
              [...failedRows(requestId, pending.expected, pending.draft, describeError(caught)), ...rows]);
          }
          setError(describeError(caught));
        }
      }
    } finally { setRecovering(false); }
  }, [keyConfigured, recovering, persistPending, resume]);

  // Clear an accepted submission only after its job id is durably in history.
  useEffect(() => {
    if (!historyLoaded || !submissionsLoaded) return;
    const ids = new Set(history.map((row) => row.requestId));
    const keys = new Set(pendingSubmissions.filter((row) => row.requestId && ids.has(row.requestId)).map((row) => row.key));
    if (!keys.size) return;
    let live = true;
    void saveHistory(history, undefined, undefined, true).then(() => {
      if (live) return persistPending((rows) => rows.filter((row) => !keys.has(row.key)));
    }).catch((caught) => { if (live) setError(describeError(caught)); });
    return () => { live = false; };
  }, [history, historyLoaded, submissionsLoaded, pendingSubmissions, persistPending]);

  const resumePaused = useCallback(() => {
    const groups = new Map<string, RunRecord[]>();
    for (const row of historyRef.current) {
      if (row.status !== "running" || !row.requestId || row.requestId.startsWith("chat-")) continue;
      groups.set(row.requestId, [...(groups.get(row.requestId) ?? []), row]);
    }
    setError(null);
    setHistory((rows) => rows.map((row) => row.status === "running" ? { ...row, error: undefined } : row));
    for (const [id, rows] of groups) void resume(id, draftOf(rows[0]!), rows.length);
  }, [resume]);

  // Re-read unsettled jobs in one action so billing reads do not queue ahead
  // of every submit individually. A failed read retries on the next interval.
  useEffect(() => {
    const ids = [...new Set(history.filter((row) => row.status !== "running" &&
      row.requestId?.startsWith("media_") && row.billing?.state !== "settled").map((row) => row.requestId!))];
    if (!ids.length || !keyConfigured) return;
    let live = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void getGenerationStatuses({ requestIds: ids }).then((results) => {
        if (!live) return;
        const statuses = new Map(results.flatMap((result) => "status" in result ? [[result.requestId, result.status] as const] : []));
        if (statuses.size) setHistory((rows) => rows.map((row) => {
          const status = statuses.get(row.requestId ?? "");
          return status ? { ...row, billing: status.billing ?? row.billing, usage: status.usage ?? row.usage } : row;
        }));
      }).catch(() => { /* Keep the last authoritative value and retry. */ }).finally(() => { polling = false; });
    }, 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [history, keyConfigured]);

  /* After the log hydrates, pick up any request that was still on the platform
     when the last session died. Generate starts its own watch; this is the
     refresh path. */
  useEffect(() => {
    if (!historyLoaded) return;
    const groups = new Map<string, RunRecord[]>();
    for (const record of historyRef.current) {
      if (record.status !== "running" || !record.requestId || record.requestId.startsWith("chat-")) continue;
      const rows = groups.get(record.requestId) ?? [];
      rows.push(record);
      groups.set(record.requestId, rows);
    }
    for (const [requestId, rows] of groups) {
      void resume(requestId, draftOf(rows[0]!), rows.length);
    }
  }, [historyLoaded, resume]);

  const visible = useMemo(() => {
    if (view === "assets") return history;
    if (view === "favorites") return history.filter((record) => record.favorite === true);
    return history.filter((record) => record.surface === view);
  }, [history, view]);

  const switchView = useCallback(
    (next: GalleryView) => {
      setView(next);
      galleryRef.current?.scrollTo({ top: 0 });
      if (CROSS_VIEWS.has(next) || next === surface) return;
      const first = MODELS.find((entry) => entry.surface === next);
      if (first) setModel(first.id);
    },
    [setModel, surface],
  );

  /* Presses do not wait on each other. A press snapshots its own plane, opens
     its own skeletons and keeps its own watch, so the composer is free the
     moment the tiles appear and any number of runs can be in flight. */
  const generate = useCallback(async () => {
    if (!keyConfigured) {
      setKeysOpen(true);
      setError("Add your platform key to generate.");
      return;
    }
    if (!submissionsLoaded) { setError("Loading submission recovery information…"); return; }
    if (useLipSync.getState().preparing) return;
    let plane: GenerationPlane;
    try {
      plane = await measurePlane(assemblePlane());
      // Validate reference capacity before spending on a carrier or uploading.
      applyLipSync(lipSyncPreview(plane, useLipSync.getState()));
      plane = await prepareLipSyncPlane(plane);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare lip sync.");
      return;
    }
    const entry = getModel(plane.model);
    const mappedRequest = toPlatform(plane);
    if (pendingRef.current.some((row) => row.request.path === mappedRequest.path && JSON.stringify(row.request.body) === JSON.stringify(mappedRequest.body))) {
      setError("This request has an unresolved submission. Recover it using its original key before generating it again.");
      return;
    }

    const ratio =
      entry.surface === "image" || entry.surface === "video"
        ? tileRatio(plane.settings, SURFACE_RATIOS[entry.surface])
        : SURFACE_RATIOS[entry.surface];
    const meta = metaOf(entry, plane.settings);
    const badge = entry.surface === "video" ? durationBadge(plane.settings) : undefined;

    /* Batch size resolves to results, not to requests. A model that carries its
       own count answers one request with that many media; every other model is
       submitted once per result. Either way the grid opens the same number of
       skeletons, and each request clears the ones it owns. */
    const native = countSetting(entry);
    const expected = entry.chat
      ? 1
      : native
        ? Math.max(1, Number(plane.settings[native.key]) || 1)
        : useActive.getState().batch;
    const startedAt = Date.now();
    const seq = ++press.current;
    const pending: ActiveRun[] = Array.from({ length: expected }, (_, index) => ({
      id: `pending-${seq}-${index}`,
      surface: entry.surface,
      modelLabel: entry.label,
      ratio,
      startedAt,
    }));
    const slots = native
      ? [{ skeletons: pending.map((slot) => slot.id) }]
      : pending.map((slot) => ({ skeletons: [slot.id] }));
    const effectivePlane = applyLipSync(plane);
    const draft: RunDraft = {
      surface: entry.surface,
      modelId: entry.id,
      modelLabel: entry.label,
      prompt: effectivePlane.prompt.text.trim(),
      ratio,
      meta,
      badge,
      settings: { ...effectivePlane.settings, ...(plane.lipSync ? { duration: String(plane.lipSync.duration) } : {}) },
      media: effectivePlane.media,
      createdAt: startedAt,
    };

    setError(null);
    if (!entry.chat) {
      const preflight = unwrapResult(await preflightGeneration(plane, slots.length));
      if (preflight.advisory) setError(preflight.advisory.message);
    }
    /* Newest press on top, above whatever is still rendering from the last. */
    setRuns((prev) => [...pending, ...prev]);
    galleryRef.current?.scrollTo({ top: 0, behavior: "smooth" });

    /* A language model has no job to watch: the answer is the press's own
       return value, so the skeleton stands until it lands and the row is
       written once, already finished. */
    const runChat = async (slot: { skeletons: string[] }) => {
      const id = `chat-${crypto.randomUUID()}`;
      try {
        setHistory((rows) => [...runningRows(id, 1, draft), ...rows]);
        setRuns((rows) => rows.filter((row) => !slot.skeletons.includes(row.id)));
        const { text } = await consumeChatStream(plane, (text) => {
          if (alive.current) setHistory((rows) => rows.map((row) => row.id === id ? { ...row, text } : row));
        });
        if (!alive.current) return;
        const record = textRow(id, draft, text);
        setHistory((prev) => {
          const next = replaceRequest(prev, id, [record]);
          void saveHistory(next);
          return next;
        });
        markFresh([record.id]);
      } catch (caught) {
        if (!alive.current) return;
        const message = describeError(caught);
        setHistory((rows) => rows.map((row) => row.id === id ? { ...row, status: "failed", error: message } : row));
        if (message.includes("platform key")) setKeysOpen(true);
        setError((prev) => prev ?? message);
      } finally {
        if (alive.current) {
          setRuns((prev) => prev.filter((active) => !slot.skeletons.includes(active.id)));
        }
      }
    };

    const runOne = async (slot: { skeletons: string[] }) => {
      if (entry.chat) return runChat(slot);
      const key = crypto.randomUUID();
      let sent = false;
      try {
        const request = toPlatform(plane);
        await persistPending((rows) => [...rows, { key, plane, draft, expected: slot.skeletons.length, request }]);
        sent = true;
        const queued = unwrapResult(await submitGeneration(plane, key, request));
        setHistory((prev) => {
          const next = [...runningRows(queued.requestId, slot.skeletons.length, draft), ...prev];
          void saveHistory(next);
          return next;
        });
        await persistPending((rows) => rows.map((row) => row.key === key ? { ...row, requestId: queued.requestId } : row)).catch((caught) => setError(describeError(caught)));
        setRuns((prev) => prev.filter((active) => !slot.skeletons.includes(active.id)));
        await resume(queued.requestId, draft, slot.skeletons.length);
      } catch (caught) {
        if (!alive.current) return;
        const message = describeError(caught);
        if (!sent || !uncertainSubmission(caught)) {
          await persistPending((rows) => rows.filter((row) => row.key !== key));
          const requestId = caught instanceof ApiActionError ? caught.detail.requestId : undefined;
          if (requestId?.startsWith("media_")) setHistory((rows) => [...failedRows(requestId, slot.skeletons.length, draft, message), ...rows]);
        }
        if (message.includes("platform key")) setKeysOpen(true);
        setError((prev) => prev ?? message);
      } finally {
        if (alive.current) {
          setRuns((prev) => prev.filter((active) => !slot.skeletons.includes(active.id)));
        }
      }
    };

    await Promise.all(slots.map(runOne));
  }, [keyConfigured, submissionsLoaded, resume, markFresh, persistPending]);

  /* Reuse restores the whole plane the run was made from — model, its dials,
     then the words. A reuse that dropped the ratio and resolution would
     re-render a different picture from the same prompt. */
  const retry = useCallback(
    (record: RunRecord) => {
      // Saved lip-sync runs already include the optimized prompt and hosted
      // recording. Reuse them without appending the current editor's audio.
      if (record.surface === "video") useLipSync.setState({ enabled: false });
      if (MODELS.some((entry) => entry.id === record.modelId)) {
        setModel(record.modelId);
        if (record.settings) setSettings(record.modelId, record.settings);
      }
      PROMPT_STORES[record.surface].getState().setText(record.prompt);
      if (record.media) MEDIA_STORES[record.surface].setState({ items: Object.values(record.media).flat() });
      setViewerId(null);
      setError(null);
      setFocusNonce((n) => n + 1);
    },
    [setModel, setSettings],
  );

  const toggleFavorite = useCallback((record: RunRecord) => {
    setHistory((prev) =>
      prev.map((entry) =>
        entry.id === record.id ? { ...entry, favorite: !entry.favorite } : entry,
      ),
    );
  }, []);

  const deleteRuns = useCallback((records: RunRecord[]) => {
    if (records.length === 0) return;
    const ids = new Set(records.map((record) => record.id));
    setHistory((prev) => prev.filter((entry) => !ids.has(entry.id)));
    setDeleted(records);
  }, []);

  const deleteRun = useCallback((record: RunRecord) => deleteRuns([record]), [deleteRuns]);

  /* History is newest-first by construction, so the restored runs drop back
     into their own places rather than onto the top of the grid. */
  const restoreDeleted = useCallback(() => {
    if (!deleted) return;
    setHistory((prev) => {
      const here = new Set(prev.map((entry) => entry.id));
      const back = deleted.filter((entry) => !here.has(entry.id));
      if (back.length === 0) return prev;
      return [...prev, ...back].sort((a, b) => b.createdAt - a.createdAt);
    });
    setDeleted(null);
  }, [deleted]);

  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), UNDO_MS);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDeleted(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [deleted]);

  /* ---------- picking runs ----------

     The grid is in selection mode whenever something is picked, so the mode has
     no switch of its own: the checkbox that appears on hover is the way in, and
     the toolbar's cross is the way out. */

  const pickedSet = useMemo(() => new Set(selected), [selected]);
  const byId = useMemo(() => new Map(history.map((record) => [record.id, record])), [history]);
  const pickedRecords = useMemo(
    () => selected.map((id) => byId.get(id)).filter((record) => record !== undefined),
    [selected, byId],
  );

  /* The range gesture walks the scope the visitor is looking at, and the walk
     happens inside the handler — reading it from a dependency would rebuild the
     callback on every history change and re-render all forty tiles with it. */
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  /* A run that left the grid cannot stay picked — deleted, aged out of the cap,
     or released from the shelf while the Favorites scope was the one on screen.
     The toolbar counts what the visitor can still see it acting on. */
  const visibleIds = useMemo(() => new Set(visible.map((record) => record.id)), [visible]);
  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((id) => visibleIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [visibleIds]);

  /* Switching scope switches what "everything picked" means, so the selection
     does not travel with it. */
  useEffect(() => {
    setSelected([]);
    rangeAnchor.current = null;
  }, [view]);

  const clearPicked = useCallback(() => {
    setSelected([]);
    rangeAnchor.current = null;
  }, []);

  const togglePick = useCallback((id: string, index: number, range: boolean) => {
    const from = rangeAnchor.current;
    rangeAnchor.current = index;
    setSelected((prev) => {
      if (range && from !== null) {
        const span = visibleRef.current
          .slice(Math.min(from, index), Math.max(from, index) + 1)
          .filter((record) => record.status !== "running")
          .map((record) => record.id);
        const held = new Set(prev);
        return [...prev, ...span.filter((entry) => !held.has(entry))];
      }
      return prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id];
    });
  }, []);

  /* Escape leaves the selection the way it leaves every other transient layer
     in the studio. The viewer owns the key while it is open. */
  useEffect(() => {
    if (selected.length === 0 || viewerId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearPicked();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selected.length, viewerId, clearPicked]);

  /* One keep for the whole selection: if every picked run is already kept the
     press releases them, which is what a pressed control has to mean. */
  const favoritePicked = useCallback(() => {
    const ids = new Set(selected);
    const keep = !pickedRecords.every((record) => record.favorite === true);
    setHistory((prev) =>
      prev.map((entry) => (ids.has(entry.id) ? { ...entry, favorite: keep } : entry)),
    );
  }, [selected, pickedRecords]);

  const deletePicked = useCallback(() => {
    deleteRuns(pickedRecords);
    clearPicked();
  }, [deleteRuns, pickedRecords, clearPicked]);

  /* One run, saved from its card. The refusal is reported through the strip the
     composer already reserves for it — a 32px button on a picture has no room
     to explain itself, and the viewer's own Download states what to do next. */
  const downloadRun = useCallback(async (record: RunRecord) => {
    const url = record.urls[0];
    if (!url) {
      if (record.text) saveText(record.text, fileNameFor(record, 0));
      return;
    }
    const ok = await saveFile(url, fileNameFor(record, 0));
    if (!ok) {
      setError(
        "The platform’s CDN refused the read, so this run could not be saved. Open it to save it from the browser instead.",
      );
    }
  }, []);

  /* Saved one at a time on purpose: browsers throttle a burst of downloads into
     a single "allow multiple files?" prompt and drop the rest, and a sequence is
     the only version that can report how far it got. */
  const downloadPicked = useCallback(async () => {
    const files = pickedRecords.filter((record) => record.urls[0]);
    if (files.length === 0) return;
    setSaving({ done: 0, total: files.length });
    let refused = 0;
    for (const [index, record] of files.entries()) {
      const ok = await saveFile(record.urls[0]!, fileNameFor(record, index));
      if (!ok) refused++;
      setSaving({ done: index + 1, total: files.length });
    }
    setSaving(null);
    if (refused > 0) {
      setError(
        refused === files.length
          ? "The platform’s CDN refused the read, so nothing could be saved. Open a run to save it from the browser instead."
          : `${refused} of ${files.length} files could not be saved — the platform’s CDN refused the read. Open those runs to save them from the browser.`,
      );
    }
  }, [pickedRecords]);

  /* An empty-gallery starter loads the composer and hands the visitor the
     caret; pressing Generate stays their call. */
  const applyStarter = useCallback(
    (text: string) => {
      PROMPT_STORES[surface].getState().setText(text);
      setError(null);
      setFocusNonce((n) => n + 1);
    },
    [surface],
  );

  const openViewer = useCallback((id: string) => setViewerId(id), []);
  const openKeys = useCallback(() => setKeysOpen(true), []);
  const runGenerate = useCallback(() => { void generate().catch((caught) => setError(describeError(caught))); }, [generate]);
  const downloadSelection = useCallback(() => void downloadPicked(), [downloadPicked]);
  const dismissDeleted = useCallback(() => setDeleted(null), []);
  const viewerItem = viewerId
    ? (history.find((record) => record.id === viewerId && record.status !== "running") ?? null)
    : null;

  /* The walk follows the scope on screen, not the whole log: arrowing out of
     the viewer never lands on a run the grid behind it is not showing. At
     either end there is no neighbour to hand down, and the step goes quiet. */
  const viewable = useMemo(
    () => visible.filter((record) => record.status !== "running"),
    [visible],
  );
  const prevRun = viewerId ? stepRun(viewable, viewerId, -1) : null;
  const nextRun = viewerId ? stepRun(viewable, viewerId, 1) : null;

  const runsHere = useMemo(
    () => runs.filter((active) => view === "assets" || active.surface === view),
    [runs, view],
  );
  const busy = runs.length > 0 || history.some((record) => record.status === "running");

  return (
    <div
      className={`ohf ${fontClassName}`}
      style={{ "--ohf-grain": GRAIN_URI } as React.CSSProperties}
    >
      <div className="ohf-shell">
        <main className="ohf-main">
          <Topbar
            view={view}
            onView={switchView}
            busy={busy}
            keyConfigured={keyConfigured}
            onKeys={openKeys}
            onAccount={() => keyConfigured ? setAccountOpen(true) : setKeysOpen(true)}
          />

          <Gallery
            view={view}
            surface={surface}
            items={visible}
            runs={runsHere}
            freshIds={freshIds}
            picked={pickedSet}
            onOpen={openViewer}
            onPick={togglePick}
            onReuse={retry}
            onFavorite={toggleFavorite}
            onDownload={downloadRun}
            onDelete={deleteRun}
            onStarter={applyStarter}
            galleryRef={galleryRef}
          />

          <Composer
            surface={surface}
            model={model}
            generating={busy}
            error={error}
            focusNonce={focusNonce}
            history={history}
            selecting={selected.length > 0}
            selection={
              <SelectionBar
                records={pickedRecords}
                saving={saving}
                onDownload={downloadSelection}
                onFavorite={favoritePicked}
                onDelete={deletePicked}
                onClose={clearPicked}
              />
            }
            onError={setError}
            onGenerate={runGenerate}
            notice={
              <>
                {pendingSubmissions.length > 0 && <div className="ohf-recovery" role="status"><span>{pendingSubmissions.length} submission(s) need recovery.</span><button className="ohf-btn-solid" disabled={recovering} onClick={() => void recoverSubmissions()}>{recovering ? "Recovering…" : "Recover submissions"}</button></div>}
                {history.some((row) => row.status === "running" && row.error) && <div className="ohf-recovery"><span>Tracking is paused for an existing job.</span><button className="ohf-btn-solid" onClick={resumePaused}>Resume tracking</button></div>}
                {deleted && <UndoBar records={deleted} onUndo={restoreDeleted} onDismiss={dismissDeleted} />}
              </>
            }
          />
        </main>

        {viewerItem && (
          <Viewer
            item={viewerItem}
            onPrev={prevRun ? () => setViewerId(prevRun.id) : undefined}
            onNext={nextRun ? () => setViewerId(nextRun.id) : undefined}
            onClose={() => setViewerId(null)}
            onReuse={() => retry(viewerItem)}
            onFavorite={() => toggleFavorite(viewerItem)}
            onEraseRemote={viewerItem.requestId?.startsWith("media_") ? async () => {
              const erased = unwrapResult(await deleteRemoteJob(viewerItem.requestId!));
              if (erased.pending) setError("Pika accepted the erasure and will finish removing the job in the background.");
              setHistory((rows) => rows.filter((row) => row.requestId !== viewerItem.requestId));
              setDeleted((rows) => rows?.filter((row) => row.requestId !== viewerItem.requestId) ?? null);
              setViewerId(null);
            } : undefined}
            onFinalize={viewerItem.modelId === "seedance-2.5" && viewerItem.settings?.draft === true && Date.now() - viewerItem.createdAt < 7 * 86400000 ? () => {
              setModel("seedance-2.5-finalize-draft");
              setSettings("seedance-2.5-finalize-draft", { draftJobId: viewerItem.requestId ?? viewerItem.id });
              MEDIA_STORES.video.setState({ items: [] });
              setViewerId(null);
            } : undefined}
            /* The viewer is released along with the run, so undoing the
               delete restores it to the grid and not back over the studio. */
            onDelete={() => {
              setViewerId(null);
              deleteRun(viewerItem);
            }}
          />
        )}
        {accountOpen && <AccountPanel onClose={() => setAccountOpen(false)} />}
        {keysOpen && (
          <KeyModal
            configured={keyConfigured}
            onClose={() => setKeysOpen(false)}
            onSaved={() => {
              setKeyConfigured(true);
              setKeysOpen(false);
              setError(null);
            }}
            onCleared={() => {
              setKeyConfigured(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

/* Deletion's receipt, in the strip the composer already reserves for the
   generation error — the studio gains no second floating layer. The hairline
   drains across the bar so the window to change your mind is visible, not
   guessed at. */
function UndoBar({
  records,
  onUndo,
  onDismiss,
}: {
  records: RunRecord[];
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const one = records.length === 1 ? records[0] : null;
  /* The words name the run to the person who wrote them; the model does not —
     a grid made on one model reads back as the same label over and over. Runs
     submitted without a prompt keep the model as their only name. The verb
     leads so a long prompt loses its tail to the ellipsis, not the sentence. */
  const subject = one
    ? one.prompt
      ? `“${one.prompt}”`
      : `${one.modelLabel} run`
    : `${records.length} runs`;

  return (
    <div className="ohf-undo" role="status">
      <span className="ohf-undo-drain" style={{ animationDuration: `${UNDO_MS}ms` }} aria-hidden />
      <span className="ohf-undo-text">{`Deleted ${subject}`}</span>
      <button type="button" className="ohf-undo-act" onClick={onUndo}>
        <UndoIcon />
        Undo
      </button>
      <button
        type="button"
        className="ohf-icon-btn ohf-icon-btn--ghost"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
