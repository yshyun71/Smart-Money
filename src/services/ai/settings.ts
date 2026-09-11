import { PROVIDERS, PROVIDER_ORDER, type ProviderId } from "./providers";

/**
 * Which provider is in use and what each one is configured with.
 *
 * Keys live only in this browser's localStorage and are only ever sent to the
 * provider they belong to.
 */

const STORAGE_KEY = "smartmoney_ai_providers_v2";
/** Where the single Gemini key lived before there was more than one provider. */
const LEGACY_GOOGLE_KEY = "smartmoney_ai_api_key_v1";

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export interface AiSettings {
  active: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
}

function blank(): AiSettings {
  return {
    active: "google",
    providers: {
      google: { apiKey: "", model: PROVIDERS.google.defaultModel },
      anthropic: { apiKey: "", model: PROVIDERS.anthropic.defaultModel },
      openai: { apiKey: "", model: PROVIDERS.openai.defaultModel },
    },
  };
}

function read(): AiSettings {
  const settings = blank();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiSettings>;
      if (parsed.active && PROVIDER_ORDER.includes(parsed.active)) {
        settings.active = parsed.active;
      }
      for (const id of PROVIDER_ORDER) {
        const stored = parsed.providers?.[id];
        if (!stored) continue;
        settings.providers[id] = {
          apiKey: typeof stored.apiKey === "string" ? stored.apiKey : "",
          model:
            typeof stored.model === "string" && stored.model.trim()
              ? stored.model.trim()
              : PROVIDERS[id].defaultModel,
        };
      }
      return settings;
    }

    // Carry over the key registered before providers were selectable
    const legacy = localStorage.getItem(LEGACY_GOOGLE_KEY);
    if (legacy && legacy.trim()) {
      settings.providers.google.apiKey = legacy.trim();
      settings.active = "google";
      write(settings);
      localStorage.removeItem(LEGACY_GOOGLE_KEY);
    }
  } catch (error) {
    console.error("AI 설정을 읽지 못했습니다:", error);
  }

  return settings;
}

function write(settings: AiSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("AI 설정을 저장하지 못했습니다:", error);
  }
}

let cache: AiSettings | null = null;

function current(): AiSettings {
  if (!cache) cache = read();
  return cache;
}

type Listener = (settings: AiSettings) => void;
const listeners = new Set<Listener>();

function publish(): void {
  const settings = current();
  listeners.forEach((listener) => listener(settings));
}

/** Subscribe to configuration changes; returns an unsubscribe function. */
export function onAiSettingsChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAiSettings(): AiSettings {
  return current();
}

export function setActiveProvider(id: ProviderId): void {
  const settings = current();
  settings.active = id;
  write(settings);
  publish();
}

export function saveProviderConfig(id: ProviderId, config: ProviderConfig): void {
  const settings = current();
  settings.providers[id] = {
    apiKey: config.apiKey.trim(),
    model: config.model.trim() || PROVIDERS[id].defaultModel,
  };
  // Registering a key is a clear signal of which provider to use
  if (settings.providers[id].apiKey) settings.active = id;
  write(settings);
  publish();
}

export function clearProviderConfig(id: ProviderId): void {
  const settings = current();
  settings.providers[id] = { apiKey: "", model: PROVIDERS[id].defaultModel };
  if (settings.active === id) {
    const fallback = PROVIDER_ORDER.find((other) => settings.providers[other].apiKey);
    settings.active = fallback ?? "google";
  }
  write(settings);
  publish();
}

export function hasApiKey(id?: ProviderId): boolean {
  const settings = current();
  if (id) return Boolean(settings.providers[id].apiKey);
  return PROVIDER_ORDER.some((other) => Boolean(settings.providers[other].apiKey));
}

export interface ActiveProvider {
  id: ProviderId;
  apiKey: string;
  model: string;
}

/** The provider to call, or null when nothing is registered. */
export function getActiveProvider(): ActiveProvider | null {
  const settings = current();
  const chosen = settings.providers[settings.active];

  if (chosen.apiKey) {
    return { id: settings.active, apiKey: chosen.apiKey, model: chosen.model };
  }

  // The selected one has no key but another might
  const fallback = PROVIDER_ORDER.find((id) => settings.providers[id].apiKey);
  if (!fallback) return null;
  return {
    id: fallback,
    apiKey: settings.providers[fallback].apiKey,
    model: settings.providers[fallback].model,
  };
}

/** Masks a key for display, e.g. "sk-a••••••••7fQ2". */
export function maskApiKey(key: string): string {
  const trimmed = (key || "").trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${"•".repeat(8)}${trimmed.slice(-4)}`;
}
