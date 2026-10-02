/* Checks catalog files against the platform's own input schemas.

   pnpm check:catalog                          every file, snapshot coverage
   pnpm check:catalog -- --live                also compare snapshots with the live index
   pnpm check:catalog src/.../video/kling.ts   one file
   ... --expect kling/video                    and that it covers that vendor's
                                               whole category

   scripts/pika-catalog holds one GET /catalog/apis/{api_id}?expand=inputs
   response per operation; refresh it with `pnpm sync:catalog`. */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ModelEntry, Operation, ParamSpec } from "../src/generation/catalog/types";

type Schema = Record<string, any>;
type Api = { api_id: string; vendor: string; category: string; input_schema?: Schema };

const here = dirname(fileURLToPath(import.meta.url));
const snapshot = join(here, "pika-catalog");
const apis = new Map<string, Api>(
  readdirSync(snapshot)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const api = JSON.parse(readFileSync(join(snapshot, name), "utf8")) as Api;
      return [api.api_id, api];
    }),
);

const args = process.argv.slice(2);
const live = args.includes("--live");
if (live) args.splice(args.indexOf("--live"), 1);
const expectAt = args.indexOf("--expect");
const expect = expectAt >= 0 ? args.splice(expectAt, 2)[1]!.split(",") : null;
const files = args.length ? args : [join(here, "../src/generation/catalog/index.ts")];

const errors: string[] = [];
const warnings: string[] = [];
const models: ModelEntry[] = [];

if (live) {
  const base = process.env.PIKA_API_BASE_URL || "https://api.dev.pika.art";
  const response = await fetch(`${base}/catalog/apis`);
  if (!response.ok) throw new Error(`Live catalog: ${response.status}`);
  const index = (await response.json()) as { apis: Api[] };
  const local = new Set(apis.keys());
  const missing = index.apis.filter((api) => !local.has(api.api_id));
  for (const api of missing) errors.push(`expanded snapshot missing live operation: ${api.api_id}`);
  console.log(`Live catalog: ${index.apis.length} records, ${missing.length} missing expanded snapshots`);
}

for (const file of files) {
  const loaded = (await import(pathToFileURL(resolve(file)).href)) as Record<string, unknown>;
  if (Array.isArray(loaded.MODELS)) {
    models.push(...(loaded.MODELS as ModelEntry[]));
    continue;
  }
  for (const value of Object.values(loaded)) {
    if (Array.isArray(value)) models.push(...(value as ModelEntry[]));
  }
}

const ids = new Set<string>();
const covered = new Set<string>();
for (const model of new Set(models)) {
  if (ids.has(model.id)) errors.push(`${model.id}: duplicate model id`);
  ids.add(model.id);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(model.id))
    errors.push(`${model.id}: id must be a lowercase slug`);
  if (model.chat) {
    const api = apis.get(model.chat.model);
    if (!api || api.category !== "llm")
      errors.push(`${model.id}: ${model.chat.model} is not a catalog LLM`);
    else if (api.vendor !== model.vendor)
      errors.push(`${model.id}: vendor should be ${api.vendor}`);
    covered.add(model.chat.model);
    continue;
  }
  if (!model.operations?.length) {
    errors.push(`${model.id}: no operations`);
    continue;
  }
  for (const operation of model.operations) checkOperation(model, operation);
}

const wanted = [...apis.values()].filter((api) =>
  expect
    ? expect.includes(`${api.vendor}/${api.category}`)
    : files.length === 1 && files[0]!.endsWith("index.ts"),
);
for (const api of wanted) {
  /* The two keyless genai image routes duplicate the async image operations. */
  if (api.category === "image" && !api.input_schema?.properties) continue;
  if (!covered.has(api.api_id)) errors.push(`catalog operation not covered: ${api.api_id}`);
}

for (const line of warnings) console.warn(`warn  ${line}`);
for (const line of errors) console.error(`error ${line}`);
console.log(
  `${new Set(models).size} models, ${covered.size} operations, ${errors.length} errors, ${warnings.length} warnings`,
);
process.exit(errors.length ? 1 : 0);

function checkOperation(model: ModelEntry, operation: Operation): void {
  const at = `${model.id} → ${operation.apiId}`;
  const api = apis.get(operation.apiId);
  if (!api?.input_schema?.properties) {
    errors.push(`${at}: not an operation in the catalog`);
    return;
  }
  if (api.vendor !== model.vendor) errors.push(`${at}: vendor should be ${api.vendor}`);
  if (api.category !== model.surface) {
    warnings.push(`${at}: catalog category is ${api.category}, surface is ${model.surface}`);
  }
  covered.add(operation.apiId);

  const schema = api.input_schema;
  const properties = schema.properties as Record<string, Schema>;
  const written = new Set<string>(Object.keys(operation.fixed ?? {}).map(top));

  const promptField = operation.prompt === undefined ? "prompt" : operation.prompt;
  if (promptField) {
    if (!properties[top(promptField)])
      errors.push(`${at}: prompt field "${promptField}" is not in the schema`);
    written.add(top(promptField));
    if (model.prompt === "none")
      errors.push(`${at}: writes a prompt but the model declares prompt: "none"`);
  }

  for (const [role, binding] of Object.entries(operation.media ?? {})) {
    if (!model.roles[role as keyof ModelEntry["roles"]])
      errors.push(`${at}: role "${role}" is bound but not in model.roles`);
    if (!properties[top(binding.field)])
      errors.push(`${at}: media field "${binding.field}" is not in the schema`);
    const isArray = flatten(properties[top(binding.field)] ?? {}, schema).some(
      (s) => s.type === "array",
    );
    if (!operation.build && !binding.field.includes(".")) {
      if (binding.many && !isArray)
        errors.push(`${at}: "${binding.field}" is not an array but the binding says many`);
      if (!binding.many && isArray)
        errors.push(`${at}: "${binding.field}" is an array; bind it with many: true`);
    }
    const required = (schema.required ?? []).includes(top(binding.field));
    if (required && !binding.required)
      warnings.push(`${at}: "${binding.field}" is required by the schema but the binding is not`);
    written.add(top(binding.field));
    if (binding.durationField) {
      if (!properties[top(binding.durationField)])
        errors.push(`${at}: duration field "${binding.durationField}" is not in the schema`);
      written.add(top(binding.durationField));
    }
  }

  for (const [key, spec] of Object.entries(operation.params ?? {})) {
    const field = typeof spec === "string" ? spec : spec.field;
    const setting = model.settings[key];
    if (!setting) {
      errors.push(`${at}: param "${key}" has no setting on the model`);
      continue;
    }
    const property = resolvePath(properties, field, schema);
    if (!property) {
      errors.push(`${at}: param field "${field}" is not in the schema`);
      continue;
    }
    written.add(top(field));
    checkValues(at, key, setting, spec, flatten(property, schema));
  }

  for (const field of schema.required ?? []) {
    if (written.has(field)) continue;
    if (operation.build) warnings.push(`${at}: required "${field}" must be written by build()`);
    else errors.push(`${at}: required field "${field}" is never written`);
  }
}

function checkValues(
  at: string,
  key: string,
  setting: ModelEntry["settings"][string],
  spec: ParamSpec,
  variants: Schema[],
): void {
  const omit = typeof spec === "string" ? [] : (spec.omit ?? []);
  const asNumber = typeof spec !== "string" && spec.as === "number";
  const allowed = variants.flatMap((v) =>
    v.enum ? v.enum : v.const !== undefined ? [v.const] : [],
  );
  const types = new Set(variants.flatMap((v) => (Array.isArray(v.type) ? v.type : [v.type])));
  const numeric = variants.find((v) => v.type === "integer" || v.type === "number");

  if (setting.type === "enum") {
    for (const value of setting.values) {
      if (omit.includes(value)) continue;
      const sent = asNumber ? Number(value) : value;
      if (
        allowed.length &&
        !allowed.includes(sent) &&
        !(numeric && typeof sent === "number" && inRange(sent, numeric))
      ) {
        errors.push(
          `${at}: ${key} value ${JSON.stringify(sent)} is not allowed (${JSON.stringify(allowed)})`,
        );
      }
      if (!allowed.length && typeof sent === "string" && !types.has("string")) {
        errors.push(
          `${at}: ${key} sends a string but the schema wants ${[...types].join("|")}; use as: "number"`,
        );
      }
    }
    if (!setting.values.includes(setting.default))
      errors.push(`${at}: ${key} default is not one of its values`);
  }
  if (setting.type === "range") {
    if (!numeric) errors.push(`${at}: ${key} is a range but the schema field is not numeric`);
    else {
      if (!inRange(setting.min, numeric) || !inRange(setting.max, numeric)) {
        errors.push(
          `${at}: ${key} range ${setting.min}–${setting.max} is outside the schema's ${numeric.minimum ?? "-∞"}–${numeric.maximum ?? "∞"}`,
        );
      }
      if (
        numeric.type === "integer" &&
        setting.step !== undefined &&
        !Number.isInteger(setting.step)
      ) {
        errors.push(`${at}: ${key} is an integer field with a fractional step`);
      }
      if (allowed.length && allowed.every((v) => typeof v === "number")) {
        warnings.push(
          `${at}: ${key} is a numeric enum ${JSON.stringify(allowed)}; an enum setting with as: "number" fits better than a range`,
        );
      }
    }
  }
  if (setting.type === "boolean" && !types.has("boolean")) {
    errors.push(`${at}: ${key} is a boolean but the schema field is ${[...types].join("|")}`);
  }
  if (setting.type === "text") {
    if (asNumber ? !numeric : !types.has("string")) {
      errors.push(`${at}: ${key} is text but the schema field is ${[...types].join("|")}`);
    }
  }
}

function inRange(value: number, schema: Schema): boolean {
  if (typeof schema.minimum === "number" && value < schema.minimum) return false;
  if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) return false;
  if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) return false;
  return true;
}

function top(path: string): string {
  return path.split(".")[0]!;
}

function deref(node: Schema, root: Schema): Schema {
  if (typeof node.$ref !== "string") return node;
  const name = node.$ref.split("/").pop()!;
  return { ...(root.$defs?.[name] ?? {}), ...node, $ref: undefined };
}

/** The concrete alternatives behind anyOf / oneOf / $ref, nulls dropped. */
function flatten(node: Schema, root: Schema): Schema[] {
  const resolved = deref(node, root);
  const branches = resolved.anyOf ?? resolved.oneOf;
  if (!Array.isArray(branches)) return [resolved];
  return branches
    .flatMap((branch: Schema) => flatten(branch, root))
    .filter((v) => v.type !== "null");
}

function resolvePath(
  properties: Record<string, Schema>,
  path: string,
  root: Schema,
): Schema | null {
  let node: Schema | undefined = properties[top(path)];
  for (const key of path.split(".").slice(1)) {
    if (!node) return null;
    node = flatten(node, root)
      .map((variant) => variant.properties?.[key] as Schema | undefined)
      .find(Boolean);
  }
  return node ?? null;
}
