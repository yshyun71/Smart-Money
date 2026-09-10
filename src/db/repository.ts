import type {
  AISpendingAnalysis,
  ConnectedAccount,
  MonthlyBudgetConfig,
  Transaction,
} from "../types/finance";
import type { StoredPin } from "../services/pinCrypto";
import { persist, queryAll, queryOne, run, runBatch } from "./database";
import {
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
export function deleteUser(id: string): void {
  runBatch([
    { sql: "DELETE FROM transactions WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM accounts WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM budgets WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM budget_configs WHERE user_id = ?", params: [id] },
    { sql: "DELETE FROM ai_analyses WHERE user_id = ?", params: [id] },
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
            is_auto_sync_enabled as isAutoSyncEnabled,
            last_synced_at as lastSyncedAt
     FROM accounts
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [requireUser()]
  );
  return rows.map((row) => ({
    ...row,
    isAutoSyncEnabled: Boolean(row.isAutoSyncEnabled),
    lastSyncedAt: row.lastSyncedAt || "",
  }));
}

export function insertAccount(account: ConnectedAccount): void {
  run(
    `INSERT INTO accounts (id, user_id, name, type, institution, identifier, balance_or_billed, color, is_auto_sync_enabled, last_synced_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account.id,
      requireUser(),
      account.name,
      account.type,
      account.institution,
      account.identifier,
      Number(account.balanceOrBilled || 0),
      account.color || "#334155",
      account.isAutoSyncEnabled ? 1 : 0,
      account.lastSyncedAt || "",
      new Date().toISOString(),
    ]
  );
}

export function deleteAccount(id: string): void {
  run("DELETE FROM accounts WHERE id = ? AND user_id = ?", [id, requireUser()]);
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
           payment_method as paymentMethod, account_id as accountId, memo,
           is_fixed_recurring as isFixedRecurring, recurring_day as recurringDay
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
  }));
}

function insertStatement(tx: Transaction, userId: string) {
  return {
    sql: `INSERT INTO transactions
            (id, user_id, date, time, type, expense_type, category, merchant, amount, payment_method, account_id, memo, is_fixed_recurring, recurring_day, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      tx.isFixedRecurring ? 1 : 0,
      tx.recurringDay ?? null,
      new Date().toISOString(),
    ],
  };
}

/**
 * Spending on a card raises its billed amount; spending from a bank account
 * lowers its balance, and income raises it.
 */
function balanceStatements(tx: Transaction, userId: string) {
  if (!tx.accountId) return [];
  const amount = Number(tx.amount || 0);

  if (tx.type === "EXPENSE") {
    return [
      {
        sql: "UPDATE accounts SET balance_or_billed = balance_or_billed + ? WHERE id = ? AND user_id = ? AND type IN ('CREDIT_CARD', 'CHECK_CARD')",
        params: [amount, tx.accountId, userId],
      },
      {
        sql: "UPDATE accounts SET balance_or_billed = balance_or_billed - ? WHERE id = ? AND user_id = ? AND type = 'BANK'",
        params: [amount, tx.accountId, userId],
      },
    ];
  }

  return [
    {
      sql: "UPDATE accounts SET balance_or_billed = balance_or_billed + ? WHERE id = ? AND user_id = ? AND type = 'BANK'",
      params: [amount, tx.accountId, userId],
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

/** Rewrites an entry in place, keeping its id. */
export function updateTransaction(tx: Transaction): void {
  run(
    `UPDATE transactions SET
       date = ?, time = ?, type = ?, expense_type = ?, category = ?, merchant = ?,
       amount = ?, payment_method = ?, account_id = ?, memo = ?,
       is_fixed_recurring = ?, recurring_day = ?
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
      tx.isFixedRecurring ? 1 : 0,
      tx.recurringDay ?? null,
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
              amount = ?, payment_method = ?, account_id = ?, memo = ?,
              is_fixed_recurring = ?, recurring_day = ?
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
        tx.isFixedRecurring ? 1 : 0,
        tx.recurringDay ?? null,
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
  };
}

export function saveBudgetConfig(config: MonthlyBudgetConfig): void {
  const userId = requireUser();
  runBatch([
    {
      sql: `INSERT OR REPLACE INTO budget_configs
              (user_id, month, monthly_income, fixed_expenses, savings_target, alert_threshold_percent, enable_push_alerts, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        userId,
        config.month,
        Number(config.monthlyIncome || 0),
        Number(config.fixedExpenses || 0),
        Number(config.savingsTarget || 0),
        Number(config.alertThresholdPercent || 80),
        config.enablePushAlerts ? 1 : 0,
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
// AI analysis cache
// ---------------------------------------------------------------------------

export function getAnalysis(month: string): AISpendingAnalysis | null {
  const row = queryOne<{ analysis_json: string }>(
    "SELECT analysis_json FROM ai_analyses WHERE user_id = ? AND month = ?",
    [requireUser(), month]
  );
  if (!row) return null;
  try {
    return JSON.parse(row.analysis_json) as AISpendingAnalysis;
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
