import type { Database } from "sql.js";
import type { CategorySplit } from "../constants/categories";
import {
  CATEGORY_SPLITS,
  FINANCE_KEYWORDS,
  SAVINGS_KEYWORDS,
} from "../constants/categories";

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
export const SCHEMA_VERSION = 16;

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
  { table: "transactions", column: "linked_account_id", type: "TEXT" },
  { table: "transactions", column: "billing_month", type: "TEXT" },
  { table: "accounts", column: "payment_account_id", type: "TEXT" },
  { table: "accounts", column: "payment_account_label", type: "TEXT" },
  { table: "transactions", column: "note", type: "TEXT" },
  { table: "transactions", column: "origin", type: "TEXT" },
  { table: "budget_configs", column: "income_source", type: "TEXT" },
  { table: "budget_configs", column: "fixed_source", type: "TEXT" },
  { table: "budget_configs", column: "savings_source", type: "TEXT" },
  { table: "budget_configs", column: "income_excluded", type: "TEXT" },
  { table: "budget_configs", column: "fixed_excluded", type: "TEXT" },
  { table: "budget_configs", column: "savings_excluded", type: "TEXT" },
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
    /*
      예산 기준은 달에 매이지 않습니다 — 한 번 정해 두고 어느 달에든 적용하는
      것이 요점이라, 사용자당 한 행입니다.
    */
    table: "budget_policy",
    ddl: `CREATE TABLE IF NOT EXISTS budget_policy (
        user_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'AMOUNT',
        rules_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );`,
  },
  {
    /*
      공유·붙여넣은 문자를 파싱해 쌓아 두는 곳. 사용자가 확인하고 고를 때까지
      거래가 되지 않으므로 `transactions` 와 따로 둡니다 — 확인 전의 추정을
      가계부에 섞으면 합계가 흔들립니다.
    */
    table: "sms_inbox",
    ddl: `CREATE TABLE IF NOT EXISTS sms_inbox (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        received_at TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        parsed_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sms_inbox_scope
        ON sms_inbox(user_id, status);`,
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
          type TEXT NOT NULL, -- 'BANK' 또는 'CARD' (§4.4)
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

  {
    version: 7,
    description: "주거/통신과 생활/의료를 각각 분리",
    up: (db) => {
      db.run(
        `INSERT OR IGNORE INTO categories (id, name, type, color, is_default) VALUES
           ('cat_housing', '주거', 'FIXED', '#2563EB', 1),
           ('cat_telecom', '통신', 'FIXED', '#06B6D4', 1),
           ('cat_living', '생활', 'VARIABLE', '#84CC16', 1),
           ('cat_medical', '의료', 'VARIABLE', '#EF4444', 1)`
      );

      for (const split of CATEGORY_SPLITS) {
        applySplit(db, split);
      }

      db.run("DELETE FROM categories WHERE name IN ('주거/통신', '생활/의료')");
    },
  },

  {
    version: 8,
    description: "카드대금 내역에서 결제한 카드 연결",
    up: (db) => {
      addColumn(db, "transactions", "linked_account_id", "TEXT");
    },
  },

  {
    version: 9,
    description: "카드 이용 내역의 결제(청구) 년월",
    up: (db) => {
      addColumn(db, "transactions", "billing_month", "TEXT");
    },
  },

  {
    version: 10,
    description: "카드 대금이 빠져나가는 결제 계좌",
    up: (db) => {
      addColumn(db, "accounts", "payment_account_id", "TEXT");
      addColumn(db, "accounts", "payment_account_label", "TEXT");
    },
  },
  {
    version: 11,
    /*
      사용자가 직접 적는 설명. memo와 따로 두는 이유가 있습니다 — memo에는
      명세서가 적어 준 구분과 할부 회차("4/10")가 들어 있고, 그 회차가
      중복 판정 키와 할부 필터의 근거입니다(7.6, 9.5). 사용자가 그 칸에
      "친구 생일선물"이라고 쓰면 다음 달 같은 할부가 중복으로 걸러집니다.
    */
    description: "사용자가 직접 적는 설명",
    up: (db) => {
      addColumn(db, "transactions", "note", "TEXT");
    },
  },
  {
    version: 12,
    /*
      예산 기준 표와, 세 입력값이 실적에서 온 것인지 사람이 적은 것인지.
      후자는 잔액의 `balance_source`(USER/AUTO)와 같은 발상입니다 — 숫자만
      남기면 어디서 온 값인지 나중에 알 수 없습니다.
    */
    description: "예산 기준(카테고리별 한도 정책)과 수입·고정비 값의 출처",
    up: (db) => {
      db.run(`CREATE TABLE IF NOT EXISTS budget_policy (
        user_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'AMOUNT',
        rules_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );`);
      addColumn(db, "budget_configs", "income_source", "TEXT");
      addColumn(db, "budget_configs", "fixed_source", "TEXT");
    },
  },
  {
    version: 13,
    /*
      저축도 실적에서 채울 수 있게 되어 그 출처가 필요해졌습니다. v12 를 고치지
      않고 새 마이그레이션을 더합니다 — 이미 배포된 것은 그 기기에서 이미
      실행됐으므로, 고쳐도 다시 돌지 않습니다(4.1).
    */
    description: "저축 금액의 출처 (실적/직접 입력)",
    up: (db) => {
      addColumn(db, "budget_configs", "savings_source", "TEXT");
    },
  },
  {
    version: 14,
    /*
      `저축`이 카테고리가 되었으니, 적금·예금·청약처럼 이미 `기타 금융`에
      들어가 있던 지출을 그쪽으로 옮깁니다 — 새로 가져왔다면 갔을 자리로
      보내는 것입니다(17.6). 과거와 새 데이터가 달리 분류되면 합계가 맞지
      않습니다.

      옮기는 것은 **지출뿐**입니다. `예금이자`는 나가는 돈이면 금융이지만
      들어오는 돈이면 수입이고, 방향만이 그 둘을 가릅니다(6.2).

      `category_rules`는 건드리지 않습니다. 사람이 "적금은 기타 금융"이라고
      정해 둔 규칙을 앱이 뒤집을 이유가 없습니다(6.4).
    */
    description: "적금·예금·청약 지출을 기타 금융에서 저축으로",
    up: (db) => {
      const clauses = SAVINGS_KEYWORDS.map(() => "merchant LIKE ?").join(" OR ");
      db.run(
        `UPDATE transactions SET category = '저축'
          WHERE category = '기타 금융' AND type = 'EXPENSE' AND (${clauses})`,
        SAVINGS_KEYWORDS.map((word) => `%${word}%`)
      );
    },
  },
  {
    version: 15,
    /*
      문자 대기함과, 각 줄의 출처.

      출처가 필요한 이유는 문자로 넣은 건이 **임시**라는 데 있습니다. 같은
      거래가 나중에 명세서로 들어오고 그쪽이 더 정확하므로, 그때 문자 건을
      알아보고 대체해야 같은 돈이 두 번 세지지 않습니다.

      이미 있던 줄은 `STATEMENT` 로 봅니다 — 대부분 명세서에서 온 것이고,
      문자로 넣었던 옛 건은 메모가 '문자 자동 인식'이라 그것으로 가립니다.
    */
    description: "문자 대기함과 거래의 출처",
    up: (db) => {
      addColumn(db, "transactions", "origin", "TEXT");
      db.run(`CREATE TABLE IF NOT EXISTS sms_inbox (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        received_at TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        parsed_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL
      );`);
      db.run(`CREATE INDEX IF NOT EXISTS idx_sms_inbox_scope
        ON sms_inbox(user_id, status);`);

      db.run(
        `UPDATE transactions SET origin = 'SMS'
          WHERE origin IS NULL AND memo LIKE '%문자 자동 인식%'`
      );
      db.run("UPDATE transactions SET origin = 'STATEMENT' WHERE origin IS NULL");
    },
  },
  {
    version: 16,
    /*
      실적에서 빼기로 한 항목을 기억합니다.

      실적 목록에서 체크를 풀고 [선택한 금액 적용]을 누르면 합계만 남고 **무엇을
      뺐는지는 사라졌습니다.** 그래서 8월 수입 칸에 3,052,140원(급여 2건)이
      적혀 있는데 목록을 열면 전부 선택된 8,314,074원(17건)이 보였고, 그 차이가
      어디서 왔는지 알 방법이 없었습니다 — 사용자가 "이 금액이 어떤 기준인가요"
      라고 물은 것이 이것입니다.

      숫자만 남기면 출처를 알 수 없다는 것은 잔액(§8)과 값의 출처(§11.4)에서
      이미 겪은 일이고, 답도 같습니다: 판단의 근거를 함께 저장합니다.
    */
    description: "실적에서 제외한 항목 기억 (수입·고정비·저축)",
    up: (db) => {
      addColumn(db, "budget_configs", "income_excluded", "TEXT");
      addColumn(db, "budget_configs", "fixed_excluded", "TEXT");
      addColumn(db, "budget_configs", "savings_excluded", "TEXT");
    },
  },
];

/**
 * Moves everything recorded under a category that has been split, using the
 * same keyword tables the app now files new entries with — so a row lands
 * where a fresh import of it would.
 *
 * A budget line cannot be split; one figure covered the lot, so it carries
 * over to the fallback and the amounts can be moved from the budget screen.
 */
function applySplit(db: Database, split: CategorySplit): void {
  const move = (table: string, column: string) => {
    for (const { category, words } of split.rules) {
      const clauses = words.map(() => `${column} LIKE ?`).join(" OR ");
      db.run(
        `UPDATE ${table} SET category = ?
          WHERE category = ? AND (${clauses})`,
        [category, split.from, ...words.map((word) => `%${word}%`)]
      );
    }
    db.run(`UPDATE ${table} SET category = ? WHERE category = ?`, [
      split.fallback,
      split.from,
    ]);
  };

  move("transactions", "merchant");
  move("category_rules", "pattern");
  db.run("UPDATE budgets SET category = ? WHERE category = ?", [
    split.fallback,
    split.from,
  ]);
}

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
  { name: "주거", type: "FIXED", color: "#2563EB" },
  { name: "통신", type: "FIXED", color: "#06B6D4" },
  { name: "구독/미디어", type: "FIXED", color: "#8B5CF6" },
  { name: "교통", type: "VARIABLE", color: "#06B6D4" },
  { name: "쇼핑", type: "VARIABLE", color: "#EC4899" },
  { name: "문화/여가", type: "VARIABLE", color: "#10B981" },
  { name: "생활", type: "VARIABLE", color: "#84CC16" },
  { name: "의료", type: "VARIABLE", color: "#EF4444" },
  { name: "보험", type: "FIXED", color: "#0D9488" },
  { name: "대출", type: "FIXED", color: "#7C3AED" },
  { name: "기타 금융", type: "FIXED", color: "#4F46E5" },
  { name: "카드대금", type: "VARIABLE", color: "#6366F1" },
  { name: "급여", type: "INCOME", color: "#059669" },
  { name: "기타수입", type: "INCOME", color: "#10B981" },
  { name: "저축", type: "FIXED", color: "#0EA5E9" },
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
    type: "CARD",
    institution: "현대카드",
    identifier: "4221-****-****-8392",
    balanceOrBilled: 948000,
    color: "#1E293B",
  },
  {
    id: "acc-4",
    name: "신한카드 Mr.Life (신용)",
    type: "CARD",
    institution: "신한카드",
    identifier: "9410-****-****-1029",
    balanceOrBilled: 582000,
    color: "#0284C7",
  },
];

export const SAMPLE_TRANSACTIONS = [
  { id: "tx-1", date: "2026-09-01", time: "09:30", type: "INCOME", expenseType: "INCOME", category: "급여", merchant: "(주)테크솔루션 급여", amount: 4500000, paymentMethod: "계좌입금", accountId: "acc-2", memo: "9월 정기 급여" },
  { id: "tx-2", date: "2026-09-01", time: "10:00", type: "EXPENSE", expenseType: "FIXED", category: "주거", merchant: "행복주택 월세", amount: 650000, paymentMethod: "계좌이체", accountId: "acc-1", memo: "9월분 월세", isFixedRecurring: true, recurringDay: 1 },
  { id: "tx-3", date: "2026-09-01", time: "10:30", type: "EXPENSE", expenseType: "FIXED", category: "주거", merchant: "아파트 관리비", amount: 210000, paymentMethod: "자동이체", accountId: "acc-1", memo: "8월 사용분 관리비", isFixedRecurring: true, recurringDay: 1 },
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
    "생활": 100000,
    "의료": 50000,
    "기타지출": 100000,
  } as Record<string, number>,
};
