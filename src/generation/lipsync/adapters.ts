import type { GenerationPlane } from "../catalog/types";
import { LIP_SYNC_RATIOS, validClipDuration, type LipSyncReference } from "./types";

/** A model adapter owns routing, reference syntax, limits and prompting.
 * The editor, media preparation and transcription do not depend on Seedance. */
export interface LipSyncAdapter {
  minDuration: number;
  maxDuration: number;
  apiId: string;
  apply: (plane: GenerationPlane, reference: LipSyncReference) => GenerationPlane;
  finalize: (body: Record<string, unknown>) => Record<string, unknown>;
}

const seedance25: LipSyncAdapter = {
  minDuration: 4,
  maxDuration: 30,
  apiId: "bytedance/seedance-2.5/reference-to-video",
  apply(plane, reference) {
    const { start = [], end = [], ...media } = plane.media;
    // Append converted frames so existing @ImageN references keep their indices.
    const images = [...(media.reference ?? [])];
    const framing: string[] = [];
    for (const [frames, instruction] of [[start, "Begin with the composition in"], [end, "Finish with the composition in"]] as const) {
      for (const frame of frames) {
        images.push({ ...frame, role: "reference" });
        framing.push(`${instruction} @Image${images.length}.`);
      }
    }
    if (images.length > 30) throw new Error("Lip sync supports up to 30 images, including start/end frames.");
    media.reference = images;
    const role = reference.mode === "video" ? "video" : "audio";
    const clips = [...(media[role] ?? [])];
    if (clips.length >= 10) throw new Error(`Leave one ${role} reference slot for lip-sync audio.`);
    const total = clips.reduce((sum, item) => {
      if (!item.duration || !Number.isFinite(item.duration)) throw new Error(`Could not measure an attached ${role} reference.`);
      return sum + item.duration;
    }, reference.duration);
    if (total > 30.001) throw new Error(`The lip-sync reference and other ${role} references must total at most 30 seconds.`);
    clips.push({ id: "lip-sync-driving-reference", role, url: reference.url, duration: reference.duration });
    media[role] = clips;
    const token = `@${role === "video" ? "Video" : "Audio"}${clips.length}`;
    const source = role === "video" ? `the audio track from ${token}` : token;
    const instructions = [
      "LIP-SYNC PERFORMANCE",
      ...framing,
      `Create a ${reference.duration}-second performance using ${source} as the exact spoken soundtrack.`,
      ...(role === "video" ? [`Use ${token} as an audio carrier; compose all visible imagery from the scene description and image references.`] : []),
      "Preserve the recording's voices, language, words, pace, pauses, breaths and emotional delivery.",
      "Align each visible speaker's mouth movements precisely with that speaker's syllables and timing in the recording.",
      "SPOKEN DIALOGUE (timing is relative to the selected audio clip):",
      reference.transcript.trim(),
      `AUDIO: The final video's dialogue soundtrack is ${source}, with its original timing throughout all ${reference.duration} seconds. Match the lip movements to this recording exactly.`,
    ];
    const text = [plane.prompt.text.trim(), instructions.join("\n")].filter(Boolean).join("\n\n");
    if (text.length > 30_000) throw new Error("The scene and lip-sync transcript exceed Seedance's prompt limit.");
    return {
      ...plane,
      lipSync: undefined,
      media,
      prompt: { text },
      settings: {
        ...plane.settings,
        duration: reference.duration,
        generateAudio: true,
        omniReferenceTaskType: "reference",
        ...(reference.mode === "video" ? { aspectRatio: reference.aspectRatio } : {}),
      },
    };
  },
  finalize: (body) => ({ ...body, omni_reference_task_type: "reference" }),
};

const adapters: Readonly<Record<string, LipSyncAdapter>> = { "seedance-2.5": seedance25 };
export function lipSyncAdapter(modelId: string): LipSyncAdapter | undefined { return adapters[modelId]; }

export function applyLipSync(plane: GenerationPlane): GenerationPlane {
  if (!plane.lipSync) return plane;
  const adapter = lipSyncAdapter(plane.model);
  if (!adapter) throw new Error("Lip sync is not supported by this model yet.");
  const reference = plane.lipSync;
  if (!validClipDuration(reference.duration)) throw new Error("Choose a whole-second lip-sync length from 4 to 30 seconds.");
  if (reference.mode !== "audio" && reference.mode !== "video") throw new Error("Invalid lip-sync mode.");
  if (typeof reference.url !== "string" || !/^https?:\/\//.test(reference.url)) throw new Error("Prepare the lip-sync reference first.");
  if (typeof reference.transcript !== "string" || !reference.transcript.trim()) throw new Error("Review the spoken transcript before generating.");
  if (reference.mode === "video" && !LIP_SYNC_RATIOS.includes(reference.aspectRatio as typeof LIP_SYNC_RATIOS[number])) {
    throw new Error("Choose an explicit aspect ratio for the Pro reference.");
  }
  return adapter.apply(plane, reference);
}
