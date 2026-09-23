# OpenPika — Unofficial, Open-Source Studio for the Pika API

> **An unofficial, community-built studio for the Pika API.** Generate video,
> image, audio and text from one composer — no closed ecosystem, no studio
> subscription.
>
> OpenPika is not affiliated with, endorsed by, or sponsored by Pika. It is an
> independent, open-source client for the [Pika API](https://dev.pika.art) —
> the "Pika API Club" — built by the community, for the community.

---

**Why OpenPika?**

- **Free & open-source** — no studio subscription, no vendor lock-in
- **Self-hosted** — clone it, run it, change it, no storage account needed
- **Your key** — generate with your own Pika API key
- **154 operations** — 68 video, 34 image, 28 audio, 24 language models, one
  catalog, one composer

---

Next.js 16 App Router · React 19 · plain CSS · Zustand · pnpm

---

## Features

### Generate

- **One composer for Video, Image, Audio and Text.** A single prompt bar
  drives all four surfaces; the model you pick decides which one runs.
  `⌘/Ctrl + Enter` submits.
- **154 operations in the catalog** — 68 video, 34 image, 28 audio (music,
  speech, sound effects, transcription, dubbing) and 24 language models, from
  Pika, ByteDance (Seedance, Seedream), Google (Veo, Gemini Omni, Nano Banana,
  Lyria), Kling, Alibaba (Wan, HappyHorse), MiniMax, Black Forest Labs, xAI,
  OpenAI, ElevenLabs, Ideogram, Recraft, Meta, Topaz, Sonilo, Anthropic,
  DeepSeek, Moonshot, Qwen, Tencent and Z.ai. Searchable picker.
- **Per-model settings.** Aspect ratio, resolution, duration, output format,
  audio, batch size, prompt enhancement — each model declares its own allow-list
  and the studio renders exactly that. No parallel hardcoded list.
- **Media inputs by role.** Start frame, end frame, references, video and audio,
  each with the per-role cap the model declares. Files upload directly to
  Pika's own upload endpoint and become the URLs the generate request carries.
- **Asset picker.** Attach from your uploads library or from any finished run in
  history — two tabs over one library, filtered to the role's kind.
- **Batch.** Up to 4 results per press. Models with a native count setting use it;
  the rest are submitted once per result, each clearing its own tile.
- **Live run lifecycle.** Skeletons open in the grid on submit; video, image and
  audio jobs are polled every 4 seconds until they complete or fail, and each
  finished result blooms into place on its own clock. Language model runs
  answer synchronously — no polling.

### Gallery

- **Six scopes** — Video, Image, Audio, Text, Assets (every finished run) and
  Favorites — as an arrow-key-navigable tab rail.
- **Masonry grid** of real runs at their true aspect ratio, newest first, with a
  gradient placeholder while media loads.
- **Per-tile actions**: reuse, favorite, delete, select.
- **Reuse restores model, settings and prompt**, so the same run can be
  re-rendered, not just re-typed.
- **Viewer.** Full-size media with prompt (copy in one click), model, resolved
  settings, timestamp, download, favorite and Recreate.
- **Selection mode.** Click a tile's checkbox to enter; shift-click extends a
  range. Bulk download (sequential, with progress and a report of any files the
  CDN refused), bulk favorite/unfavorite, bulk delete. `Esc` exits.
- **Undo.** Deletion is reversible for 6 seconds via a bar with a draining
  hairline, in the strip the composer already reserves.
- **Empty states** that hand you a starter prompt instead of a blank grid.

### State and errors

- **History persists** in IndexedDB in this browser. Favorites are a
  deliberate keep and never age out of the cap. Result URLs belong to Pika's
  platform, so old history can outlive its CDN lifetime and show gaps.
- **Failed, moderated and canceled runs** are recorded as failed tiles carrying
  the reason and a retry that restores the prompt and model.
- **Your own Pika API key.** Entered in a modal, stored by a server action in
  an httpOnly cookie. A missing key opens the modal — it never fails silently.
  The topbar lamp states whether a key is held and whether a run is in flight.
  Generation is prepaid: add funds at [dev.pika.art/billing](https://dev.pika.art/billing).

---

## Architecture

Each generate is one object: `{ model, prompt, media, settings }`.

- **The UI builds that object** and hands it to a server action. The action
  resolves it against the catalog and maps it to the Pika API's own fields.
- **Server actions are the only caller.** The browser never talks to the Pika
  API directly. Submit is `POST /v1/media/{vendor}/{model}/{function}`; status
  is `GET /v1/media/jobs/{id}`, polled every 4 seconds until the job completes
  or fails. Language model calls are synchronous. Auth is a single key sent as
  `X-API-Key`.
- **The catalog is the source of truth** (`src/generation/catalog/`), one file
  per vendor per surface, validated against Pika's own schemas with
  `pnpm check:catalog`. A new entry appears in the picker, brings its own
  settings rail and media roles, and needs no studio changes. See
  [`src/generation/catalog/README.md`](./src/generation/catalog/README.md) for
  how entries are structured and kept in sync with the platform.
- **Five small Zustand stores** — shared prompt and media per surface,
  `settings[modelId]`, and a tiny `active` store. No store per model.
- **Uploads** go straight to Pika's own upload endpoint
  (`POST /v1/media/uploads`, a presigned PUT) through `/api/upload`. Self-hosting
  needs no storage account at all.

---

## Getting started

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Open the studio, press **Add key**, and paste your Pika API key. Create one at
[dev.pika.art/keys](https://dev.pika.art/keys).

### Environment

```bash
PIKA_API_BASE_URL=     # Pika API origin, server only — optional, defaults to
                        # https://api.dev.pika.art
```

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server on port 3000 |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm brand` | Rebuild the icons and OG card in `public/` |
| `pnpm check:catalog` | Validate the catalog against Pika's own schemas |
| `pnpm check:requests` | Build a request for every operation and check it against its schema |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm sync:catalog` | Refresh the cached schemas the catalog is checked against |

---

## Layout

```
src/
  app/          /  is the full-viewport studio and the only page
                /api/upload issues upload tokens for Pika's own upload endpoint
                base.css owns the document canvas
  generation/   generate requests, server actions, API mapping, catalog, stores
  openhiggsfield/
                the studio surface: composer, gallery, viewer, model picker,
                settings, asset picker, selection bar — and openhiggsfield.css
```

---

## Design principles

Dark studio ground, a single lime accent `#d1fe17`, Inter throughout. The chrome
stays neutral so the generated work is the only color on the surface.

1. **The tool disappears into the task** — expression never obscures state or
   affordance.
2. **Accent is state, not decoration** — selection, primary action, liveness only.
3. **Data is data** — settings, counts and durations read in tabular numerals.
   One typeface throughout; no monospace anywhere.
4. **Motion conveys state** — the generation lifecycle, the arrival of a run.
   Nothing loops decoratively.
5. **Every control ships all its states** — hover, focus, active, disabled,
   loading, error, empty.
6. **The catalog is the source of truth** — the studio renders what the model
   declares, never a parallel hardcoded list.

Built for people who work in long sessions, iterating on prompts, inputs and
settings.

---

## Credit

OpenPika is forked from [wide-trace/open-higgsfield](https://github.com/wide-trace/open-higgsfield),
an open-source studio originally built for the Higgsfield AI API, and
re-targeted to the [Pika API](https://dev.pika.art). Thanks to the original
authors for the studio this is built on.
