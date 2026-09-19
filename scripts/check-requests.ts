/* Builds a request for every media operation — each with exactly the roles it
   binds attached and the model's default settings — and checks the body against
   the platform schema: right route, no unknown or missing fields, legal values. */

import { readFileSync } from "node:fs";
import { MODELS, parseSettings } from "../src/generation/catalog";
import type { GenerationPlane, MediaRole } from "../src/generation/catalog";
import { toPlatform } from "../src/generation/to-platform";

let bad = 0,
  n = 0;
for (const model of MODELS) {
  if (!model.operations) continue;
  for (const op of model.operations) {
    // attach exactly the roles this op binds (required + requireAny first + all optional)
    const media: GenerationPlane["media"] = {};
    for (const role of Object.keys(op.media ?? {}) as MediaRole[]) {
      const count = op.media![role]!.many ? Math.min(2, model.roles[role] ?? 1) : 1;
      media[role] = Array.from({ length: count }, (_, i) => ({
        id: `${role}${i}`,
        role,
        url: `https://x.test/${role}${i}.bin`,
        duration: 12.34,
      }));
    }
    const plane: GenerationPlane = {
      model: model.id,
      prompt: { text: "line one\nline two" },
      media,
      settings: parseSettings(model, {}),
    };
    let mapped;
    try {
      mapped = toPlatform(plane);
    } catch (e) {
      console.log("THROW", model.id, op.apiId, (e as Error).message);
      bad++;
      continue;
    }
    n++;
    if (mapped.path !== `/v1/media/${op.apiId}`) {
      console.log("ROUTE", model.id, "wanted", op.apiId, "got", mapped.path);
      bad++;
      continue;
    }
    const schema = JSON.parse(
      readFileSync(`scripts/pika-catalog/${op.apiId.replaceAll("/", "__")}.json`, "utf8"),
    ).input_schema;
    for (const key of Object.keys(mapped.body))
      if (!schema.properties[key]) {
        console.log("UNKNOWN", op.apiId, key);
        bad++;
      }
    for (const key of schema.required ?? [])
      if (mapped.body[key] === undefined) {
        console.log("MISSING", op.apiId, key);
        bad++;
      }
    for (const [key, value] of Object.entries(mapped.body)) {
      const p = schema.properties[key];
      if (!p) continue;
      const variants = (p.anyOf ?? [p]) as any[];
      const enums = variants.flatMap((v) => v.enum ?? (v.const !== undefined ? [v.const] : []));
      const nums = variants.filter((v) => v.type === "integer" || v.type === "number");
      if (
        enums.length &&
        !enums.includes(value) &&
        !(
          typeof value === "number" &&
          nums.some((v) => (v.minimum ?? -1e9) <= value && value <= (v.maximum ?? 1e9))
        )
      ) {
        console.log("ENUM", op.apiId, key, value);
        bad++;
      }
      if (typeof value === "number")
        for (const v of nums)
          if (
            !enums.includes(value) &&
            (value < (v.minimum ?? -1e9) || value > (v.maximum ?? 1e9))
          ) {
            console.log("RANGE", op.apiId, key, value);
            bad++;
          }
      const types = variants.map((v) => v.type);
      const t = Array.isArray(value)
        ? "array"
        : typeof value === "number"
          ? Number.isInteger(value)
            ? "integer"
            : "number"
          : typeof value;
      if (
        !variants.some((v) => v.$ref) &&
        !types.includes(t) &&
        !(t === "integer" && types.includes("number"))
      ) {
        console.log("TYPE", op.apiId, key, t, "not in", types);
        bad++;
      }
    }
  }
}
console.log(n, "bodies built,", bad, "problems");
process.exit(bad ? 1 : 0);
