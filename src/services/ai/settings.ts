import { PROVIDERS, PROVIDER_ORDER, type ProviderId } from "./providers";

/**
 * Which provider is in use and what each one is configured with.
 *
 * Keys live only in this browser's localStorage and are only ever sent to the
 * provider they belong to. They are also **the signing-in user's own**: a key
 * is billed to whoever registered it, and a device holding two ledgers held
 * one shared key, so deleting a user left theirs behind for the next person.
 */

const STORAGE_PREFIX = "smartmoney_ai_providers_v2";
/** Where the one shared key lived before keys belonged to a user. */
const SHARED_KEY = STORAGE_PREFIX;
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

/** Whose settings are being read and written; nobody signed in means none. */
let userId: string | null = null;

function storageKey(id: string): string {
  return `${STORAGE_PREFIX}:${id}`;
}

/**
 * Points the settings at a user, on sign-in and sign-out.
 *
 * Called by the auth layer rather than read from the database here, so this
 * module stays free of it (3절 계층 규칙).
 */
export function setAiUser(id: string | null): void {
  if (id === userId) return;
  userId = id;
  cache = null;
  publish();
}

/** Removes a user's keys, for when the user is removed. */
export function clearAiSettingsFor(id: string): void {
  try {
    localStorage.removeItem(storageKey(id));
  } catch {
    /* storage unavailable — nothing was stored either */
  }
  if (id === userId) {
    cache = null;
    publish();
  }
}

function read(): AiSettings {
  const settings = blank();
  if (!userId) return settings;

  try {
    const raw = localStorage.getItem(storageKey(userId));
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

    /*
      Keys registered before they belonged to anyone go to whoever signs in
      first, and the shared copy is removed. A key cannot be split between two
      people, and leaving it shared would defeat the separation — the other
      user registers their own.
    */
    const shared = localStorage.getItem(SHARED_KEY);
    if (shared) {
      try {
        const parsed = JSON.parse(shared) as Partial<AiSettings>;
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
        write(settings);
        localStorage.removeItem(SHARED_KEY);
        return settings;
      } catch {
        /* unreadable — treated as nothing stored */
      }
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
  // Nobody signed in: there is no one to save a key for
  if (!userId) return;

  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(settings));
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
