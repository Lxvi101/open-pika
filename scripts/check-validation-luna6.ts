import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { MODELS, parseSettings } from "../src/generation/catalog";
import type { GenerationPlane, MediaRole } from "../src/generation/catalog";
import requestSchemas from "../src/generation/request-schemas.json";
import { toPlatform } from "../src/generation/to-platform";
import { generationValidation, validateRequestBody } from "../src/generation/validation";

const snapshots: Record<string, unknown> = {};
for (const file of readdirSync("scripts/pika-catalog").filter((name) => name.endsWith(".json"))) {
  const snapshot = JSON.parse(readFileSync(`scripts/pika-catalog/${file}`, "utf8"));
  if (snapshot.api_id && snapshot.input_schema && Object.keys(snapshot.input_schema).length) {
    snapshots[snapshot.api_id] = snapshot.input_schema;
  }
}
assert.deepEqual(requestSchemas, snapshots, "request schemas must match the current catalog snapshots");

const seedance = MODELS.find((model) => model.id === "seedance-2.5")!;
const seedancePlane: GenerationPlane = {
  model: seedance.id,
  prompt: { text: "" },
  media: {},
  settings: parseSettings(seedance, {}),
};
assert.match(generationValidation(seedancePlane) ?? "", /prompt/i, "selected operation requires prompt");
assert.match(
  generationValidation({ ...seedancePlane, prompt: { text: "x".repeat(30_001) } }) ?? "",
  /30000 characters/i,
  "prompt length is reported instead of being silently truncated",
);

const dialogue = MODELS.find((model) => model.id === "eleven-text-to-dialogue")!;
const dialoguePlane: GenerationPlane = {
  model: dialogue.id,
  prompt: { text: "" },
  media: {},
  settings: parseSettings(dialogue, {}),
};
assert.match(generationValidation(dialoguePlane) ?? "", /dialogue turn/i);
assert.match(
  validateRequestBody("elevenlabs/eleven-text-to-dialogue/text-to-speech", { inputs: [] }) ?? "",
  /at least 1 inputs/i,
  "minItems is enforced",
);
assert.match(
  validateRequestBody("elevenlabs/eleven-text-to-dialogue/text-to-speech", { inputs: [{}] }) ?? "",
  /text is required/i,
  "nested $ref object requirements are enforced",
);

const textModel = MODELS.find((model) => model.settings.voice1?.type === "text")!;
const longText = "x".repeat((textModel.settings.voice1 as { maxLength?: number }).maxLength ?? 1_000);
const parsedText = parseSettings(textModel, { voice1: longText });
assert.equal(parsedText.voice1, longText, "creative text settings are preserved for schema validation");

const rangeModel = MODELS.find((model) => Object.values(model.settings).some((field) => field.type === "range"))!;
const rangeField = Object.entries(rangeModel.settings).find(([, field]) => field.type === "range")!;
const rangeKey = rangeField[0];
const range = rangeField[1];
assert.equal(range.type, "range");
if (range.type !== "range") throw new Error("Expected a numeric setting");
assert.equal(parseSettings(rangeModel, { [rangeKey]: range.max + 100 })[rangeKey], range.max);
assert.equal(parseSettings(rangeModel, { [rangeKey]: range.min - 100 })[rangeKey], range.min);
assert.equal(parseSettings(rangeModel, { [rangeKey]: range.min + 0.49 })[rangeKey], range.min);

// Ensure the schema validator can resolve nested `$ref`s and accepts the
// mapper's complete valid request for every declared operation.
let checked = 0;
const checkedRoutes = new Set<string>();
for (const model of MODELS) {
  for (const operation of model.operations ?? []) {
    const media: GenerationPlane["media"] = {};
    const declaredRoles = Object.keys(operation.media ?? {}) as MediaRole[];
    const requiredRoles = declaredRoles.filter((role) => operation.media?.[role]?.required);
    const rolesToAttach = requiredRoles.length
      ? requiredRoles
      : operation.requireAny?.length
        ? [operation.requireAny[0]!]
        : declaredRoles.slice(0, 1);
    for (const role of rolesToAttach) {
      if (!operation.media?.[role]) continue;
      const binding = operation.media![role]!;
      const count = binding.many ? Math.min(2, model.roles[role] ?? 1) : 1;
      media[role] = Array.from({ length: count }, (_, index) => ({
        id: `${role}-${index}`,
        role,
        url: `https://example.test/${role}-${index}.bin`,
        duration: 3,
      }));
    }
    const settings = parseSettings(model, {});
    // Fixtures for custom builders that need structured input. These requests
    // are mapped and validated locally; the script never submits generations.
    if ("tracksJson" in settings) {
      settings.tracksJson = JSON.stringify([{
        id: "main",
        type: "image",
        keyframes: [{ timestamp: 0, duration: 5000, url: "https://example.test/frame.jpg" }],
      }]);
    }
    if ("draftJobId" in settings) settings.draftJobId = "test-completed-draft";
    if ("voiceConsentAttested" in settings) settings.voiceConsentAttested = true;
    const plane: GenerationPlane = {
      model: model.id,
      prompt: { text: "A quiet scene" },
      media,
      settings,
    };
    let request: ReturnType<typeof toPlatform>;
    try {
      request = toPlatform(plane);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const builderNeedsUserInput =
        /requires a voice ID for each speaker|Add at least one dialogue turn|supports at most 10 turns|Each .* turn must be .* characters or fewer|Add timeline tracks as JSON|Enter the completed Seedance draft job ID|Attest that you have permission to clone this voice/i.test(
          message,
        );
      if (builderNeedsUserInput) continue;
      throw error;
    }

    const apiId = request.path.slice("/v1/media/".length);
    if (requestSchemas[apiId as keyof typeof requestSchemas]) {
      assert.equal(generationValidation(plane), null, `${model.id} ${apiId}`);
      checked++;
      checkedRoutes.add(apiId);
    }
  }
}
assert.equal(checkedRoutes.size, Object.keys(requestSchemas).length, "every catalog request route must be exercised");
console.log(`Validation passed; ${checked} generated requests covered all ${checkedRoutes.size} catalog schemas.`);
