/**
 * The AI providers the app can talk to.
 *
 * Everything above this layer speaks in plain JSON Schema and gets parsed JSON
 * back; each adapter is responsible for however its own API expresses that.
 * Schemas are written to satisfy the strictest of the three — every property
 * listed in `required`, and `additionalProperties: false` on every object — so
 * one schema serves all of them.
 */

export type ProviderId = "google" | "anthropic" | "openai";

export interface ProviderInfo {
  id: ProviderId;
  /** Shown as the tab label. */
  label: string;
  /** The company, for prose. */
  vendor: string;
  defaultModel: string;
  keyUrl: string;
  keyHint: string;
  /** Where to read about available model names. */
  modelsUrl: string;
}

export const PROVIDER_ORDER: ProviderId[] = ["google", "anthropic", "openai"];

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  google: {
    id: "google",
    label: "Google Gemini",
    vendor: "Google",
    defaultModel: "gemini-3.8-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "AIza...",
    modelsUrl: "https://ai.google.dev/gemini-api/docs/models",
  },
  anthropic: {
    id: "anthropic",
    label: "Claude",
    vendor: "Anthropic",
    defaultModel: "claude-opus-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-...",
    modelsUrl: "https://docs.anthropic.com/en/docs/about-claude/models",
  },
  openai: {
    id: "openai",
    label: "ChatGPT",
    vendor: "OpenAI",
    defaultModel: "gpt-5.5",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-...",
    modelsUrl: "https://platform.openai.com/docs/models",
  },
};

/** A subset of JSON Schema — enough for the shapes this app asks for. */
export interface JsonSchema {
  type: "object" | "array" | "string" | "integer" | "number" | "boolean";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  additionalProperties?: false;
}

export interface JsonRequest {
  system: string;
  prompt: string;
  schema: JsonSchema;
  /** Used as the tool or response-format name where one is needed. */
  schemaName: string;
  /** Hint that the task is bulk and simple, so a cheaper setting is fine. */
  bulk?: boolean;
}

export interface TextRequest {
  system: string;
  prompt: string;
}

export interface CallContext {
  apiKey: string;
  model: string;
}

export interface AiAdapter {
  generateJson(request: JsonRequest, context: CallContext): Promise<unknown>;
  generateText(request: TextRequest, context: CallContext): Promise<string>;
}

/** Reads JSON out of a response that may have wrapped it in prose or fences. */
export function parseJsonLoosely(raw: string): unknown {
  const text = (raw || "").trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    /* fall through to the fenced / embedded cases */
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* keep looking */
    }
  }

  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* give up below */
    }
  }

  throw new Error("AI 응답을 JSON으로 읽지 못했습니다.");
}
