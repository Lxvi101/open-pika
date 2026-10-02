"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { getGenerationQuote } from "@/generation/actions";
import { generationValidation } from "@/generation/validation";
import { parseSettings } from "@/generation/catalog";
import type { MediaItem, ModelEntry, Surface } from "@/generation/catalog";
import { estimateCost, formatCost } from "@/generation/cost";
import { durationOf, planeOf } from "@/generation/plane";
import { applyLipSync, lipSyncAdapter } from "@/generation/lipsync/adapters";
import { lipSyncPreview, lipSyncReady, useLipSync } from "@/generation/lipsync/store";
import { completeReference, promptReferences, referenceQuery, supportsReferences } from "@/generation/references";
import type { PromptReference, ReferenceQuery } from "@/generation/references";
import { MAX_BATCH, useActive } from "@/generation/stores/active";
import { PROMPT_STORES } from "@/generation/stores/prompt";
import { useSettings } from "@/generation/stores/settings";

import { swatchFor } from "./artwork";
import { AssetPicker } from "./asset-picker";
import { PROMPT_PLACEHOLDERS, PROMPT_UNUSED, countSetting } from "./data";
import type { RunRecord } from "./history";
import { ArrowUpIcon, CaretDownIcon, CloseIcon, MinusIcon, PlusIcon, WarningIcon } from "./icons";
import { MediaStrip, useMediaTray } from "./media-tray";
import { ModelIcon, modelIconSrc } from "./model-icon";
import { ModelPicker } from "./model-picker";
import { ReferenceSuggestions } from "./reference-suggestions";
import { LipSyncControl } from "./lip-sync-editor";
import { SettingPill, SettingPopover } from "./settings";

/* Overlay ids: the two fixed panels, or one setting addressed by its catalog
   key — the rail renders whatever the model declares, so the ids cannot be a
   closed union. */
const PICKER = "picker";
const ASSETS = "assets";
const SETTING = "setting:";

const PROMPT_MAX_HEIGHT = 168;

/* What the studio itself can deliver for a model that carries no count of its
   own: one platform request per result. */
const STUDIO_COUNTS = Array.from({ length: MAX_BATCH }, (_, index) => index + 1);

/** Breathing room between a popover and the control it opened from. */
const POPOVER_GAP = 8;

/** Declared widths keep an opening popover inside the composer's own column. */
function popoverWidth(id: string, model: ModelEntry): number {
  if (id === PICKER || id === ASSETS) return 560;
  /* A list of an enum's values is the narrow panel; a slider needs its travel. */
  if (id.startsWith(SETTING) && model.settings[id.slice(SETTING.length)]?.type === "enum") {
    return 216;
  }
  if (id.startsWith(SETTING) && model.settings[id.slice(SETTING.length)]?.type === "text") {
    return 360;
  }
  return 268;
}

export function Composer({
  surface,
  model,
  generating,
  error,
  focusNonce,
  history,
  notice,
  selection,
  selecting,
  onError,
  onGenerate,
}: {
  surface: Surface;
  model: ModelEntry;
  generating: boolean;
  error: string | null;
  focusNonce: number;
  /* Finished runs are attachable inputs, so the asset picker reads the same
     log the gallery renders. */
  history: RunRecord[];
  /* Transient receipts from the gallery share the composer's banner strip
     rather than adding a floating layer of their own. */
  notice?: ReactNode;
  /* The bulk toolbar takes the composer's slot while runs are picked; it is
     always mounted so it can animate away, and states its own presence. */
  selection: ReactNode;
  selecting: boolean;
  onError: (message: string | null) => void;
  onGenerate: () => void;
}) {
  const setModel = useActive((state) => state.setModel);
  const batch = useActive((state) => state.batch);
  const setBatch = useActive((state) => state.setBatch);
  /* The surface picks the store, not the hook: every surface's store is the
     same hook shape, so the call order never changes between renders. */
  const prompt = PROMPT_STORES[surface]();
  const settings = useSettings();
  const values = parseSettings(model, settings.byModel[model.id] ?? {});
  const tray = useMediaTray(model, onError);
  const lengths = useClipLengths(tray.items);
  const lip = useLipSync();
  const lipActive = lip.enabled && Boolean(lipSyncAdapter(model.id));

  const [overlay, setOverlay] = useState<string | null>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [shortcut, setShortcut] = useState<string | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const referencesId = useId();
  const [mention, setMention] = useState<ReferenceQuery | null>(null);
  const [activeReference, setActiveReference] = useState(0);
  const dismissedMention = useRef<string | null>(null);
  const mentionSelection = useRef<string | null>(null);
  const referencesEnabled = supportsReferences(model);
  let referenceItems = tray.items;
  if (lipActive) {
    try {
      const effective = applyLipSync(lipSyncPreview(planeOf(model, prompt.text, tray.items.map((item) => ({ ...item, duration: item.duration ?? lengths[item.url] })), values), lip));
      referenceItems = Object.values(effective.media).flat();
    } catch { /* Invalid combinations are reported before generation. */ }
  }
  const references = promptReferences(model, referenceItems);
  const matches = mention
    ? references.filter((entry) => entry.token.slice(1).toLowerCase().startsWith(mention.query.toLowerCase()))
    : [];
  const referenceIndex = Math.min(activeReference, Math.max(0, matches.length - 1));
  const mentionsOpen = referencesEnabled && mention !== null && !selecting && overlay === null;

  function updateMention(element: HTMLTextAreaElement) {
    const next = referencesEnabled ? referenceQuery(element.value, element.selectionStart, element.selectionEnd) : null;
    const key = `${element.value}:${element.selectionStart}:${element.selectionEnd}`;
    if (dismissedMention.current === key || mentionSelection.current === key) return;
    mentionSelection.current = key;
    dismissedMention.current = null;
    setMention(next);
    setActiveReference(0);
  }

  function dismissMention() {
    const element = promptRef.current;
    if (element) dismissedMention.current = `${element.value}:${element.selectionStart}:${element.selectionEnd}`;
    setMention(null);
  }

  function insertReference(reference: PromptReference) {
    if (!mention) return;
    const result = completeReference(prompt.text, mention, reference.token);
    prompt.setText(result.text);
    setMention(null);
    // Restore the caret after React has applied the controlled textarea value.
    requestAnimationFrame(() => {
      const element = promptRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(result.caret, result.caret);
      dismissedMention.current = `${result.text}:${result.caret}:${result.caret}`;
    });
  }

  useEffect(() => {
    setMention(null);
    dismissedMention.current = null;
    mentionSelection.current = null;
  }, [model.id, focusNonce]);
  /* A run in flight is not a lock: it holds its own tile in the grid, so the
     only thing that can stop a press is having nothing to say — or, for a tool
     that works on media alone, nothing to work on. */
  const wordless = model.prompt === "none";


  /* One batch control, two mechanisms. A model that declares its own
     results-per-request gets that setting written; the rest are submitted once
     per result by the studio. Either way the control means "results per press",
     so the model's own count key never also appears as a settings pill. */
  const native = countSetting(model);
  const counts = native ? native.counts : STUDIO_COUNTS;
  const batchValue = native ? Number(values[native.key]) || counts[0]! : batch;
  const settingKeys = Object.keys(model.settings).filter((key) => key !== native?.key &&
    !(lipActive && (key === "duration" || key === "generateAudio" || key === "omniReferenceTaskType" || (lip.pro && key === "aspectRatio"))));

  /* Priced from the very request a press would send, so the figure moves with
     every dial. The studio's own batch is that many requests; a model's own
     count is one request asking for that many results. */
  const modelSettings = settings.byModel[model.id];
  const quotePlane = useMemo(() => lipSyncPreview(planeOf(model, prompt.text, tray.items.map((item) => ({ ...item, duration: item.duration ?? lengths[item.url] })), modelSettings ?? {}), lip), [model, prompt.text, tray.items, lengths, modelSettings, lip]);
  const validation = model.chat ? (prompt.text.trim() ? null : "Write a prompt first") : generationValidation(lipSyncPreview(quotePlane, lip));
  const disabled = validation !== null || tray.uploading || (lipActive && !lipSyncReady(lip));
  const [liveQuote, setLiveQuote] = useState<{ key: string; micro: number } | null>(null);
  const quoteKey = JSON.stringify(quotePlane);
  useEffect(() => {
    if (model.chat || validation || lipActive) return;
    let live = true;
    const timer = setTimeout(() => {
      void getGenerationQuote(quotePlane).then((result) => {
        if (live && result.ok) setLiveQuote({ key: quoteKey, micro: result.value.micro_usd });
      }).catch(() => {});
    }, 650);
    return () => { live = false; clearTimeout(timer); };
  }, [quoteKey, model.chat, validation, quotePlane, lipActive]);
  const publishedEstimate = useMemo(() => {
    const items = tray.items.map((item) => ({
      ...item,
      duration: item.duration ?? lengths[item.url],
    }));
    const plane = planeOf(model, prompt.text, items, modelSettings ?? {});
    const press = native
      ? { requests: 1, outputs: batchValue }
      : { requests: model.surface === "text" ? 1 : batch, outputs: 1 };
    return estimateCost(lipSyncPreview(plane, lip), press);
  }, [model, prompt.text, tray.items, lengths, modelSettings, native, batchValue, batch, lip]);
  const hasLiveQuote = !lipActive && liveQuote?.key === quoteKey;
  const estimate = hasLiveQuote ? { kind: "total" as const, usd: liveQuote!.micro / 1_000_000 * (native ? 1 : batch), approximate: false } : publishedEstimate;

  function setBatchValue(next: number) {
    if (!native) {
      setBatch(next);
      return;
    }
    settings.set(model.id, { [native.key]: native.kind === "enum" ? String(next) : next });
  }

  /* The dock floats over the gallery, so the gallery cannot reserve its height
     from layout. It reads it from here instead, and the last row keeps clearing
     a composer that grew — a long prompt, a media strip, the undo receipt. */
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const observer = new ResizeObserver(() => {
      dock.parentElement?.style.setProperty("--ohf-dock-h", `${dock.offsetHeight}px`);
    });
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!overlay) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOverlay(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverlay(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overlay]);

  /* Auto-grow the prompt, including when text is set programmatically — and
     again when the column narrows, because the field shares its line with the
     attachment now and the same text rewraps onto more of them. Only a width
     change re-measures: reacting to the height we just set would loop. */
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    const grow = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
    };
    grow();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      grow();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [prompt.text]);

  useEffect(() => {
    if (focusNonce > 0) promptRef.current?.focus();
  }, [focusNonce]);

  /* A panel anchored to a control the visitor can no longer see is a stray
     plate — the swap closes whatever the composer had open. */
  useEffect(() => {
    if (selecting) setOverlay(null);
  }, [selecting]);

  // Rendered only after mount: the modifier is the visitor's, not the server's.
  useEffect(() => {
    setShortcut(/Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? "⌘↵" : "Ctrl↵");
  }, []);

  /* Popovers are positioned by the composer so the wide ones stay inside its
     column, but they open off the control that summoned them: the anchor
     travels to the trigger's left edge, clamped to the column, and rises from
     just above the trigger's own top rather than from the whole dock.
     One thing outranks the trigger: the attachments. A panel laid over the
     frames already on the plane makes the visitor choose blind, so where the
     strip is present every panel clears it. */
  function toggle(next: string, trigger: HTMLElement) {
    if (overlay === next) {
      setOverlay(null);
      return;
    }
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wrapBox = wrap.getBoundingClientRect();
    const triggerBox = trigger.getBoundingClientRect();
    const strip = wrap.querySelector(".ohf-strip");
    const ceiling = strip
      ? Math.min(triggerBox.top, strip.getBoundingClientRect().top)
      : triggerBox.top;
    const available = wrap.clientWidth;
    const width = Math.min(popoverWidth(next, model), available);
    setAnchor({
      x: Math.round(Math.max(0, Math.min(triggerBox.left - wrapBox.left, available - width))),
      y: Math.round(wrapBox.bottom - ceiling + POPOVER_GAP),
    });
    setOverlay(next);
  }

  const attachLabel = tray.allFull ? "Change the inputs" : "Add an input";
  const settingKey = overlay?.startsWith(SETTING) ? overlay.slice(SETTING.length) : null;
  const generateLabel = batchValue > 1 ? `Generate ${batchValue} results` : "Generate";
  const generateTip = lipActive && !lipSyncReady(lip) ? "Prepare lip-sync audio and dialogue first" : disabled
    ? validation ?? "Wait for the upload to finish"
    : `${generateLabel} · ${shortcut ?? "⌘↵"}`;
  /* A language model answers once per press; a batch of identical answers is
     spend with nothing to show for it. */
  const batchable = model.surface !== "text";

  return (
    <div className="ohf-dock" ref={dockRef} data-selecting={selecting}>
      <div
        className="ohf-composer-wrap ohf-enter-2"
        ref={wrapRef}
        style={
          {
            "--ohf-pop-x": `${anchor.x}px`,
            "--ohf-pop-y": `${anchor.y}px`,
          } as CSSProperties
        }
      >
        {notice}

        {error && (
          <div className="ohf-alert" role="alert">
            <span className="ohf-alert-ic">
              <WarningIcon />
            </span>
            <span className="ohf-alert-text">{error}</span>
            <button
              type="button"
              className="ohf-icon-btn ohf-icon-btn--ghost"
              aria-label="Dismiss error"
              title="Dismiss error"
              onClick={() => onError(null)}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        )}

        {settingKey && <SettingPopover model={model} settingKey={settingKey} values={values} />}
        {overlay === ASSETS && (
          <AssetPicker
            model={model}
            items={tray.items}
            uploads={tray.uploads}
            history={history}
            staged={tray.staged}
            uploading={tray.uploading}
            onUpload={tray.begin}
            onApply={tray.apply}
            onErase={tray.erase}
            onClose={() => setOverlay(null)}
          />
        )}
        {overlay === PICKER && (
          <ModelPicker
            selectedId={model.id}
            surface={surface}
            onPick={(next) => {
              setModel(next.id);
              setOverlay(null);
            }}
            onClose={() => setOverlay(null)}
          />
        )}

        {/* One slot, two instruments. Both are laid on the same cell and
            aligned to the same bottom edge, so the dock never changes height
            and the toolbar rises exactly where the composer's rail was. */}
        <div className="ohf-swap">
          <div className="ohf-composer">
            {mentionsOpen && (
              <ReferenceSuggestions
                id={referencesId}
                references={matches}
                active={referenceIndex}
                empty={references.length > 0 ? "No matching reference." : "Attach reference images, video or audio with + first. Start/end frames use image-to-video."}
                onPick={insertReference}
                onActive={setActiveReference}
              />
            )}
            <MediaStrip model={model} />

            {/* The attachment sits beside the words it belongs to, on the same
                left rail the control row starts from. */}
            <div className="ohf-composer-head">
              {tray.roles.length > 0 && (
                <>
                  {tray.input}
                  <button
                    type="button"
                    className="ohf-attach ohf-tip ohf-tip--start"
                    data-tip={attachLabel}
                    disabled={tray.allFull}
                    aria-label={tray.uploading ? "Uploading" : attachLabel}
                    aria-expanded={overlay === ASSETS}
                    aria-haspopup="dialog"
                    onClick={(event) => toggle(ASSETS, event.currentTarget)}
                  >
                    {tray.uploading ? (
                      <span className="ohf-spinner" aria-hidden />
                    ) : (
                      <PlusIcon size={16} />
                    )}
                  </button>
                </>
              )}

              {/* The prompt lives inside the wrap the outside-pointer rule
                  guards, so it has to dismiss for itself: reaching for the words
                  puts the open control away. Pointer and focus both, because a
                  button click does not move focus on every platform — the field
                  can still hold it while a popover stands open. */}
              {model.settings.draftJobId && <label className="ohf-draft-select">Saved draft
                <select aria-label="Saved draft" className="ohf-input" value={String(values.draftJobId ?? "")} onChange={(event) => settings.set(model.id, { ...values, draftJobId: event.target.value })}>
                  <option value="">Choose a completed draft or enter its job ID in settings</option>
                  {[...new Map(history.filter((row) => row.status === "completed" && row.modelId === "seedance-2.5" && row.settings?.draft === true && Date.now() - row.createdAt < 7 * 86400000).map((row) => [row.requestId ?? row.id, row])).values()].map((row) => <option key={row.requestId ?? row.id} value={row.requestId ?? row.id}>{row.prompt.slice(0, 60) || row.modelLabel} · {new Date(row.createdAt).toLocaleDateString()}</option>)}
                  {Boolean(values.draftJobId) && !history.some((row) => row.requestId === values.draftJobId) && <option value={String(values.draftJobId)}>{String(values.draftJobId)}</option>}
                </select>
              </label>}
              <textarea
                ref={promptRef}
                className="ohf-prompt"
                rows={1}
                value={prompt.text}
                placeholder={wordless ? PROMPT_UNUSED : referencesEnabled ? "Describe your video… type @ to reference an input" : PROMPT_PLACEHOLDERS[surface]}
                disabled={wordless}
                aria-label="Prompt"
                role={referencesEnabled ? "combobox" : undefined}
                aria-autocomplete={referencesEnabled ? "list" : undefined}
                aria-expanded={referencesEnabled ? mentionsOpen : undefined}
                aria-controls={mentionsOpen ? referencesId : undefined}
                aria-activedescendant={mentionsOpen && matches.length > 0 ? `${referencesId}-${referenceIndex}` : undefined}
                onPointerDown={() => setOverlay(null)}
                onFocus={() => setOverlay(null)}
                onBlur={dismissMention}
                onSelect={(event) => updateMention(event.currentTarget)}
                onChange={(event) => {
                  prompt.setText(event.target.value);
                  updateMention(event.currentTarget);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (mentionsOpen && event.key === "Escape") {
                    event.preventDefault();
                    dismissMention();
                    return;
                  }
                  if (mentionsOpen && matches.length > 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveReference((referenceIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
                      return;
                    }
                    if (event.key === "Tab" || event.key === "Enter") {
                      event.preventDefault();
                      insertReference(matches[referenceIndex]!);
                      return;
                    }
                  }
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    if (!disabled) onGenerate();
                  }
                }}
              />
            </div>

            <div className="ohf-composer-row">
              <div className="ohf-controls">
                <button
                  type="button"
                  className="ohf-ctl ohf-ctl--model ohf-tip"
                  data-tip="Change model"
                  aria-expanded={overlay === PICKER}
                  aria-haspopup="dialog"
                  onClick={(event) => toggle(PICKER, event.currentTarget)}
                >
                  {modelIconSrc(model.id) ? (
                    <ModelIcon modelId={model.id} />
                  ) : (
                    <span
                      className="ohf-model-swatch"
                      style={{ background: swatchFor(surface, model.id) }}
                    />
                  )}
                  <span className="ohf-ctl-name">{model.label}</span>
                  <span className="ohf-caret">
                    <CaretDownIcon />
                  </span>
                </button>

                <LipSyncControl modelId={model.id} />
                {settingKeys.map((key) => (
                  <SettingPill
                    key={key}
                    model={model}
                    settingKey={key}
                    values={values}
                    open={overlay === `${SETTING}${key}`}
                    onOpen={(trigger) => toggle(`${SETTING}${key}`, trigger)}
                  />
                ))}

                {batchable && (
                  <BatchStepper value={batchValue} counts={counts} onChange={setBatchValue} />
                )}
              </div>

              <span className="ohf-generate-slot ohf-tip ohf-tip--end" data-tip={generateTip}>
                {estimate && (
                  <span
                    className="ohf-cost"
                    aria-label={`${hasLiveQuote ? "Quoted" : "Estimated"} cost: ${formatCost(estimate)}`}
                    title={
                      hasLiveQuote ? "Live Pika list-price quote; organization pricing and final usage may differ" : estimate.kind === "total"
                        ? "Estimated cost of this press, from the platform's published prices"
                        : "Billed by usage the platform counts after the run"
                    }
                  >
                    {formatCost(estimate)}
                  </span>
                )}
                <button
                  type="button"
                  className="ohf-generate"
                  disabled={disabled}
                  data-busy={generating}
                  aria-label={generateLabel}
                  onClick={onGenerate}
                >
                  {/* The sheen is the only thing a run in flight changes here:
                      the label still names what pressing does, because pressing
                      is still allowed. Progress is the grid's to report. */}
                  {generating && <span className="ohf-generate-sheen" aria-hidden />}
                  <span className="ohf-generate-glyph" aria-hidden>
                    <ArrowUpIcon size={15} />
                  </span>
                  <span className="ohf-generate-label">Generate</span>
                  {shortcut && <kbd className="ohf-kbd">{shortcut}</kbd>}
                </button>
              </span>
            </div>
          </div>

          {selection}
        </div>
      </div>
    </div>
  );
}

/* Lengths of the attached clips and tracks, read as they arrive: a tool that
   bills by the length of its input cannot be priced without them. */
function useClipLengths(items: readonly MediaItem[]): Record<string, number> {
  const [lengths, setLengths] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    for (const item of items) {
      if (item.role !== "video" && item.role !== "audio") continue;
      void durationOf(item.url, item.role).then((seconds) => {
        if (live && seconds) {
          setLengths((prev) => (prev[item.url] === seconds ? prev : { ...prev, [item.url]: seconds }));
        }
      });
    }
    return () => {
      live = false;
    };
  }, [items]);
  return lengths;
}

/* Results per press. Every unit is a real generation, so the number is a
   spinbutton the keyboard can drive rather than two anonymous arrows, and the
   ceiling stays in view beside it. The arrows walk the counts the model
   actually allows — Soul offers 1 or 4, and there is no 2 to land on. */
function BatchStepper({
  value,
  counts,
  onChange,
}: {
  value: number;
  counts: number[];
  onChange: (next: number) => void;
}) {
  const index = Math.max(0, counts.indexOf(value));
  const last = counts.length - 1;
  const max = counts[last]!;
  const label = `Batch size — ${value} result${value > 1 ? "s" : ""} per press`;

  const step = (delta: number) => {
    const next = counts[Math.min(last, Math.max(0, index + delta))]!;
    if (next !== value) onChange(next);
  };

  return (
    <div className="ohf-batch ohf-tip" data-tip={label}>
      <button
        type="button"
        className="ohf-batch-step"
        aria-label="Fewer results"
        disabled={index <= 0}
        onClick={() => step(-1)}
      >
        <MinusIcon size={12} />
      </button>
      <span
        className="ohf-batch-value"
        role="spinbutton"
        tabIndex={0}
        aria-label="Batch size"
        aria-valuemin={counts[0]}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} of ${max}`}
        onKeyDown={(event) => {
          const delta =
            event.key === "ArrowUp" || event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowDown" || event.key === "ArrowLeft"
                ? -1
                : 0;
          if (delta !== 0) {
            event.preventDefault();
            step(delta);
            return;
          }
          if (event.key === "Home") {
            event.preventDefault();
            onChange(counts[0]!);
          }
          if (event.key === "End") {
            event.preventDefault();
            onChange(max);
          }
        }}
      >
        {value}
        <span className="ohf-batch-max" aria-hidden>
          /{max}
        </span>
      </span>
      <button
        type="button"
        className="ohf-batch-step"
        aria-label="More results"
        disabled={index >= last}
        onClick={() => step(1)}
      >
        <PlusIcon size={12} />
      </button>
    </div>
  );
}
