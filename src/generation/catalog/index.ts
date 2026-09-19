import { bytedanceAudio } from "./audio/bytedance";
import { elevenlabsAudio } from "./audio/elevenlabs";
import { googleAudio } from "./audio/google";
import { klingAudio } from "./audio/kling";
import { minimaxAudio } from "./audio/minimax";
import { openaiAudio } from "./audio/openai";
import { pikaAudio } from "./audio/pika";
import { soniloAudio } from "./audio/sonilo";
import { bytedanceImage } from "./image/bytedance";
import { googleImage } from "./image/google";
import { ideogramImage } from "./image/ideogram";
import { metaImage } from "./image/meta";
import { openaiImage } from "./image/openai";
import { recraftImage } from "./image/recraft";
import { topazImage } from "./image/topaz";
import { xaiImage } from "./image/x-ai";
import { parseSettings } from "./parse-settings";
import { languageModels } from "./text/llm";
import type { ModelEntry } from "./types";
import { alibabaVideo } from "./video/alibaba";
import { blackForestLabsVideo } from "./video/black-forest-labs";
import { bytedanceVideo } from "./video/bytedance";
import { googleVideo } from "./video/google";
import { klingVideo } from "./video/kling";
import { minimaxVideo } from "./video/minimax";
import { pikaVideo } from "./video/pika";
import { topazVideo } from "./video/topaz";
import { xaiVideo } from "./video/x-ai";

/* Picker order within a surface: the house models lead, then the rest. */
export const MODELS: readonly ModelEntry[] = [
  ...pikaVideo,
  ...bytedanceVideo,
  ...googleVideo,
  ...klingVideo,
  ...alibabaVideo,
  ...minimaxVideo,
  ...blackForestLabsVideo,
  ...xaiVideo,
  ...topazVideo,
  ...bytedanceImage,
  ...googleImage,
  ...openaiImage,
  ...ideogramImage,
  ...recraftImage,
  ...xaiImage,
  ...metaImage,
  ...topazImage,
  ...pikaAudio,
  ...elevenlabsAudio,
  ...googleAudio,
  ...minimaxAudio,
  ...soniloAudio,
  ...klingAudio,
  ...bytedanceAudio,
  ...openaiAudio,
  ...languageModels,
];

export const DEFAULT_MODEL = "seedance-2.5";

export function getModel(id: string): ModelEntry {
  const model = MODELS.find((entry) => entry.id === id);
  if (!model) throw new Error(`Unknown model: ${id}`);
  return model;
}

export type {
  ChatProtocol,
  GenerationPlane,
  MediaBinding,
  MediaItem,
  MediaRole,
  ModelEntry,
  Operation,
  ParamSpec,
  SettingField,
  Surface,
} from "./types";
export { parseSettings };
