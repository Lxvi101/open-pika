import type { ModelEntry } from "../types";

/* Every language model takes the same rail: how long an answer can run, and an
   optional system prompt. Settings never reach the wire beyond `maxTokens`
   and `system` — see `chatRequest` in ../../platform.ts. */
const CHAT_SETTINGS = {
  maxTokens: { type: "range", min: 256, max: 16384, default: 2048, step: 256 },
  system: { type: "text", default: "", multiline: true, placeholder: "System prompt" },
} as const;

/* `chat.model` is the exact string each vendor's spec puts in the request's
   `model` field — for anthropic and openai that's the full catalog `api_id`
   (vendor prefix included), not just the slug. genai carries no `model` in
   the body; the client takes the last segment of the api_id from the URL
   path, so the same rule (api_id, in full) applies there too. */
function llm(
  apiId: string,
  protocol: "anthropic" | "openai" | "genai",
  label: string,
  description?: string,
): ModelEntry {
  return {
    id: apiId.split("/").pop()!,
    surface: "text",
    vendor: apiId.split("/")[0]!,
    label,
    ...(description ? { description } : {}),
    roles: {},
    settings: CHAT_SETTINGS,
    chat: { protocol, model: apiId },
  };
}

export const languageModels: readonly ModelEntry[] = [
  // Anthropic — strongest first
  llm("anthropic/claude-fable-5.1", "anthropic", "Claude Fable 5.1"),
  llm(
    "anthropic/claude-fable-5",
    "anthropic",
    "Claude Fable 5",
    "Anthropic's newest Claude for everyday chat and generation",
  ),
  llm("anthropic/claude-opus-5", "anthropic", "Claude Opus 5"),
  llm(
    "anthropic/claude-sonnet-5",
    "anthropic",
    "Claude Sonnet 5",
    "Balanced Claude — strong quality at production speed",
  ),
  llm("anthropic/claude-haiku-4.5", "anthropic", "Claude Haiku 4.5"),
  // OpenAI — strongest first
  llm("openai/gpt-6-astra", "openai", "GPT-6 Astra"),
  llm("openai/gpt-5.6-sol", "openai", "GPT-5.6 Sol"),
  llm(
    "openai/gpt-5.5",
    "openai",
    "GPT-5.5",
    "OpenAI's flagship model for general-purpose chat and reasoning",
  ),
  llm("openai/gpt-5.6-terra", "openai", "GPT-5.6 Terra"),
  llm("openai/gpt-5.6-luna", "openai", "GPT-5.6 Luna"),
  // Google — strongest first
  llm(
    "google/gemini-3.1-pro",
    "genai",
    "Gemini 3.1 Pro",
  ),
  llm("google/gemini-3.8-flash", "genai", "Gemini 3.8 Flash"),
  llm("google/gemini-3.7-flash", "genai", "Gemini 3.7 Flash"),
  llm("google/gemini-3.6-flash", "genai", "Gemini 3.6 Flash"),
  llm("google/gemini-3.5-flash-lite", "genai", "Gemini 3.5 Flash-Lite"),
  // DeepSeek — strongest first
  llm(
    "deepseek/deepseek-v4-pro",
    "openai",
    "DeepSeek V4 Pro",
    "DeepSeek's high-performance reasoning model",
  ),
  llm("deepseek/deepseek-v4.1-flash", "openai", "DeepSeek V4.1 Flash"),
  // Moonshot AI
  llm(
    "moonshotai/kimi-k3",
    "openai",
    "Kimi K3",
    "Moonshot's Kimi — strong agentic reasoning and long context",
  ),
  // Qwen — strongest first
  llm("qwen/qwen3.8-max", "openai", "Qwen3.8 Max"),
  llm("qwen/qwen3.8-flash", "openai", "Qwen3.8 Flash"),
  // Tencent
  llm("tencent/hy4-preview", "openai", "Hunyuan 4 Preview"),
  // Z.ai — strongest first
  llm("z-ai/glm-5.3", "openai", "GLM 5.3"),
  llm("z-ai/glm-5.2", "openai", "GLM 5.2", "Z.ai's GLM for multilingual chat and reasoning"),
  llm("z-ai/glm-5.3-flash", "openai", "GLM 5.3 Flash"),
];
