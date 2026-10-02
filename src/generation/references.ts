import type { GenerationPlane, MediaItem, ModelEntry } from "./catalog/types";
import { pickOperation } from "./to-platform";

export type PromptReference = { item: MediaItem; token: string };
export type ReferenceQuery = { start: number; end: number; query: string };

export function supportsReferences(model: ModelEntry): boolean {
  return model.vendor === "bytedance" && model.id.startsWith("seedance-") &&
    (model.operations ?? []).some((operation) => operation.media?.reference?.field === "image_urls");
}

/** Use the selected operation and its URL-array order, including role caps.
    Start/end frames belong to image-to-video and have no @ImageN alias. */
export function promptReferences(model: ModelEntry, items: readonly MediaItem[]): PromptReference[] {
  if (!supportsReferences(model)) return [];
  const media: GenerationPlane["media"] = {};
  for (const item of items) {
    const list = media[item.role] ?? [];
    if (list.length >= (model.roles[item.role] ?? 0)) continue;
    media[item.role] = [...list, item];
  }
  const operation = pickOperation(model.operations ?? [], {
    model: model.id, prompt: { text: "" }, media, settings: {},
  });
  const out: PromptReference[] = [];
  for (const [role, field, label] of [
    ["reference", "image_urls", "Image"],
    ["video", "video_urls", "Video"],
    ["audio", "audio_urls", "Audio"],
  ] as const) {
    const binding = operation.media?.[role];
    if (!binding?.many || binding.field !== field) continue;
    (media[role] ?? []).forEach((item, index) => out.push({ item, token: `@${label}${index + 1}` }));
  }
  return out;
}

/** A collapsed caret in an @word, including when editing its middle. Emails
    and a selected text range leave normal textarea keyboard behavior intact. */
export function referenceQuery(text: string, start: number, end = start): ReferenceQuery | null {
  if (start !== end) return null;
  const match = /(?:^|[\s([{,:;!?])@([a-zA-Z0-9]*)$/.exec(text.slice(0, start));
  if (!match) return null;
  const suffix = /^[a-zA-Z0-9]*/.exec(text.slice(start))![0];
  return { start: start - match[1]!.length - 1, end: start + suffix.length, query: match[1]! };
}

export function completeReference(text: string, query: ReferenceQuery, token: string) {
  const after = text.slice(query.end);
  const insert = token + (after === "" || /^[a-zA-Z0-9@]/.test(after) ? " " : "");
  return { text: text.slice(0, query.start) + insert + after, caret: query.start + insert.length };
}
