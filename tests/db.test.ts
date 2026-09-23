/**
 * 스키마와 마이그레이션 (§4.1~4.3).
 *
 * 이 계층에 **회귀 세트가 하나도 없었습니다.** v1~v17, 자가 복구, 데이터 보존을
 * 전부 일회용 하네스로만 확인했고, §15.2 가 스스로 이렇게 적어 두었습니다 —
 * *"하네스로 확인한 것이 계속 지켜지길 바란다면 세트로 옮기세요."*
 *
 * 여기가 틀리면 **사용자의 가계부가 사라집니다.** 화면 버그는 다시 그리면 되지만
 * 마이그레이션은 한 번 잘못 돌면 되돌릴 것이 없습니다. 그래서 이 파일은 `sql.js`
 * 를 노드에서 진짜로 띄워, 앱이 기기에서 하는 것과 **같은 함수**를 돌립니다.
 */
import initSqlJs, { type Database } from "sql.js";
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  migrate,
  readSchemaVersion,
  repairMissingColumns,
  repairMissingTables,
} from "../src/db/schema";

/*
  마이그레이션은 한 줄씩 자기가 무엇을 하는지 알립니다 — 기기에서는 그것이
  유일한 기록이라 그대로 둡니다. 여기서는 확인 결과를 덮어 버리므로 가립니다.
*/
const say = console.log;
console.log = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("[DB]")) return;
  say(...args);
};

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

const SQL = await initSqlJs({
  locateFile: () => "./node_modules/sql.js/dist/sql-wasm.wasm",
});

/** 갓 만든 빈 DB — 진짜 첫 실행과 같은 상태입니다(§4.7). */
function fresh(): Database {
  return new SQL.Database();
}

/** 그 버전까지만 올린 DB — 옛 기기를 흉내 냅니다. */
function at(version: number): Database {
  const db = fresh();
  for (const migration of MIGRATIONS) {
    if (migration.version > version) break;
    migration.up(db);
  }
  db.run(`PRAGMA user_version = ${version}`);
  return db;
}

const columns = (db: Database, table: string): string[] => {
  const r = db.exec(`PRAGMA table_info(${table})`);
  return r[0] ? r[0].values.map((row) => String(row[1])) : [];
};

const tables = (db: Database): string[] => {
  const r = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  return r[0] ? r[0].values.map((row) => String(row[0])) : [];
};

const count = (db: Database, sql: string): number => {
  const r = db.exec(sql);
  return r[0] ? Number(r[0].values[0][0]) : 0;
};

const value = (db: Database, sql: string): unknown => {
  const r = db.exec(sql);
  return r[0]?.values?.[0]?.[0];
};

// ---------------------------------------------------------------------------
section("v0 부터 전부 — 첫 실행이 지나는 길");
// ---------------------------------------------------------------------------
{
  const db = fresh();
  check("빈 DB 는 버전 0", readSchemaVersion(db) === 0, readSchemaVersion(db));

  const moved = migrate(db);
  check("0 에서 시작해", moved.from === 0);
  check(`${SCHEMA_VERSION} 까지`, moved.to === SCHEMA_VERSION, moved);
  check("버전이 DB 에 적힙니다", readSchemaVersion(db) === SCHEMA_VERSION);

  /* §4.4 가 적어 둔 테이블이 모두 있어야 합니다 */
  const made = tables(db);
  for (const table of [
    "users",
    "accounts",
    "transactions",
    "categories",
    "custom_categories",
    "category_rules",
    "budgets",
    "budget_configs",
    "budget_policy",
    "ai_analyses",
    "sms_inbox",
    "undo_log",
  ]) {
    check(`${table} 있음`, made.includes(table), made);
  }

  /* PIN 은 평문으로 두지 않습니다 (v2 — §5) */
  const users = columns(db, "users");
  check("pin_hash", users.includes("pin_hash"));
  check("pin_salt", users.includes("pin_salt"));
  check("pin_iterations", users.includes("pin_iterations"));

  /* 사용자별 분리 (v3) — 범위 없는 질의가 나올 수 없는 구조입니다 */
  for (const table of ["accounts", "transactions", "budgets", "budget_configs", "ai_analyses"]) {
    check(`${table}.user_id`, columns(db, table).includes("user_id"), columns(db, table));
  }

  /* 뒤에 붙은 칸들 (v4~v16) */
  const tx = columns(db, "transactions");
  for (const column of ["linked_account_id", "billing_month", "note", "origin", "created_at"]) {
    check(`transactions.${column}`, tx.includes(column), tx);
  }
  const cfg = columns(db, "budget_configs");
  for (const column of [
    "income_source",
    "fixed_source",
    "savings_source",
    "income_excluded",
    "fixed_excluded",
    "savings_excluded",
  ]) {
    check(`budget_configs.${column}`, cfg.includes(column), cfg);
  }
  db.close();
}

// ---------------------------------------------------------------------------
section("두 번 돌려도 같습니다 (§14.3 멱등)");
// ---------------------------------------------------------------------------
{
  const db = fresh();
  migrate(db);
  const before = tables(db).sort().join(",");

  const again = migrate(db);
  check("이미 최신이면 아무것도 안 합니다", again.from === SCHEMA_VERSION && again.to === SCHEMA_VERSION, again);
  check("테이블이 그대로", tables(db).sort().join(",") === before);

  /* 자가 복구도 두 번째에는 할 일이 없어야 합니다 */
  check("복구할 컬럼 없음", repairMissingColumns(db).length === 0, repairMissingColumns(db));
  check("복구할 테이블 없음", repairMissingTables(db).length === 0, repairMissingTables(db));
  db.close();
}

// ---------------------------------------------------------------------------
section("중간 버전에서 올라오기 — 실제 기기가 지나는 길");
// ---------------------------------------------------------------------------
{
  /* 모든 중간 버전에서 최신까지 올라갈 수 있어야 합니다 */
  for (const from of MIGRATIONS.map((m) => m.version)) {
    const db = at(from);
    let threw = "";
    try {
      migrate(db);
    } catch (error) {
      threw = String(error);
    }
    check(`v${from} → v${SCHEMA_VERSION}`, threw === "" && readSchemaVersion(db) === SCHEMA_VERSION, threw);
    db.close();
  }
}

// ---------------------------------------------------------------------------
section("데이터를 지우지 않습니다 (§4.1)");
// ---------------------------------------------------------------------------
{
  /*
    v3 은 budgets·budget_configs·ai_analyses 를 **재구축**합니다(SQLite 는 PK 를
    바꿀 수 없습니다). 재구축은 행을 옮겨 담는 일이라, 옮기다 흘리면 그 달 예산이
    통째로 사라집니다. 그래서 여기서 지킵니다.
  */
  const db = at(2);
  db.run(
    `INSERT INTO users (id, name, created_at) VALUES ('u1', '홍길동', '2026-01-01')`
  );
  db.run(
    `INSERT INTO accounts (id, name, type, institution, identifier, balance_or_billed, color, is_auto_sync_enabled, created_at)
     VALUES ('a1', 'KB국민카드', 'CARD', 'KB', '6097', 0, 'amber', 0, '2026-01-01')`
  );
  db.run(
    `INSERT INTO transactions (id, date, time, type, expense_type, category, merchant, amount, payment_method, account_id, created_at)
     VALUES ('t1', '2026-08-03', '12:00', 'EXPENSE', 'VARIABLE', '식비', '스타벅스', 5500, 'KB국민카드', 'a1', '2026-08-03')`
  );
  db.run(`INSERT INTO budgets (month, category, amount) VALUES ('2026-08', '식비', 400000)`);

  migrate(db);

  check("사용자가 남습니다", count(db, "SELECT COUNT(*) FROM users") === 1);
  check("계좌가 남습니다", count(db, "SELECT COUNT(*) FROM accounts") === 1);
  check("거래가 남습니다", count(db, "SELECT COUNT(*) FROM transactions") === 1);
  check("재구축된 예산도 남습니다", count(db, "SELECT COUNT(*) FROM budgets") === 1, count(db, "SELECT COUNT(*) FROM budgets"));
  check(
    "금액이 그대로",
    value(db, "SELECT amount FROM budgets WHERE category='식비'") === 400000
  );
  check(
    "거래의 값이 그대로",
    value(db, "SELECT merchant FROM transactions WHERE id='t1'") === "스타벅스"
  );
  /* v3 이 기존 행에 user_id 를 채워 넣어야 합니다 — 비면 모든 조회가 0건이 됩니다 */
  check(
    "기존 행에 user_id 가 채워집니다",
    count(db, "SELECT COUNT(*) FROM transactions WHERE user_id IS NOT NULL AND user_id <> ''") === 1,
    value(db, "SELECT user_id FROM transactions WHERE id='t1'")
  );
  db.close();
}

// ---------------------------------------------------------------------------
section("카테고리 분리가 과거 내역을 옮깁니다 (§6.3)");
// ---------------------------------------------------------------------------
{
  /*
    v14 는 적금·예금·청약 **지출**을 `기타 금융` 에서 `저축` 으로 옮깁니다.
    **지출만**입니다 — `예금이자` 는 나가면 금융이지만 들어오면 수입이고, 방향만이
    그 둘을 가릅니다(§6.2).
  */
  const db = at(13);
  const user = String(value(db, "SELECT id FROM users LIMIT 1") || "u1");
  if (count(db, "SELECT COUNT(*) FROM users") === 0) {
    db.run(`INSERT INTO users (id, name, created_at) VALUES ('u1', '홍', '2026-01-01')`);
  }
  const add = (id: string, type: string, category: string, merchant: string) =>
    db.run(
      `INSERT INTO transactions (id, user_id, date, time, type, expense_type, category, merchant, amount, payment_method, account_id, created_at)
       VALUES ('${id}', '${user}', '2026-08-03', '12:00', '${type}', '${
        type === "INCOME" ? "INCOME" : "VARIABLE"
      }', '${category}', '${merchant}', 100000, '통장', 'a1', '2026-08-03')`
    );

  add("s1", "EXPENSE", "기타 금융", "정기적금 자동이체");
  add("s2", "INCOME", "기타 금융", "예금이자");
  add("s3", "EXPENSE", "기타 금융", "미래에셋 펀드");

  migrate(db);

  check(
    "적금 지출은 저축으로",
    value(db, "SELECT category FROM transactions WHERE id='s1'") === "저축",
    value(db, "SELECT category FROM transactions WHERE id='s1'")
  );
  /*
    v14 는 지출만 옮겼습니다. v18 이 그 뒤를 이어 **방향마다 이름을 나눕니다**
    (§6.1) — 나가는 돈은 `금융/자산`, 들어오는 돈은 `금융/자산수입` 입니다.
    한 이름이 두 뜻을 갖고 있었던 것이 v14 가 반쪽짜리였던 까닭입니다.
  */
  check(
    "입금 건은 금융/자산수입으로",
    value(db, "SELECT category FROM transactions WHERE id='s2'") === "금융/자산수입",
    value(db, "SELECT category FROM transactions WHERE id='s2'")
  );
  check(
    "굴리는 돈은 금융/자산으로",
    value(db, "SELECT category FROM transactions WHERE id='s3'") === "금융/자산",
    value(db, "SELECT category FROM transactions WHERE id='s3'")
  );
  db.close();
}


// ---------------------------------------------------------------------------
section("v18 — 수입의 정기성과 방향별 카테고리 (§6.1 · §6.6)");
// ---------------------------------------------------------------------------
{
  const db = at(17);
  db.run(`INSERT INTO users (id, name, created_at) VALUES ('u1', '홍', '2026-01-01')`);
  const add = (id: string, type: string, et: string, category: string) =>
    db.run(
      `INSERT INTO transactions (id, user_id, date, time, type, expense_type, category, merchant, amount, payment_method, account_id, created_at)
       VALUES ('${id}', 'u1', '2026-08-03', '12:00', '${type}', '${et}', '${category}', '${id}', 1000, '통장', 'a1', '2026-08-03')`
    );

  add("pay", "INCOME", "INCOME", "급여");
  add("odd", "INCOME", "INCOME", "기타수입");
  /* 실제 기기에 있던 모습 — 수입인데 지출 카테고리가 붙어 있었습니다 */
  add("wrong", "INCOME", "INCOME", "주거");
  add("wrongCard", "INCOME", "INCOME", "카드대금");
  /* 지출인데 수입 카테고리 */
  add("wrongPay", "EXPENSE", "VARIABLE", "급여");
  /* 양쪽에 있는 이름은 그대로 */
  add("moveOut", "EXPENSE", "VARIABLE", "이체");
  add("moveIn", "INCOME", "INCOME", "이체");
  /* 사용자가 만든 이름은 건드리지 않습니다 */
  db.run(
    `INSERT INTO custom_categories (id, user_id, name, type, created_at)
     VALUES ('c1', 'u1', '반려동물', 'VARIABLE', '2026-01-01')`
  );
  add("pet", "EXPENSE", "VARIABLE", "반려동물");

  migrate(db);

  const cat = (id: string) => value(db, `SELECT category FROM transactions WHERE id='${id}'`);
  const kind = (id: string) => value(db, `SELECT expense_type FROM transactions WHERE id='${id}'`);

  /* 정기성 — 급여만 고정, 나머지는 변동 */
  check("급여는 고정수입", kind("pay") === "FIXED", kind("pay"));
  check("나머지 수입은 변동", kind("odd") === "VARIABLE", kind("odd"));
  check("INCOME 값이 남지 않음", count(db, `SELECT COUNT(*) FROM transactions WHERE expense_type='INCOME'`) === 0);
  check("지출의 정기성은 그대로", kind("moveOut") === "VARIABLE");

  /* 방향에 맞지 않는 카테고리 → 그 방향의 기타 */
  check("수입의 주거 → 기타수입", cat("wrong") === "기타수입", cat("wrong"));
  check("수입의 카드대금 → 기타수입", cat("wrongCard") === "기타수입", cat("wrongCard"));
  check("지출의 급여 → 기타지출", cat("wrongPay") === "기타지출", cat("wrongPay"));

  /* 양쪽에 있는 이름은 그대로 (§6.5) */
  check("나간 이체 그대로", cat("moveOut") === "이체");
  check("받은 이체 그대로", cat("moveIn") === "이체");

  /* 사용자가 만든 이름은 옮기지 않습니다 — 그 사람이 정한 것입니다 */
  check("직접 만든 카테고리 그대로", cat("pet") === "반려동물", cat("pet"));

  /* 사용자 카테고리에 방향이 붙고, 같은 이름을 양쪽에 등록할 수 있게 됩니다 */
  check("방향 칸이 생김", columns(db, "custom_categories").includes("direction"));
  check(
    "쓰인 자리로 방향을 정함",
    value(db, `SELECT direction FROM custom_categories WHERE name='반려동물'`) === "EXPENSE",
    value(db, `SELECT direction FROM custom_categories WHERE name='반려동물'`)
  );

  let threw = "";
  try {
    db.run(
      `INSERT INTO custom_categories (id, user_id, name, type, direction, created_at)
       VALUES ('c2', 'u1', '반려동물', 'VARIABLE', 'INCOME', '2026-01-01')`
    );
  } catch (error) {
    threw = String(error);
  }
  check("같은 이름을 반대 방향에 등록할 수 있음", threw === "", threw);

  let dupe = "";
  try {
    db.run(
      `INSERT INTO custom_categories (id, user_id, name, type, direction, created_at)
       VALUES ('c3', 'u1', '반려동물', 'VARIABLE', 'EXPENSE', '2026-01-01')`
    );
  } catch (error) {
    dupe = String(error);
  }
  check("같은 방향에 같은 이름은 여전히 막힘", dupe !== "", dupe);

  db.close();
}

// ---------------------------------------------------------------------------
section("자가 복구 — 버전만 올라가고 칸이 없는 기기 (§4.2)");
// ---------------------------------------------------------------------------
{
  /*
    실제로 있었던 일입니다: `pin_hash` 가 없는데 버전만 최신이었습니다. 버전만
    믿는 코드로는 **영원히** 복구되지 않습니다 — 그래서 매 실행마다 모양을
    확인합니다.
  */
  const db = fresh();
  migrate(db);

  /* 칸 하나를 떼어 냅니다 — 그 기기와 같은 상태를 만듭니다 */
  db.run("ALTER TABLE users DROP COLUMN pin_hash");
  db.run("ALTER TABLE transactions DROP COLUMN billing_month");
  check("떼어졌습니다", !columns(db, "users").includes("pin_hash"));

  const repaired = repairMissingColumns(db);
  check("두 칸을 되살립니다", repaired.length === 2, repaired);
  check("pin_hash 가 돌아옵니다", columns(db, "users").includes("pin_hash"));
  check("billing_month 도", columns(db, "transactions").includes("billing_month"));

  /* 나중에 생긴 테이블이 통째로 없는 경우 */
  db.run("DROP TABLE undo_log");
  db.run("DROP TABLE sms_inbox");
  check("사라졌습니다", !tables(db).includes("undo_log"));

  const rebuilt = repairMissingTables(db);
  check("두 테이블을 되살립니다", rebuilt.length === 2, rebuilt);
  check("undo_log 가 돌아옵니다", tables(db).includes("undo_log"));
  check("sms_inbox 도", tables(db).includes("sms_inbox"));

  /* 되살린 뒤에는 쓸 수 있어야 합니다 — 껍데기만 만들면 뜻이 없습니다 */
  let threw = "";
  try {
    db.run(
      `INSERT INTO undo_log (id, user_id, kind, label, payload_json, created_at)
       VALUES ('u1', 'user', 'DELETE_ENTRIES', '지운 거래', '{}', '2026-09-22')`
    );
  } catch (error) {
    threw = String(error);
  }
  check("되살린 테이블에 쓸 수 있습니다", threw === "", threw);
  db.close();
}

// ---------------------------------------------------------------------------
section("자가 복구는 있는 것을 건드리지 않습니다");
// ---------------------------------------------------------------------------
{
  const db = fresh();
  migrate(db);
  db.run(
    `INSERT INTO users (id, name, pin_hash, created_at) VALUES ('u1', '홍', 'HASH', '2026-01-01')`
  );

  repairMissingColumns(db);
  repairMissingTables(db);

  check(
    "이미 있는 값이 지워지지 않습니다",
    value(db, "SELECT pin_hash FROM users WHERE id='u1'") === "HASH"
  );
  db.close();
}

// ---------------------------------------------------------------------------
section("마이그레이션 목록 자체의 규칙");
// ---------------------------------------------------------------------------
{
  const versions = MIGRATIONS.map((m) => m.version);

  check("빈 목록이 아닙니다", versions.length > 0);
  check(
    "번호가 1 부터 빠짐없이 이어집니다",
    versions.every((v, i) => v === i + 1),
    versions
  );
  check(
    "가장 큰 번호가 SCHEMA_VERSION 과 같습니다",
    versions[versions.length - 1] === SCHEMA_VERSION,
    { last: versions[versions.length - 1], SCHEMA_VERSION }
  );
  check(
    "모두 설명이 있습니다",
    MIGRATIONS.every((m) => m.description.trim().length > 0)
  );
}

// ---------------------------------------------------------------------------
section("같은 DB 를 내보냈다 가져와도 버전이 따라갑니다 (§4.1)");
// ---------------------------------------------------------------------------
{
  const db = fresh();
  migrate(db);
  db.run(
    `INSERT INTO users (id, name, created_at) VALUES ('u1', '홍길동', '2026-01-01')`
  );
  const bytes = db.export();
  db.close();

  /* 파일로 나갔다 들어온 것과 같습니다 */
  const back = new SQL.Database(bytes);
  check("버전이 파일에 실립니다", readSchemaVersion(back) === SCHEMA_VERSION);
  check("행도 함께", count(back, "SELECT COUNT(*) FROM users") === 1);
  check(
    "다시 마이그레이션해도 아무 일 없습니다",
    migrate(back).from === SCHEMA_VERSION
  );
  back.close();
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
