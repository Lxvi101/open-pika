import requestSchemas from "./request-schemas.json";
import type { GenerationPlane } from "./catalog/types";
import { toPlatform } from "./to-platform";

type Schema = {
  $ref?: string;
  type?: string | string[];
  title?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: boolean | Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  const?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
};

type RequestSchemas = Record<string, Schema>;
const schemas = requestSchemas as unknown as RequestSchemas;

/** Returns the first catalog-schema issue for the request the mapper selected. */
export function generationValidation(plane: GenerationPlane): string | null {
  let mapped: ReturnType<typeof toPlatform>;
  try {
    mapped = toPlatform(plane);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Measured media lengths are populated by the composer immediately before
    // submit; their absence while rendering validation is not a user error.
    return message.includes("Could not read the length of the attached file") ? null : message;
  }

  const apiId = mapped.path.slice("/v1/media/".length);
  return validateRequestBody(apiId, mapped.body);
}

/** Validate a mapped request directly; exposed for catalog regression checks. */
export function validateRequestBody(apiId: string, body: Record<string, unknown>): string | null {
  const schema = schemas[apiId];
  if (!schema) return null;
  return validateValue(body, schema, schema, apiId, new Set())?.message ?? null;
}

type Issue = { path: string; message: string };

function validateValue(
  value: unknown,
  schema: Schema,
  root: Schema,
  apiId: string,
  refStack: Set<string>,
  path = "",
): Issue | null {
  if (schema.$ref) {
    if (refStack.has(schema.$ref)) return null;
    const target = resolveRef(root, schema.$ref);
    if (!target) return { path, message: `The ${apiId} request schema has an unresolved reference.` };
    const nextStack = new Set(refStack);
    nextStack.add(schema.$ref);
    return validateValue(value, target, root, apiId, nextStack, path);
  }

  if (schema.allOf) {
    for (const part of schema.allOf) {
      const issue = validateValue(value, part, root, apiId, refStack, path);
      if (issue) return issue;
    }
  }
  if (schema.anyOf && !schema.anyOf.some((part) => !validateValue(value, part, root, apiId, refStack, path))) {
    return { path, message: `Choose a supported value for ${label(path, schema)}.` };
  }
  if (schema.oneOf && schema.oneOf.filter((part) => !validateValue(value, part, root, apiId, refStack, path)).length !== 1) {
    return { path, message: `Choose one supported option for ${label(path, schema)}.` };
  }

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    return { path, message: `${label(path, schema)} must be ${String(schema.const)}.` };
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return { path, message: `Choose a supported value for ${label(path, schema)}.` };
  }

  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length && !types.some((type) => matchesType(value, type))) {
    return { path, message: `Enter a valid ${label(path, schema)}.` };
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      return { path, message: `${label(path, schema)} must be at least ${schema.minimum}.` };
    if (schema.maximum !== undefined && value > schema.maximum)
      return { path, message: `${label(path, schema)} must be at most ${schema.maximum}.` };
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return { path, message: `${label(path, schema)} must contain at least ${schema.minLength} characters.` };
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return { path, message: `${label(path, schema)} must be at most ${schema.maxLength} characters.` };
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      return { path, message: `Enter a valid ${label(path, schema)}.` };
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      return { path, message: `Add at least ${schema.minItems} ${label(path, schema)}.` };
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      return { path, message: `Use no more than ${schema.maxItems} ${label(path, schema)}.` };
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const issue = validateValue(value[i], schema.items, root, apiId, refStack, `${path}[${i}]`);
        if (issue) return issue;
      }
    }
  }
  if (isRecord(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key) || value[key] === undefined) {
        const child = schema.properties?.[key];
        const childPath = path ? `${path}.${key}` : key;
        const name = label(childPath, child);
        return {
          path: childPath,
          message: childPath === "prompt" ? "Add a prompt to continue." : `${name} is required.`,
        };
      }
    }
    for (const [key, childValue] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      const childPath = path ? `${path}.${key}` : key;
      if (childSchema) {
        const issue = validateValue(childValue, childSchema, root, apiId, refStack, childPath);
        if (issue) return issue;
      } else if (schema.additionalProperties === false) {
        return { path: childPath, message: `${label(childPath)} is not supported by this model.` };
      } else if (isRecord(schema.additionalProperties)) {
        const issue = validateValue(childValue, schema.additionalProperties, root, apiId, refStack, childPath);
        if (issue) return issue;
      }
    }
  }
  return null;
}

function resolveRef(root: Schema, ref: string): Schema | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let value: unknown = root;
  for (const segment of ref.slice(2).split("/")) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(value)) return undefined;
    value = value[key];
  }
  return isRecord(value) ? (value as Schema) : undefined;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "null": return value === null;
    case "object": return isRecord(value);
    case "array": return Array.isArray(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    default: return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function label(path: string, schema?: Schema): string {
  if (schema?.title) return schema.title.toLowerCase();
  const last = path.split(/[.[\]]/).filter(Boolean).at(-1);
  return last ? last.replaceAll("_", " ") : "request";
}
