# The model catalog

One file per vendor per surface (`video/kling.ts`, `image/openai.ts`, …). Each
exports one `readonly ModelEntry[]` that `index.ts` spreads into `MODELS`. The
studio renders only what an entry declares — the picker line, the settings
rail, the attachment roles — and `to-platform.ts` turns an entry plus the
visitor's plane into `POST /v1/media/{apiId}` with no per-model code.

The platform's own input schemas are the source of truth. They live in
`scripts/pika-catalog/{vendor}__{model}__{function}.json` (refresh with
`pnpm sync:catalog`). Never guess a field, enum value or range: read the schema.

```
pnpm check:catalog src/generation/catalog/video/kling.ts --expect kling/video
```

must end with `0 errors`. Warnings are for reading, not for ignoring blindly.

`video/black-forest-labs.ts` is the reference entry. Read it first.

## Models and operations

A **model** is what the visitor picks; an **operation** is one catalog
`api_id`. Group a model's functions into one entry when the attachments alone
decide which one runs:

| function | picked when | typical binding |
| --- | --- | --- |
| `text-to-video`, `text-to-image`, `text-to-audio` … | nothing attached | — |
| `image-to-video` | a start frame | `start` required, `end` optional |
| `reference-to-video`, `image-to-image` | reference images | `reference` required, `many: true` if the field is an array |
| `video-to-video`, `video-extension`, upscale | a clip | `video` required |

The mapper picks the operation whose required roles are all attached and that
binds every attached role; ties go to list order, so **list the most specific
operation first and the text-only one last**.

When an operation works from any one of several roles (references **or** a
clip **or** a track), leave those bindings optional and name the set in
`requireAny` — a `required` binding would make one of them the only way in.

Split a function into its own entry (id suffix: `kling-3.0-motion-control`,
`veo-3.1-extend`) when it would collide with a sibling on the same attachments
(two functions that both need exactly one video), or when it is a different
tool with its own settings (motion control, lipsync, omni, effects).

## Entry fields

- `id` — the catalog model slug (`seedance-2.5`, `gpt-image-2`), plus a suffix
  for split entries. Lowercase, unique across the whole catalog.
- `label` — the marketing name as the catalog's `name` gives it, minus the
  function words ("Seedance 2.5", not "Seedance 2.5 Text To Video").
- `vendor` — the catalog vendor slug, exactly.
- `surface` — the catalog `category`.
- `description` — only when the derived picker line would mislead (an
  upscaler, a lipsync tool). One short line, sentence case, no full stop.
- `prompt` — `"optional"` when the schema does not require the prompt field,
  `"none"` when the operation has no prompt field at all (set
  `prompt: null` on those operations too). Omit when required.
- `roles` — the union of roles the operations bind, with the cap the schema's
  `maxItems` gives (1 for a single URL field).
- `settings` — the union of the operations' settings.

## Roles

`start` first frame · `end` last frame · `reference` any other input image
(references, the image to edit, an image to upscale, an avatar's face) ·
`video` any input video · `audio` any input audio.

## Settings

Setting keys are camelCase and shared across the catalog so the studio can
label and draw them. Use these names when the meaning matches:

`aspectRatio` (from `aspect_ratio` **or** `ratio`) · `resolution` · `size` ·
`duration` · `generateAudio` · `numImages` · `outputFormat` · `quality` ·
`negativePrompt` · `seed` · `voice` · `language` · `lyrics` · `speed` ·
`enhancePrompt` · `draft` · `background` · `mode`

Anything else: camelCase of the schema field.

Types:

- `enum` — string values in the schema's order. Put resolutions in ascending
  order. For an integer enum (`duration: 5 | 10`) use string values with
  `{ field: "duration", as: "number" }`.
- `range` — numeric with min/max (and `step` for fractions). For
  `integer | "auto"` fields use a range and drop `auto`.
- `boolean`.
- `text` — free strings: `negativePrompt`, `lyrics`, a custom voice id, `seed`
  (`{ field: "seed", as: "number" }`, default `""`, placeholder `"Random"`).
  Set `multiline: true` for prose. An empty string is never sent.

Defaults: the schema's default when it has one. When the schema default is
`null`, offer the platform's choice as an explicit value only if the schema has
one (`"auto"`, `"adaptive"`); otherwise pick the most common sensible value
(`16:9`, `720p`, 5 seconds).

To let the platform decide, include the value and omit it on the wire:
`{ field: "aspect_ratio", omit: ["auto"] }` — but only when `"auto"` is not
itself a legal schema value (if it is, just send it).

Leave out, always: `watermark`, `aigc_watermark`, `webhook_url`, and anything
that is plumbing rather than a creative choice. Keep the rail short: a setting
earns its place if a visitor would reach for it. More than ~7 settings on one
model is a smell — drop the most esoteric ones (the platform default applies).

## Shapes the declarative fields cannot say

`build(plane, body)` gets the body built so far and returns the final one. Use
it for lists of objects (keyframes, dialogue turns, `elements`). Bind the roles
anyway — selection and the check script read the bindings — and let `build`
overwrite the field.
