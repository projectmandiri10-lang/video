export type GeminiErrorCode = "UNAVAILABLE" | "RESOURCE_EXHAUSTED" | "OTHER";

export const AUTO_RETRY_DELAYS_SEC = [60, 120, 240, 300, 300, 300] as const;
export const MAX_AUTO_RETRY = AUTO_RETRY_DELAYS_SEC.length;

function parseEmbeddedJson(message: string): Record<string, unknown> | undefined {
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(message.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function detectFromStatusAndCode(status: string, code: number): GeminiErrorCode {
  if (status === "UNAVAILABLE" || code === 503) {
    return "UNAVAILABLE";
  }
  if (status === "RESOURCE_EXHAUSTED" || code === 429) {
    return "RESOURCE_EXHAUSTED";
  }
  return "OTHER";
}

function detectFromString(message: string): GeminiErrorCode {
  const upper = message.toUpperCase();
  if (upper.includes("UNAVAILABLE") || /\b503\b/.test(upper)) {
    return "UNAVAILABLE";
  }
  if (upper.includes("RESOURCE_EXHAUSTED") || /\b429\b/.test(upper)) {
    return "RESOURCE_EXHAUSTED";
  }
  return "OTHER";
}

export function classifyGeminiError(error: unknown): GeminiErrorCode {
  const direct = error as { status?: unknown; code?: unknown; message?: unknown };
  const directStatus = typeof direct?.status === "string" ? direct.status.toUpperCase() : "";
  const directCode = typeof direct?.code === "number" ? direct.code : NaN;
  if (directStatus || Number.isFinite(directCode)) {
    return detectFromStatusAndCode(directStatus, Number.isFinite(directCode) ? directCode : 0);
  }

  const message =
    typeof direct?.message === "string" ? direct.message : String(error ?? "Error tidak diketahui.");
  const payload = parseEmbeddedJson(message) as
    | {
        error?: {
          status?: unknown;
          code?: unknown;
        };
      }
    | undefined;
  const payloadStatus =
    typeof payload?.error?.status === "string" ? payload.error.status.toUpperCase() : "";
  const payloadCode = typeof payload?.error?.code === "number" ? payload.error.code : NaN;
  if (payloadStatus || Number.isFinite(payloadCode)) {
    return detectFromStatusAndCode(
      payloadStatus,
      Number.isFinite(payloadCode) ? payloadCode : 0
    );
  }

  return detectFromString(message);
}

export function getAutoRetryDelaySec(retryAttempt: number): number | null {
  if (retryAttempt < 1 || retryAttempt > MAX_AUTO_RETRY) {
    return null;
  }
  return AUTO_RETRY_DELAYS_SEC[retryAttempt - 1] ?? null;
}
