export type ApiErrorInfo = {
  message: string;
  status?: number;
  code?: string;
  retryAfter?: number;
  requestId?: string;
};

export class ApiActionError extends Error {
  constructor(readonly detail: ApiErrorInfo) {
    super(detail.message);
    this.name = "ApiActionError";
  }
}

export function unwrapResult<T>(result: { ok: true; value: T } | { ok: false; error: ApiErrorInfo }): T {
  if (!result.ok) throw new ApiActionError(result.error);
  return result.value;
}

export function apiErrorMessage(caught: unknown): string {
  const detail = caught instanceof ApiActionError ? caught.detail : caught instanceof Error ? caught as Error & ApiErrorInfo : undefined;
  const message = caught instanceof Error ? caught.message : String(caught);
  if (detail?.code === "missing_credentials" || detail?.status === 401 || /Missing platform key/.test(message)) {
    return "Add or update your Pika API key to continue.";
  }
  if ((detail?.code === "cycle_limit_exceeded" || detail?.code === "cycle_limit")) return "Your invoice cycle limit does not cover this run. Check billing before retrying.";
  if (detail?.code === "insufficient_balance") return `${message} Add funds at dev.pika.art/billing before retrying.`;
  if (detail?.code === "rate_limited" || detail?.status === 429) {
    return `Pika's request limit was reached.${detail.retryAfter ? ` Retry after ${Math.ceil(detail.retryAfter)} seconds.` : " Wait before retrying."}`;
  }
  if (detail?.code === "content_moderation") return "The provider refused the request under its moderation policy. Adjust the prompt or inputs.";
  if (detail?.status === 422 || detail?.code === "invalid_input") return message;
  if (detail?.status === 409) return message;
  return message;
}

export function uncertainSubmission(caught: unknown): boolean {
  if (!(caught instanceof ApiActionError)) return true;
  const { requestId, status, code } = caught.detail;
  if (code === "saved_mapping_changed") return true;
  // X-Request-ID can identify an HTTP request rather than an accepted media job.
  if (requestId?.startsWith("media_")) return false;
  if (code === "missing_credentials" || code === "invalid_input" || code === "insufficient_balance" || (code === "cycle_limit_exceeded" || code === "cycle_limit")) return false;
  return status === undefined || status === 408 || status >= 500;
}
