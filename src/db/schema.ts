import type { Database } from "sql.js";
import { FINANCE_KEYWORDS } from "../constants/categories";

/**
 * Schema version of the on-device database.
 *
 * The database itself is NEVER shipped with the app — it is created on the
 * device at first launch and then owned by the device. Shipping a new build
 * therefore replaces only the program.
 *
 * When the structure has to change, bump this number and append a migration
 * below. On the next launch every migration newer than the device's stored
 * version runs in order, so existing rows are carried forward instead of being
 * wiped. Never edit a migration that has already shipped — append a new one.
 *
 * The device's current version lives in SQLite's own `PRAGMA user_version`,
 * so it survives export/import of the .db file.
 */
export const SCHEMA_VERSION = 6;

export interface Migration {
  version: number;
  description: string;
  up: (db: Database) => void;
}

function columnNames(db: Database, table: string): string[] {
  const stmt = db.prepare(`PRAGMA table_info(${table})`);
  const names: string[] = [];
  while (stmt.step()) {
    names.push(String((stmt.getAsObject() as { name?: unknown }).name ?? ""));
  }
  stmt.free();
  return names;
}

/** ALTER TABLE ADD COLUMN fails on a column that already exists, so ask first. */
function addColumn(db: Database, table: string, column: string, type: string): boolean {
  if (columnNames(db, table).includes(column)) return false;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  return true;
}

/**
 * Columns that must exist once their migration has run, checked on every open.
 *
 * A device was found recording schema version 2 while its users table still
 * had no pin_hash — the version had been saved without the columns landing.
 * Every query against them then failed, and the version said there was
 * nothing left to do. Verifying the shape rather than trusting the number
 * lets such a device repair itself on the next launch.
 */
const EXPECTED_COLUMNS: { table: string; column: string; type: string }[] = [
  { table: "users", column: "pin_hash", type: "TEXT" },
  { table: "users", column: "pin_salt", type: "TEXT" },
  { table: "users", column: "pin_iterations", type: "INTEGER" },
  { table: "accounts", column: "user_id", type: "TEXT" },
  { table: "transactions", column: "user_id", type: "TEXT" },
  { table: "budgets", column: "user_id", type: "TEXT" },
  { table: "budget_configs", column: "user_id", type: "TEXT" },
  { table: "ai_analyses", column: "user_id", type: "TEXT" },
  { table: "accounts", column: "balance_as_of", type: "TEXT" },
  { table: "accounts", column: "balance_source", type: "TEXT" },
];

/**
 * Tables a later migration introduced, recreated the same way.
 *
 * `CREATE TABLE IF NOT EXISTS` costs nothing when the table is already there,
 * and covers a device whose version was saved without the table landing.
 */
const EXPECTED_TABLES: { table: string; ddl: string }[] = [
  {
    table: "custom_categories",
    ddl: `CREATE TABLE IF NOT EXISTS custom_categories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'VARIABLE',
        created_at TEXT NOT NULL,
        UNIQUE(user_id, name)
      );`,
  },
  {
    table: "category_rules",
    ddl: `CREATE TABLE IF NOT EXISTS category_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        pattern TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'USER',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_category_rules_scope
        ON category_rules(user_id, account_id);`,
  },
];

/** Returns the tables it had to recreate, for logging. */
export function repairMissingTables(db: Database): string[] {
  const repaired: string[] = [];
  for (const { table, ddl } of EXPECTED_TABLES) {
    try {
      const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?");
      stmt.bind([table]);
      const exists = stmt.step();
      stmt.free();
      if (!exists) {
        db.run(ddl);
        repaired.push(table);
      }
    } catch (error) {
      console.error(`[DB] ${table} 복구에 실패했습니다:`, error);
    }
  }
  return repaired;
}

/** Returns the columns it had to add, for logging. */
export function repairMissingColumns(db: Database): string[] {
  const repaired: string[] = [];
  for (const { table, column, type } of EXPECTED_COLUMNS) {
    try {
      if (addColumn(db, table, column, type)) {
        repaired.push(`${table}.${column}`);
      }
    } catch (error) {
      console.error(`[DB] ${table}.${column} 복구에 실패했습니다:`, error);
    }
  }
  return repaired;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "초기 스키마 (사용자, 카테고리, 계좌, 거래, 예산, AI 분석)",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          pin TEXT,
          auth_provider TEXT DEFAULT 'KAKAO',
          provider_label TEXT DEFAULT '카카오 간편인증',
          is_authenticated INTEGER DEFAULT 0,
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
    },
  },
  {
    version: 2,
    description: "PIN을 평문 대신 PBKDF2 해시로 저장",
    up: (db) => {
      addColumn(db, "users", "pin_hash", "TEXT");
      addColumn(db, "users", "pin_salt", "TEXT");
      addColumn(db, "users", "pin_iterations", "INTEGER");
      // A plaintext PIN cannot be converted here — hashing is async and a
      // migration is not. Clearing it asks for the PIN once more rather than
      // carrying a readable credential forward. The name and phone survive.
      db.run("UPDATE users SET pin = NULL");
    },
  },
  {
    version: 3,
    description: "사용자별 데이터 분리 (거래·계좌·예산에 소유자 추가)",
    up: (db) => {
      // Everything recorded so far belongs to whoever is already registered.
      const owner = firstUserId(db) ?? PRIMARY_USER_ID;

      addColumn(db, "accounts", "user_id", "TEXT");
      addColumn(db, "transactions", "user_id", "TEXT");
      db.run("UPDATE accounts SET user_id = ? WHERE user_id IS NULL", [owner]);
      db.run("UPDATE transactions SET user_id = ? WHERE user_id IS NULL", [owner]);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
      `);

      /*
        These three are keyed by month, so the owner has to become part of the
        key — two people must be able to budget the same month. SQLite cannot
        alter a primary key, so each table is rebuilt and its rows carried
        across.
      */
      rebuild(
        db,
        "budgets",
        `CREATE TABLE budgets (
           user_id TEXT NOT NULL,
           month TEXT NOT NULL,
           category TEXT NOT NULL,
           amount REAL NOT NULL,
           PRIMARY KEY (user_id, month, category)
         )`,
        `INSERT INTO budgets (user_id, month, category, amount)
           SELECT ?, month, category, amount FROM budgets_old`,
        owner
      );

      rebuild(
        db,
        "budget_configs",
        `CREATE TABLE budget_configs (
           user_id TEXT NOT NULL,
           month TEXT NOT NULL,
           monthly_income REAL DEFAULT 0,
           fixed_expenses REAL DEFAULT 0,
           savings_target REAL DEFAULT 0,
           alert_threshold_percent INTEGER DEFAULT 80,
           enable_push_alerts INTEGER DEFAULT 1,
           updated_at TEXT NOT NULL,
           PRIMARY KEY (user_id, month)
         )`,
        `INSERT INTO budget_configs (user_id, month, monthly_income, fixed_expenses,
             savings_target, alert_threshold_percent, enable_push_alerts, updated_at)
           SELECT ?, month, monthly_income, fixed_expenses, savings_target,
                  alert_threshold_percent, enable_push_alerts, updated_at
           FROM budget_configs_old`,
        owner
      );

      rebuild(
        db,
        "ai_analyses",
        `CREATE TABLE ai_analyses (
           user_id TEXT NOT NULL,
           month TEXT NOT NULL,
           analysis_json TEXT NOT NULL,
           health_score INTEGER,
           updated_at TEXT NOT NULL,
           PRIMARY KEY (user_id, month)
         )`,
        `INSERT INTO ai_analyses (user_id, month, analysis_json, health_score, updated_at)
           SELECT ?, month, analysis_json, health_score, updated_at FROM ai_analyses_old`,
        owner
      );
    },
  },
  {
    version: 4,
    description: "잔액 기준일시·출처, 가맹점 카테고리 규칙",
    up: (db) => {
      addColumn(db, "accounts", "balance_as_of", "TEXT");
      addColumn(db, "accounts", "balance_source", "TEXT");
      // Balances entered so far were typed in by hand, as of when the account
      // was registered — the closest honest reading of an untagged figure.
      db.run(
        `UPDATE accounts
           SET balance_as_of = COALESCE(balance_as_of, created_at),
               balance_source = COALESCE(balance_source, 'USER')`
      );

      db.run(`
        CREATE TABLE IF NOT EXISTS category_rules (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          pattern TEXT NOT NULL,
          category TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'USER',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_category_rules_scope
          ON category_rules(user_id, account_id);
      `);
    },
  },

  {
    version: 5,
    description: "카드대금 기본 분류, 사용자가 직접 만든 카테고리",
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS custom_categories (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'VARIABLE',
          created_at TEXT NOT NULL,
          UNIQUE(user_id, name)
        );
      `);

      // The shipped list gained one; a device that already seeded the others
      // would otherwise never see it.
      db.run(
        `INSERT OR IGNORE INTO categories (id, name, type, color, is_default)
         VALUES ('cat_card_payment', '카드대금', 'VARIABLE', '#6366F1', 1)`
      );
    },
  },

  {
    version: 6,
    description: "금융/보험을 보험·대출·기타 금융으로 분리",
    up: (db) => {
      db.run(
        `INSERT OR IGNORE INTO categories (id, name, type, color, is_default) VALUES
           ('cat_insurance', '보험', 'FIXED', '#0D9488', 1),
           ('cat_loan', '대출', 'FIXED', '#7C3AED', 1),
           ('cat_finance_etc', '기타 금융', 'FIXED', '#4F46E5', 1)`
      );

      /*
        Existing rows carry the old name, and the line itself usually says
        which of the three it became. The keyword lists are the same ones the
        app classifies with from now on, so a row lands where a fresh import
        of it would.
      */
      for (const { category, words } of FINANCE_KEYWORDS) {
        const clauses = words.map(() => "merchant LIKE ?").join(" OR ");
        db.run(
          `UPDATE transactions SET category = ?
            WHERE category = '금융/보험' AND (${clauses})`,
          [category, ...words.map((word) => `%${word}%`)]
        );
      }
      // Whatever the words could not place is financial traffic all the same
      db.run("UPDATE transactions SET category = '기타 금융' WHERE category = '금융/보험'");

      // Standing rules are matched on their pattern, the same way
      for (const { category, words } of FINANCE_KEYWORDS) {
        const clauses = words.map(() => "pattern LIKE ?").join(" OR ");
        db.run(
          `UPDATE category_rules SET category = ?
            WHERE category = '금융/보험' AND (${clauses})`,
          [category, ...words.map((word) => `%${word}%`)]
        );
      }
      db.run("UPDATE category_rules SET category = '기타 금융' WHERE category = '금융/보험'");

      /*
        A budget line cannot be split — one figure covered all three. It
        carries over to 기타 금융, and the user can move the amounts across
        the new categories from the budget screen.
      */
      db.run("UPDATE budgets SET category = '기타 금융' WHERE category = '금융/보험'");

      db.run("DELETE FROM categories WHERE name = '금융/보험'");
    },
  },
];

/**
 * Who existing rows belong to. Earlier builds seeded a nameless placeholder
 * user, and handing the data to that row would make it invisible — so a
 * registered user is preferred over merely the oldest one.
 */
function firstUserId(db: Database): string | null {
  const pick = (sql: string): string | null => {
    try {
      const stmt = db.prepare(sql);
      const id = stmt.step() ? String((stmt.getAsObject() as { id?: unknown }).id ?? "") : "";
      stmt.free();
      return id || null;
    } catch {
      return null;
    }
  };

  return (
    pick(
      "SELECT id FROM users WHERE name IS NOT NULL AND TRIM(name) != '' ORDER BY created_at LIMIT 1"
    ) ?? pick("SELECT id FROM users ORDER BY created_at LIMIT 1")
  );
}

/**
 * Swaps a table for one with a different primary key, carrying its rows over.
 * Skipped when the table already has the owner column, so re-running is safe.
 */
function rebuild(
  db: Database,
  table: string,
  createSql: string,
  copySql: string,
  owner: string
): void {
  if (columnNames(db, table).includes("user_id")) return;

  db.run(`ALTER TABLE ${table} RENAME TO ${table}_old`);
  db.run(createSql);
  db.run(copySql, [owner]);
  db.run(`DROP TABLE ${table}_old`);
}

/**
 * The only rows written at first launch. No accounts, no transactions, no
 * budget and no personal details — the device starts empty and unregistered.
 */
export const DEFAULT_CATEGORIES = [
  { name: "식비", type: "VARIABLE", color: "#F97316" },
  { name: "카페/간식", type: "VARIABLE", color: "#D97706" },
  { name: "주거/통신", type: "FIXED", color: "#2563EB" },
  { name: "구독/미디어", type: "FIXED", color: "#8B5CF6" },
  { name: "교통", type: "VARIABLE", color: "#06B6D4" },
  { name: "쇼핑", type: "VARIABLE", color: "#EC4899" },
  { name: "문화/여가", type: "VARIABLE", color: "#10B981" },
  { name: "생활/의료", type: "VARIABLE", color: "#14B8A6" },
  { name: "보험", type: "FIXED", color: "#0D9488" },
  { name: "대출", type: "FIXED", color: "#7C3AED" },
  { name: "기타 금융", type: "FIXED", color: "#4F46E5" },
  { name: "카드대금", type: "VARIABLE", color: "#6366F1" },
  { name: "급여", type: "INCOME", color: "#059669" },
  { name: "기타수입", type: "INCOME", color: "#10B981" },
  { name: "기타지출", type: "VARIABLE", color: "#64748B" },
];

export const PRIMARY_USER_ID = "user_primary";

/**
 * Demo dataset. Never installed automatically — only written when the user
 * explicitly picks "샘플 데이터로 초기화" in the connected-assets screen.
 */
export const SAMPLE_ACCOUNTS = [
  {
    id: "acc-1",
    name: "카카오뱅크 입출금 통장",
    type: "BANK",
    institution: "카카오뱅크",
    identifier: "3333-01-928471",
    balanceOrBilled: 3450000,
    color: "#FEE500",
  },
  {
    id: "acc-2",
    name: "신한 주거래 급여통장",
    type: "BANK",
    institution: "신한은행",
    identifier: "110-384-912048",
    balanceOrBilled: 1820000,
    color: "#0046FF",
  },
  {
    id: "acc-3",
    name: "현대카드 M (신용)",
    type: "CREDIT_CARD",
    institution: "현대카드",
    identifier: "4221-****-****-8392",
    balanceOrBilled: 948000,
    color: "#1E293B",
  },
  {
    id: "acc-4",
    name: "신한카드 Mr.Life (신용)",
    type: "CREDIT_CARD",
    institution: "신한카드",
    identifier: "9410-****-****-1029",
    balanceOrBilled: 582000,
    color: "#0284C7",
  },
];

export const SAMPLE_TRANSACTIONS = [
  { id: "tx-1", date: "2026-09-01", time: "09:30", type: "INCOME", expenseType: "INCOME", category: "급여", merchant: "(주)테크솔루션 급여", amount: 4500000, paymentMethod: "계좌입금", accountId: "acc-2", memo: "9월 정기 급여" },
  { id: "tx-2", date: "2026-09-01", time: "10:00", type: "EXPENSE", expenseType: "FIXED", category: "주거/통신", merchant: "행복주택 월세", amount: 650000, paymentMethod: "계좌이체", accountId: "acc-1", memo: "9월분 월세", isFixedRecurring: true, recurringDay: 1 },
  { id: "tx-3", date: "2026-09-01", time: "10:30", type: "EXPENSE", expenseType: "FIXED", category: "주거/통신", merchant: "아파트 관리비", amount: 210000, paymentMethod: "자동이체", accountId: "acc-1", memo: "8월 사용분 관리비", isFixedRecurring: true, recurringDay: 1 },
  { id: "tx-4", date: "2026-09-02", time: "12:15", type: "EXPENSE", expenseType: "VARIABLE", category: "식비", merchant: "본가한식당", amount: 12000, paymentMethod: "신한카드 Mr.Life", accountId: "acc-4", memo: "점심 식사" },
  { id: "tx-5", date: "2026-09-02", time: "12:45", type: "EXPENSE", expenseType: "VARIABLE", category: "카페/간식", merchant: "스타벅스 강남점", amount: 5500, paymentMethod: "현대카드 M", accountId: "acc-3", memo: "아이스 아메리카노" },
  { id: "tx-6", date: "2026-09-03", time: "19:40", type: "EXPENSE", expenseType: "VARIABLE", category: "식비", merchant: "배달의민족 (교촌치킨)", amount: 28000, paymentMethod: "현대카드 M", accountId: "acc-3", memo: "야식 주문" },
  { id: "tx-7", date: "2026-09-04", time: "08:30", type: "EXPENSE", expenseType: "VARIABLE", category: "교통", merchant: "티머니 지하철", amount: 1400, paymentMethod: "신한카드 Mr.Life", accountId: "acc-4", memo: "출근 대중교통" },
  { id: "tx-8", date: "2026-09-04", time: "14:00", type: "EXPENSE", expenseType: "FIXED", category: "구독/미디어", merchant: "넷플릭스 프리미엄", amount: 17000, paymentMethod: "현대카드 M", accountId: "acc-3", memo: "월 정기결제", isFixedRecurring: true, recurringDay: 4 },
  { id: "tx-9", date: "2026-09-05", time: "11:20", type: "EXPENSE", expenseType: "FIXED", category: "구독/미디어", merchant: "유튜브 프리미엄", amount: 14900, paymentMethod: "현대카드 M", accountId: "acc-3", memo: "월 정기구독", isFixedRecurring: true, recurringDay: 5 },
  { id: "tx-10", date: "2026-09-05", time: "16:00", type: "EXPENSE", expenseType: "VARIABLE", category: "쇼핑", merchant: "쿠팡 로켓배송", amount: 48500, paymentMethod: "신한카드 Mr.Life", accountId: "acc-4", memo: "생필품 구매" },
  { id: "tx-11", date: "2026-09-06", time: "13:30", type: "EXPENSE", expenseType: "VARIABLE", category: "식비", merchant: "이마트 역삼점", amount: 89000, paymentMethod: "신한카드 Mr.Life", accountId: "acc-4", memo: "주말 장보기" },
  { id: "tx-12", date: "2026-09-06", time: "23:10", type: "EXPENSE", expenseType: "VARIABLE", category: "교통", merchant: "카카오T 택시", amount: 18400, paymentMethod: "현대카드 M", accountId: "acc-3", memo: "심야 귀가 택시" },
  { id: "tx-13", date: "2026-09-07", time: "09:00", type: "EXPENSE", expenseType: "FIXED", category: "보험", merchant: "삼성화재 실비보험", amount: 78000, paymentMethod: "계좌자동이체", accountId: "acc-1", memo: "실손의료비", isFixedRecurring: true, recurringDay: 7 },
  { id: "tx-14", date: "2026-09-07", time: "18:30", type: "EXPENSE", expenseType: "VARIABLE", category: "식비", merchant: "배달의민족 (초밥)", amount: 36000, paymentMethod: "현대카드 M", accountId: "acc-3", memo: "저녁 배달 식사" },
  { id: "tx-15", date: "2026-09-08", time: "08:15", type: "EXPENSE", expenseType: "VARIABLE", category: "카페/간식", merchant: "메가커피", amount: 2000, paymentMethod: "신한카드 Mr.Life", accountId: "acc-4", memo: "아침 커피" },
];

export const SAMPLE_BUDGET_MONTH = "2026-09";

export const SAMPLE_BUDGET_CONFIG = {
  monthlyIncome: 4500000,
  fixedExpenses: 1150000,
  savingsTarget: 1500000,
  alertThresholdPercent: 80,
  enablePushAlerts: true,
  categoryBudgets: {
    "식비": 600000,
    "카페/간식": 100000,
    "교통": 150000,
    "쇼핑": 250000,
    "문화/여가": 150000,
    "생활/의료": 150000,
    "기타지출": 100000,
  } as Record<string, number>,
};
