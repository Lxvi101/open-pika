/* Prices every media operation at the model's default settings — each with
   exactly the roles it binds attached — and fails on one the price list cannot
   answer for. Prints the table, so a catalog refresh shows what moved. */

import { MODELS, parseSettings } from "../src/generation/catalog";
import type { GenerationPlane, MediaRole } from "../src/generation/catalog";
import { estimateCost, formatCost } from "../src/generation/cost";
import { toPlatform } from "../src/generation/to-platform";

let bad = 0;
for (const model of MODELS) {
  const planes: GenerationPlane[] = [];
  for (const op of model.operations ?? [undefined]) {
    const media: GenerationPlane["media"] = {};
    for (const role of Object.keys(op?.media ?? {}) as MediaRole[]) {
      media[role] = [{ id: role, role, url: `https://x.test/${role}.bin`, duration: 10 }];
    }
    planes.push({
      model: model.id,
      prompt: { text: "A forty character prompt, give or take." },
      media,
      settings: parseSettings(model, {}),
    });
  }
  for (const plane of planes) {
    const estimate = estimateCost(plane, { requests: 1, outputs: 1 });
    const name = model.chat ? model.chat.model : toPlatform(plane).path.slice("/v1/media/".length);
    if (!estimate) bad++;
    console.log(`${estimate ? "  " : "NO"} ${name.padEnd(58)} ${estimate ? formatCost(estimate) : "—"}`);
  }
}
if (bad) {
  console.error(`${bad} operations without a price`);
  process.exit(1);
}
