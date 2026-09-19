import { getModel, parseSettings } from "./catalog";
import type { GenerationPlane } from "./catalog/types";
import { useActive } from "./stores/active";
import { MEDIA_STORES } from "./stores/media";
import { PROMPT_STORES } from "./stores/prompt";
import { useSettings } from "./stores/settings";

export function assemblePlane(): GenerationPlane {
  const { model: modelId, surface } = useActive.getState();
  const model = getModel(modelId);
  const text = PROMPT_STORES[surface].getState().text;
  const items = MEDIA_STORES[surface].getState().items;
  const media: GenerationPlane["media"] = {};
  for (const item of items) {
    const max = model.roles[item.role];
    if (!max) continue;
    const list = media[item.role] ?? [];
    if (list.length >= max) continue;
    list.push(item);
    media[item.role] = list;
  }
  return {
    model: model.id,
    prompt: { text },
    media,
    settings: parseSettings(model, useSettings.getState().byModel[model.id] ?? {}),
  };
}

/** The plane with every attached clip and track measured. Read from metadata
    alone, so no bytes beyond the header travel and no CORS grant is needed. */
export async function measurePlane(plane: GenerationPlane): Promise<GenerationPlane> {
  const media: GenerationPlane["media"] = {};
  for (const [role, items] of Object.entries(plane.media)) {
    media[role as keyof GenerationPlane["media"]] =
      role === "video" || role === "audio"
        ? await Promise.all(
            items.map(async (item) => ({ ...item, duration: await durationOf(item.url, role) })),
          )
        : items;
  }
  return { ...plane, media };
}

function durationOf(url: string, kind: "video" | "audio"): Promise<number | undefined> {
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    const done = (seconds?: number) => {
      element.removeAttribute("src");
      resolve(
        seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined,
      );
    };
    const timer = setTimeout(() => done(), 15_000);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      clearTimeout(timer);
      done(element.duration);
    };
    element.onerror = () => {
      clearTimeout(timer);
      done();
    };
    element.src = url;
  });
}
