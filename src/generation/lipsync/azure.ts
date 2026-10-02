export type SpeechCredentials = { endpoint: string; key: string };

export function speechCredentials(endpoint: unknown, key: unknown): SpeechCredentials {
  if (typeof endpoint !== "string" || typeof key !== "string") throw new Error("Enter your Azure Speech endpoint and key.");
  const url = new URL(endpoint.trim());
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.cognitiveservices\.azure\.com$/.test(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Use your resource endpoint: https://your-resource.cognitiveservices.azure.com");
  }
  if (!/^[\x21-\x7e]{1,512}$/.test(key.trim())) throw new Error("Enter a valid Azure Speech key.");
  return { endpoint: url.origin, key: key.trim() };
}

export const transcriptionDefinition = {
  enhancedMode: { enabled: true, model: "MAI-Transcribe-2" },
  diarization: { enabled: true },
  modelOptions: { timestamps: "word", transcribeStyle: "verbatim" },
};

export function transcriptText(data: unknown): string {
  if (!data || typeof data !== "object") throw new Error("Azure returned an invalid transcript.");
  const result = data as { phrases?: Array<{ text?: string; speaker?: number; offsetMilliseconds?: number; durationMilliseconds?: number }>; combinedPhrases?: Array<{ text?: string }> };
  const phrases = result.phrases?.filter((phrase) => typeof phrase.text === "string" && phrase.text.trim());
  if (phrases?.length) return phrases.map((phrase) => {
    const start = phrase.offsetMilliseconds;
    const length = phrase.durationMilliseconds;
    const timing = typeof start === "number" && typeof length === "number"
      ? `[${(start / 1000).toFixed(2)}–${((start + length) / 1000).toFixed(2)}s] ` : "";
    return `${timing}${typeof phrase.speaker === "number" ? `Speaker ${phrase.speaker + 1}: ` : ""}${phrase.text}`;
  }).join("\n");
  const text = result.combinedPhrases?.map((phrase) => phrase.text ?? "").join("\n").trim();
  if (!text) throw new Error("No speech detected. Choose another section or enter the spoken dialogue manually.");
  return text;
}

export async function transcribe(audio: Blob, credentials: SpeechCredentials, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.set("audio", audio, "lip-sync.wav");
  form.set("definition", JSON.stringify(transcriptionDefinition));
  const timeout = AbortSignal.timeout(120_000);
  const response = await fetch(`${credentials.endpoint}/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": credentials.key },
    body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: "error",
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Azure rejected the Speech credentials. Check the endpoint and key.");
    if (response.status === 429) throw new Error("Azure's transcription limit was reached. Retry shortly.");
    throw new Error(`Azure transcription failed (${response.status}). Check that your resource region supports MAI-Transcribe-2, then retry.`);
  }
  return transcriptText(await response.json());
}
