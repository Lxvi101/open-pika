import type { ModelEntry } from "../types";

export const recraft41: ModelEntry = {
  id: "recraft-4.1",
  surface: "image",
  label: "Recraft 4.1",
  vendor: "recraft",
  roles: {},
  settings: {
    numImages: { type: "range", min: 1, max: 6, default: 1 },
    /* The schema's "size" enum mixes exact WxH pairs with aspect-ratio
       shorthands; the shorthands alone cover what a visitor would reach for
       and stay inside the schema's allowed values. */
    size: {
      type: "enum",
      values: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
      default: "1:1",
    },
  },
  operations: [
    {
      apiId: "recraft/recraft-4.1/text-to-image",
      params: { numImages: "num_images", size: "size" },
    },
  ],
};

export const recraftImage: readonly ModelEntry[] = [recraft41];
