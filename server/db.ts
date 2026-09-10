import initSqlJs, { Database } from "sql.js";
import fs from "fs";
import path from "path";

export interface DBStats {
  path: string;
  sizeBytes: number;
  tables: Record<string, number>;
  lastSavedAt: string;
}

const DB_FILE_PATH = path.join(process.cwd(), "finance.db");

let dbInstance: Database | null = null;
let lastSavedAt = new Date().toISOString();

/**
 * Initialize SQLite database with WebAssembly engine (sql.js)
 * Loads existing finance.db from disk if present, or creates a new file.
 */
export async function getDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE_PATH);
      dbInstance = new SQL.Database(fileBuffer);
      console.log(`[SQLite] Loaded existing database from ${DB_FILE_PATH} (${fileBuffer.byteLength} bytes)`);
    } catch (err) {
      console.error(`[SQLite] Failed to load existing database file, creating fresh:`, err);
      dbInstance = new SQL.Database();
    }
  } else {
    console.log(`[SQLite] Initializing new database at ${DB_FILE_PATH}`);
    dbInstance = new SQL.Database();
  }

  // Ensure tables and baseline schema exist
  ensureSchema(dbInstance);

  // If newly created or empty, seed standard categories & baseline data
  seedInitialDataIfEmpty(dbInstance);

  // Persist to disk
  saveDatabase();

  return dbInstance;
}

/**
 * Save current SQLite database state to disk (finance.db)
 */
export function saveDatabase(): void {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE_PATH, buffer);
    lastSavedAt = new Date().toISOString();
  } catch (error) {
    console.error("[SQLite] Error saving database to disk:", error);
  }
}

/**
 * Executes a query that returns multiple rows
 */
export function queryAll<T = any>(sql: string, params: any[] = []): T[] {
  if (!dbInstance) throw new Error("Database not initialized");
  const stmt = dbInstance.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  const rows: T[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return rows;
}

/**
 * Executes a query that returns a single row or null
 */
export function queryOne<T = any>(sql: string, params: any[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Executes an INSERT, UPDATE, or DELETE statement
 */
export function run(sql: string, params: any[] = []): void {
  if (!dbInstance) throw new Error("Database not initialized");
  dbInstance.run(sql, params);
  saveDatabase();
}

/**
 * Create tables if they do not already exist
 */
function ensureSchema(db: Database) {
  // If users table already exists with NOT NULL on pin, migrate it to allow NULL
  try {
    const tableInfo = db.prepare("PRAGMA table_info(users)");
    let pinColumnNotNull = false;
    while (tableInfo.step()) {
      const col = tableInfo.getAsObject() as any;
      if (col.name === "pin" && col.notnull === 1) {
        pinColumnNotNull = true;
      }
    }
    tableInfo.free();

    if (pinColumnNotNull) {
      console.log("[SQLite] Migrating users table to remove NOT NULL and DEFAULT '123456' on pin...");
      db.run(`
        CREATE TABLE users_temp (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          pin TEXT,
          auth_provider TEXT DEFAULT 'KAKAO',
          provider_label TEXT DEFAULT '카카오 간편인증',
          is_authenticated INTEGER DEFAULT 1,
          is_biometric_enabled INTEGER DEFAULT 1,
          authenticated_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_temp SELECT id, name, email, phone, CASE WHEN pin = '123456' THEN NULL ELSE pin END, auth_provider, provider_label, is_authenticated, is_biometric_enabled, authenticated_at, created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_temp RENAME TO users;
      `);
      console.log("[SQLite] Migration complete. All '123456' PINs cleared.");
    }
  } catch (err) {
    console.error("[SQLite] Error checking/migrating users table schema:", err);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      pin TEXT,
      auth_provider TEXT DEFAULT 'KAKAO',
      provider_label TEXT DEFAULT '카카오 간편인증',
      is_authenticated INTEGER DEFAULT 1,
      is_biometric_enabled INTEGER DEFAULT 1,
      authenticated_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL, -- 'FIXED', 'VARIABLE', 'INCOME'
      icon TEXT,
      color TEXT,
      is_default INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'BANK', 'CREDIT_CARD', 'CHECK_CARD'
      institution TEXT NOT NULL,
      identifier TEXT NOT NULL,
      balance_or_billed REAL NOT NULL DEFAULT 0,
      color TEXT,
      is_auto_sync_enabled INTEGER DEFAULT 1,
      last_synced_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL, -- YYYY-MM-DD
      time TEXT NOT NULL, -- HH:mm
      type TEXT NOT NULL, -- 'EXPENSE', 'INCOME'
      expense_type TEXT NOT NULL, -- 'FIXED', 'VARIABLE', 'INCOME'
      category TEXT NOT NULL,
      merchant TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      account_id TEXT,
      memo TEXT,
      is_fixed_recurring INTEGER DEFAULT 0,
      recurring_day INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);

    CREATE TABLE IF NOT EXISTS budgets (
      month TEXT NOT NULL, -- YYYY-MM
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      PRIMARY KEY (month, category)
    );

    CREATE TABLE IF NOT EXISTS budget_configs (
      month TEXT PRIMARY KEY, -- YYYY-MM
      monthly_income REAL DEFAULT 0,
      fixed_expenses REAL DEFAULT 0,
      savings_target REAL DEFAULT 0,
      alert_threshold_percent INTEGER DEFAULT 80,
      enable_push_alerts INTEGER DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_analyses (
      month TEXT PRIMARY KEY,
      analysis_json TEXT NOT NULL,
      health_score INTEGER,
      updated_at TEXT NOT NULL
    );
  `);
}

/**
 * Standard default categories for Korean household accounting
 */
const DEFAULT_CATEGORIES = [
  { name: "식비", type: "VARIABLE", color: "#F97316" },
  { name: "카페/간식", type: "VARIABLE", color: "#D97706" },
  { name: "주거/통신", type: "FIXED", color: "#2563EB" },
  { name: "구독/미디어", type: "FIXED", color: "#8B5CF6" },
  { name: "교통", type: "VARIABLE", color: "#06B6D4" },
  { name: "쇼핑", type: "VARIABLE", color: "#EC4899" },
  { name: "문화/여가", type: "VARIABLE", color: "#10B981" },
  { name: "생활/의료", type: "VARIABLE", color: "#14B8A6" },
  { name: "금융/보험", type: "FIXED", color: "#4F46E5" },
  { name: "급여", type: "INCOME", color: "#059669" },
  { name: "기타수입", type: "INCOME", color: "#10B981" },
  { name: "기타지출", type: "VARIABLE", color: "#64748B" },
];

/**
 * Baseline seed data populated into SQLite
 */
function seedInitialDataIfEmpty(db: Database) {
  // Check categories
  const catCountRow = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM categories");
  if (!catCountRow || catCountRow.count === 0) {
    console.log("[SQLite] Seeding standard categories...");
    for (const cat of DEFAULT_CATEGORIES) {
      db.run(
        `INSERT INTO categories (id, name, type, color, is_default) VALUES (?, ?, ?, ?, 1)`,
        [`cat_${encodeURIComponent(cat.name)}`, cat.name, cat.type, cat.color]
      );
    }
  }

  // Check user
  const userCountRow = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM users");
  if (!userCountRow || userCountRow.count === 0) {
    console.log("[SQLite] Initializing users table (unauthenticated, no default PIN)...");
    db.run(
      `INSERT INTO users (id, name, email, phone, pin, auth_provider, provider_label, is_authenticated, is_biometric_enabled, authenticated_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 0, 1, NULL, ?)`,
      [
        "user_primary",
        "",
        "",
        "",
        "KAKAO",
        "카카오 간편인증",
        new Date().toISOString(),
      ]
    );
  } else {
    // Reset any previous dummy user '김영수' and remove default '123456' PIN
    db.run(
      `UPDATE users SET name = '', email = '', phone = '', is_authenticated = 0, authenticated_at = NULL WHERE name = '김영수'`
    );
    db.run(
      `UPDATE users SET pin = NULL WHERE pin = '123456'`
    );
  }

  // Check accounts
  const accCountRow = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM accounts");
  if (!accCountRow || accCountRow.count === 0) {
    console.log("[SQLite] Seeding initial connected accounts and cards...");
    const initialAccounts = [
      {
        id: "acc-1",
        name: "카카오뱅크 입출금 통장",
        type: "BANK",
        institution: "카카오뱅크",
        identifier: "3333-01-928471",
        balance_or_billed: 3450000,
        color: "#FEE500",
      },
      {
        id: "acc-2",
        name: "신한 주거래 급여통장",
        type: "BANK",
        institution: "신한은행",
        identifier: "110-384-912048",
        balance_or_billed: 1820000,
        color: "#0046FF",
      },
      {
        id: "acc-3",
        name: "현대카드 M (신용)",
        type: "CREDIT_CARD",
        institution: "현대카드",
        identifier: "4221-****-****-8392",
        balance_or_billed: 948000,
        color: "#1E293B",
      },
      {
        id: "acc-4",
        name: "신한카드 Mr.Life (신용)",
        type: "CREDIT_CARD",
        institution: "신한카드",
        identifier: "9410-****-****-1029",
        balance_or_billed: 582000,
        color: "#0284C7",
      },
    ];

    for (const acc of initialAccounts) {
      db.run(
        `INSERT INTO accounts (id, name, type, institution, identifier, balance_or_billed, color, is_auto_sync_enabled, last_synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          acc.id,
          acc.name,
          acc.type,
          acc.institution,
          acc.identifier,
          acc.balance_or_billed,
          acc.color,
          "2026-09-08 09:15",
          new Date().toISOString(),
        ]
      );
    }
  }

  // Check transactions
  const txCountRow = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM transactions");
  if (!txCountRow || txCountRow.count === 0) {
    console.log("[SQLite] Seeding baseline transactions...");
    const sampleTxs = [
      { id: "tx-1", date: "2026-09-01", time: "09:30", type: "INCOME", expense_type: "INCOME", category: "급여", merchant: "(주)테크솔루션 급여", amount: 4500000, payment_method: "계좌입금", account_id: "acc-2", memo: "9월 정기 급여" },
      { id: "tx-2", date: "2026-09-01", time: "10:00", type: "EXPENSE", expense_type: "FIXED", category: "주거/통신", merchant: "행복주택 월세", amount: 650000, payment_method: "계좌이체", account_id: "acc-1", memo: "9월분 월세", is_fixed_recurring: 1, recurring_day: 1 },
      { id: "tx-3", date: "2026-09-01", time: "10:30", type: "EXPENSE", expense_type: "FIXED", category: "주거/통신", merchant: "아파트 관리비", amount: 210000, payment_method: "자동이체", account_id: "acc-1", memo: "8월 사용분 관리비", is_fixed_recurring: 1, recurring_day: 1 },
      { id: "tx-4", date: "2026-09-02", time: "12:15", type: "EXPENSE", expense_type: "VARIABLE", category: "식비", merchant: "본가한식당", amount: 12000, payment_method: "신한카드 Mr.Life", account_id: "acc-4", memo: "점심 식사" },
      { id: "tx-5", date: "2026-09-02", time: "12:45", type: "EXPENSE", expense_type: "VARIABLE", category: "카페/간식", merchant: "스타벅스 강남점", amount: 5500, payment_method: "현대카드 M", account_id: "acc-3", memo: "아이스 아메리카노" },
      { id: "tx-6", date: "2026-09-03", time: "19:40", type: "EXPENSE", expense_type: "VARIABLE", category: "식비", merchant: "배달의민족 (교촌치킨)", amount: 28000, payment_method: "현대카드 M", account_id: "acc-3", memo: "야식 주문" },
      { id: "tx-7", date: "2026-09-04", time: "08:30", type: "EXPENSE", expense_type: "VARIABLE", category: "교통", merchant: "티머니 지하철", amount: 1400, payment_method: "신한카드 Mr.Life", account_id: "acc-4", memo: "출근 대중교통" },
      { id: "tx-8", date: "2026-09-04", time: "14:00", type: "EXPENSE", expense_type: "FIXED", category: "구독/미디어", merchant: "넷플릭스 프리미엄", amount: 17000, payment_method: "현대카드 M", account_id: "acc-3", memo: "월 정기결제", is_fixed_recurring: 1, recurring_day: 4 },
      { id: "tx-9", date: "2026-09-05", time: "11:20", type: "EXPENSE", expense_type: "FIXED", category: "구독/미디어", merchant: "유튜브 프리미엄", amount: 14900, payment_method: "현대카드 M", account_id: "acc-3", memo: "월 정기구독", is_fixed_recurring: 1, recurring_day: 5 },
      { id: "tx-10", date: "2026-09-05", time: "16:00", type: "EXPENSE", expense_type: "VARIABLE", category: "쇼핑", merchant: "쿠팡 로켓배송", amount: 48500, payment_method: "신한카드 Mr.Life", account_id: "acc-4", memo: "생필품 구매" },
      { id: "tx-11", date: "2026-09-06", time: "13:30", type: "EXPENSE", expense_type: "VARIABLE", category: "식비", merchant: "이마트 역삼점", amount: 89000, payment_method: "신한카드 Mr.Life", account_id: "acc-4", memo: "주말 장보기" },
      { id: "tx-12", date: "2026-09-06", time: "23:10", type: "EXPENSE", expense_type: "VARIABLE", category: "교통", merchant: "카카오T 택시", amount: 18400, payment_method: "현대카드 M", account_id: "acc-3", memo: "심야 귀가 택시" },
      { id: "tx-13", date: "2026-09-07", time: "09:00", type: "EXPENSE", expense_type: "FIXED", category: "금융/보험", merchant: "삼성화재 실비보험", amount: 78000, payment_method: "계좌자동이체", account_id: "acc-1", memo: "실손의료비", is_fixed_recurring: 1, recurring_day: 7 },
      { id: "tx-14", date: "2026-09-07", time: "18:30", type: "EXPENSE", expense_type: "VARIABLE", category: "식비", merchant: "배달의민족 (초밥)", amount: 36000, payment_method: "현대카드 M", account_id: "acc-3", memo: "저녁 배달 식사" },
      { id: "tx-15", date: "2026-09-08", time: "08:15", type: "EXPENSE", expense_type: "VARIABLE", category: "카페/간식", merchant: "메가커피", amount: 2000, payment_method: "신한카드 Mr.Life", account_id: "acc-4", memo: "아침 커피" },
    ];

    for (const tx of sampleTxs) {
      db.run(
        `INSERT INTO transactions (id, date, time, type, expense_type, category, merchant, amount, payment_method, account_id, memo, is_fixed_recurring, recurring_day, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tx.id,
          tx.date,
          tx.time,
          tx.type,
          tx.expense_type,
          tx.category,
          tx.merchant,
          tx.amount,
          tx.payment_method,
          tx.account_id,
          tx.memo,
          tx.is_fixed_recurring || 0,
          tx.recurring_day || null,
          new Date().toISOString(),
        ]
      );
    }
  }

  // Check budget config
  const budgetCountRow = queryOne<{ count: number }>("SELECT COUNT(*) as count FROM budget_configs WHERE month = '2026-09'");
  if (!budgetCountRow || budgetCountRow.count === 0) {
    db.run(
      `INSERT INTO budget_configs (month, monthly_income, fixed_expenses, savings_target, alert_threshold_percent, enable_push_alerts, updated_at)
       VALUES ('2026-09', 4500000, 1150000, 1500000, 80, 1, ?)`,
      [new Date().toISOString()]
    );

    const defaultBudgets = [
      { category: "식비", amount: 600000 },
      { category: "카페/간식", amount: 100000 },
      { category: "교통", amount: 150000 },
      { category: "쇼핑", amount: 250000 },
      { category: "문화/여가", amount: 150000 },
      { category: "생활/의료", amount: 150000 },
      { category: "기타지출", amount: 100000 },
    ];

    for (const b of defaultBudgets) {
      db.run(
        `INSERT OR REPLACE INTO budgets (month, category, amount) VALUES ('2026-09', ?, ?)`,
        [b.category, b.amount]
      );
    }
  }
}

/**
 * Returns database statistics and table row counts
 */
export function getDbStats(): DBStats {
  const stat = fs.existsSync(DB_FILE_PATH) ? fs.statSync(DB_FILE_PATH) : { size: 0 };
  
  const tables: Record<string, number> = {};
  const tableNames = ["users", "categories", "accounts", "transactions", "budgets", "budget_configs", "ai_analyses"];
  
  for (const name of tableNames) {
    try {
      const row = queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM ${name}`);
      tables[name] = row ? row.count : 0;
    } catch {
      tables[name] = 0;
    }
  }

  return {
    path: "finance.db",
    sizeBytes: stat.size,
    tables,
    lastSavedAt,
  };
}

/**
 * Reset database:
 * - 'clean': Erases all transactions and accounts, leaving only clean schema & default categories.
 * - 'sample': Resets back to full sample state.
 */
export function resetDatabase(mode: "clean" | "sample"): void {
  if (!dbInstance) return;

  dbInstance.run(`
    DELETE FROM transactions;
    DELETE FROM accounts;
    DELETE FROM budgets;
    DELETE FROM budget_configs;
    DELETE FROM ai_analyses;
  `);

  if (mode === "clean") {
    // Leave clean schema with categories
    saveDatabase();
    console.log("[SQLite] Database reset to clean state (0 transactions, 0 accounts).");
  } else {
    // Re-seed sample data
    seedInitialDataIfEmpty(dbInstance);
    saveDatabase();
    console.log("[SQLite] Database reset to initial sample state.");
  }
}

/**
 * Export raw binary database buffer for direct download
 */
export function getDatabaseBinary(): Buffer {
  if (!dbInstance) {
    throw new Error("Database not initialized");
  }
  const data = dbInstance.export();
  return Buffer.from(data);
}
