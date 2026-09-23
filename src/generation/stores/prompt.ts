import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Surface } from "../catalog/types";
import { browserStorage } from "./browser-storage";

type PromptState = {
  text: string;
  setText: (text: string) => void;
};

function createPromptStore(name: string) {
  return create<PromptState>()(
    persist(
      (set) => ({
        text: "",
        setText: (text) => set((state) => (state.text === text ? state : { text })),
      }),
      { name, storage: browserStorage(), partialize: (state) => ({ text: state.text }) },
    ),
  );
}

export const useImagePrompt = createPromptStore("openhiggsfield.imagePrompt.v1");
export const useVideoPrompt = createPromptStore("openhiggsfield.videoPrompt.v1");
export const useAudioPrompt = createPromptStore("openhiggsfield.audioPrompt.v1");
export const useTextPrompt = createPromptStore("openhiggsfield.textPrompt.v1");

/** Each surface keeps its own words: a shot description is no use as lyrics. */
export const PROMPT_STORES: Record<Surface, typeof useImagePrompt> = {
  image: useImagePrompt,
  video: useVideoPrompt,
  audio: useAudioPrompt,
  text: useTextPrompt,
};
