import type { ChatProtocol } from "./catalog/types";

const MEDIA_PATH = /^\/v1\/media\/[a-z0-9][a-z0-9._/-]*$/i;

export class PlatformError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(messageFromBody(status, body));
    this.name = "PlatformError";
    this.status = status;
    this.body = body;
  }
}

export type QueuedGeneration = {
  status: string;
  requestId: string;
};

export type GenerationStatus = {
  status: string;
  requestId: string;
  images?: Array<{ url: string }>;
  video?: { url: string };
  audio?: { url: string };
  /** A transcription job answers with the URL of its transcript JSON. */
  transcript?: { url: string };
  /** Words the run produced: a transcript once it has been read. */
  text?: string;
  /** The platform's stable error code, e.g. "content_moderation". */
  errorCode?: string;
  error?: unknown;
};

export type ChatRequest = {
  protocol: ChatProtocol;
  model: string;
  prompt: string;
  system?: string;
  maxTokens: number;
  /** Public image URLs the model should look at, for models that can. */
  images?: string[];
};

/** One request's answer inside a batched status poll. A request that errors
    carries its reason alone, so it cannot lose the answers standing beside it. */
export type StatusResult =
  { requestId: string; status: GenerationStatus } | { requestId: string; error: string };

export type PlatformClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
};

export function isMediaPath(path: string): boolean {
  return MEDIA_PATH.test(path) && !path.includes("..");
}

export function createPlatformClient(options: PlatformClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;

  async function send(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    headers?: Record<string, string>,
  ) {
    const url = `${baseUrl}${path}`;
    console.info("[platform] request", { method, url, body: body ?? null });
    const response = await fetchImpl(url, {
      method,
      headers: {
        "X-API-Key": options.apiKey,
        ...headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const payload = await readJson(response);
    console.info("[platform] response", { method, url, status: response.status, body: payload });
    /* A submit the balance or a rate limit turned away still answers with the
       failed job envelope; its error is the message worth showing. */
    if (!response.ok) throw new PlatformError(response.status, payload);
    return payload;
  }

  return {
    async submit(path: string, input: Record<string, unknown>): Promise<QueuedGeneration> {
      if (!isMediaPath(path)) throw new PlatformError(400, { message: "Invalid operation" });
      return mapQueued(await send("POST", path, input, { "Idempotency-Key": crypto.randomUUID() }));
    },
    async status(requestId: string): Promise<GenerationStatus> {
      if (!requestId) throw new PlatformError(400, { message: "Missing request id" });
      return mapStatus(await send("GET", `/v1/media/jobs/${encodeURIComponent(requestId)}`));
    },
    async upload(contentType: string, sizeBytes: number): Promise<UploadTicket> {
      return mapUpload(
        await send("POST", "/v1/media/uploads", {
          content_type: contentType,
          size_bytes: sizeBytes,
        }),
      );
    },
    /** Language models are synchronous: one request, the whole answer. */
    async chat(request: ChatRequest): Promise<string> {
      const { path, body, headers } = chatRequest(request);
      const text = chatText(request.protocol, await send("POST", path, body, headers));
      if (!text) throw new PlatformError(502, { message: "The model returned no text" });
      return text;
    },
  };
}

export type UploadTicket = {
  uploadUrl: string;
  headers: Record<string, string>;
  url: string;
};

function mapUpload(payload: unknown): UploadTicket {
  const data = asRecord(payload);
  const uploadUrl = stringField(data, "upload_url");
  const url = stringField(data, "url");
  if (!uploadUrl || !url)
    throw new PlatformError(502, { message: "Upload response missing a URL" });
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(asRecord(data.headers))) {
    if (typeof value === "string") headers[key] = value;
  }
  return { uploadUrl, headers, url };
}

function chatRequest(request: ChatRequest): {
  path: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
} {
  const images = request.images ?? [];
  if (request.protocol === "anthropic") {
    return {
      path: "/anthropic/v1/messages",
      headers: { "anthropic-version": "2023-06-01" },
      body: {
        model: request.model,
        max_tokens: request.maxTokens,
        ...(request.system ? { system: request.system } : {}),
        messages: [
          {
            role: "user",
            content: [
              ...images.map((url) => ({ type: "image", source: { type: "url", url } })),
              { type: "text", text: request.prompt },
            ],
          },
        ],
      },
    };
  }
  if (request.protocol === "genai") {
    const model = request.model.split("/").pop()!;
    return {
      path: `/genai/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      body: {
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: { maxOutputTokens: request.maxTokens },
      },
    };
  }
  return {
    path: "/v1/chat/completions",
    body: {
      model: request.model,
      max_completion_tokens: request.maxTokens,
      messages: [
        ...(request.system ? [{ role: "system", content: request.system }] : []),
        {
          role: "user",
          content: images.length
            ? [
                { type: "text", text: request.prompt },
                ...images.map((url) => ({ type: "image_url", image_url: { url } })),
              ]
            : request.prompt,
        },
      ],
    },
  };
}

function chatText(protocol: ChatProtocol, payload: unknown): string {
  const data = asRecord(payload);
  if (protocol === "anthropic") return joinText(data.content);
  if (protocol === "genai") {
    const candidate = Array.isArray(data.candidates) ? asRecord(data.candidates[0]) : {};
    return joinText(asRecord(candidate.content).parts);
  }
  const choice = Array.isArray(data.choices) ? asRecord(data.choices[0]) : {};
  const content = asRecord(choice.message).content;
  return typeof content === "string" ? content : joinText(content);
}

/** Every text part of a content list, in order; thinking and tool parts carry
    no `text` string and fall away. */
function joinText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => asRecord(part).text)
    .filter((text): text is string => typeof text === "string")
    .join("");
}

function mapQueued(payload: unknown): QueuedGeneration {
  const data = asRecord(payload);
  const requestId = stringField(data, "id");
  if (!requestId) throw new PlatformError(502, { message: "Platform response missing a job id" });
  const status = stringField(data, "status") ?? "queued";
  if (status === "failed") throw new PlatformError(402, data);
  return { status, requestId };
}

function mapStatus(payload: unknown): GenerationStatus {
  const data = asRecord(payload);
  const output = asRecord(data.output);
  const images = Array.isArray(output.images)
    ? output.images.flatMap((item) => {
        const url = asRecord(item).url;
        return typeof url === "string" ? [{ url }] : [];
      })
    : undefined;
  const urlOf = (key: string) => {
    const url = asRecord(output[key]).url;
    return typeof url === "string" ? { url } : undefined;
  };
  const video = urlOf("video");
  const audio = urlOf("audio");
  const transcript = urlOf("transcript");
  const error = asRecord(data.error);

  return {
    status: stringField(data, "status") ?? "unknown",
    requestId: stringField(data, "id") ?? "",
    ...(images?.length ? { images } : {}),
    ...(video ? { video } : {}),
    ...(audio ? { audio } : {}),
    ...(transcript ? { transcript } : {}),
    ...(typeof error.code === "string" ? { errorCode: error.code } : {}),
    ...(data.error !== undefined ? { error: stringField(error, "message") ?? data.error } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function messageFromBody(status: number, body: unknown): string {
  const data = asRecord(body);
  const nested = asRecord(data.error).message;
  if (typeof nested === "string" && nested) return nested;
  const detail = data.message;
  if (typeof detail === "string" && detail) return detail;
  return `Platform request failed (${status})`;
}
