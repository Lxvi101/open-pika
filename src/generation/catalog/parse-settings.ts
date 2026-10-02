import type { ModelEntry } from "./types";

/** The model's settings with every value legal. Anything the catalog no longer
    allows — a stored pick from before a catalog sync, a hand-made payload —
    falls back to the default rather than failing the press. */
export function parseSettings(
  model: ModelEntry,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(model.settings)) {
    const value = raw[key];
    if (field.type === "enum") {
      out[key] = typeof value === "string" && field.values.includes(value) ? value : field.default;
      continue;
    }
    if (field.type === "range") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        out[key] = field.default;
        continue;
      }
      const step = field.step ?? 1;
      const clamped = Math.min(field.max, Math.max(field.min, value));
      const stepped = field.min + Math.round((clamped - field.min) / step) * step;
      const precision = Math.min(12, Math.max(0, (String(step).split(".")[1] ?? "").length));
      out[key] = Math.min(field.max, Math.max(field.min, Number(stepped.toFixed(precision))));
      continue;
    }
    if (field.type === "text") {
      out[key] = typeof value === "string" ? value : field.default;
      continue;
    }
    out[key] = typeof value === "boolean" ? value : field.default;
  }
  return out;
}
