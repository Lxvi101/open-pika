"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { decodeAudio, encodeClip, SAMPLE_RATE, waveformPeaks } from "@/generation/lipsync/audio";
import { applyLipSync, lipSyncAdapter } from "@/generation/lipsync/adapters";
import { clipKey, lipSyncPreview, lipSyncReady, responseError, useLipSync } from "@/generation/lipsync/store";
import { LIP_SYNC_RATIOS } from "@/generation/lipsync/types";
import { assemblePlane } from "@/generation/plane";
import { CloseIcon } from "./icons";

const seconds = (value: number) => `${value.toFixed(2)}s`;

export function LipSyncControl({ modelId }: { modelId: string }) {
  const state = useLipSync();
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const supported = Boolean(lipSyncAdapter(modelId));
  const active = supported && state.enabled;
  const key = clipKey(state);

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    fetch("/api/lipsync/config").then((response) => response.json()).then((data) => {
      if (alive) setConfigured(data.configured === true);
    }).catch(() => { if (alive) setConfigured(false); });
    return () => { alive = false; };
  }, [supported]);

  // Only the selected clip is transcribed. Debounce drag/keyboard edits and
  // abort stale requests; an older transcript can never label a newer clip.
  useEffect(() => {
    if (!active || !state.samples || !configured) return;
    if (useLipSync.getState().transcriptKey === key) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (useLipSync.getState().transcriptKey === key) return;
      useLipSync.setState({ status: "transcribing", error: null });
      try {
        const wav = encodeClip(state.samples!, state.start, state.duration);
        const response = await fetch("/api/lipsync/transcribe", {
          method: "POST", body: new Blob([wav], { type: "audio/wav" }), signal: controller.signal,
        });
        if (!response.ok) throw await responseError(response);
        const result = await response.json();
        if (typeof result.text !== "string" || !result.text.trim()) throw new Error("No speech detected in this clip.");
        const current = useLipSync.getState();
        if (!controller.signal.aborted && clipKey(current) === key && current.transcriptKey !== key) {
          useLipSync.setState({ transcript: result.text, transcriptKey: key, status: "ready" });
        }
      } catch (error) {
        if (!controller.signal.aborted && clipKey(useLipSync.getState()) === key && useLipSync.getState().transcriptKey !== key) {
          useLipSync.setState({ status: "error", error: error instanceof Error ? error.message : "Transcription failed." });
        }
      }
    }, 1000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, state.samples, state.start, state.duration, state.retry, configured, key]);

  if (!supported) return null;
  return <>
    <button type="button" className="ohf-ctl ohf-lip-trigger" data-active={active} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { useLipSync.setState({ enabled: true }); setOpen(true); }}>
      <span className="ohf-lip-mark" aria-hidden>≋</span> Lip sync{active ? ` · ${state.duration}s` : ""}
    </button>
    {active && <span className="ohf-lip-state" role="status">
      {state.preparing ? state.progress : state.status === "transcribing" ? "Transcribing…" : lipSyncReady(state) ? (state.pro ? "Pro · ready" : "Audio matched") : "Set up audio"}
    </span>}
    {open && <LipSyncEditor configured={configured} onConfigured={setConfigured} onClose={() => setOpen(false)} />}
  </>;
}

function LipSyncEditor({ configured, onConfigured, onClose }: {
  configured: boolean | null; onConfigured: (value: boolean) => void; onClose: () => void;
}) {
  const state = useLipSync();
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useRef<HTMLAudioElement>(null);
  const sourceLoad = useRef(0);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [preview, setPreview] = useState("");
  const [peaks, setPeaks] = useState<number[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const duration = state.samples ? state.samples.length / SAMPLE_RATE : 0;
  const timeline = Math.max(duration, state.duration);
  const padding = Math.max(0, state.start + state.duration - duration);

  useEffect(() => { dialog.current?.showModal(); return () => { sourceLoad.current++; }; }, []);
  useEffect(() => { setPeaks(state.samples ? waveformPeaks(state.samples) : []); }, [state.samples]);
  useEffect(() => {
    setPlaying(false); setPosition(0);
    if (!state.samples) { setPreview(""); return; }
    const url = URL.createObjectURL(new Blob([encodeClip(state.samples, state.start, state.duration)], { type: "audio/wav" }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [state.samples, state.start, state.duration]);

  async function load(file?: File) {
    if (!file || state.preparing) return;
    const id = ++sourceLoad.current;
    setLoading(true); setLocalError(null);
    useLipSync.setState({ samples: null, name: file.name, sourceId: "", transcript: "", transcriptKey: "", status: "waiting", error: null, uploaded: null });
    try {
      const samples = await decodeAudio(file);
      if (!samples.length) throw new Error("This recording is empty.");
      if (id === sourceLoad.current) state.setSource(file.name, samples);
    } catch (error) { if (id === sourceLoad.current) setLocalError(error instanceof Error ? error.message : "Could not decode this audio file. Try WAV or MP3."); }
    finally { if (id === sourceLoad.current) setLoading(false); }
  }

  let generatedPrompt = "";
  try { generatedPrompt = applyLipSync(lipSyncPreview(assemblePlane(), state)).prompt.text; }
  catch (error) { generatedPrompt = error instanceof Error ? error.message : "Add your scene and audio to preview."; }

  return <dialog ref={dialog} className="ohf-lip-dialog" aria-labelledby="lip-sync-title" onClose={onClose}
    onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
    <div className="ohf-lip-editor">
      <header className="ohf-lip-header">
        <div><div className="ohf-lip-eyebrow">PERFORMANCE STUDIO</div><h2 id="lip-sync-title">Make every word visible.</h2>
          <p>One recording. Matching timing, dialogue and expression.</p></div>
        <button type="button" className="ohf-icon-btn" aria-label="Close lip-sync editor" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="ohf-lip-body">
        <div className="ohf-lip-section-head"><h3>01 <span>Lip Sync Audio</span></h3><span>{duration ? `${seconds(duration)} original` : "WAV, MP3, M4A, FLAC"}</span></div>
        <label className="ohf-lip-upload" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void load(event.dataTransfer.files[0]); }}>
          <span className="ohf-lip-upload-icon" aria-hidden>≋</span>
          <span><strong>{loading ? "Reading waveform…" : state.name || "Drop your dialogue here"}</strong><small>{state.name ? "Choose another recording" : "or choose an audio file · up to 50 MB / 10 min"}</small></span>
          <input type="file" accept="audio/*,.wav,.mp3,.m4a,.flac" aria-label="Lip Sync Audio" disabled={state.preparing || loading} onChange={(event) => { void load(event.target.files?.[0]); event.target.value = ""; }} />
        </label>
        {state.samples && <>
          <Waveform peaks={peaks} duration={duration} timeline={timeline} start={state.start} length={state.duration} position={position} onTrim={state.trim} disabled={state.preparing} />
          <div className="ohf-lip-trim-controls">
            <button type="button" className="ohf-lip-play" disabled={!preview} aria-label={playing ? "Pause selected audio" : "Play selected audio"}
              onClick={() => {
                if (!player.current) return;
                if (playing) player.current.pause();
                else void player.current.play().catch(() => setLocalError("Could not play the selected clip."));
              }}>{playing ? "Ⅱ" : "▶"}</button>
            <label>Start <input type="number" aria-label="Clip start in seconds" step="0.01" min="0" max={Math.max(0, duration - state.duration)} value={state.start} disabled={state.preparing} onChange={(event) => state.trim(Number(event.target.value), state.duration)} /><span>s</span></label>
            <label>Length <select aria-label="Lip-sync output duration" value={state.duration} disabled={state.preparing} onChange={(event) => state.trim(state.start, Number(event.target.value))}>
              {Array.from({ length: 27 }, (_, i) => i + 4).map((value) => <option key={value} value={value}>{value}s</option>)}
            </select></label>
            <span className="ohf-lip-match">{state.duration.toFixed(2)}s audio = {state.duration.toFixed(2)}s video</span>
          </div>
          <p className="ohf-lip-hint">Drag the selection to choose a passage. Drag its right edge to change length.{padding > 0 ? ` ${seconds(padding)} of silence will be added at the end.` : " Speech stays at its original speed."}</p>
          <audio ref={player} src={preview || undefined} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPosition(0); }} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} />
        </>}

        <div className="ohf-lip-section-head"><h3>02 <span>Spoken dialogue</span></h3><span role="status">{state.status === "transcribing" ? "MAI-Transcribe-2 · transcribing…" : state.transcriptKey ? "Ready to review" : "Automatic · verbatim"}</span></div>
        <textarea className="ohf-lip-transcript" aria-label="Spoken dialogue transcript" rows={4} value={state.transcript} disabled={!state.samples || state.preparing}
          placeholder={configured ? "Your selected audio is transcribed automatically. You can correct the words here." : "Connect Azure below for automatic transcription, or enter the exact spoken words here."}
          onChange={(event) => useLipSync.setState({ transcript: event.target.value, transcriptKey: clipKey(state), status: "ready", error: null })} />
        <div className="ohf-lip-transcript-footer"><p className="ohf-lip-hint">Keep fillers and pauses. Replace “Speaker 1” with a character name when needed.</p>
          <button type="button" className="ohf-btn-quiet" disabled={!configured || !state.samples || state.status === "transcribing" || state.preparing}
            onClick={() => useLipSync.setState({ transcriptKey: "", transcript: "", status: "waiting", retry: state.retry + 1 })}>Re-transcribe</button></div>

        <AzureSpeechSettings configured={configured} onConfigured={onConfigured} />

        <div className="ohf-lip-section-head"><h3>03 <span>Reference delivery</span></h3><span>Audio generation stays on</span></div>
        <div className="ohf-lip-modes">
          <button type="button" aria-pressed={!state.pro} disabled={state.preparing} onClick={() => useLipSync.setState({ pro: false })}><strong>Audio reference</strong><span>Exact-length WAV · standard cost</span></button>
          <button type="button" aria-pressed={state.pro} disabled={state.preparing} onClick={() => {
            const ratio = assemblePlane().settings.aspectRatio;
            useLipSync.setState({ pro: true, ...(!state.pro && typeof ratio === "string" && LIP_SYNC_RATIOS.includes(ratio as typeof LIP_SYNC_RATIOS[number]) ? { ratio } : {}) });
          }}><strong>Black video <b>PRO</b></strong><span>Audio inside an MP4 · higher video-input cost</span></button>
        </div>
        {state.pro && <div className="ohf-lip-pro"><div className="ohf-lip-black-frame" style={{ aspectRatio: state.ratio.replace(":", "/") }}><span>≋</span></div>
          <div><label>Reference & output ratio <select aria-label="Pro reference and output aspect ratio" value={state.ratio} disabled={state.preparing} onChange={(event) => useLipSync.setState({ ratio: event.target.value })}>{LIP_SYNC_RATIOS.map((ratio) => <option key={ratio}>{ratio}</option>)}</select></label>
            <p className="ohf-lip-hint">A black frame carries your audio for exactly {state.duration}s. This sets the output ratio too. An experimental workflow; improved lip sync is not guaranteed.</p></div></div>}
        <p className="ohf-lip-hint">Your scene and references stay in place. Start/end images become composition references. Timing and a positive dialogue instruction are appended automatically.</p>
        <details className="ohf-lip-details"><summary>Preview the optimized prompt</summary><pre>{generatedPrompt}</pre></details>
        {(localError || state.error) && <p className="ohf-lip-error" role="alert">{localError || state.error}</p>}
      </div>
      <footer className="ohf-lip-footer"><button type="button" className="ohf-btn-quiet" disabled={state.preparing} onClick={() => { useLipSync.setState({ enabled: false }); onClose(); }}>Turn off lip sync</button>
        <span>{state.preparing ? state.progress : lipSyncReady(state) ? `${state.duration}s · ready to generate` : "Add audio and review the dialogue"}</span>
        <button type="button" className="ohf-keys-save" onClick={onClose}>Done</button></footer>
    </div>
  </dialog>;
}

function Waveform({ peaks, duration, timeline, start, length, position, onTrim, disabled }: {
  peaks: number[]; duration: number; timeline: number; start: number; length: number; position: number;
  onTrim: (start: number, duration: number) => void; disabled: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number; length: number; edge: boolean } | null>(null);
  function begin(event: PointerEvent<HTMLDivElement>, edge: boolean) {
    if (disabled) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start, length, edge };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !root.current) return;
    const delta = (event.clientX - drag.current.x) / root.current.clientWidth * timeline;
    onTrim(drag.current.start + (drag.current.edge ? 0 : delta), drag.current.length + (drag.current.edge ? delta : 0));
  }
  return <div className="ohf-lip-wave-wrap">
    <div className="ohf-lip-wave" ref={root}>
      <svg viewBox="0 0 960 100" preserveAspectRatio="none" aria-hidden>
        {peaks.map((peak, index) => <rect key={index} x={index / peaks.length * 960 * duration / timeline} y={50 - Math.max(2, peak * 44)} width={2.5} height={Math.max(4, peak * 88)} rx="1" />)}
      </svg>
      <div className="ohf-lip-window" style={{ left: `${start / timeline * 100}%`, width: `${length / timeline * 100}%` }} role="group" aria-label="Selected audio passage"
        onPointerDown={(event) => begin(event, false)} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <span className="ohf-lip-window-label">{length}s selected</span>
        <div className="ohf-lip-start-handle" role="slider" tabIndex={disabled ? -1 : 0} aria-label="Audio selection start" aria-valuemin={0} aria-valuemax={Math.max(0, duration - length)} aria-valuenow={start} aria-valuetext={`${seconds(start)} to ${seconds(start + length)}`}
          onKeyDown={(event) => { if (!disabled && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); onTrim(event.key === "Home" ? 0 : event.key === "End" ? Math.max(0, duration - length) : start + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1), length); } }} />
        <div className="ohf-lip-handle" role="slider" tabIndex={disabled ? -1 : 0} aria-label="Audio selection length" aria-valuemin={4} aria-valuemax={30} aria-valuenow={length}
          onPointerDown={(event) => begin(event, true)} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
          onKeyDown={(event) => { event.stopPropagation(); if (!disabled && ["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); onTrim(start, length + (event.key === "ArrowLeft" ? -1 : 1)); } }} />
      </div>
      {position > 0 && <i className="ohf-lip-playhead" style={{ left: `${(start + position) / timeline * 100}%` }} />}
    </div>
    <div className="ohf-lip-ruler">{[0, 1, 2, 3, 4].map((tick) => <span key={tick}>{seconds(timeline * tick / 4)}</span>)}</div>
  </div>;
}

function AzureSpeechSettings({ configured, onConfigured }: { configured: boolean | null; onConfigured: (value: boolean) => void }) {
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(remove = false) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/lipsync/config", {
        method: remove ? "DELETE" : "POST",
        ...(!remove ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint, key }) } : {}),
      });
      if (!response.ok) throw await responseError(response);
      const data = await response.json();
      onConfigured(data.configured); setKey(""); setEndpoint("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save Azure credentials."); }
    finally { setBusy(false); }
  }
  return <details className="ohf-lip-details" open={configured === false ? true : undefined}>
    <summary>Azure Speech <span>{configured ? "Connected · MAI-Transcribe-2" : "Connect for automatic transcription"}</span></summary>
    <div className="ohf-lip-azure">
      <p>Your Speech resource endpoint and one resource key are required. Keys stay in an httpOnly cookie; Azure requests run on the server. Transcription is billed by Azure when you select or change a clip.</p>
      <label>Speech endpoint<input className="ohf-input" type="url" placeholder="https://your-resource.cognitiveservices.azure.com" autoComplete="off" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
      <label>Speech resource key<input className="ohf-input" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder={configured ? "Enter a new key to replace" : "Paste your Azure Speech key"} /></label>
      {error && <p className="ohf-lip-error" role="alert">{error}</p>}
      <div>{configured && <button type="button" className="ohf-btn-quiet" disabled={busy} onClick={() => void save(true)}>Remove saved credentials</button>}
        <button type="button" className="ohf-keys-save" disabled={busy || !endpoint.trim() || !key.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Connect Azure"}</button></div>
    </div>
  </details>;
}
