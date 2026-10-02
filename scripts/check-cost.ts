/* Prices every media operation at the model's default settings — each with
   exactly the roles it binds attached — and fails on one the price list cannot
   answer for. Prints the table, so a catalog refresh shows what moved. */

import { MODELS, parseSettings } from "../src/generation/catalog";
import type { GenerationPlane, MediaRole } from "../src/generation/catalog";
import { estimateCost, formatCost } from "../src/generation/cost";
import { readFileSync } from "node:fs";
import { toPlatform } from "../src/generation/to-platform";

let bad = 0;
let skipped = 0;
for (const model of MODELS) {
  const planes: { plane: GenerationPlane; name: string; hasCustomInput: boolean }[] = [];
  for (const op of model.operations ?? [undefined]) {
    const media: GenerationPlane["media"] = {};
    const schema = op
      ? JSON.parse(readFileSync(`scripts/pika-catalog/${op.apiId.replaceAll("/", "__")}.json`, "utf8")).input_schema
      : { required: [], properties: {} };
    const requiredFields = new Set<string>(schema.required ?? []);
    const firstAny = op?.requireAny?.[0];
    for (const role of Object.keys(op?.media ?? {}) as MediaRole[]) {
      const binding = op!.media![role]!;
      if (!binding.required && !requiredFields.has(binding.field.split(".")[0]!) && firstAny !== role) continue;
      const property = schema.properties?.[binding.field.split(".")[0]!];
      const minimum = binding.many ? Math.max(1, property?.minItems ?? 1) : 1;
      media[role] = Array.from({ length: minimum }, (_, index) => ({
        id: `${role}${index}`,
        role,
        url: `https://x.test/${role}${index}.bin`,
        duration: 10,
      }));
    }
    planes.push({
      name: model.chat ? model.chat.model : op?.apiId ?? model.id,
      hasCustomInput: Boolean(op?.build),
      plane: {
        model: model.id,
        prompt: { text: "A forty character prompt, give or take." },
        media,
        settings: parseSettings(model, {
          ...(model.id === "pika-video-compose"
            ? { tracksJson: '[{"id":"main","type":"video","keyframes":[{"timestamp":0,"duration":5000,"url":"https://x.test/clip.mp4"}]}]' }
            : {}),
          ...(model.id === "seedance-2.5-finalize-draft" ? { draftJobId: "job-fixture" } : {}),
        }),
      },
    });
  }
  for (const { plane, name, hasCustomInput } of planes) {
    const estimate = estimateCost(plane, { requests: 1, outputs: 1 });
    let requestReady = true;
    try {
      toPlatform(plane);
    } catch {
      requestReady = false;
    }
    if (!estimate && hasCustomInput && !requestReady) skipped++;
    else if (!estimate) bad++;
    console.log(`${estimate ? "  " : hasCustomInput && !requestReady ? "SKIP" : "NO"} ${name.padEnd(58)} ${estimate ? formatCost(estimate) : "—"}`);
  }
}
if (bad) {
  console.error(`${bad} operations without a price`);
  process.exit(1);
}
if (skipped) console.log(`${skipped} operations need custom inputs before their cost can be checked`);
