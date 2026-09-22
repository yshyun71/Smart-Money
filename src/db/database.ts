import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  DEFAULT_CATEGORIES,
  migrate,
  readSchemaVersion,
  repairMissingColumns,
  repairMissingTables,
} from "./schema";

/**
 * On-device SQLite. The same sql.js engine the server used to run, moved into
 * the browser so the app needs no backend at all: the database file lives in
 * the phone's IndexedDB and never leaves the device.
 */

const IDB_NAME = "smartmoney";
const IDB_STORE = "sqlite";
const IDB_KEY = "finance.db";
/** Where the bytes go when they cannot be opened, rather than under a new database. */
const IDB_QUARANTINE = "finance.db.unreadable";

export interface DBStats {
  path: string;
  sizeBytes: number;
  tables: Record<string, number>;
  lastSavedAt: string;
  schemaVersion: number;
}

/**
 * The stored ledger exists but could not be opened or read.
 *
 * Thrown rather than swallowed so that no write can follow: the bytes on the
 * device are the only copy, and carrying on with a blank database would save
 * over them at the same key.
 */
export class DatabaseUnavailable extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DatabaseUnavailable";
    this.cause = cause;
  }
}

let db: Database | null = null;
let dbPromise: Promise<Database> | null = null;
/** Set once the ledger is known to be unreachable, so screens can say so. */
let openFailure: DatabaseUnavailable | null = null;
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

async function idbWrite(bytes: Uint8Array, key: string = IDB_KEY): Promise<void> {
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite");
      // Store a plain copy: the sql.js buffer is reused between exports.
      tx.objectStore(IDB_STORE).put(bytes.slice(), key);
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

/**
 * Rows the app cannot run without — the default categories, and nothing else.
 * No user is created: a fresh install has zero users, which is what sends it
 * to the first-run setup screen.
 */
function seedEssentials(target: Database): void {
  /*
    Row by row rather than "is the table empty": a migration that introduces a
    category writes its own row, and a first launch runs those migrations
    before reaching here — so an emptiness check would see that one row and
    skip every other default. The name is unique, so re-seeding costs nothing.
  */
  for (const category of DEFAULT_CATEGORIES) {
    target.run(
      `INSERT OR IGNORE INTO categories (id, name, type, color, is_default)
       VALUES (?, ?, ?, ?, 1)`,
      [`cat_${encodeURIComponent(category.name)}`, category.name, category.type, category.color]
    );
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });

  /*
    A failed read is not an empty gatherer of nothing.

    This used to fall through to a blank database, and a blank database looks
    exactly like a new install — the app asks for a first user, every account
    and statement appears deleted. Worse, the first thing typed into it saved
    over the one copy of the real data, at the same key. One unlucky read then
    meant permanent loss.

    So a read that fails stops here. The app says so instead of pretending to
    be empty, and nothing is written until someone decides what to do.
  */
  let stored: Uint8Array | null;
  try {
    stored = await idbRead();
  } catch (error) {
    console.error("[DB] 저장된 데이터베이스를 읽지 못했습니다:", error);
    throw new DatabaseUnavailable(
      "기기에 저장된 가계부를 읽지 못했습니다. 브라우저를 다시 열어 보시고, 그래도 같으면 데이터를 덮어쓰지 않도록 이 창을 닫아 주세요.",
      error
    );
  }

  if (stored) {
    try {
      db = new SQL.Database(stored);
    } catch (error) {
      console.error("[DB] 저장된 파일을 열지 못했습니다:", error);

      /*
        Unopenable is not the same as worthless: the bytes are the only copy
        of the user's ledger, and a later version of sql.js — or a repair by
        hand — may still get them open. They are moved aside under their own
        key before anything else claims the main one.
      */
      try {
        await idbWrite(stored, IDB_QUARANTINE);
        console.warn(`[DB] 원본 바이트를 '${IDB_QUARANTINE}' 로 보관했습니다.`);
      } catch (saveError) {
        console.error("[DB] 원본 바이트를 보관하지 못했습니다:", saveError);
      }

      throw new DatabaseUnavailable(
        "기기에 저장된 가계부 파일을 열지 못했습니다. 원본은 지우지 않고 따로 보관해 두었습니다.",
        error
      );
    }
  } else {
    // Nothing stored at all — a genuine first run on this origin
    db = new SQL.Database();
  }

  const { from, to } = migrate(db);

  // Trust the shape, not just the recorded version: a device can end up with
  // the version saved but a migration's columns missing, and every query
  // against them fails from then on.
  const repaired = repairMissingColumns(db);
  if (repaired.length > 0) {
    console.warn(`[DB] 누락된 컬럼을 복구했습니다: ${repaired.join(", ")}`);
  }

  const rebuilt = repairMissingTables(db);
  if (rebuilt.length > 0) {
    console.warn(`[DB] 누락된 테이블을 복구했습니다: ${rebuilt.join(", ")}`);
  }

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
    dbPromise = initDatabase().catch((error) => {
      openFailure =
        error instanceof DatabaseUnavailable
          ? error
          : new DatabaseUnavailable("기기 내 데이터베이스를 열지 못했습니다.", error);
      throw error;
    });
  }
  return dbPromise;
}

/**
 * Whether the stored ledger could not be reached, and why.
 *
 * Told apart from "there is nothing here yet" on purpose: the screens react to
 * the two in opposite ways, and reading them the same way is how a device with
 * data intact came to show a first-run setup screen.
 */
export function databaseFailure(): DatabaseUnavailable | null {
  return openFailure;
}

/** Writes the current database bytes to IndexedDB. */
/**
 * 저장이 실패한 상태.
 *
 * 예전에는 `console.error` 한 줄로 끝났습니다. 화면은 "등록 완료"를 보여 주는데
 * 실제로는 IndexedDB 에 한 바이트도 쓰이지 않은 채 — 용량 초과, 사생활 보호
 * 모드, 디스크 꽉 참 — 다시 열면 그 작업이 전부 사라집니다. **메모리에 썼다는
 * 것과 남았다는 것은 다른 사실입니다.**
 */
export interface SaveFailure {
  attempts: number;
  message: string;
  at: string;
}

let saveFailure: SaveFailure | null = null;
const saveWatchers = new Set<(failure: SaveFailure | null) => void>();

/** 저장 상태가 바뀔 때 알려 줍니다 — 화면이 띠를 띄울 수 있게. */
export function watchSaveFailure(listener: (failure: SaveFailure | null) => void): () => void {
  saveWatchers.add(listener);
  listener(saveFailure);
  return () => saveWatchers.delete(listener);
}

export function currentSaveFailure(): SaveFailure | null {
  return saveFailure;
}

function announceSave(failure: SaveFailure | null): void {
  saveFailure = failure;
  for (const listener of saveWatchers) {
    try {
      listener(failure);
    } catch {
      /* 한 구독자가 실패해도 나머지에게는 알려야 합니다 */
    }
  }
}

const SAVE_ATTEMPTS = 3;

/**
 * IndexedDB 에 지금 상태를 씁니다 — **실패하면 다시 시도하고, 그래도 안 되면
 * 말합니다.**
 *
 * 일시적인 실패(백그라운드 전환 중의 쓰기 충돌 등)는 재시도로 넘어갑니다.
 * 계속 실패하는 것은 용량·권한 문제이므로 사용자가 알아야 합니다 — 그 상태에서
 * 계속 입력하면 전부 잃습니다.
 */
export async function persist(): Promise<void> {
  // Never write over a ledger that could not be read — it is still the only copy
  if (!db || openFailure) return;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
    try {
      await idbWrite(db.export());
      lastSavedAt = new Date().toISOString();
      if (saveFailure) announceSave(null); // 되살아났으면 띠를 내립니다
      return;
    } catch (error) {
      lastError = error;
      console.error(`[DB] 저장에 실패했습니다 (${attempt}/${SAVE_ATTEMPTS}):`, error);
      // 마지막 시도가 아니면 잠깐 쉬고 다시 — 순간적인 충돌은 이것으로 넘어갑니다
      if (attempt < SAVE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      }
    }
  }

  announceSave({
    attempts: SAVE_ATTEMPTS,
    message:
      lastError instanceof Error ? lastError.message : "기기에 저장하지 못했습니다.",
    at: new Date().toISOString(),
  });
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

/**
 * 여러 쓰기를 **한 트랜잭션**으로, 한 번의 저장으로.
 *
 * 예전에는 트랜잭션 없이 순차 실행했습니다. 명세서 300건을 넣다가 중간에
 * 실패하면 **절반만 적용된 채** 남았고, 다시 시도하면 앞쪽이 중복으로
 * 들어갔습니다. `BEGIN`/`COMMIT` 으로 감싸면 "전부 아니면 전무"가 되어
 * **재시도가 안전해집니다** — 가져오기 재시도(§7.9)가 이것에 기대고 있습니다.
 *
 * 깊이를 세는 이유: 바깥 배치가 도는 중에 다시 배치가 시작되면 `BEGIN` 이 두 번
 * 불려 오류가 납니다. 가장 바깥만 트랜잭션을 엽니다.
 */
let batchDepth = 0;

export function runBatch(statements: { sql: string; params?: any[] }[]): void {
  const target = requireDb();
  const outermost = batchDepth === 0;

  if (outermost) target.run("BEGIN");
  batchDepth += 1;

  try {
    for (const statement of statements) {
      target.run(statement.sql, statement.params ?? []);
    }
    batchDepth -= 1;
    if (outermost) target.run("COMMIT");
  } catch (error) {
    batchDepth -= 1;
    if (outermost) {
      try {
        target.run("ROLLBACK");
      } catch (rollbackError) {
        // 되돌리기까지 실패하면 메모리 상태를 믿을 수 없습니다 — 저장하지 않습니다
        console.error("[DB] 되돌리지 못했습니다:", rollbackError);
      }
    }
    /* 되돌렸으므로 저장할 것이 없습니다 — 부르는 쪽이 다시 시도할 수 있습니다 */
    throw error;
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
  "category_rules",
  "custom_categories",
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
