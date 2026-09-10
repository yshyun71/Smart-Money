import type {
  AISpendingAnalysis,
  ConnectedAccount,
  MonthlyBudgetConfig,
  Transaction,
} from "../types/finance";
import type { StoredPin } from "../services/pinCrypto";
import { persist, queryAll, queryOne, run, runBatch } from "./database";
import {
  PRIMARY_USER_ID,
  SAMPLE_ACCOUNTS,
  SAMPLE_BUDGET_CONFIG,
  SAMPLE_BUDGET_MONTH,
  SAMPLE_TRANSACTIONS,
} from "./schema";

/**
 * Every read and write the UI performs, expressed against the on-device
 * database. These functions replace the REST endpoints the app used to call.
 */

// ---------------------------------------------------------------------------
// User & authentication
// ---------------------------------------------------------------------------

export interface ProfileRecord {
  id: string;
  name: string;
  phone: string;
  registeredAt: string;
  lastUnlockedAt: string | null;
  /** True once a name and a PIN both exist — the device is set up. */
  isRegistered: boolean;
  hasPin: boolean;
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

function readUserRow(): UserRow | null {
  return queryOne<UserRow>("SELECT * FROM users LIMIT 1");
}

export function getProfile(): ProfileRecord | null {
  const row = readUserRow();
  if (!row) return null;

  const hasName = Boolean(row.name && row.name.trim().length > 0);
  const hasPin = Boolean(row.pin_hash && row.pin_salt && row.pin_iterations);

  return {
    id: row.id,
    name: row.name || "",
    phone: row.phone || "",
    registeredAt: row.created_at,
    lastUnlockedAt: row.authenticated_at,
    isRegistered: hasName && hasPin,
    hasPin,
  };
}

/** First-run setup: the owner's details and their PIN, written together. */
export function registerAccount(details: {
  name: string;
  phone: string;
  pin: StoredPin;
}): void {
  const row = readUserRow();
  const statements = [
    row
      ? {
          sql: `UPDATE users SET name = ?, phone = ?, pin = NULL,
                pin_hash = ?, pin_salt = ?, pin_iterations = ? WHERE id = ?`,
          params: [
            details.name.trim(),
            details.phone.trim(),
            details.pin.hash,
            details.pin.salt,
            details.pin.iterations,
            row.id,
          ],
        }
      : {
          sql: `INSERT INTO users (id, name, email, phone, pin, pin_hash, pin_salt, pin_iterations,
                  auth_provider, provider_label, is_authenticated, is_biometric_enabled, authenticated_at, created_at)
                VALUES (?, ?, '', ?, NULL, ?, ?, ?, 'PIN', '간편 비밀번호', 0, 1, NULL, ?)`,
          params: [
            PRIMARY_USER_ID,
            details.name.trim(),
            details.phone.trim(),
            details.pin.hash,
            details.pin.salt,
            details.pin.iterations,
            new Date().toISOString(),
          ],
        },
  ];
  runBatch(statements);
}

export function updateProfile(details: { name: string; phone: string }): void {
  run("UPDATE users SET name = ?, phone = ?", [
    details.name.trim(),
    details.phone.trim(),
  ]);
}

export function readStoredPin(): StoredPin | null {
  const row = readUserRow();
  if (!row || !row.pin_hash || !row.pin_salt || !row.pin_iterations) return null;
  return {
    hash: row.pin_hash,
    salt: row.pin_salt,
    iterations: row.pin_iterations,
  };
}

export function savePinHash(pin: StoredPin): void {
  run(
    "UPDATE users SET pin = NULL, pin_hash = ?, pin_salt = ?, pin_iterations = ?",
    [pin.hash, pin.salt, pin.iterations]
  );
}

/** Records a successful unlock, shown back to the user as "최근 로그인". */
export function touchLastUnlock(): void {
  run("UPDATE users SET authenticated_at = ?", [new Date().toISOString()]);
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export function listAccounts(): ConnectedAccount[] {
  const rows = queryAll<any>(`
    SELECT id, name, type, institution, identifier,
           balance_or_billed as balanceOrBilled, color,
           is_auto_sync_enabled as isAutoSyncEnabled,
           last_synced_at as lastSyncedAt
    FROM accounts
    ORDER BY created_at DESC
  `);
  return rows.map((row) => ({
    ...row,
    isAutoSyncEnabled: Boolean(row.isAutoSyncEnabled),
    lastSyncedAt: row.lastSyncedAt || "",
  }));
}

export function insertAccount(account: ConnectedAccount): void {
  run(
    `INSERT INTO accounts (id, name, type, institution, identifier, balance_or_billed, color, is_auto_sync_enabled, last_synced_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account.id,
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
  run("DELETE FROM accounts WHERE id = ?", [id]);
}

export function touchAccountSync(): string {
  const label = new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  run("UPDATE accounts SET last_synced_at = ?", [label]);
  return label;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export function listTransactions(month?: string): Transaction[] {
  let sql = `
    SELECT id, date, time, type,
           expense_type as expenseType, category, merchant, amount,
           payment_method as paymentMethod, account_id as accountId, memo,
           is_fixed_recurring as isFixedRecurring, recurring_day as recurringDay
    FROM transactions
  `;
  const params: any[] = [];
  if (month) {
    sql += " WHERE date LIKE ?";
    params.push(`${month}%`);
  }
  sql += " ORDER BY date DESC, time DESC";

  return queryAll<any>(sql, params).map((row) => ({
    ...row,
    isFixedRecurring: Boolean(row.isFixedRecurring),
    recurringDay: row.recurringDay || undefined,
  }));
}

function insertStatement(tx: Transaction) {
  return {
    sql: `INSERT INTO transactions
            (id, date, time, type, expense_type, category, merchant, amount, payment_method, account_id, memo, is_fixed_recurring, recurring_day, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      tx.id,
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
function balanceStatements(tx: Transaction) {
  if (!tx.accountId) return [];
  const amount = Number(tx.amount || 0);

  if (tx.type === "EXPENSE") {
    return [
      {
        sql: "UPDATE accounts SET balance_or_billed = balance_or_billed + ? WHERE id = ? AND type IN ('CREDIT_CARD', 'CHECK_CARD')",
        params: [amount, tx.accountId],
      },
      {
        sql: "UPDATE accounts SET balance_or_billed = balance_or_billed - ? WHERE id = ? AND type = 'BANK'",
        params: [amount, tx.accountId],
      },
    ];
  }

  return [
    {
      sql: "UPDATE accounts SET balance_or_billed = balance_or_billed + ? WHERE id = ? AND type = 'BANK'",
      params: [amount, tx.accountId],
    },
  ];
}

export function insertTransaction(tx: Transaction): void {
  runBatch([insertStatement(tx), ...balanceStatements(tx)]);
}

export function insertTransactions(txs: Transaction[]): void {
  runBatch(txs.flatMap((tx) => [insertStatement(tx), ...balanceStatements(tx)]));
}

export function deleteTransaction(id: string): void {
  run("DELETE FROM transactions WHERE id = ?", [id]);
}

export function toggleTransactionFixed(id: string): "FIXED" | "VARIABLE" | null {
  const row = queryOne<{ expense_type: string }>(
    "SELECT expense_type FROM transactions WHERE id = ?",
    [id]
  );
  if (!row) return null;

  const next = row.expense_type === "FIXED" ? "VARIABLE" : "FIXED";
  run("UPDATE transactions SET expense_type = ?, is_fixed_recurring = ? WHERE id = ?", [
    next,
    next === "FIXED" ? 1 : 0,
    id,
  ]);
  return next;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export function getBudgetConfig(month: string): MonthlyBudgetConfig {
  const configRow = queryOne<any>("SELECT * FROM budget_configs WHERE month = ?", [month]);
  const budgetRows = queryAll<{ category: string; amount: number }>(
    "SELECT category, amount FROM budgets WHERE month = ?",
    [month]
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
  const statements = [
    {
      sql: `INSERT OR REPLACE INTO budget_configs
              (month, monthly_income, fixed_expenses, savings_target, alert_threshold_percent, enable_push_alerts, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
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
      sql: "INSERT OR REPLACE INTO budgets (month, category, amount) VALUES (?, ?, ?)",
      params: [config.month, category, Number(amount || 0)],
    })),
  ];
  runBatch(statements);
}

// ---------------------------------------------------------------------------
// AI analysis cache
// ---------------------------------------------------------------------------

export function getAnalysis(month: string): AISpendingAnalysis | null {
  const row = queryOne<{ analysis_json: string }>(
    "SELECT analysis_json FROM ai_analyses WHERE month = ?",
    [month]
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
    "INSERT OR REPLACE INTO ai_analyses (month, analysis_json, health_score, updated_at) VALUES (?, ?, ?, ?)",
    [month, JSON.stringify(analysis), analysis.healthScore || 0, new Date().toISOString()]
  );
}

export function deleteAnalysis(month: string): void {
  run("DELETE FROM ai_analyses WHERE month = ?", [month]);
}

// ---------------------------------------------------------------------------
// Sample dataset (explicit user action only)
// ---------------------------------------------------------------------------

export async function installSampleData(): Promise<void> {
  const syncLabel = new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

  const statements = [
    ...SAMPLE_ACCOUNTS.map((account) => ({
      sql: `INSERT OR REPLACE INTO accounts (id, name, type, institution, identifier, balance_or_billed, color, is_auto_sync_enabled, last_synced_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      params: [
        account.id,
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
    ...SAMPLE_TRANSACTIONS.map((tx) => insertStatement(tx as Transaction)),
    {
      sql: `INSERT OR REPLACE INTO budget_configs
              (month, monthly_income, fixed_expenses, savings_target, alert_threshold_percent, enable_push_alerts, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
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
      sql: "INSERT OR REPLACE INTO budgets (month, category, amount) VALUES (?, ?, ?)",
      params: [SAMPLE_BUDGET_MONTH, category, amount],
    })),
  ];

  runBatch(statements);
  await persist();
}
