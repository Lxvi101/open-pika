# Lip-sync mode

Choose **Seedance 2.5 → Lip sync** in the composer. Attach the usual scene references and write a scene prompt, then select a separate **Lip Sync Audio** recording.

The editor decodes the recording locally, displays its actual waveform, and lets you move a selection or resize its right edge. Keyboard arrows and numeric controls work too. Output lengths are whole seconds from 4–30, matching Seedance's schema. Audio is resampled to 48 kHz mono PCM without changing speech speed. Short recordings are padded with silence; the editor states how much. Listen to the exact prepared clip before generating.

The selected clip is automatically transcribed after editing settles. Changing the selection invalidates its previous transcript; stale responses are ignored. The transcript stays editable, including speaker labels, fillers and timing. A manual transcript works when Azure is unavailable. Closing the editor retains the draft for this session; reloading discards local recording bytes.

## Azure MAI-Transcribe-2

Connect Azure in the editor using **two values**, not multiple subscription keys:

- Speech resource endpoint: `https://YOUR-RESOURCE.cognitiveservices.azure.com`
- One Speech resource key from that resource's **Keys and Endpoint** page.

Use a resource in a region that supports MAI-Transcribe-2. The key is saved in an httpOnly, SameSite cookie (Secure in production), following the app's existing per-browser credential pattern. The key is never returned by configuration reads, written to localStorage, or sent to Pika. Configuration presence means credentials are saved; validity is checked by the first transcription.

Alternatively, configure the server:

```dotenv
AZURE_SPEECH_ENDPOINT=https://YOUR-RESOURCE.cognitiveservices.azure.com
AZURE_SPEECH_KEY=YOUR-SPEECH-RESOURCE-KEY
```

Do not prefix these with `NEXT_PUBLIC_`. Browser credentials override server configuration. Removing saved credentials falls back to any server configuration. The existing Pika key is required before connecting/preparing lip sync.

Transcription uses `POST /speechtotext/transcriptions:transcribe?api-version=2025-10-15`, multipart audio + definition, `Ocp-Apim-Subscription-Key`, `enhancedMode.enabled=true`, model `MAI-Transcribe-2`, diarization, word timestamps and verbatim style. Only the selected, prepared WAV is sent. Azure bills this separately; selecting another segment or pressing Re-transcribe makes another transcription request. Drag changes are debounced; canceling a request does not guarantee Azure canceled billing.

[Microsoft's MAI-Transcribe documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)

## Standard and Pro

**Audio reference:** uploads the exact-length WAV and appends a positional `@AudioN` reference.

**Black video (Pro):** encodes the same audio in a black H.264/AAC MP4. The reference and output have the same explicitly chosen aspect ratio and duration. All six supported sizes exceed Seedance's minimum input pixel count; video runs at 30 fps. This is an experimental prompting workflow, not a guarantee of exact lip sync. It incurs video-input pricing, shown in the composer. The authoritative quote/balance check uses the real hosted reference before generation.

Pro requires FFmpeg with the `libx264` and `aac` encoders on the Node server:

```dotenv
# Optional when ffmpeg is already on PATH
FFMPEG_PATH=/absolute/path/to/ffmpeg
```

Deploy to a Node environment that includes this executable and writable temporary storage. Temporary WAV/MP4 files are removed after preparation. A missing encoder or executable produces a visible error rather than silently using another mode. Serverless deployments must package FFmpeg and allow the preparation route's runtime; FFmpeg is not bundled by this change.

## Request behavior

- The adapter routes lip sync through `reference-to-video`, sets `omni_reference_task_type=reference`, forces audio generation on and replaces output duration with the clip duration.
- Existing references retain their positional indices. Start/end frames are appended as reference images with positive opening/closing composition instructions; they are no longer hard keyframes.
- The driving recording is appended last, and its actual `@AudioN`/`@VideoN` token is used in the prompt. Reference counts and the combined 30-second budget for that media kind are checked before preparation.
- The original scene remains intact. A positive performance block includes verbatim dialogue, recording timing, voices, pauses and repeated synchronization instructions.
- The user can preview the optimized prompt. The submitted transcript and matched reference are saved with the run; reusing a run restores the already optimized prompt and ordinary hosted references, with editor mode off to avoid duplicating instructions.
- No post-generation overlay is performed. These steps improve conditioning; Seedance still generates the mouth animation and audio, so exact reproduction is not guaranteed.

## Extension points and checks

`src/generation/lipsync/adapters.ts` contains the model registry and Seedance-specific request/prompt logic. The waveform, WAV preparation, Azure client and optional video encoder are separate modules. Add a model adapter and validate its documented operation before enabling another model.

`npm run check:lipsync` checks request routing, original-plane immutability, reference order, constraints, prompt construction, pricing and the Azure request contract with a mock. It also creates six local MP4s and uses FFprobe to verify both streams' exact duration, audio start time, frame rate and dimensions. Requires `ffmpeg` and `ffprobe` on PATH (or `FFMPEG_PATH`/`FFPROBE_PATH`). It makes no paid API calls.
