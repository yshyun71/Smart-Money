import type {
  AISpendingAnalysis,
  CategoryRule,
  CategoryType,
  ConnectedAccount,
  ExpenseType,
  MonthlyBudgetConfig,
  RuleSource,
  Transaction,
  TransactionType,
  ValueSource,
} from "../types/finance";
import type { StoredPin } from "../services/pinCrypto";
import {
  emptyPolicy,
  type BudgetPolicy,
  type BudgetPolicyMode,
} from "../services/budgetPolicy";
import {
  createScratchDatabase,
  currentSchemaVersion,
  persist,
  queryAll,
  queryOne,
  run,
  runBatch,
} from "./database";
import {
  PER_USER_TABLES,
  USER_FILE_FORMAT,
  USER_FILE_VERSION,
  type UserExport,
} from "../services/userTransfer";
import { movesBalance } from "../services/balance";
import {
  MIGRATIONS,
  migrate,
  repairMissingColumns,
  repairMissingTables,
  SAMPLE_ACCOUNTS,
  SAMPLE_BUDGET_CONFIG,
  SAMPLE_BUDGET_MONTH,
  SAMPLE_TRANSACTIONS,
} from "./schema";

/**
 * Every read and write the UI performs, expressed against the on-device
 * database. These functions replace the REST endpoints the app used to call.
 *
 * The device can hold several users, each with their own ledger. Data
 * functions read the signed-in user from the session below rather than taking
 * an id at every call site, so a query can never accidentally go unscoped.
 */

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

function requireUser(): string {
  if (!currentUserId) {
    throw new Error("로그인된 사용자가 없습니다.");
  }
  return currentUserId;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserSummary {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  lastUnlockedAt: string | null;
}

interface UserRow {
  id: string;
  name: string | null;
  phone: string | null;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_iterations: number | null;
  authenticated_at: string | null;
  created_at: string;
}

function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    name: row.name || "",
    phone: row.phone || "",
    createdAt: row.created_at,
    lastUnlockedAt: row.authenticated_at,
  };
}

/**
 * Only fully set-up users. Earlier builds seeded a nameless placeholder row,
 * which must never appear on the sign-in screen.
 */
export function listUsers(): UserSummary[] {
  return queryAll<UserRow>(
    `SELECT * FROM users
     WHERE name IS NOT NULL AND TRIM(name) != '' AND pin_hash IS NOT NULL
     ORDER BY created_at`
  ).map(toSummary);
}

export function getUserById(id: string): UserSummary | null {
  const row = queryOne<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return row ? toSummary(row) : null;
}

export function createUser(details: {
  name: string;
  phone: string;
  pin: StoredPin;
}): string {
  const id = `u-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  run(
    `INSERT INTO users (id, name, email, phone, pin, pin_hash, pin_salt, pin_iterations,
       auth_provider, provider_label, is_authenticated, is_biometric_enabled, authenticated_at, created_at)
     VALUES (?, ?, '', ?, NULL, ?, ?, ?, 'PIN', '간편 비밀번호', 0, 1, NULL, ?)`,
    [
      id,
      details.name.trim(),
      details.phone.trim(),
      details.pin.hash,
      details.pin.salt,
      details.pin.iterations,
      new Date().toISOString(),
    ]
  );
  return id;
}

/** Removes the user and everything they recorded. */
/**
 * 그 사람의 것을 전부 지웁니다.
 *
 * **`services/userTransfer.PER_USER_TABLES` 와 같은 목록이어야 합니다.** 한쪽에만
 * 테이블을 더하면 지울 때는 남고 옮길 때는 빠지는 식으로 갈립니다(§5·§4.10).
 */
export function deleteUser(id: string): void {
  runBatch([
    { sql: "DELETE FROM transactions WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM accounts WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM budgets WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM budget_configs WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM ai_analyses WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM category_rules WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM custom_categories WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM budget_policy WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM sms_inbox WHERE user_id = ?", params: [id] },
    /*
      되돌리기 임시 저장소도 함께 비웁니다(§4.9).

      오래 빠져 있었습니다. 남겨 두면 **그 id 를 다시 쓰는 사람에게** 이전
      사람의 행 사본이 딸려 갑니다 — 되돌리기는 역연산이 아니라 담아 둔 행을
      그대로 다시 쓰는 방식이라(§4.9), 누르는 순간 지워진 사람의 거래가 새
      가계부에 되살아납니다. 사용자를 갈아 끼우는 길이 생기면서(§4.10) 그 창이
      실제로 열렸습니다.
    */
    { sql: "DELETE FROM undo_log WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM users WHERE id = ?", params: [id] },
  ]);
}

export function updateProfile(id: string, details: { name: string; phone: string }): void {
  run("UPDATE users SET name = ?, phone = ? WHERE id = ?", [
    details.name.trim(),
    details.phone.trim(),
    id,
  ]);
}

export function readStoredPin(id: string): StoredPin | null {
  const row = queryOne<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  if (!row || !row.pin_hash || !row.pin_salt || !row.pin_iterations) return null;
  return {
    hash: row.pin_hash,
    salt: row.pin_salt,
    iterations: row.pin_iterations,
  };
}

export function savePinHash(id: string, pin: StoredPin): void {
  run(
    "UPDATE users SET pin = NULL, pin_hash = ?, pin_salt = ?, pin_iterations = ? WHERE id = ?",
    [pin.hash, pin.salt, pin.iterations, id]
  );
}

/** Records a successful sign-in, shown back to the user as "최근 로그인". */
export function touchLastUnlock(id: string): void {
  run("UPDATE users SET authenticated_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
}

/** True when a name is already taken, so two entries cannot be confused. */
export function isNameTaken(name: string, exceptId?: string): boolean {
  const row = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM users
     WHERE TRIM(LOWER(name)) = TRIM(LOWER(?)) AND id != ?`,
    [name, exceptId ?? ""]
  );
  return Boolean(row && row.count > 0);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export function listAccounts(): ConnectedAccount[] {
  const rows = queryAll<any>(
    `SELECT id, name, type, institution, identifier,
            balance_or_billed as balanceOrBilled, color,
            balance_as_of as balanceAsOf, balance_source as balanceSource,
            payment_account_id as paymentAccountId,
            payment_account_label as paymentAccountLabel,
            is_auto_sync_enabled as isAutoSyncEnabled,
            last_synced_at as lastSyncedAt, created_at as createdAt
     FROM accounts
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [requireUser()]
  );
  return rows.map((row) => ({
    ...row,
    isAutoSyncEnabled: Boolean(row.isAutoSyncEnabled),
    lastSyncedAt: row.lastSyncedAt || "",
    // An untagged balance predates the change that started recording this
    balanceAsOf: row.balanceAsOf || row.createdAt || new Date().toISOString(),
    balanceSource: (row.balanceSource as ValueSource) || "USER",
    paymentAccountId: row.paymentAccountId || undefined,
    paymentAccountLabel: row.paymentAccountLabel || undefined,
  }));
}

export function insertAccount(account: ConnectedAccount): void {
  run(
    `INSERT INTO accounts (id, user_id, name, type, institution, identifier, balance_or_billed,
       balance_as_of, balance_source, payment_account_id, payment_account_label,
       color, is_auto_sync_enabled, last_synced_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account.id,
      requireUser(),
      account.name,
      account.type,
      account.institution,
      account.identifier,
      Number(account.balanceOrBilled || 0),
      account.balanceAsOf || new Date().toISOString(),
      account.balanceSource || "USER",
      account.paymentAccountId || null,
      account.paymentAccountLabel || null,
      account.color || "#334155",
      account.isAutoSyncEnabled ? 1 : 0,
      account.lastSyncedAt || "",
      new Date().toISOString(),
    ]
  );
}

/** Records a balance the user typed in, with the moment it is true as of. */
export function updateAccountBalance(
  id: string,
  balance: number,
  asOf: string,
  source: ValueSource = "USER"
): void {
  run(
    `UPDATE accounts SET balance_or_billed = ?, balance_as_of = ?, balance_source = ?
     WHERE id = ? AND user_id = ?`,
    [Number(balance || 0), asOf, source, id, requireUser()]
  );
}

/** The details the user typed in when registering, corrected after the fact. */
export function updateAccountDetails(
  id: string,
  details: {
    name: string;
    institution: string;
    identifier: string;
    type: ConnectedAccount["type"];
    paymentAccountId?: string;
    paymentAccountLabel?: string;
  }
): void {
  run(
    `UPDATE accounts SET name = ?, institution = ?, identifier = ?, type = ?,
       payment_account_id = ?, payment_account_label = ?
     WHERE id = ? AND user_id = ?`,
    [
      details.name.trim(),
      details.institution.trim(),
      details.identifier.trim(),
      details.type,
      details.paymentAccountId || null,
      details.paymentAccountLabel?.trim() || null,
      id,
      requireUser(),
    ]
  );
}

/**
 * 계좌·카드와 **그것에 매인 모든 것**을 지웁니다.
 *
 * 예전에는 `accounts` 한 줄만 지웠습니다. 그 계좌의 내역은 그대로 남아 —
 * 실제 기기에서 KB국민카드 501건, KB국민은행 469건 — **계속 합계에 잡히는데
 * 화면에서는 열 수 없었습니다.** 확인 문구는 `연동을 해제하고 삭제`라고
 * 말했지만 둘 다 아니었습니다: 자료는 남아 세어지고 손댈 수 없었습니다.
 *
 * 함께 지우는 것:
 * - 그 계좌의 거래 내역
 * - 그 계좌에 매인 카테고리 규칙(§6.4 — 계좌별로 걸립니다)
 * - 다른 계좌의 카드대금이 이 카드를 가리키던 연결(`linked_account_id`)
 * - 이 계좌를 결제 계좌로 지정한 카드의 지정(`payment_account_id`)
 *
 * 한 배치이므로 **전부 아니면 전무**입니다(§4.8). 지우기 전의 상태는 부르는
 * 쪽이 `undo` 에 담습니다(§4.9).
 */
export function deleteAccount(id: string): void {
  const userId = requireUser();
  runBatch([
    { sql: "DELETE FROM transactions WHERE account_id = ? AND user_id = ?", params: [id, userId] },
    { sql: "DELETE FROM category_rules WHERE account_id = ? AND user_id = ?", params: [id, userId] },
    {
      /* 이 카드를 가리키던 카드대금 출금은 연결만 풉니다 — 출금 자체는 남습니다 */
      sql: `UPDATE transactions SET linked_account_id = NULL, billing_month = NULL
            WHERE linked_account_id = ? AND user_id = ?`,
      params: [id, userId],
    },
    {
      /* 이 계좌를 결제 계좌로 쓰던 카드의 지정을 비웁니다 */
      sql: `UPDATE accounts SET payment_account_id = NULL, payment_account_label = NULL
            WHERE payment_account_id = ? AND user_id = ?`,
      params: [id, userId],
    },
    { sql: "DELETE FROM accounts WHERE id = ? AND user_id = ?", params: [id, userId] },
  ]);
}

/** 그 계좌를 지우면 함께 사라지는 것 — 확인 화면이 건수로 말할 수 있게. */
export function accountFootprint(id: string): {
  entries: number;
  rules: number;
  linkedBills: number;
  cardsPaidFrom: number;
} {
  const userId = requireUser();
  const count = (sql: string, params: any[]) =>
    Number(queryOne<{ n: number }>(sql, params)?.n || 0);

  return {
    entries: count(
      "SELECT COUNT(*) n FROM transactions WHERE account_id = ? AND user_id = ?",
      [id, userId]
    ),
    rules: count(
      "SELECT COUNT(*) n FROM category_rules WHERE account_id = ? AND user_id = ?",
      [id, userId]
    ),
    linkedBills: count(
      "SELECT COUNT(*) n FROM transactions WHERE linked_account_id = ? AND user_id = ?",
      [id, userId]
    ),
    cardsPaidFrom: count(
      "SELECT COUNT(*) n FROM accounts WHERE payment_account_id = ? AND user_id = ?",
      [id, userId]
    ),
  };
}

export function touchAccountSync(): string {
  const label = new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  run("UPDATE accounts SET last_synced_at = ? WHERE user_id = ?", [label, requireUser()]);
  return label;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export function listTransactions(month?: string): Transaction[] {
  const params: any[] = [requireUser()];
  let sql = `
    SELECT id, date, time, type,
           expense_type as expenseType, category, merchant, amount,
           payment_method as paymentMethod, account_id as accountId, memo, note, origin,
           is_fixed_recurring as isFixedRecurring, recurring_day as recurringDay,
           linked_account_id as linkedAccountId, billing_month as billingMonth,
           created_at as createdAt
    FROM transactions
    WHERE user_id = ?
  `;
  if (month) {
    sql += " AND date LIKE ?";
    params.push(`${month}%`);
  }
  sql += " ORDER BY date DESC, time DESC";

  return queryAll<any>(sql, params).map((row) => ({
    ...row,
    isFixedRecurring: Boolean(row.isFixedRecurring),
    recurringDay: row.recurringDay || undefined,
    linkedAccountId: row.linkedAccountId || undefined,
    billingMonth: row.billingMonth || undefined,
    note: row.note || undefined,
    origin: row.origin || undefined,
  }));
}

function insertStatement(tx: Transaction, userId: string) {
  return {
    sql: `INSERT INTO transactions
            (id, user_id, date, time, type, expense_type, category, merchant, amount, payment_method, account_id, memo, note, origin, is_fixed_recurring, recurring_day, linked_account_id, billing_month, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      tx.id,
      userId,
      tx.date,
      tx.time || "12:00",
      tx.type,
      tx.expenseType,
      tx.category,
      tx.merchant,
      Number(tx.amount || 0),
      tx.paymentMethod || "카드결제",
      tx.accountId || "",
      tx.memo || "",
      tx.note || null,
      tx.origin || "MANUAL",
      tx.isFixedRecurring ? 1 : 0,
      tx.recurringDay ?? null,
      tx.linkedAccountId || null,
      tx.billingMonth || null,
      new Date().toISOString(),
    ],
  };
}

/**
 * Whether an entry should move the balance at all.
 *
 * A balance is recorded as of a moment. Anything that happened before that
 * moment is already inside the figure, so replaying it would count it twice —
 * only what happened afterwards moves it.
 */
function postDatesBalance(tx: Transaction, userId: string): boolean {
  const row = queryOne<{ balanceAsOf: string | null }>(
    "SELECT balance_as_of as balanceAsOf FROM accounts WHERE id = ? AND user_id = ?",
    [tx.accountId, userId]
  );
  if (!row || !row.balanceAsOf) return true;
  return movesBalance(tx, row.balanceAsOf);
}

/**
 * Spending on a card raises its billed amount; spending from a bank account
 * lowers its balance, and income raises it.
 */
function balanceStatements(tx: Transaction, userId: string) {
  if (!tx.accountId) return [];
  if (!postDatesBalance(tx, userId)) return [];
  const amount = Number(tx.amount || 0);

  if (tx.type === "EXPENSE") {
    return [
      {
        sql: `UPDATE accounts SET balance_or_billed = balance_or_billed + ?,
                balance_as_of = ?, balance_source = 'AUTO'
              WHERE id = ? AND user_id = ? AND type != 'BANK'`,
        params: [amount, new Date().toISOString(), tx.accountId, userId],
      },
      {
        sql: `UPDATE accounts SET balance_or_billed = balance_or_billed - ?,
                balance_as_of = ?, balance_source = 'AUTO'
              WHERE id = ? AND user_id = ? AND type = 'BANK'`,
        params: [amount, new Date().toISOString(), tx.accountId, userId],
      },
    ];
  }

  return [
    {
      sql: `UPDATE accounts SET balance_or_billed = balance_or_billed + ?,
              balance_as_of = ?, balance_source = 'AUTO'
            WHERE id = ? AND user_id = ? AND type = 'BANK'`,
      params: [amount, new Date().toISOString(), tx.accountId, userId],
    },
  ];
}

export function insertTransaction(tx: Transaction): void {
  const userId = requireUser();
  runBatch([insertStatement(tx, userId), ...balanceStatements(tx, userId)]);
}

export function insertTransactions(txs: Transaction[]): void {
  const userId = requireUser();
  runBatch(
    txs.flatMap((tx) => [insertStatement(tx, userId), ...balanceStatements(tx, userId)])
  );
}

export function deleteTransaction(id: string): void {
  run("DELETE FROM transactions WHERE id = ? AND user_id = ?", [id, requireUser()]);
}

/** Removes a whole selection under one save. */
export function deleteTransactions(ids: string[]): void {
  if (ids.length === 0) return;
  const userId = requireUser();
  runBatch(
    ids.map((id) => ({
      sql: "DELETE FROM transactions WHERE id = ? AND user_id = ?",
      params: [id, userId],
    }))
  );
}

/** Rewrites an entry in place, keeping its id. */
export function updateTransaction(tx: Transaction): void {
  run(
    `UPDATE transactions SET
       date = ?, time = ?, type = ?, expense_type = ?, category = ?, merchant = ?,
       amount = ?, payment_method = ?, account_id = ?, memo = ?, note = ?, origin = ?,
       is_fixed_recurring = ?, recurring_day = ?, linked_account_id = ?,
       billing_month = ?
     WHERE id = ? AND user_id = ?`,
    [
      tx.date,
      tx.time || "12:00",
      tx.type,
      tx.expenseType,
      tx.category,
      tx.merchant,
      Number(tx.amount || 0),
      tx.paymentMethod || "카드결제",
      tx.accountId || "",
      tx.memo || "",
      tx.note || null,
      tx.origin || "MANUAL",
      tx.isFixedRecurring ? 1 : 0,
      tx.recurringDay ?? null,
      tx.linkedAccountId || null,
      tx.billingMonth || null,
      tx.id,
      requireUser(),
    ]
  );
}

/**
 * Applies a statement import in one write.
 *
 * Unlike a manual entry this does NOT move account balances. An imported
 * statement is a record of what already happened, and the balance the user
 * entered for the account is a figure from that same statement — adjusting it
 * again per row would count everything twice.
 */
export function applyImport(inserts: Transaction[], updates: Transaction[]): void {
  const userId = requireUser();
  runBatch([
    ...inserts.map((tx) => insertStatement(tx, userId)),
    ...updates.map((tx) => ({
      sql: `UPDATE transactions SET
              date = ?, time = ?, type = ?, expense_type = ?, category = ?, merchant = ?,
              amount = ?, payment_method = ?, account_id = ?, memo = ?, note = ?, origin = ?,
              is_fixed_recurring = ?, recurring_day = ?, linked_account_id = ?,
              billing_month = ?
            WHERE id = ? AND user_id = ?`,
      params: [
        tx.date,
        tx.time || "12:00",
        tx.type,
        tx.expenseType,
        tx.category,
        tx.merchant,
        Number(tx.amount || 0),
        tx.paymentMethod || "카드결제",
        tx.accountId || "",
        tx.memo || "",
        tx.note || null,
        tx.origin || "STATEMENT",
        tx.isFixedRecurring ? 1 : 0,
        tx.recurringDay ?? null,
        tx.linkedAccountId || null,
        tx.billingMonth || null,
        tx.id,
        userId,
      ],
    })),
  ]);
}

export function toggleTransactionFixed(id: string): "FIXED" | "VARIABLE" | null {
  const userId = requireUser();
  const row = queryOne<{ expense_type: string }>(
    "SELECT expense_type FROM transactions WHERE id = ? AND user_id = ?",
    [id, userId]
  );
  if (!row) return null;

  const next = row.expense_type === "FIXED" ? "VARIABLE" : "FIXED";
  run(
    "UPDATE transactions SET expense_type = ?, is_fixed_recurring = ? WHERE id = ? AND user_id = ?",
    [next, next === "FIXED" ? 1 : 0, id, userId]
  );
  return next;
}

// ---------------------------------------------------------------------------
// Category rules
// ---------------------------------------------------------------------------

export function listCategoryRules(accountId?: string): CategoryRule[] {
  const params: any[] = [requireUser()];
  let sql = `
    SELECT id, account_id as accountId, pattern, category, source,
           updated_at as updatedAt
    FROM category_rules
    WHERE user_id = ?
  `;
  if (accountId) {
    sql += " AND account_id = ?";
    params.push(accountId);
  }
  sql += " ORDER BY source, LENGTH(pattern) DESC, updated_at DESC";

  return queryAll<CategoryRule>(sql, params);
}

/**
 * Writes a rule, replacing any existing one with the same pattern on the same
 * account. A rule the user confirms takes over one the classifier wrote; the
 * classifier never overwrites the user.
 */
export function saveCategoryRule(rule: {
  id?: string;
  accountId: string;
  pattern: string;
  category: CategoryType;
  source: RuleSource;
}): void {
  const userId = requireUser();
  const now = new Date().toISOString();
  const pattern = rule.pattern.trim();
  if (!pattern) return;

  const existing = queryOne<{ id: string; source: RuleSource }>(
    `SELECT id, source FROM category_rules
     WHERE user_id = ? AND account_id = ? AND TRIM(LOWER(pattern)) = TRIM(LOWER(?))`,
    [userId, rule.accountId, pattern]
  );

  const targetId = rule.id || existing?.id;

  if (targetId) {
    // Never let an AI-written rule downgrade one the user confirmed
    if (!rule.id && existing?.source === "USER" && rule.source === "AI") return;
    run(
      `UPDATE category_rules SET pattern = ?, category = ?, source = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [pattern, rule.category, rule.source, now, targetId, userId]
    );
    return;
  }

  run(
    `INSERT INTO category_rules (id, user_id, account_id, pattern, category, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      userId,
      rule.accountId,
      pattern,
      rule.category,
      rule.source,
      now,
      now,
    ]
  );
}

/** Records what the classifier decided, so the user can confirm it later. */
export function saveCategoryRules(
  rules: { accountId: string; pattern: string; category: CategoryType; source: RuleSource }[]
): void {
  for (const rule of rules) saveCategoryRule(rule);
}

export function deleteCategoryRule(id: string): void {
  run("DELETE FROM category_rules WHERE id = ? AND user_id = ?", [id, requireUser()]);
}

/** Promotes a classifier's rule to one the user stands behind, or back again. */
export function setCategoryRuleSource(id: string, source: RuleSource): void {
  run(
    "UPDATE category_rules SET source = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    [source, new Date().toISOString(), id, requireUser()]
  );
}

// ---------------------------------------------------------------------------
// Categories the user added themselves
// ---------------------------------------------------------------------------

/**
 * Names this user typed in, on top of the ones the app ships with. They are
 * kept per user for the same reason ledgers are: one person's categories are
 * no business of another's.
 */
export interface CustomCategory {
  name: string;
  /** 수입용인가 지출용인가 — 같은 이름이 양쪽에 있을 수 있습니다 (§6.1). */
  direction: TransactionType;
}

export function listCustomCategories(): CustomCategory[] {
  return queryAll<{ name: string; direction: string }>(
    "SELECT name, direction FROM custom_categories WHERE user_id = ? ORDER BY created_at",
    [requireUser()]
  ).map((row) => ({
    name: row.name,
    direction: row.direction === "INCOME" ? "INCOME" : "EXPENSE",
  }));
}

/**
 * 같은 이름이 이미 있으면 아무 일도 하지 않습니다 — 오류가 아닙니다.
 *
 * **방향이 다르면 다른 카테고리입니다**(§6.1). `이체` 가 양쪽에 있는 것과 같은
 * 까닭이고, 유일성도 `(사용자, 이름, 방향)` 으로 걸려 있습니다.
 */
export function addCustomCategory(
  name: string,
  direction: TransactionType = "EXPENSE",
  type: ExpenseType = "VARIABLE"
): void {
  const trimmed = (name || "").trim();
  if (!trimmed) return;

  run(
    `INSERT OR IGNORE INTO custom_categories (id, user_id, name, type, direction, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      `cc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      requireUser(),
      trimmed,
      type,
      direction,
      new Date().toISOString(),
    ]
  );
}

export function deleteCustomCategory(name: string, direction?: TransactionType): void {
  if (direction) {
    run(
      "DELETE FROM custom_categories WHERE user_id = ? AND name = ? AND direction = ?",
      [requireUser(), (name || "").trim(), direction]
    );
    return;
  }
  run("DELETE FROM custom_categories WHERE user_id = ? AND name = ?", [
    requireUser(),
    (name || "").trim(),
  ]);
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export function getBudgetConfig(month: string): MonthlyBudgetConfig {
  const userId = requireUser();
  const configRow = queryOne<any>(
    "SELECT * FROM budget_configs WHERE user_id = ? AND month = ?",
    [userId, month]
  );
  const budgetRows = queryAll<{ category: string; amount: number }>(
    "SELECT category, amount FROM budgets WHERE user_id = ? AND month = ?",
    [userId, month]
  );

  const categoryBudgets: Record<string, number> = {};
  for (const row of budgetRows) {
    categoryBudgets[row.category] = row.amount;
  }

  if (!configRow) {
    // A month the user has not configured yet starts at zero, not at a demo figure.
    return {
      month,
      monthlyIncome: 0,
      fixedExpenses: 0,
      savingsTarget: 0,
      alertThresholdPercent: 80,
      enablePushAlerts: true,
      categoryBudgets,
      incomeSource: "USER",
      fixedSource: "USER",
      savingsSource: "USER",
      incomeExcluded: [],
      fixedExcluded: [],
      savingsExcluded: [],
    };
  }

  return {
    month: configRow.month,
    monthlyIncome: configRow.monthly_income,
    fixedExpenses: configRow.fixed_expenses,
    savingsTarget: configRow.savings_target,
    alertThresholdPercent: configRow.alert_threshold_percent,
    enablePushAlerts: Boolean(configRow.enable_push_alerts),
    categoryBudgets,
    incomeSource: configRow.income_source === "ACTUALS" ? "ACTUALS" : "USER",
    fixedSource: configRow.fixed_source === "ACTUALS" ? "ACTUALS" : "USER",
    savingsSource: configRow.savings_source === "ACTUALS" ? "ACTUALS" : "USER",
    incomeExcluded: readIdList(configRow.income_excluded),
    fixedExcluded: readIdList(configRow.fixed_excluded),
    savingsExcluded: readIdList(configRow.savings_excluded),
  };
}

/**
 * 제외 목록을 읽습니다 — 깨진 값은 빈 목록으로.
 *
 * 이 칸이 비거나 옛 기기에서 없을 수 있고(v16 이전), 그때 예외를 던지면 예산
 * 화면 전체가 열리지 않습니다. 제외 목록을 잃는 것이 화면을 잃는 것보다 낫습니다.
 */
function readIdList(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 예산 기준 — 달에 매이지 않는 한 행.
 *
 * 카테고리별 한도를 매달 다시 적지 않으려고 두는 것이라, 사용자당 하나이고
 * 어느 달에든 적용됩니다.
 */
/**
 * 공유·붙여넣은 문자를 쌓아 두는 대기함.
 *
 * 확인 전의 추정을 `transactions` 에 섞으면 합계가 흔들리므로 따로 둡니다.
 * 사용자가 고르고 등록한 뒤에야 거래가 됩니다.
 */
export interface SmsInboxRow {
  id: string;
  receivedAt: string;
  rawText: string;
  /** `services/smsParse.ts` 가 읽어 낸 것. 화면에서 고칠 수 있습니다. */
  parsed: Record<string, unknown>;
  status: "PENDING" | "REGISTERED" | "DISMISSED";
}

export function listSmsInbox(status?: SmsInboxRow["status"]): SmsInboxRow[] {
  const params: any[] = [requireUser()];
  let sql = `SELECT id, received_at, raw_text, parsed_json, status
             FROM sms_inbox WHERE user_id = ?`;
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY received_at DESC";

  return queryAll<any>(sql, params).map((row) => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(row.parsed_json || "{}");
    } catch {
      // 깨진 JSON 은 빈 것으로 봅니다 — 원문이 남아 있어 다시 읽을 수 있습니다
    }
    return {
      id: row.id,
      receivedAt: row.received_at,
      rawText: row.raw_text,
      parsed,
      status: row.status,
    };
  });
}

/** 같은 문자를 두 번 공유해도 한 줄만 남도록 원문으로 확인합니다. */
export function smsInboxHasRaw(rawText: string): boolean {
  const row = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM sms_inbox WHERE user_id = ? AND raw_text = ?",
    [requireUser(), rawText]
  );
  return Boolean(row && row.count > 0);
}

export function addSmsInbox(
  rows: { id: string; receivedAt: string; rawText: string; parsed: unknown }[]
): void {
  if (rows.length === 0) return;
  const userId = requireUser();
  const now = new Date().toISOString();

  runBatch(
    rows.map((row) => ({
      sql: `INSERT OR REPLACE INTO sms_inbox
              (id, user_id, received_at, raw_text, parsed_json, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      params: [row.id, userId, row.receivedAt, row.rawText, JSON.stringify(row.parsed), now],
    }))
  );
}

export function setSmsInboxStatus(ids: string[], status: SmsInboxRow["status"]): void {
  if (ids.length === 0) return;
  const userId = requireUser();
  runBatch(
    ids.map((id) => ({
      sql: "UPDATE sms_inbox SET status = ? WHERE id = ? AND user_id = ?",
      params: [status, id, userId],
    }))
  );
}

export function updateSmsInboxParsed(id: string, parsed: unknown): void {
  run("UPDATE sms_inbox SET parsed_json = ? WHERE id = ? AND user_id = ?", [
    JSON.stringify(parsed),
    id,
    requireUser(),
  ]);
}

export function deleteSmsInbox(ids: string[]): void {
  if (ids.length === 0) return;
  const userId = requireUser();
  runBatch(
    ids.map((id) => ({
      sql: "DELETE FROM sms_inbox WHERE id = ? AND user_id = ?",
      params: [id, userId],
    }))
  );
}

export function getBudgetPolicy(): BudgetPolicy {
  const row = queryOne<{ mode: string; rules_json: string }>(
    "SELECT mode, rules_json FROM budget_policy WHERE user_id = ?",
    [requireUser()]
  );
  if (!row) return emptyPolicy();

  const mode: BudgetPolicyMode =
    row.mode === "INCOME_RATIO" || row.mode === "SPARE_RATIO" ? row.mode : "AMOUNT";

  try {
    const parsed = JSON.parse(row.rules_json || "{}") as Record<string, unknown>;
    const rules: Record<string, number> = {};
    for (const [category, value] of Object.entries(parsed)) {
      const amount = Number(value);
      if (Number.isFinite(amount) && amount > 0) rules[category] = amount;
    }
    return { mode, rules };
  } catch {
    // 저장된 JSON 이 깨졌다면 기준이 없는 것으로 봅니다 — 엉뚱한 예산을 배분하지 않습니다
    console.error("예산 기준을 읽지 못했습니다. 비어 있는 것으로 봅니다.");
    return { mode, rules: {} };
  }
}

export function saveBudgetPolicy(policy: BudgetPolicy): void {
  run(
    `INSERT OR REPLACE INTO budget_policy (user_id, mode, rules_json, updated_at)
     VALUES (?, ?, ?, ?)`,
    [requireUser(), policy.mode, JSON.stringify(policy.rules || {}), new Date().toISOString()]
  );
}

export function saveBudgetConfig(config: MonthlyBudgetConfig): void {
  const userId = requireUser();
  runBatch([
    {
      sql: `INSERT OR REPLACE INTO budget_configs
              (user_id, month, monthly_income, fixed_expenses, savings_target, alert_threshold_percent, enable_push_alerts, income_source, fixed_source, savings_source, income_excluded, fixed_excluded, savings_excluded, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        userId,
        config.month,
        Number(config.monthlyIncome || 0),
        Number(config.fixedExpenses || 0),
        Number(config.savingsTarget || 0),
        Number(config.alertThresholdPercent || 80),
        config.enablePushAlerts ? 1 : 0,
        config.incomeSource === "ACTUALS" ? "ACTUALS" : "USER",
        config.fixedSource === "ACTUALS" ? "ACTUALS" : "USER",
        config.savingsSource === "ACTUALS" ? "ACTUALS" : "USER",
        JSON.stringify(config.incomeExcluded || []),
        JSON.stringify(config.fixedExcluded || []),
        JSON.stringify(config.savingsExcluded || []),
        new Date().toISOString(),
      ],
    },
    ...Object.entries(config.categoryBudgets || {}).map(([category, amount]) => ({
      sql: "INSERT OR REPLACE INTO budgets (user_id, month, category, amount) VALUES (?, ?, ?, ?)",
      params: [userId, config.month, category, Number(amount || 0)],
    })),
  ]);
}

// ---------------------------------------------------------------------------
// 되돌리기 임시 저장소 (§4.9)
// ---------------------------------------------------------------------------

/**
 * 바꾸기 전의 상태를 담아 둡니다.
 *
 * 담는 것은 **행의 사본**이고 역연산이 아닙니다 — 계산이 없으므로 되돌리기가
 * 새 손상이 될 여지가 없습니다(`services/undo.ts`).
 */
export function pushUndo(entry: {
  id: string;
  kind: string;
  label: string;
  payload: unknown;
}): void {
  run(
    `INSERT OR REPLACE INTO undo_log (id, user_id, kind, label, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      requireUser(),
      entry.kind,
      entry.label,
      JSON.stringify(entry.payload ?? {}),
      new Date().toISOString(),
    ]
  );
}

export function listUndo(): {
  id: string;
  kind: string;
  label: string;
  payload: any;
  createdAt: string;
}[] {
  return queryAll<any>(
    `SELECT id, kind, label, payload_json, created_at FROM undo_log
      WHERE user_id = ? ORDER BY created_at DESC`,
    [requireUser()]
  ).map((row) => {
    let payload: any = {};
    try {
      payload = JSON.parse(row.payload_json || "{}");
    } catch {
      /* 깨진 것은 빈 것으로 — 되돌릴 수 없다고 화면이 말합니다(`canUndo`) */
    }
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      payload,
      createdAt: row.created_at,
    };
  });
}

export function deleteUndo(ids: string[]): void {
  if (ids.length === 0) return;
  const userId = requireUser();
  runBatch(
    ids.map((id) => ({
      sql: "DELETE FROM undo_log WHERE id = ? AND user_id = ?",
      params: [id, userId],
    }))
  );
}

/**
 * 되돌리기 — 담아 둔 행을 그대로 되돌려 놓고 그 기록을 지웁니다.
 *
 * **한 배치입니다.** 절반만 복원되면 되돌리기가 손상이 됩니다(§4.8).
 */
export function applyUndo(entry: {
  id: string;
  kind: string;
  payload: {
    entries?: Transaction[];
    account?: ConnectedAccount;
    rules?: CategoryRule[];
    before?: Transaction[];
    budgets?: { month: string; categoryBudgets: Record<string, number> };
  };
}): void {
  const userId = requireUser();
  const statements: { sql: string; params?: any[] }[] = [];

  if (entry.payload.account) {
    const account = entry.payload.account;
    statements.push({
      sql: `INSERT OR REPLACE INTO accounts
              (id, user_id, name, type, institution, identifier, balance_or_billed,
               balance_as_of, balance_source, payment_account_id, payment_account_label,
               color, is_auto_sync_enabled, last_synced_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        account.id,
        userId,
        account.name,
        account.type,
        account.institution,
        account.identifier,
        Number(account.balanceOrBilled || 0),
        account.balanceAsOf || null,
        account.balanceSource || "USER",
        account.paymentAccountId || null,
        account.paymentAccountLabel || null,
        account.color || "",
        account.isAutoSyncEnabled ? 1 : 0,
        account.lastSyncedAt || null,
        new Date().toISOString(),
      ],
    });
  }

  /* 지운 거래를 그대로 되돌립니다 — 같은 id 로 넣으므로 중복이 생기지 않습니다 */
  for (const tx of entry.payload.entries || []) {
    statements.push(insertStatement(tx, userId));
  }

  for (const rule of entry.payload.rules || []) {
    statements.push({
      sql: `INSERT OR REPLACE INTO category_rules
              (id, user_id, account_id, pattern, category, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        rule.id,
        userId,
        rule.accountId,
        rule.pattern,
        rule.category,
        rule.source,
        /* 규칙 타입에는 생성 시각이 없습니다 — 되살릴 때 수정 시각을 함께 씁니다 */
        rule.updatedAt,
        rule.updatedAt,
      ],
    });
  }

  /* 분류를 바꾸기 전 모습으로 — 행 전체를 다시 쓰지 않고 바뀐 칸만 되돌립니다 */
  for (const tx of entry.payload.before || []) {
    statements.push({
      sql: `UPDATE transactions
              SET category = ?, expense_type = ?, is_fixed_recurring = ?, recurring_day = ?
            WHERE id = ? AND user_id = ?`,
      params: [
        tx.category,
        tx.expenseType,
        tx.isFixedRecurring ? 1 : 0,
        tx.recurringDay ?? null,
        tx.id,
        userId,
      ],
    });
  }

  if (entry.payload.budgets) {
    const { month, categoryBudgets } = entry.payload.budgets;
    /*
      그 달의 한도를 **비우고** 담아 둔 것으로 채웁니다. 덮어쓰기만 하면
      자동 배분이 새로 만든 칸이 남습니다.
    */
    statements.push({
      sql: "DELETE FROM budgets WHERE user_id = ? AND month = ?",
      params: [userId, month],
    });
    for (const [category, amount] of Object.entries(categoryBudgets || {})) {
      statements.push({
        sql: "INSERT OR REPLACE INTO budgets (user_id, month, category, amount) VALUES (?, ?, ?, ?)",
        params: [userId, month, category, Number(amount || 0)],
      });
    }
  }

  statements.push({
    sql: "DELETE FROM undo_log WHERE id = ? AND user_id = ?",
    params: [entry.id, userId],
  });

  runBatch(statements);
}

// ---------------------------------------------------------------------------
// AI analysis cache
// ---------------------------------------------------------------------------

export function getAnalysis(month: string): AISpendingAnalysis | null {
  const row = queryOne<{ analysis_json: string; updated_at: string }>(
    "SELECT analysis_json, updated_at FROM ai_analyses WHERE user_id = ? AND month = ?",
    [requireUser(), month]
  );
  if (!row) return null;
  try {
    const analysis = JSON.parse(row.analysis_json) as AISpendingAnalysis;
    /*
      옛 분석에는 견줄 수 있는 시각이 없습니다. 행의 `updated_at` 이 그 값을
      대신하므로 읽을 때 채워 넣습니다 — 그러면 다음 저장 때 JSON 안으로
      들어가 스스로 나아집니다. 이미 있는 값은 건드리지 않습니다.
    */
    return analysis.analyzedAtIso
      ? analysis
      : { ...analysis, analyzedAtIso: row.updated_at };
  } catch {
    return null;
  }
}

export function saveAnalysis(month: string, analysis: AISpendingAnalysis): void {
  run(
    `INSERT OR REPLACE INTO ai_analyses (user_id, month, analysis_json, health_score, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      requireUser(),
      month,
      JSON.stringify(analysis),
      analysis.healthScore || 0,
      new Date().toISOString(),
    ]
  );
}

export function deleteAnalysis(month: string): void {
  run("DELETE FROM ai_analyses WHERE user_id = ? AND month = ?", [requireUser(), month]);
}

// ---------------------------------------------------------------------------
// Maintenance, scoped to the signed-in user
// ---------------------------------------------------------------------------

/** Wipes the signed-in user's ledger, leaving other users untouched. */
export async function clearUserData(): Promise<void> {
  const userId = requireUser();
  runBatch([
    { sql: "DELETE FROM transactions WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM accounts WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM budgets WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM budget_configs WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM ai_analyses WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM category_rules WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM custom_categories WHERE user_id = ?", params: [userId] },
  ]);
  await persist();
}

export function countUserRows(): { accounts: number; transactions: number } {
  const userId = requireUser();
  const accounts = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM accounts WHERE user_id = ?",
    [userId]
  );
  const transactions = queryOne<{ count: number }>(
    "SELECT COUNT(*) as count FROM transactions WHERE user_id = ?",
    [userId]
  );
  return {
    accounts: accounts?.count ?? 0,
    transactions: transactions?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Sample dataset (explicit user action only)
// ---------------------------------------------------------------------------

export async function installSampleData(): Promise<void> {
  const userId = requireUser();
  const syncLabel = new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

  // Prefixed so two users installing the sample data do not collide on ids
  const localId = (id: string) => `${userId}:${id}`;

  const statements = [
    ...SAMPLE_ACCOUNTS.map((account) => ({
      sql: `INSERT OR REPLACE INTO accounts (id, user_id, name, type, institution, identifier, balance_or_billed, color, is_auto_sync_enabled, last_synced_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      params: [
        localId(account.id),
        userId,
        account.name,
        account.type,
        account.institution,
        account.identifier,
        account.balanceOrBilled,
        account.color,
        syncLabel,
        new Date().toISOString(),
      ],
    })),
    ...SAMPLE_TRANSACTIONS.map((tx) =>
      insertStatement(
        {
          ...(tx as unknown as Transaction),
          id: localId(tx.id),
          accountId: tx.accountId ? localId(tx.accountId) : "",
        },
        userId
      )
    ),
    {
      sql: `INSERT OR REPLACE INTO budget_configs
              (user_id, month, monthly_income, fixed_expenses, savings_target, alert_threshold_percent, enable_push_alerts, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        userId,
        SAMPLE_BUDGET_MONTH,
        SAMPLE_BUDGET_CONFIG.monthlyIncome,
        SAMPLE_BUDGET_CONFIG.fixedExpenses,
        SAMPLE_BUDGET_CONFIG.savingsTarget,
        SAMPLE_BUDGET_CONFIG.alertThresholdPercent,
        SAMPLE_BUDGET_CONFIG.enablePushAlerts ? 1 : 0,
        new Date().toISOString(),
      ],
    },
    ...Object.entries(SAMPLE_BUDGET_CONFIG.categoryBudgets).map(([category, amount]) => ({
      sql: "INSERT OR REPLACE INTO budgets (user_id, month, category, amount) VALUES (?, ?, ?, ?)",
      params: [userId, SAMPLE_BUDGET_MONTH, category, amount],
    })),
  ];

  runBatch(statements);
  await persist();
}

/* -------------------------------------------------------------------------
   사용자 한 명을 통째로 옮기기 (§4.10)
   ------------------------------------------------------------------------- */

/**
 * 그 사람의 행을 테이블째 꺼냅니다.
 *
 * **열 이름을 손으로 적지 않습니다.** `SELECT *` 로 읽어 그대로 담습니다 —
 * 컬럼은 마이그레이션마다 늘고(§4.3), 손으로 적어 두면 새 컬럼이 생길 때마다
 * 여기가 조용히 낡습니다. 그 사고는 이미 겪었습니다(§7.4의 기억된 형식).
 *
 * 테이블 이름은 고정 목록(`PER_USER_TABLES`)에서만 오므로 질의에 사용자 입력이
 * 섞이지 않습니다.
 */
export function exportUser(id: string): UserExport | null {
  const user = queryOne<Record<string, unknown>>("SELECT * FROM users WHERE id = ?", [id]);
  if (!user) return null;

  /*
    **없는 테이블은 건너뜁니다.** 기기의 DB 는 열 때 사다리를 타고 자가 복구까지
    거치므로(§4.1·§4.2) 보통은 전부 있습니다. 그래도 하나가 비었다고 내보내기
    자체가 실패하면, 사용자는 **아무것도 옮기지 못한 채** 막힙니다 — 나머지를
    담아 주는 편이 낫습니다. 실제로 v11 백업에는 `budget_policy` 가 없습니다
    (v12에 생겼습니다).
  */
  const present = new Set(
    queryAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).map((row) => row.name)
  );

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of PER_USER_TABLES) {
    tables[table] = present.has(table)
      ? queryAll<Record<string, unknown>>(`SELECT * FROM ${table} WHERE user_id = ?`, [id])
      : [];
  }

  return {
    format: USER_FILE_FORMAT,
    version: USER_FILE_VERSION,
    schemaVersion: currentSchemaVersion(),
    exportedAt: new Date().toISOString(),
    user,
    tables,
  };
}

/** 확인 창이 "무엇이 지워지는가"를 건수로 말하기 위한 값입니다(§12.8). */
export function userFootprint(id: string): { accounts: number; transactions: number } {
  const count = (table: string) =>
    queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [id])?.n || 0;
  return { accounts: count("accounts"), transactions: count("transactions") };
}

/** 행 하나를 그 테이블에 넣는 문장. 열은 행이 가진 것만 씁니다. */
function insertFor(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  return {
    sql: `INSERT OR REPLACE INTO ${table} (${columns.join(", ")})
          VALUES (${columns.map(() => "?").join(", ")})`,
    params: columns.map((column) => row[column] as never),
  };
}

/**
 * 그 사람을 파일의 사람으로 갈아 끼웁니다 (§4.10).
 *
 * **한 배치입니다**(§4.8). 반쯤 적용되면 주인 없는 데이터나 데이터 없는 주인이
 * 남고, 그것은 되돌릴 방법이 없는 손상입니다.
 *
 * 순서가 중요합니다 — **먼저 지우고 나서 넣습니다.** 같은 id 를 다시 쓰는
 * 경우가 보통이라(기기를 옮기거나 되돌리는 일), 지우지 않고 넣으면 옛 행과 새
 * 행이 섞입니다. `deleteUser` 가 `undo_log` 까지 비우므로(§4.9) 이전 사람의
 * 행 사본이 새 사람에게 딸려 가지 않습니다.
 *
 * **검증을 걸지 않습니다**(§17.7의 예외). 복원은 "파일이 진실"이라는 약속이고,
 * 여기서 줄을 걸러 내면 파일에 있는 것이 조용히 들어오지 않습니다. 대신 들인
 * 뒤에 데이터 점검(`integrity.inspect`)으로 무엇이 이상한지 **보고**합니다.
 */
export function replaceUser(file: UserExport): { tables: number; rows: number } {
  const id = String(file.user.id);

  const statements: { sql: string; params?: unknown[] }[] = [
    { sql: "DELETE FROM transactions WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM accounts WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM budgets WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM budget_configs WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM ai_analyses WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM category_rules WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM custom_categories WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM budget_policy WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM sms_inbox WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM undo_log WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM users WHERE id = ?", params: [id] },
    insertFor("users", file.user),
  ];

  let rows = 1;
  let tables = 1;
  for (const table of PER_USER_TABLES) {
    const list = file.tables[table] || [];
    if (list.length > 0) tables += 1;
    for (const row of list) {
      statements.push(insertFor(table, row));
      rows += 1;
    }
  }

  runBatch(statements as { sql: string; params?: any[] }[]);
  return { tables, rows };
}

/**
 * 옛 버전에서 만든 파일을 지금 구조로 끌어올립니다 (§4.10).
 *
 * 전체 백업(`.db`)은 `PRAGMA user_version` 을 달고 다녀 열 때 사다리가 알아서
 * 따라잡습니다(§4.1). 사용자 파일은 그 장치가 없으므로 **여기서 같은 사다리를
 * 태웁니다**:
 *
 * 1. 빈 메모리 DB 를 만들어 **파일의 버전까지만** 마이그레이션합니다.
 * 2. 그 구조에 파일의 행을 넣습니다 — 만들어질 당시의 모양과 맞습니다.
 * 3. `migrate()` 로 현재 버전까지 끌어올립니다. 컬럼 추가뿐 아니라 **값을 옮기는
 *    마이그레이션**(v6·v7의 카테고리 분리, v14의 저축, v18의 방향별 분리)이
 *    그대로 적용됩니다.
 * 4. 도로 꺼냅니다.
 *
 * **변환을 따로 만들지 않는 것이 요점입니다.** 옮기기 전용 규칙을 쓰면 §4.3 의
 * 사다리와 어긋나는 날이 오고, 그러면 같은 데이터가 경로에 따라 다르게
 * 분류됩니다(§17.6).
 */
export async function alignUserFile(file: UserExport): Promise<UserExport> {
  const now = currentSchemaVersion();
  if (file.schemaVersion >= now) return file;

  const scratch = await createScratchDatabase();
  try {
    for (const migration of MIGRATIONS) {
      if (migration.version > file.schemaVersion) break;
      migration.up(scratch);
    }
    scratch.run(`PRAGMA user_version = ${file.schemaVersion}`);

    const put = (table: string, row: Record<string, unknown>) => {
      const columns = Object.keys(row);
      scratch.run(
        `INSERT OR REPLACE INTO ${table} (${columns.join(", ")})
         VALUES (${columns.map(() => "?").join(", ")})`,
        columns.map((column) => row[column] as never)
      );
    };

    put("users", file.user);
    for (const table of PER_USER_TABLES) {
      for (const row of file.tables[table] || []) put(table, row);
    }

    /* 자가 복구까지 함께 — 옛 기기에 없던 테이블·컬럼이 여기서 채워집니다(§4.2) */
    migrate(scratch);
    repairMissingTables(scratch);
    repairMissingColumns(scratch);

    const read = (sql: string, params: unknown[]) => {
      const out: Record<string, unknown>[] = [];
      const statement = scratch.prepare(sql);
      statement.bind(params as never);
      while (statement.step()) out.push(statement.getAsObject() as Record<string, unknown>);
      statement.free();
      return out;
    };

    const id = String(file.user.id);
    const user = read("SELECT * FROM users WHERE id = ?", [id])[0];
    if (!user) throw new Error("사용자 정보를 옮기지 못했습니다.");

    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const table of PER_USER_TABLES) {
      tables[table] = read(`SELECT * FROM ${table} WHERE user_id = ?`, [id]);
    }

    return { ...file, schemaVersion: now, user, tables };
  } finally {
    scratch.close();
  }
}
