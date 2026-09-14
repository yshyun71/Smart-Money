import type { ColumnMapping } from "./csvImport";

/**
 * Remembering how a statement format maps, so it is worked out once.
 *
 * Every bank and card issuer lays its file out differently, and the columns of
 * any one of them do not change from month to month. Keyed on the header line
 * itself, a format confirmed once is applied instantly every month after —
 * which is what keeps the cost of understanding a new format to a single time.
 */

const STORAGE_KEY = "smart_money_statement_formats_v1";
const LIMIT = 60;

interface RememberedFormat {
  mapping: ColumnMapping;
  savedAt: string;
}

type Store = Record<string, RememberedFormat>;

/** The header line, reduced to what identifies the format. */
export function formatSignature(headers: string[]): string {
  return headers
    .map((header) => (header || "").replace(/\s+/g, "").toLowerCase())
    .join("|");
}

function read(): Store {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* a private window, or storage turned off — the mapping is still usable */
  }
}

export function recallMapping(headers: string[]): ColumnMapping | null {
  const signature = formatSignature(headers);
  if (!signature) return null;
  return read()[signature]?.mapping ?? null;
}

/** Called once a human has confirmed the columns, which is what makes it worth keeping. */
export function rememberMapping(headers: string[], mapping: ColumnMapping): void {
  const signature = formatSignature(headers);
  if (!signature) return;

  const store = read();
  store[signature] = { mapping, savedAt: new Date().toISOString() };

  // Oldest out first, so a long history of one-off files cannot grow forever
  const entries = Object.entries(store);
  if (entries.length > LIMIT) {
    entries.sort((a, b) => a[1].savedAt.localeCompare(b[1].savedAt));
    for (const [key] of entries.slice(0, entries.length - LIMIT)) {
      delete store[key];
    }
  }

  write(store);
}

export function forgetMapping(headers: string[]): void {
  const signature = formatSignature(headers);
  if (!signature) return;
  const store = read();
  delete store[signature];
  write(store);
}
