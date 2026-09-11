import { anthropicAdapter } from "./anthropic";
import { googleAdapter } from "./google";
import { openaiAdapter } from "./openai";
import {
  PROVIDERS,
  type AiAdapter,
  type JsonRequest,
  type ProviderId,
  type TextRequest,
} from "./providers";
import { getActiveProvider } from "./settings";

export * from "./providers";
export * from "./settings";

const ADAPTERS: Record<ProviderId, AiAdapter> = {
  google: googleAdapter,
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
};

export class MissingApiKeyError extends Error {
  constructor() {
    super("AI 키가 등록되지 않았습니다. 설정 메뉴의 [AI 등록]에서 키를 먼저 입력해주세요.");
    this.name = "MissingApiKeyError";
  }
}

/**
 * Conditions worth another attempt: the model being busy, a per-minute rate
 * limit, a gateway hiccup. Every provider reports these as a 429 or a 5xx,
 * sometimes with a name like "overloaded" attached.
 */
const RETRYABLE =
  /\b(429|500|502|503|504|529)\b|UNAVAILABLE|overloaded|high demand|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|INTERNAL|rate limit|ECONNRESET/i;

/** Turns provider failures into messages that mean something to the user. */
export function describeAiFailure(error: unknown): Error {
  if (error instanceof MissingApiKeyError) return error;
  const message = error instanceof Error ? error.message : String(error);

  if (/api[_ ]?key|API_KEY_INVALID|invalid_api_key|\b401\b|\b403\b|authentication/i.test(message)) {
    return new Error("AI 키가 올바르지 않거나 권한이 없습니다. 설정 > AI 등록에서 키를 확인해주세요.");
  }
  if (/\b(404|400)\b.*model|model.*not.*(found|exist)|invalid model|model_not_found/i.test(message)) {
    return new Error("모델 이름이 올바르지 않습니다. 설정 > AI 등록에서 모델명을 확인해주세요.");
  }
  if (/\b(503|529)\b|UNAVAILABLE|overloaded|high demand/i.test(message)) {
    return new Error("AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.");
  }
  if (/quota|\b429\b|RESOURCE_EXHAUSTED|rate limit|billing|insufficient_quota/i.test(message)) {
    // 분당 제한이면 잠시 뒤 풀리고, 일일·결제 한도면 풀리지 않는다 — 둘 다 안내한다
    return new Error(
      "AI 요청 한도에 걸렸습니다. 무료 사용량은 분당·하루 호출 수가 제한됩니다. " +
        "잠시 후 다시 시도하거나, 한 번에 분류할 건수를 줄이거나, 설정 > AI 등록에서 다른 공급자·모델로 바꿔보세요."
    );
  }
  if (/DEADLINE_EXCEEDED|timeout|timed out/i.test(message)) {
    return new Error("AI 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.");
  }
  if (/Failed to fetch|NetworkError|ERR_NETWORK|network/i.test(message)) {
    return new Error("네트워크에 연결되어 있지 않습니다. AI 기능은 인터넷 연결이 필요합니다.");
  }
  if (/\b(500|502|504)\b|INTERNAL/i.test(message)) {
    return new Error("AI 서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
  return new Error(message || "AI 요청에 실패했습니다.");
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Attempts per request, including the first. */
export const RETRY_ATTEMPTS = 4;

/** A rate limit, as opposed to the model merely being busy. */
export function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(message);
}

/**
 * How long the provider itself asked us to wait, in ms.
 *
 * Google puts `retryDelay: "31s"` in the error body and everyone sets
 * Retry-After; honouring it beats guessing, and guessing low on a rate limit
 * spends the very quota that ran out.
 */
function providerRetryDelay(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);

  const retryDelay = message.match(/retryDelay["'\s:]+(\d+(?:\.\d+)?)s/i);
  if (retryDelay) return Math.ceil(Number(retryDelay[1]) * 1000);

  const retryAfter = message.match(/retry[-\s]?after["'\s:]+(\d+)/i);
  if (retryAfter) return Number(retryAfter[1]) * 1000;

  return null;
}

/** Busy servers clear in seconds; a rate limit needs the window to roll over. */
const OVERLOAD_BASE_MS = 1200;
const RATE_LIMIT_BASE_MS = 15000;
const MAX_WAIT_MS = 60000;

export function backoffFor(error: unknown, attempt: number): number {
  const asked = providerRetryDelay(error);
  if (asked) return Math.min(asked + 500, MAX_WAIT_MS);

  const base = isRateLimited(error) ? RATE_LIMIT_BASE_MS : OVERLOAD_BASE_MS;
  const grown = base * 2 ** (attempt - 1);
  // Jitter, so parallel clients do not line up
  return Math.min(Math.round(grown * (1 + Math.random() * 0.4)), MAX_WAIT_MS);
}

/** Retries a transient failure with backoff; anything else is thrown at once. */
export async function withRetry<T>(
  run: () => Promise<T>,
  attempts: number = RETRY_ATTEMPTS,
  onWait?: (waitMs: number, attempt: number, rateLimited: boolean) => void
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === attempts || !RETRYABLE.test(message)) throw error;

      const waitMs = backoffFor(error, attempt);
      onWait?.(waitMs, attempt, isRateLimited(error));
      await sleep(waitMs);
    }
  }

  throw lastError;
}

function resolve() {
  const active = getActiveProvider();
  if (!active) throw new MissingApiKeyError();
  return { adapter: ADAPTERS[active.id], active };
}

/** The provider a request would go to right now, for labelling the UI. */
export function activeProviderLabel(): string | null {
  const active = getActiveProvider();
  return active ? `${PROVIDERS[active.id].label} · ${active.model}` : null;
}

export async function generateJson<T>(request: JsonRequest): Promise<T> {
  const { adapter, active } = resolve();
  return (await adapter.generateJson(request, {
    apiKey: active.apiKey,
    model: active.model,
  })) as T;
}

export async function generateText(request: TextRequest): Promise<string> {
  const { adapter, active } = resolve();
  return adapter.generateText(request, {
    apiKey: active.apiKey,
    model: active.model,
  });
}

/** Verifies a provider's key and model with the smallest possible call. */
export async function validateProvider(
  id: ProviderId,
  apiKey: string,
  model: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await ADAPTERS[id].generateText(
      {
        system: "Reply with the single word OK.",
        prompt: "ping",
      },
      { apiKey: apiKey.trim(), model: model.trim() || PROVIDERS[id].defaultModel }
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeAiFailure(error).message };
  }
}
