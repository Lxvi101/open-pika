import { getModel } from "./catalog";
import pricing from "./catalog/pricing.json";
import type { GenerationPlane, MediaItem } from "./catalog/types";
import { toPlatform } from "./to-platform";
import { applyLipSync } from "./lipsync/adapters";

type Tier = { spec: Record<string, string>; usd: number };
type Component = { role: string; unit: string; per: number; included?: number; tiers: Tier[] };

const PRICING = pricing as unknown as Record<string, Component[]>;

/** What a press is expected to cost. A `total` is dollars for the whole press;
    `approximate` marks one that leans on a guess — a token count worked out
    from the frame size, a tier the request does not pin down. Where the bill
    turns on something only the platform can count, the `rate` is shown as it
    is published rather than a number made up to look like a total. */
export type CostEstimate =
  { kind: "total"; usd: number; approximate: boolean } | { kind: "rate"; label: string };

export type Press = {
  /** Platform requests the press submits. */
  requests: number;
  /** Results each request asks for — the model's own count, where it has one. */
  outputs: number;
};

const UNIT_NAMES: Record<string, string> = {
  second: "s",
  output_second: "s",
  video_input_second: "s of input",
  minute: "min",
  request: "run",
  image: "image",
  input_image: "input image",
  character: "characters",
  input_token: "tokens in",
  output_token: "tokens out",
  image_output_token: "image tokens",
  video_output_token: "video tokens",
};

/* Seedance bills w × h × fps × seconds / 1024 tokens at 24 fps, and holds the
   frame area near-constant per resolution whatever the ratio. */
const SEEDANCE_AREA: Record<string, number> = {
  "480p": 864 * 480,
  "720p": 1248 * 704,
  "1080p": 1920 * 1088,
  "4k": 3840 * 2176,
};
const SEEDANCE_FPS = 24;

export function estimateCost(plane: GenerationPlane, press: Press): CostEstimate | null {
  const model = getModel(plane.model);
  if (model.chat) return chatRate(PRICING[model.chat.model] ?? []);

  let mapped;
  try {
    mapped = toPlatform(plane);
    plane = applyLipSync(plane);
  } catch {
    return null; // nothing the platform would accept yet, so nothing to price
  }
  const components = PRICING[mapped.path.slice("/v1/media/".length)];
  if (!components?.length) return null;

  /* Topaz counts delivered pixels for Proteus and output frames for Starlight.
     The request does not carry final dimensions or an output-frame count, so a
     numeric estimate would invent usage. Show the billing basis until a quote
     is available. */
  if (components.some((component) =>
    component.unit === "output_megapixel" || component.unit.startsWith("output_frame_"),
  )) {
    const modelName = String(mapped.body.model ?? "proteus");
    return {
      kind: "rate",
      label: modelName === "proteus"
        ? "Usage-based · output megapixels; final cost requires platform quote"
        : "Usage-based · output frames and size tier; final cost requires platform quote",
    };
  }

  let usd = 0;
  let approximate = false;
  for (const component of components) {
    const picked = pickTier(component.tiers, mapped.body, plane);
    const amount = quantityOf(component, picked.tier, mapped.body, plane, press.outputs);
    if (amount === undefined) {
      /* The words of a prompt are a rounding error beside the media they buy;
         an output nobody can count ahead of time is the whole bill. */
      if (component.role === "output" && component.unit !== "output_token") {
        return rateOf([component]);
      }
      approximate = true;
      continue;
    }
    usd += (amount.value / component.per) * picked.tier.usd;
    approximate ||= amount.approximate || !picked.exact;
  }
  return { kind: "total", usd: usd * press.requests, approximate };
}

export function formatCost(estimate: CostEstimate): string {
  if (estimate.kind === "rate") return estimate.label;
  return `${estimate.approximate ? "≈ " : ""}${formatUsd(estimate.usd)}`;
}

function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(usd < 10 ? 2 : usd < 100 ? 1 : 0)}`;
}

function rateOf(components: Component[]): CostEstimate | null {
  const parts = components
    .filter((component) => UNIT_NAMES[component.unit])
    .map((component) => {
      const usd = Math.min(...component.tiers.map((tier) => tier.usd));
      const per = component.per === 1 ? "" : `${compact(component.per)} `;
      return `$${trim(usd)}/${per}${UNIT_NAMES[component.unit]}`;
    });
  return parts.length ? { kind: "rate", label: parts.join(" · ") } : null;
}

/** A language model bills by the token, and nobody knows the answer's length
    before it is written — so the two rates that matter, on one line. */
function chatRate(components: Component[]): CostEstimate | null {
  const usd = (unit: string) => components.find((component) => component.unit === unit)?.tiers[0]?.usd;
  const input = usd("input_token");
  const output = usd("output_token");
  if (input === undefined || output === undefined) return null;
  return { kind: "rate", label: `$${trim(input)} in · $${trim(output)} out / 1M tokens` };
}

function compact(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${n / 1000}K` : String(n);
}

function trim(usd: number): string {
  return usd >= 1 ? String(Math.round(usd * 100) / 100) : String(Math.round(usd * 1000) / 1000);
}

/* ---- tiers ---- */

/** The tier the request lands in. A tier fits when every key it names agrees
    with the request; the one naming the most keys wins. Where the request does
    not pin a tier down — a quality left on "auto" — the tiers agreeing on the
    most keys stand in. Between equals the dearer wins, so the estimate errs high. */
function pickTier(
  tiers: Tier[],
  body: Record<string, unknown>,
  plane: GenerationPlane,
): { tier: Tier; exact: boolean } {
  const scored = tiers.map((tier) => {
    const keys = Object.entries(tier.spec);
    const held = keys.filter(
      ([key, value]) => isUniform(tiers, key) || specHolds(key, value, body, plane),
    ).length;
    return { tier, held, fits: held === keys.length };
  });
  const exact = scored.some((entry) => entry.fits);
  const pool = exact ? scored.filter((entry) => entry.fits) : scored;
  const best = pool.reduce((top, next) =>
    next.held > top.held || (next.held === top.held && next.tier.usd > top.tier.usd) ? next : top,
  );
  return { tier: best.tier, exact };
}

/** A key every tier sets to the same value says nothing about the request. */
function isUniform(tiers: Tier[], key: string): boolean {
  return tiers.every((tier) => tier.spec[key] === tiers[0]!.spec[key]);
}

function specHolds(
  key: string,
  value: string,
  body: Record<string, unknown>,
  plane: GenerationPlane,
): boolean {
  const want = value.toLowerCase();
  if (key === "audio") {
    const audio = body.generate_audio ?? body.audio;
    if (audio === undefined) return false;
    return (audio === true || (typeof audio === "string" && audio !== "off")) === (want === "on");
  }
  if (want.endsWith("-video-input")) {
    return ((plane.media.video?.length ?? 0) > 0) === (want === "with-video-input");
  }
  if (want.endsWith("-watermark")) return (body.watermark === true) === (want === "with-watermark");
  if (key === "mode" && typeof body.draft === "boolean") return body.draft === (want === "draft");
  /* The platform names the deciding field its own way per vendor — resolution,
     size, bitrate_mode, model — so any scalar of the body may carry the value. */
  return Object.values(body).some((field) => {
    if (typeof field !== "string" && typeof field !== "number") return false;
    const have = String(field).toLowerCase();
    return have === want || want.endsWith(`-${have === "std" ? "standard" : have}`);
  });
}

/* ---- quantities ---- */

type Amount = { value: number; approximate: boolean };

function quantityOf(
  component: Component,
  tier: Tier,
  body: Record<string, unknown>,
  plane: GenerationPlane,
  outputs: number,
): Amount | undefined {
  const exact = (value: number | undefined): Amount | undefined =>
    value === undefined ? undefined : { value, approximate: false };
  /* A model that makes one fixed length of clip names it in the tier alone. */
  const seconds = outputSeconds(body, plane) ?? (Number(tier.spec.duration_s) || undefined);
  switch (component.unit) {
    case "request":
      return exact(1);
    case "image":
      return exact(outputs);
    case "second":
    case "output_second":
      return exact(scale(seconds, outputs));
    case "minute":
      return exact(scale(seconds, outputs / 60));
    case "video_input_second":
      return exact(clipSeconds(plane.media.video) ?? (plane.media.video?.length ? undefined : 0));
    case "input_image": {
      const images = (["start", "end", "reference"] as const).reduce(
        (count, role) => count + (plane.media[role]?.length ?? 0),
        0,
      );
      return exact(Math.max(0, images - (component.included ?? 0)));
    }
    case "character":
      return exact(characters(body));
    case "video_output_token": {
      const area = SEEDANCE_AREA[String(body.resolution ?? "").toLowerCase()];
      if (getModel(plane.model).vendor !== "bytedance" || !area || !seconds) return undefined;
      // Seedance 2.5's published nominal token rate doubles with video input
      // (43,200 vs 21,600 tokens/s at 720p). The lower per-token tier alone
      // would incorrectly make the Pro carrier appear cheaper.
      const videoFactor = plane.model === "seedance-2.5" && plane.media.video?.length ? 2 : 1;
      return { value: (area * SEEDANCE_FPS * seconds * outputs * videoFactor) / 1024, approximate: true };
    }
    default:
      return undefined;
  }
}

function scale(value: number | undefined, by: number): number | undefined {
  return value === undefined ? undefined : value * by;
}

/** Length of what comes back: the duration the request names, else the length
    of the clip or track it works on — an edit, an upscale, a lipsync. */
function outputSeconds(body: Record<string, unknown>, plane: GenerationPlane): number | undefined {
  if (Array.isArray(body.tracks)) {
    const ends = body.tracks.flatMap((track) =>
      Array.isArray((track as { keyframes?: unknown[] })?.keyframes)
        ? (track as { keyframes: { timestamp?: unknown; duration?: unknown }[] }).keyframes.map(
            (frame) => Number(frame.timestamp) + Number(frame.duration),
          )
        : [],
    );
    if (ends.length && ends.every(Number.isFinite)) return Math.max(...ends) / 1000;
  }
  /* Keyframes: one transition between each pair of frames. */
  const transition = Number(body.transition_duration_s);
  if (transition > 0 && Array.isArray(body.images)) {
    return transition * Math.max(1, body.images.length - 1);
  }
  for (const field of ["duration", "duration_s", "duration_seconds"]) {
    const seconds = Number(body[field]);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return clipSeconds(plane.media.video) ?? clipSeconds(plane.media.audio);
}

function clipSeconds(items: MediaItem[] | undefined): number | undefined {
  if (!items?.length || items.some((item) => !item.duration)) return undefined;
  return items.reduce((sum, item) => sum + item.duration!, 0);
}

function characters(body: Record<string, unknown>): number | undefined {
  if (Array.isArray(body.inputs)) {
    return body.inputs.reduce(
      (sum: number, turn) => sum + String((turn as { text?: unknown })?.text ?? "").length,
      0,
    );
  }
  const text = body.text ?? body.prompt;
  return typeof text === "string" ? text.length : undefined;
}
