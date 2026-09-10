import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  DEFAULT_CATEGORIES,
  MIGRATIONS,
  PRIMARY_USER_ID,
  SCHEMA_VERSION,
} from "./schema";

/**
 * On-device SQLite. The same sql.js engine the server used to run, moved into
 * the browser so the app needs no backend at all: the database file lives in
 * the phone's IndexedDB and never leaves the device.
 */

const IDB_NAME = "smartmoney";
const IDB_STORE = "sqlite";
const IDB_KEY = "finance.db";

export interface DBStats {
  path: string;
  sizeBytes: number;
  tables: Record<string, number>;
  lastSavedAt: string;
  schemaVersion: number;
}

let db: Database | null = null;
let dbPromise: Promise<Database> | null = null;
let lastSavedAt = new Date().toISOString();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// IndexedDB helpers (a single record holding the exported .db bytes)
// ---------------------------------------------------------------------------

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const idb = request.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbRead(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readonly");
      const request = tx.objectStore(IDB_STORE).get(IDB_KEY);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value ? new Uint8Array(value) : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    idb.close();
  }
}

async function idbWrite(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      // Store a plain copy: the sql.js buffer is reused between exports.
      tx.objectStore(IDB_STORE).put(bytes.slice(), IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    idb.close();
  }
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

function readSchemaVersion(target: Database): number {
  const result = target.exec("PRAGMA user_version");
  const value = result[0]?.values?.[0]?.[0];
  return typeof value === "number" ? value : 0;
}

/**
 * Brings an existing device database up to SCHEMA_VERSION without touching the
 * rows already in it. A brand new database starts at version 0 and simply runs
 * every migration in order.
 */
function migrate(target: Database): { from: number; to: number } {
  const from = readSchemaVersion(target);
  if (from >= SCHEMA_VERSION) return { from, to: from };

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    console.log(`[DB] 마이그레이션 v${migration.version}: ${migration.description}`);
    migration.up(target);
  }

  target.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return { from, to: SCHEMA_VERSION };
}

/**
 * Rows the app cannot run without. Deliberately does NOT create accounts,
 * transactions, budgets or any personal detail — a fresh install is empty and
 * unregistered until the user acts.
 */
function seedEssentials(target: Database): void {
  const categoryCount = queryOneOn<{ count: number }>(
    target,
    "SELECT COUNT(*) as count FROM categories"
  );
  if (!categoryCount || categoryCount.count === 0) {
    for (const category of DEFAULT_CATEGORIES) {
      target.run(
        "INSERT INTO categories (id, name, type, color, is_default) VALUES (?, ?, ?, ?, 1)",
        [`cat_${encodeURIComponent(category.name)}`, category.name, category.type, category.color]
      );
    }
  }

  const userCount = queryOneOn<{ count: number }>(
    target,
    "SELECT COUNT(*) as count FROM users"
  );
  if (!userCount || userCount.count === 0) {
    target.run(
      `INSERT INTO users (id, name, email, phone, pin, auth_provider, provider_label, is_authenticated, is_biometric_enabled, authenticated_at, created_at)
       VALUES (?, '', '', '', NULL, 'KAKAO', '카카오 간편인증', 0, 1, NULL, ?)`,
      [PRIMARY_USER_ID, new Date().toISOString()]
    );
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });

  let stored: Uint8Array | null = null;
  try {
    stored = await idbRead();
  } catch (error) {
    console.error("[DB] 저장된 데이터베이스를 읽지 못했습니다:", error);
  }

  if (stored) {
    try {
      db = new SQL.Database(stored);
    } catch (error) {
      console.error("[DB] 저장된 파일이 손상되어 새 데이터베이스를 만듭니다:", error);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  const { from, to } = migrate(db);
  seedEssentials(db);

  if (stored && from !== to) {
    console.log(`[DB] 기존 데이터를 유지한 채 v${from} → v${to} 로 업그레이드했습니다.`);
  }

  await persist();
  return db;
}

/** Memoised so every caller shares one database instance. */
export function getDatabase(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = initDatabase();
  }
  return dbPromise;
}

/** Writes the current database bytes to IndexedDB. */
export async function persist(): Promise<void> {
  if (!db) return;
  try {
    await idbWrite(db.export());
    lastSavedAt = new Date().toISOString();
  } catch (error) {
    console.error("[DB] 저장에 실패했습니다:", error);
  }
}

/**
 * Coalesces the writes of a burst (a batch insert, a slider drag) into one
 * IndexedDB round trip.
 */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 250);
}

// Never lose the pending debounce when the app is backgrounded or closed.
if (typeof document !== "undefined") {
  const flush = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      void persist();
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function queryAllOn<T = any>(target: Database, sql: string, params: any[] = []): T[] {
  const stmt = target.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return rows;
}

function queryOneOn<T = any>(target: Database, sql: string, params: any[] = []): T | null {
  const rows = queryAllOn<T>(target, sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function requireDb(): Database {
  if (!db) {
    throw new Error("데이터베이스가 아직 초기화되지 않았습니다. getDatabase()를 먼저 await 하세요.");
  }
  return db;
}

export function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  return queryAllOn<T>(requireDb(), sql, params);
}

export function queryOne<T = any>(sql: string, params: any[] = []): T | null {
  return queryOneOn<T>(requireDb(), sql, params);
}

/** Runs a write statement and schedules a save. */
export function run(sql: string, params: any[] = []): void {
  requireDb().run(sql, params);
  scheduleSave();
}

/** Runs several writes under a single save. */
export function runBatch(statements: { sql: string; params?: any[] }[]): void {
  const target = requireDb();
  for (const statement of statements) {
    target.run(statement.sql, statement.params ?? []);
  }
  scheduleSave();
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

const TABLE_NAMES = [
  "users",
  "categories",
  "accounts",
  "transactions",
  "budgets",
  "budget_configs",
  "ai_analyses",
];

export function getDbStats(): DBStats {
  const target = requireDb();
  const tables: Record<string, number> = {};
  for (const name of TABLE_NAMES) {
    try {
      const row = queryOneOn<{ count: number }>(target, `SELECT COUNT(*) as count FROM ${name}`);
      tables[name] = row ? row.count : 0;
    } catch {
      tables[name] = 0;
    }
  }

  return {
    path: "IndexedDB · smartmoney/finance.db",
    sizeBytes: target.export().byteLength,
    tables,
    lastSavedAt,
    schemaVersion: readSchemaVersion(target),
  };
}

export function exportDatabaseBytes(): Uint8Array {
  return requireDb().export();
}

/** Wipes every user-owned row, keeping the schema and default categories. */
export async function clearAllData(): Promise<void> {
  const target = requireDb();
  target.run(`
    DELETE FROM transactions;
    DELETE FROM accounts;
    DELETE FROM budgets;
    DELETE FROM budget_configs;
    DELETE FROM ai_analyses;
  `);
  await persist();
}

/**
 * Replaces the device database with the contents of an exported .db file,
 * migrating it forward if it was taken from an older build.
 */
export async function importDatabaseBytes(bytes: Uint8Array): Promise<void> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const imported = new SQL.Database(bytes);
  migrate(imported);
  seedEssentials(imported);

  db?.close();
  db = imported;
  dbPromise = Promise.resolve(imported);
  await persist();
}
