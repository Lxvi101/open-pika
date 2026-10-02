export type Surface = "image" | "video" | "audio" | "text";
export type MediaRole = "start" | "end" | "reference" | "video" | "audio";

export type MediaItem = {
  id: string;
  url: string;
  role: MediaRole;
  /** Seconds, for a clip or a track — measured in the browser at the press. */
  duration?: number;
};

export type SettingField =
  | { type: "enum"; values: readonly string[]; default: string }
  | { type: "range"; min: number; max: number; default: number; step?: number }
  | { type: "boolean"; default: boolean }
  | {
      type: "text";
      default: string;
      multiline?: boolean;
      placeholder?: string;
      maxLength?: number;
    };

/** Where one attached role lands in the request body. `many` writes every URL
    of the role as an array; otherwise only the first is sent. A `required`
    binding keeps the operation out of the running until the role is attached. */
export type MediaBinding = {
  field: string;
  many?: boolean;
  required?: boolean;
  /** Body field that takes the attached clip's length in seconds. Some tools
      price by it and cannot measure a URL, so the studio measures it. */
  durationField?: string;
};

/** How one studio setting is written to the body. The string form is the body
    field alone. `as: "number"` sends an enum or text value as a number (a
    duration enum of "5" | "10", a typed seed). Values listed in `omit` are
    never sent — the "auto" that means "leave it to the platform". An empty
    string is never sent. Fields may be dotted to nest: "voice_settings.speed". */
export type ParamSpec =
  string | { field: string; as?: "number" | "string"; omit?: readonly unknown[] };

/** One callable catalog operation: POST /v1/media/{apiId}. */
export type Operation = {
  apiId: string;
  /** Body field the prompt is written to. Defaults to "prompt"; null when the
      operation takes no words at all. */
  prompt?: string | null;
  media?: Partial<Record<MediaRole, MediaBinding>>;
  /** Roles of which at least one must be attached — an operation that works
      from references, a clip or a track, and needs any one of them. */
  requireAny?: readonly MediaRole[];
  /** Setting key → body field. A setting the operation does not list is not
      sent, so one model's settings can be the union of its operations'. */
  params?: Record<string, ParamSpec>;
  /** Constants the operation always carries. */
  fixed?: Record<string, unknown>;
  /** Last word on the body, for shapes the declarative fields cannot say —
      keyframe lists, dialogue turns. Receives the body built so far. */
  build?: (plane: GenerationPlane, body: Record<string, unknown>) => Record<string, unknown>;
};

export type ChatProtocol = "openai" | "anthropic" | "genai";

export type ModelEntry = {
  id: string;
  surface: Surface;
  label: string;
  /** Catalog vendor slug: "bytedance", "kling", "x-ai". */
  vendor: string;
  /** Replaces the derived picker line when the model needs its own words. */
  description?: string;
  /** Whether Generate needs words. Defaults to "required". */
  prompt?: "required" | "optional" | "none";
  roles: Partial<Record<MediaRole, number>>;
  settings: Record<string, SettingField>;
  /** Media operations, most specific first. The mapper picks by attachments. */
  operations?: readonly Operation[];
  /** Language models are synchronous and speak one of three protocols. */
  chat?: { protocol: ChatProtocol; model: string };
};

export type GenerationPlane = {
  lipSync?: import("../lipsync/types").LipSyncReference;
  model: string;
  prompt: { text: string };
  media: Partial<Record<MediaRole, MediaItem[]>>;
  settings: Record<string, unknown>;
};
