/**
 * 사용자 한 명을 통째로 옮기기 (§4.10).
 *
 * 여기가 틀리면 **두 사람의 가계부가 섞입니다.** 화면에는 아무 오류도 뜨지
 * 않고, 이름은 A인데 내역은 B인 상태가 조용히 남습니다 — 마이그레이션과 같은
 * 종류의 위험이라 `db.test.ts` 처럼 `sql.js` 를 진짜로 띄워, 앱이 기기에서
 * 부르는 것과 **같은 함수**로 왕복시킵니다.
 */
import initSqlJs, { type Database } from "sql.js";
import { MIGRATIONS, SCHEMA_VERSION, migrate, readSchemaVersion } from "../src/db/schema";
import {
  PER_USER_TABLES,
  USER_FILE_FORMAT,
  USER_FILE_VERSION,
  checkImport,
  describePlan,
  isUserExport,
  readUserFile,
  summariseExport,
  type UserExport,
} from "../src/services/userTransfer";

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

function fresh(): Database {
  const db = new SQL.Database();
  migrate(db);
  return db;
}

/** 앱의 `repository` 가 하는 것과 같은 모양으로 — 열을 손으로 적지 않습니다. */
function put(db: Database, table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  db.run(
    `INSERT OR REPLACE INTO ${table} (${columns.join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
    columns.map((c) => row[c] as never)
  );
}

function rows(db: Database, sql: string, params: unknown[] = []) {
  const out: Record<string, unknown>[] = [];
  const statement = db.prepare(sql);
  statement.bind(params as never);
  while (statement.step()) out.push(statement.getAsObject() as Record<string, unknown>);
  statement.free();
  return out;
}

/** `repository.exportUser` 와 같은 규칙. */
function exportUser(db: Database, id: string): UserExport {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of PER_USER_TABLES) {
    tables[table] = rows(db, `SELECT * FROM ${table} WHERE user_id = ?`, [id]);
  }
  return {
    format: USER_FILE_FORMAT,
    version: USER_FILE_VERSION,
    schemaVersion: readSchemaVersion(db),
    exportedAt: new Date().toISOString(),
    user: rows(db, "SELECT * FROM users WHERE id = ?", [id])[0],
    tables,
  };
}

/** `repository.replaceUser` 와 같은 규칙 — 먼저 지우고 나서 넣습니다. */
function replaceUser(db: Database, file: UserExport) {
  const id = String(file.user.id);
  for (const table of [...PER_USER_TABLES, "undo_log"]) {
    db.run(`DELETE FROM ${table} WHERE user_id = ?`, [id]);
  }
  db.run("DELETE FROM users WHERE id = ?", [id]);
  put(db, "users", file.user);
  for (const table of PER_USER_TABLES) {
    for (const row of file.tables[table] || []) put(db, table, row);
  }
}

function seedUser(db: Database, id: string, name: string, howMany: number) {
  put(db, "users", { id, name, phone: "010-0000-0000", created_at: "2026-01-01T00:00:00.000Z" });
  put(db, "accounts", {
    id: `${id}-acc`,
    user_id: id,
    name: `${name}의 통장`,
    type: "BANK",
    institution: "국민",
    identifier: "***",
    balance_or_billed: 1000,
    color: "indigo",
    is_auto_sync_enabled: 0,
    last_synced_at: "",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  for (let n = 0; n < howMany; n++) {
    put(db, "transactions", {
      id: `${id}-tx-${n}`,
      user_id: id,
      date: "2026-08-03",
      time: "12:00",
      type: "EXPENSE",
      expense_type: "VARIABLE",
      category: "식비",
      merchant: `가맹점${n}`,
      amount: 1000 * (n + 1),
      payment_method: "계좌",
      account_id: `${id}-acc`,
      created_at: "2026-08-03T00:00:00.000Z",
    });
  }
  put(db, "category_rules", {
    id: `${id}-rule`,
    user_id: id,
    account_id: `${id}-acc`,
    pattern: "스타벅스",
    category: "카페/간식",
    source: "USER",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

// ---------------------------------------------------------------------------
section("옮길 목록이 지울 목록과 같은가");
// ---------------------------------------------------------------------------
{
  /*
    `deleteUser` 가 지우는 테이블과 옮기는 테이블이 갈리면, 지울 때는 남고
    옮길 때는 빠지는 식으로 어긋납니다(§5·§4.10).
  */
  const db = fresh();
  const named = new Set(PER_USER_TABLES as readonly string[]);

  const withUserId = rows(
    db,
    `SELECT m.name FROM sqlite_master m WHERE m.type = 'table'`
  )
    .map((r) => String(r.name))
    .filter((table) => {
      const columns = rows(db, `PRAGMA table_info(${table})`).map((c) => String(c.name));
      return columns.includes("user_id");
    });

  /* `undo_log` 는 일부러 뺍니다 — 임시 저장소를 옮길 이유가 없습니다(§4.9) */
  const missing = withUserId.filter((t) => !named.has(t) && t !== "undo_log");
  check("user_id 를 가진 테이블이 모두 목록에 있습니다", missing.length === 0, missing);
  check("undo_log 는 담지 않습니다", !named.has("undo_log"));
  db.close();
}

// ---------------------------------------------------------------------------
section("왕복 — 뽑아서 다시 넣으면 그대로");
// ---------------------------------------------------------------------------
{
  const db = fresh();
  seedUser(db, "u-a", "양승현", 5);
  seedUser(db, "u-b", "홍길동", 2);

  const file = exportUser(db, "u-a");
  check("내역을 전부 담습니다", file.tables.transactions.length === 5);
  check("계좌도", file.tables.accounts.length === 1);
  check("규칙도", file.tables.category_rules.length === 1);
  check("남의 것은 담지 않습니다", !JSON.stringify(file).includes("홍길동"));

  /* 지우고 다시 넣어도 같아야 합니다 */
  replaceUser(db, file);
  check(
    "왕복 뒤에도 건수가 같습니다",
    rows(db, "SELECT * FROM transactions WHERE user_id = ?", ["u-a"]).length === 5
  );
  check(
    "다른 사용자는 손대지 않습니다",
    rows(db, "SELECT * FROM transactions WHERE user_id = ?", ["u-b"]).length === 2
  );
  check(
    "사용자 수는 그대로",
    rows(db, "SELECT * FROM users").length === 2,
    rows(db, "SELECT * FROM users").map((u) => u.name)
  );

  /* 두 번 넣어도 늘지 않습니다 — 먼저 지우기 때문입니다(§14.3 멱등) */
  replaceUser(db, file);
  check(
    "두 번 넣어도 늘지 않습니다",
    rows(db, "SELECT * FROM transactions WHERE user_id = ?", ["u-a"]).length === 5
  );
  db.close();
}

// ---------------------------------------------------------------------------
section("갈아 끼우기 — 지우고 나서 넣습니다");
// ---------------------------------------------------------------------------
{
  const source = fresh();
  seedUser(source, "u-a", "양승현", 3);
  const file = exportUser(source, "u-a");
  source.close();

  const target = fresh();
  seedUser(target, "u-a", "양승현", 9);
  seedUser(target, "u-b", "홍길동", 4);

  replaceUser(target, file);
  check(
    "기존 내역이 남지 않습니다",
    rows(target, "SELECT * FROM transactions WHERE user_id = ?", ["u-a"]).length === 3,
    rows(target, "SELECT * FROM transactions WHERE user_id = ?", ["u-a"]).length
  );
  check(
    "다른 사용자는 그대로",
    rows(target, "SELECT * FROM transactions WHERE user_id = ?", ["u-b"]).length === 4
  );

  /*
    되돌리기 임시 저장소가 남으면, 그 id 를 다시 쓰는 사람에게 **이전 사람의 행
    사본**이 딸려 갑니다 — 누르는 순간 지워진 거래가 되살아납니다(§4.9).
  */
  put(target, "undo_log", {
    id: "undo-1",
    user_id: "u-a",
    kind: "DELETE_ENTRIES",
    label: "지운 거래 9건",
    payload_json: "{}",
    created_at: "2026-08-01T00:00:00.000Z",
  });
  replaceUser(target, file);
  check(
    "되돌리기 기록도 함께 비웁니다",
    rows(target, "SELECT * FROM undo_log WHERE user_id = ?", ["u-a"]).length === 0
  );
  target.close();
}

// ---------------------------------------------------------------------------
section("옛 버전 파일은 사다리를 태워 끌어올립니다");
// ---------------------------------------------------------------------------
{
  /*
    v17 에서 만든 파일을 v18 기기로 가져오는 경우. `기타 금융` 지출은 v18 이
    `금융/자산` 으로 옮깁니다(§6.1) — 옮기기 전용 변환을 따로 만들면 이 규칙과
    어긋나므로, **같은 사다리**를 태웁니다.
  */
  const old = new SQL.Database();
  for (const migration of MIGRATIONS) {
    if (migration.version > 17) break;
    migration.up(old);
  }
  old.run("PRAGMA user_version = 17");
  seedUser(old, "u-a", "양승현", 1);
  old.run("UPDATE transactions SET category = '기타 금융' WHERE user_id = 'u-a'");
  const file = exportUser(old, "u-a");
  old.close();

  check("파일이 v17 이라고 적혀 있습니다", file.schemaVersion === 17, file.schemaVersion);
  check(
    "옮기기 전에는 옛 이름",
    file.tables.transactions[0].category === "기타 금융",
    file.tables.transactions[0].category
  );

  /* `repository.alignUserFile` 과 같은 순서 */
  const scratch = new SQL.Database();
  for (const migration of MIGRATIONS) {
    if (migration.version > file.schemaVersion) break;
    migration.up(scratch);
  }
  scratch.run(`PRAGMA user_version = ${file.schemaVersion}`);
  put(scratch, "users", file.user);
  for (const table of PER_USER_TABLES) {
    for (const row of file.tables[table] || []) put(scratch, table, row);
  }
  migrate(scratch);

  const moved = rows(scratch, "SELECT * FROM transactions WHERE user_id = ?", ["u-a"]);
  check("사다리가 값을 옮겼습니다", moved[0].category === "금융/자산", moved[0].category);
  check("끌어올린 뒤 현재 버전", readSchemaVersion(scratch) === SCHEMA_VERSION);
  check("건수는 그대로", moved.length === 1);
  scratch.close();
}

// ---------------------------------------------------------------------------
section("가져와도 되는 파일인가");
// ---------------------------------------------------------------------------
{
  const here = [
    { id: "u-a", name: "양승현" },
    { id: "u-b", name: "홍길동" },
  ];
  const file = (over: Record<string, unknown> = {}): UserExport => ({
    format: USER_FILE_FORMAT,
    version: USER_FILE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: "2026-09-23T00:00:00.000Z",
    user: { id: "u-a", name: "양승현" },
    tables: { accounts: [{ id: "x" }], transactions: [] },
    ...over,
  });

  const same = checkImport(file(), { users: here });
  check("같은 사람이면 그 사람을 갈아 끼웁니다", same.ok && same.replacing?.id === "u-a");
  check("이름이 그대로면 조용히", !same.nameChanges);

  const fresh2 = checkImport(file({ user: { id: "u-new", name: "일지매" } }), { users: here });
  check("없는 사람이면 새로 생깁니다", fresh2.ok && fresh2.replacing === null);

  /*
    `user_primary` 는 첫 사용자가 쓰던 **고정 id** 라 기기마다 다른 사람이 그것을
    갖고 있을 수 있습니다. 남의 가계부를 지우는 일이므로 화면이 더 분명히
    말해야 합니다.
  */
  const renaming = checkImport(file({ user: { id: "u-a", name: "일지매" } }), { users: here });
  check("이름이 달라지면 알립니다", renaming.ok && renaming.nameChanges);
  check("누가 지워지는지 말합니다", renaming.replacing?.name === "양승현");

  /* 로그인 화면에서 사람을 고르는 값이 이름입니다(§5) */
  const clash = checkImport(file({ user: { id: "u-new", name: "홍길동" } }), { users: here });
  check("남이 쓰는 이름은 막습니다", !clash.ok && clash.refusal === "NAME_TAKEN");

  /* 사다리는 위로만 놓여 있습니다(§4.3) */
  const future = checkImport(file({ schemaVersion: SCHEMA_VERSION + 1 }), { users: here });
  check("더 새로운 파일은 열지 않습니다", !future.ok && future.refusal === "NEWER_SCHEMA");
  check("까닭을 말합니다", (future.why || "").includes("업데이트"));

  const older = checkImport(file({ schemaVersion: 1 }), { users: here });
  check("옛 파일은 받습니다", older.ok);

  check(
    "사용자 정보가 없으면 거절",
    checkImport(file({ user: {} }), { users: here }).refusal === "NO_USER"
  );
  check(
    "파일이 아니면 거절",
    checkImport(null, { users: here }).refusal === "NOT_A_USER_FILE"
  );
  check(
    "전체 백업을 여기에 넣으면 그렇게 말합니다",
    (checkImport(null, { users: here }).why || "").includes("전체 백업")
  );
  check("빈 기기에도 들어갑니다", checkImport(file(), { users: [] }).ok);
}

// ---------------------------------------------------------------------------
section("파일 읽기와 요약");
// ---------------------------------------------------------------------------
{
  const made: UserExport = {
    format: USER_FILE_FORMAT,
    version: USER_FILE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: "2026-09-23T00:00:00.000Z",
    user: { id: "u-a", name: "양승현" },
    tables: {
      accounts: [{ id: "a" }, { id: "b" }],
      transactions: Array.from({ length: 1420 }, (_, n) => ({ id: `t${n}` })),
      category_rules: [{ id: "r" }],
    },
  };

  check("스스로 만든 것을 다시 읽습니다", readUserFile(JSON.stringify(made))?.user.id === "u-a");
  check("글자가 아니면 null", readUserFile("{{{") === null);
  check("다른 JSON 은 null", readUserFile('{"hello":1}') === null);
  check("전체 백업 바이트도 null", readUserFile("SQLite format 3") === null);
  check("모양 판별", isUserExport(made) && !isUserExport({ format: "다른것" }));

  const summary = summariseExport(made);
  check("건수를 셉니다", summary.accounts === 2 && summary.transactions === 1420);

  const plan = describePlan(
    checkImport(made, { users: [{ id: "u-a", name: "양승현" }] }),
    made,
    { accounts: 7, transactions: 1420 }
  );
  const said = plan.join(" ");
  check("지워지는 것을 건수로 말합니다", said.includes("7개") && said.includes("1,420건"));
  check("다른 사용자는 남는다고 말합니다", said.includes("다른 사용자"));
  check("PIN 이 바뀐다고 말합니다", said.includes("비밀번호"));
  check("따라오지 않는 것을 말합니다", said.includes("AI 키"));

  const added = describePlan(checkImport(made, { users: [] }), made);
  check("새로 생기는 경우도 말합니다", added.join(" ").includes("새로 생깁니다"));
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
