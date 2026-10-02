import { getModel } from "./catalog";
import { applyLipSync, lipSyncAdapter } from "./lipsync/adapters";
import type { GenerationPlane, MediaRole, Operation, ParamSpec } from "./catalog/types";

type Mapped = { path: string; body: Record<string, unknown> };

const ROLES: readonly MediaRole[] = ["start", "end", "reference", "video", "audio"];

export function toPlatform(plane: GenerationPlane): Mapped {
  const adapter = plane.lipSync ? lipSyncAdapter(plane.model) : undefined;
  plane = applyLipSync(plane);
  const model = getModel(plane.model);
  if (!model.operations?.length) throw new Error(`No platform operation for ${plane.model}`);
  const operation = pickOperation(model.operations, plane);
  if (adapter && operation.apiId !== adapter.apiId) throw new Error("Invalid lip-sync operation.");
  const ignored = ROLES.filter(
    (role) => (plane.media[role]?.length ?? 0) > 0 && !operation.media?.[role],
  );
  if (ignored.length) {
    const guidance = model.vendor === "bytedance" && plane.media.audio?.length &&
      (plane.media.start?.length || plane.media.end?.length)
      ? " Use a reference image instead of start/end frames when attaching audio."
      : " Remove the incompatible attachments or choose another model.";
    throw new Error(
      `${model.label} cannot use this combination of attachments; ${ignored.join(" and ")} would be ignored.${guidance}`,
    );
  }
  const body = buildBody(operation, plane);
  return { path: `/v1/media/${operation.apiId}`, body: adapter ? adapter.finalize(body) : body };
}

/** The operation the attachments ask for. One that binds every attached role
    and has every role it requires wins outright; failing that, the one that
    consumes the most of what is attached. Ties fall to catalog order, so a
    model lists its most specific operation first. */
export function pickOperation(operations: readonly Operation[], plane: GenerationPlane): Operation {
  const attached = ROLES.filter((role) => (plane.media[role]?.length ?? 0) > 0);
  const satisfied = operations.filter(
    (operation) =>
      ROLES.every((role) => !operation.media?.[role]?.required || attached.includes(role)) &&
      (!operation.requireAny || operation.requireAny.some((role) => attached.includes(role))),
  );
  if (satisfied.length === 0) {
    throw new Error(`Attach ${missingRoles(operations[0]!, attached).join(" and ")} first`);
  }
  const consumed = (operation: Operation) =>
    attached.filter((role) => operation.media?.[role]).length;
  const exact = satisfied.find((operation) => consumed(operation) === attached.length);
  if (exact) return exact;
  return satisfied.reduce((best, next) => (consumed(next) > consumed(best) ? next : best));
}

function missingRoles(operation: Operation, attached: MediaRole[]): string[] {
  const names: Record<MediaRole, string> = {
    start: "a start frame",
    end: "an end frame",
    reference: "a reference image",
    video: "a video",
    audio: "an audio file",
  };
  return ROLES.filter((role) => operation.media?.[role]?.required && !attached.includes(role)).map(
    (role) => names[role],
  );
}

function buildBody(operation: Operation, plane: GenerationPlane): Record<string, unknown> {
  const body: Record<string, unknown> = { ...operation.fixed };

  const promptField = operation.prompt === undefined ? "prompt" : operation.prompt;
  const text = plane.prompt.text.trim();
  if (promptField && text) setPath(body, promptField, text);

  for (const role of ROLES) {
    const binding = operation.media?.[role];
    const urls = (plane.media[role] ?? []).map((item) => item.url);
    if (!binding || urls.length === 0) continue;
    setPath(body, binding.field, binding.many ? urls : urls[0]);
    if (binding.durationField) {
      const seconds = plane.media[role]![0]!.duration;
      if (!seconds) throw new Error("Could not read the length of the attached file");
      setPath(body, binding.durationField, Math.round(seconds * 10) / 10);
    }
  }

  for (const [key, spec] of Object.entries(operation.params ?? {})) {
    const value = paramValue(spec, plane.settings[key]);
    if (value !== undefined) setPath(body, fieldOf(spec), value);
  }

  return operation.build ? operation.build(plane, body) : body;
}

function fieldOf(spec: ParamSpec): string {
  return typeof spec === "string" ? spec : spec.field;
}

function paramValue(spec: ParamSpec, value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof spec === "string") return value;
  if (spec.omit?.includes(value)) return undefined;
  if (spec.as === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (spec.as === "string") return String(value);
  return value;
}

function setPath(body: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let node = body;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]!] = value;
}
