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
      const legal = typeof value === "number" && value >= field.min && value <= field.max;
      out[key] = legal ? value : field.default;
      continue;
    }
    if (field.type === "text") {
      const text = typeof value === "string" ? value : field.default;
      out[key] = field.maxLength === undefined ? text : text.slice(0, field.maxLength);
      continue;
    }
    out[key] = typeof value === "boolean" ? value : field.default;
  }
  return out;
}
