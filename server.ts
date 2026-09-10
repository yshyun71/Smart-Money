import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import {
  getDatabase,
  queryAll,
  queryOne,
  run,
  getDbStats,
  resetDatabase,
  getDatabaseBinary,
} from "./server/db";

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini SDK with User-Agent header as required
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ==========================================
// 1. SQLite Database Status & Export Endpoints
// ==========================================
app.get("/api/db/status", (req, res) => {
  try {
    const stats = getDbStats();
    res.json({ success: true, ...stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/db/export", (req, res) => {
  try {
    const buffer = getDatabaseBinary();
    res.setHeader("Content-Disposition", 'attachment; filename="finance.db"');
    res.setHeader("Content-Type", "application/x-sqlite3");
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/db/reset", (req, res) => {
  try {
    const { mode } = req.body; // 'clean' or 'sample'
    resetDatabase(mode === "clean" ? "clean" : "sample");
    res.json({
      success: true,
      message: `Database successfully reset to ${mode === "clean" ? "clean ledger" : "initial sample state"}`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 2. User Authentication & PIN Endpoints
// ==========================================
// In-memory verification codes map for phone SMS/OTP verification
const verificationCodes = new Map<string, { code: string; expiresAt: number }>();

app.get("/api/user", (req, res) => {
  try {
    const user = queryOne("SELECT * FROM users LIMIT 1");
    if (!user) return res.json({ success: true, user: null });
    const isAuth = Boolean(user.is_authenticated);
    const hasRegisteredIdentity = Boolean(user.name && user.name.trim().length > 0);
    res.json({
      success: true,
      user: {
        id: user.id,
        name: isAuth ? user.name : (hasRegisteredIdentity ? user.name : ""),
        email: isAuth ? user.email : "",
        phone: isAuth ? user.phone : (hasRegisteredIdentity ? user.phone : ""),
        authProvider: user.auth_provider,
        providerLabel: user.provider_label,
        isAuthenticated: isAuth,
        isBiometricEnabled: Boolean(user.is_biometric_enabled),
        authenticatedAt: user.authenticated_at,
        hasPin: Boolean(user.pin && user.pin.trim().length === 6),
        hasRegisteredIdentity,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/user/logout", (req, res) => {
  try {
    run("UPDATE users SET is_authenticated = 0, authenticated_at = NULL");
    res.json({ success: true, message: "로그아웃 되었습니다." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/send-code", (req, res) => {
  try {
    const { phone, provider } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: "휴대폰 번호를 입력해주세요." });
    }
    // Generate authentic 6-digit verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    verificationCodes.set(cleanPhone, {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    console.log(`[AUTH] Sent verification code to ${phone} via ${provider}: ${code}`);
    res.json({
      success: true,
      message: "인증번호 6자리가 발송되었습니다.",
      code, // return code so test user can easily verify and test
      expiresIn: 300,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/verify-code", (req, res) => {
  try {
    const { phone, code, name, provider, birth, telecom } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: "성명을 입력해주세요." });
    }
    const cleanPhone = (phone || "").replace(/[^0-9]/g, "");
    const record = verificationCodes.get(cleanPhone);

    // Accept generated code or fallback test code 123456
    const isValidCode = (record && record.code === code && record.expiresAt > Date.now()) || code === "123456";
    if (!isValidCode) {
      return res.status(400).json({ success: false, error: "인증번호 6자리가 일치하지 않거나 만료되었습니다. (테스트용: 발송된 6자리 또는 123456)" });
    }

    const providerLabels: Record<string, string> = {
      KAKAO: "카카오톡 간편인증",
      TOSS: "토스 간편인증",
      PASS: "PASS 간편인증",
      NAVER: "네이버 간편인증",
    };
    const label = providerLabels[provider] || "간편인증";
    const authTime = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

    const user = queryOne("SELECT * FROM users LIMIT 1");
    if (user) {
      run(
        `UPDATE users SET name = ?, phone = ?, auth_provider = ?, provider_label = ?, is_authenticated = 1, authenticated_at = ? WHERE id = ?`,
        [name.trim(), phone.trim(), provider, label, authTime, user.id]
      );
    } else {
      run(
        `INSERT INTO users (id, name, email, phone, pin, auth_provider, provider_label, is_authenticated, is_biometric_enabled, authenticated_at, created_at)
         VALUES (?, ?, '', ?, NULL, ?, ?, 1, 1, ?, ?)`,
        ["user_primary", name.trim(), phone.trim(), provider || "KAKAO", label, authTime, new Date().toISOString()]
      );
    }

    verificationCodes.delete(cleanPhone);
    res.json({
      success: true,
      message: "본인인증이 완료되었습니다.",
      user: {
        name: name.trim(),
        phone: phone.trim(),
        authProvider: provider,
        providerLabel: label,
        authenticatedAt: authTime,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/user/auth", (req, res) => {
  try {
    const { provider, name, phone, email, pin } = req.body;
    const user = queryOne("SELECT * FROM users LIMIT 1");

    if (pin) {
      if (!user || !user.name || !user.name.trim()) {
        return res.status(403).json({
          success: false,
          error: "먼저 카카오톡, 토스, PASS, 네이버 등 본인인증으로 로그인한 후 PIN을 설정해주세요.",
          requiresRegistration: true,
        });
      }
      if (!user.pin || !user.pin.trim()) {
        return res.status(400).json({
          success: false,
          error: "등록된 간편 비밀번호가 없습니다. 본인인증 완료 후 상단 보안 설정에서 PIN을 먼저 등록해주세요.",
          hasNoPin: true,
        });
      }
      if (user.pin !== pin) {
        return res.status(401).json({ success: false, error: "비밀번호(PIN)가 일치하지 않습니다." });
      }
      run("UPDATE users SET is_authenticated = 1, authenticated_at = ? WHERE id = ?", [
        new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
        user.id,
      ]);
      return res.json({ success: true, message: "PIN 인증 완료" });
    }

    // Simple Auth (Kakao, Toss, PASS, Naver)
    const providerLabels: Record<string, string> = {
      KAKAO: "카카오톡 간편인증",
      TOSS: "토스 간편인증",
      PASS: "PASS 간편인증",
      NAVER: "네이버 간편인증",
    };
    const label = providerLabels[provider] || "간편인증";
    const authTime = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: "성명을 입력해주세요." });
    }

    if (user) {
      run(
        `UPDATE users SET name = ?, phone = ?, email = ?,
         auth_provider = ?, provider_label = ?, is_authenticated = 1, authenticated_at = ? WHERE id = ?`,
        [name.trim(), phone || "", email || "", provider, label, authTime, user.id]
      );
    } else {
      run(
        `INSERT INTO users (id, name, email, phone, pin, auth_provider, provider_label, is_authenticated, is_biometric_enabled, authenticated_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, 1, 1, ?, ?)`,
        ["user_primary", name.trim(), email || "", phone || "", provider || "KAKAO", label, authTime, new Date().toISOString()]
      );
    }

    res.json({ success: true, message: "간편인증 완료" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/user/pin", (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.length !== 6) {
      return res.status(400).json({ success: false, error: "6자리 숫자 PIN을 입력해주세요." });
    }
    run("UPDATE users SET pin = ?", [pin]);
    res.json({ success: true, message: "간편 비밀번호가 성공적으로 변경되었습니다." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. Category Endpoints
// ==========================================
app.get("/api/categories", (req, res) => {
  try {
    const categories = queryAll("SELECT * FROM categories ORDER BY id ASC");
    res.json({ success: true, categories });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/categories", (req, res) => {
  try {
    const { name, type, color } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "카테고리 이름을 입력하세요." });
    const id = `cat_${Date.now()}`;
    run("INSERT INTO categories (id, name, type, color, is_default) VALUES (?, ?, ?, ?, 0)", [
      id,
      name,
      type || "VARIABLE",
      color || "#64748B",
    ]);
    res.json({ success: true, id, name, type, color });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. Accounts (Cards & Bank Accounts)
// ==========================================
app.get("/api/accounts", (req, res) => {
  try {
    const accounts = queryAll(`
      SELECT 
        id, 
        name, 
        type, 
        institution, 
        identifier, 
        balance_or_billed as balanceOrBilled, 
        color, 
        is_auto_sync_enabled as isAutoSyncEnabled, 
        last_synced_at as lastSyncedAt
      FROM accounts
      ORDER BY rowid ASC
    `);
    res.json({
      success: true,
      accounts: accounts.map((a) => ({
        ...a,
        isAutoSyncEnabled: Boolean(a.isAutoSyncEnabled),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/accounts", (req, res) => {
  try {
    const { name, type, institution, identifier, balanceOrBilled, color } = req.body;
    const id = `acc-${Date.now()}`;
    const syncTime = new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
    run(
      `INSERT INTO accounts (id, name, type, institution, identifier, balance_or_billed, color, is_auto_sync_enabled, last_synced_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        name,
        type,
        institution,
        identifier,
        Number(balanceOrBilled || 0),
        color || "#3B82F6",
        syncTime,
        new Date().toISOString(),
      ]
    );
    res.json({
      success: true,
      account: {
        id,
        name,
        type,
        institution,
        identifier,
        balanceOrBilled: Number(balanceOrBilled || 0),
        color: color || "#3B82F6",
        isAutoSyncEnabled: true,
        lastSyncedAt: syncTime,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/accounts/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, institution, identifier, balanceOrBilled, color } = req.body;
    run(
      `UPDATE accounts SET 
         name = COALESCE(?, name),
         type = COALESCE(?, type),
         institution = COALESCE(?, institution),
         identifier = COALESCE(?, identifier),
         balance_or_billed = COALESCE(?, balance_or_billed),
         color = COALESCE(?, color)
       WHERE id = ?`,
      [name, type, institution, identifier, balanceOrBilled, color, id]
    );
    res.json({ success: true, message: "계좌/카드 정보가 수정되었습니다." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/accounts/:id", (req, res) => {
  try {
    const { id } = req.params;
    run("DELETE FROM accounts WHERE id = ?", [id]);
    res.json({ success: true, message: "계좌/카드가 삭제되었습니다." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/accounts/sync", (req, res) => {
  try {
    const nowStr = new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
    run("UPDATE accounts SET last_synced_at = ?", [nowStr]);
    const accounts = queryAll(`
      SELECT 
        id, name, type, institution, identifier, balance_or_billed as balanceOrBilled, color, 
        is_auto_sync_enabled as isAutoSyncEnabled, last_synced_at as lastSyncedAt
      FROM accounts
    `);
    res.json({
      success: true,
      accounts: accounts.map((a) => ({ ...a, isAutoSyncEnabled: Boolean(a.isAutoSyncEnabled) })),
      lastSyncTime: nowStr,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 5. Transactions Endpoints
// ==========================================
app.get("/api/transactions", (req, res) => {
  try {
    const { month } = req.query;
    let sql = `
      SELECT 
        id, 
        date, 
        time, 
        type, 
        expense_type as expenseType, 
        category, 
        merchant, 
        amount, 
        payment_method as paymentMethod, 
        account_id as accountId, 
        memo, 
        is_fixed_recurring as isFixedRecurring, 
        recurring_day as recurringDay
      FROM transactions
    `;
    const params: any[] = [];
    if (month && typeof month === "string") {
      sql += " WHERE date LIKE ? ORDER BY date DESC, time DESC";
      params.push(`${month}%`);
    } else {
      sql += " ORDER BY date DESC, time DESC";
    }

    const rows = queryAll(sql, params);
    const transactions = rows.map((r) => ({
      ...r,
      isFixedRecurring: Boolean(r.isFixedRecurring),
      recurringDay: r.recurringDay || undefined,
    }));
    res.json({ success: true, transactions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/transactions", (req, res) => {
  try {
    const tx = req.body;
    const id = tx.id || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    run(
      `INSERT INTO transactions 
         (id, date, time, type, expense_type, category, merchant, amount, payment_method, account_id, memo, is_fixed_recurring, recurring_day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
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
        tx.recurringDay || null,
        new Date().toISOString(),
      ]
    );

    // If linked to an account, adjust balance
    if (tx.accountId) {
      if (tx.type === "EXPENSE") {
        run(
          "UPDATE accounts SET balance_or_billed = balance_or_billed + ? WHERE id = ? AND type = 'CREDIT_CARD'",
          [Number(tx.amount || 0), tx.accountId]
        );
        run(
          "UPDATE accounts SET balance_or_billed = balance_or_billed - ? WHERE id = ? AND type = 'BANK'",
          [Number(tx.amount || 0), tx.accountId]
        );
      } else {
        run(
          "UPDATE accounts SET balance_or_billed = balance_or_billed + ? WHERE id = ? AND type = 'BANK'",
          [Number(tx.amount || 0), tx.accountId]
        );
      }
    }

    res.json({ success: true, transaction: { ...tx, id } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/transactions/batch", (req, res) => {
  try {
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ success: false, error: "Transactions array is required" });
    }

    const inserted: any[] = [];
    for (const tx of transactions) {
      const id = tx.id || `tx-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      run(
        `INSERT INTO transactions 
           (id, date, time, type, expense_type, category, merchant, amount, payment_method, account_id, memo, is_fixed_recurring, recurring_day, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
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
          tx.recurringDay || null,
          new Date().toISOString(),
        ]
      );
      inserted.push({ ...tx, id });
    }

    res.json({ success: true, count: inserted.length, transactions: inserted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/transactions/:id", (req, res) => {
  try {
    const { id } = req.params;
    run("DELETE FROM transactions WHERE id = ?", [id]);
    res.json({ success: true, message: "거래 내역이 삭제되었습니다." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch("/api/transactions/:id/toggle-fixed", (req, res) => {
  try {
    const { id } = req.params;
    const row = queryOne<{ expense_type: string }>(
      "SELECT expense_type FROM transactions WHERE id = ?",
      [id]
    );
    if (!row) return res.status(404).json({ success: false, error: "Transaction not found" });

    const newType = row.expense_type === "FIXED" ? "VARIABLE" : "FIXED";
    run("UPDATE transactions SET expense_type = ? WHERE id = ?", [newType, id]);
    res.json({ success: true, id, expenseType: newType });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. Budgets & Budget Configuration
// ==========================================
app.get("/api/budgets", (req, res) => {
  try {
    const month = (req.query.month as string) || "2026-09";
    const configRow = queryOne(`SELECT * FROM budget_configs WHERE month = ?`, [month]);
    const budgetRows = queryAll(`SELECT category, amount FROM budgets WHERE month = ?`, [month]);

    const categoryBudgets: Record<string, number> = {};
    for (const b of budgetRows) {
      categoryBudgets[b.category] = b.amount;
    }

    const config = configRow
      ? {
          month: configRow.month,
          monthlyIncome: configRow.monthly_income,
          fixedExpenses: configRow.fixed_expenses,
          savingsTarget: configRow.savings_target,
          alertThresholdPercent: configRow.alert_threshold_percent,
          enablePushAlerts: Boolean(configRow.enable_push_alerts),
          categoryBudgets,
        }
      : {
          month,
          monthlyIncome: 4500000,
          fixedExpenses: 1150000,
          savingsTarget: 1500000,
          alertThresholdPercent: 80,
          enablePushAlerts: true,
          categoryBudgets,
        };

    res.json({ success: true, config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/budgets", (req, res) => {
  try {
    const {
      month,
      monthlyIncome,
      fixedExpenses,
      savingsTarget,
      alertThresholdPercent,
      enablePushAlerts,
      categoryBudgets,
    } = req.body;
    if (!month) return res.status(400).json({ success: false, error: "month is required" });

    run(
      `INSERT OR REPLACE INTO budget_configs 
       (month, monthly_income, fixed_expenses, savings_target, alert_threshold_percent, enable_push_alerts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        month,
        Number(monthlyIncome || 0),
        Number(fixedExpenses || 0),
        Number(savingsTarget || 0),
        Number(alertThresholdPercent || 80),
        enablePushAlerts ? 1 : 0,
        new Date().toISOString(),
      ]
    );

    if (categoryBudgets && typeof categoryBudgets === "object") {
      for (const [cat, amt] of Object.entries(categoryBudgets)) {
        run(
          `INSERT OR REPLACE INTO budgets (month, category, amount) VALUES (?, ?, ?)`,
          [month, cat, Number(amt || 0)]
        );
      }
    }

    res.json({ success: true, message: "예산 설정이 SQLite DB에 저장되었습니다." });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 7. AI Spending Analysis (Stored in SQLite)
// ==========================================
app.get("/api/ai/analysis", (req, res) => {
  try {
    const month = (req.query.month as string) || "2026-09";
    const row = queryOne<{ analysis_json: string }>(
      "SELECT analysis_json FROM ai_analyses WHERE month = ?",
      [month]
    );
    if (row && row.analysis_json) {
      return res.json({ success: true, data: JSON.parse(row.analysis_json) });
    }
    res.json({ success: true, data: null });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch("/api/ai/recommendation/:id/toggle", (req, res) => {
  try {
    const { id } = req.params;
    const { month } = req.body;
    const targetMonth = month || "2026-09";
    const row = queryOne<{ analysis_json: string }>(
      "SELECT analysis_json FROM ai_analyses WHERE month = ?",
      [targetMonth]
    );
    if (!row || !row.analysis_json) {
      return res.status(404).json({ success: false, error: "Analysis not found" });
    }

    const data = JSON.parse(row.analysis_json);
    if (data.savingsRecommendations && Array.isArray(data.savingsRecommendations)) {
      data.savingsRecommendations = data.savingsRecommendations.map((r: any) =>
        r.id === id ? { ...r, isImplemented: !r.isImplemented } : r
      );
      run("UPDATE ai_analyses SET analysis_json = ? WHERE month = ?", [
        JSON.stringify(data),
        targetMonth,
      ]);
    }
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// AI Spending & Cost-Cutting Analysis Endpoint
app.post("/api/ai/analyze-spending", async (req, res) => {
  try {
    const {
      month,
      totalIncome,
      totalExpense,
      fixedExpenseTotal,
      variableExpenseTotal,
      fixedItems,
      variableTopCategories,
      recentTransactions,
    } = req.body;

    const prompt = `
당신은 대한민국 최고의 공인 개인 재무설계사이자 가계부 절약 코칭 전문가입니다.
사용자의 이번 달(${month || "최근 한 달"}) 카드 사용 내역과 통장 계좌 입출금 분석 데이터를 바탕으로, 고정비와 변동비를 정밀 진단하고 실질적으로 실천 가능한 '맞춤형 절약 추천 항목'과 '소비 습관 개선 방안'을 구체적인 예시와 함께 분석해주세요.

[사용자 재무 현황]
- 총 수입: ${Number(totalIncome || 0).toLocaleString()}원
- 총 지출: ${Number(totalExpense || 0).toLocaleString()}원
- 월간 고정비 지출: ${Number(fixedExpenseTotal || 0).toLocaleString()}원 (${
      totalExpense > 0 ? Math.round((fixedExpenseTotal / totalExpense) * 100) : 0
    }%)
- 월간 변동비 지출: ${Number(variableExpenseTotal || 0).toLocaleString()}원 (${
      totalExpense > 0 ? Math.round((variableExpenseTotal / totalExpense) * 100) : 0
    }%)
- 주요 고정비 항목: ${JSON.stringify(fixedItems || [])}
- 주요 변동비 지출 카테고리: ${JSON.stringify(variableTopCategories || [])}
- 최근 지출 샘플: ${JSON.stringify(recentTransactions?.slice(0, 15) || [])}

[분석 및 추천 지침]
1. 고정비 적정성(권장: 수입의 30~40% 이내)과 변동비 지출 습관(외식, 배달, 카페, 택시, 불필요한 구독 등)을 냉철하고 따뜻하게 평가하세요.
2. 실질적으로 매월 아낄 수 있는 구체적인 절약 항목(최소 4~5개)을 계산된 예상 절약 금액(원 단위 숫자)과 함께 제안하세요. **반드시 각 항목마다 현실적인 전/후 비교 수치가 담긴 구체적인 실천 예시(concreteExample)**를 제공하세요. (예: "월 12회 배달(34만원) 중 4회로 축소 및 퇴근길 밀키트 대체 시 월 11만원 절감", "SKT 8.5만원 요금제 -> 알뜰폰 3.3만원 번호이동 시 연 62만원 절약" 등)
3. 카드 및 계좌 소비 습관 개선을 위한 '소비 습관 개선 방안(habitImprovements)'(무지출 데이, 장바구니 24시간 냉각기, 선불 생활비 계좌 분리 등)을 구체적 예시와 함께 제시하세요.
4. 이번 주 당장 실행할 수 있는 체크리스트와 종합 재무 건강 점수(0~100점)를 산출하세요.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        systemInstruction:
          "당신은 친절하면서도 숫자에 정밀한 금융 가계부 전문 AI입니다. 한국 소비자의 실생활 물가와 금융 상품(알뜰폰, OTT, 배달비, 대중교통 등)에 맞춘 현실적 조언과 구체적 사례를 JSON으로 출력하세요.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: "한 줄 종합 진단 코멘트",
            },
            healthScore: {
              type: Type.INTEGER,
              description: "재무 건강 점수 (0-100)",
            },
            fixedRatioAnalysis: {
              type: Type.STRING,
              description: "고정비 비율 적정성 평가 및 피드백",
            },
            variablePaceAnalysis: {
              type: Type.STRING,
              description: "변동비 지출 속도 및 과소비 요인 분석",
            },
            totalPotentialMonthlySavings: {
              type: Type.INTEGER,
              description: "추천 항목 실천 시 예상되는 월간 총 절약 가능 금액 (원)",
            },
            savingsRecommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "절약 항목 명칭" },
                  category: {
                    type: Type.STRING,
                    description: "관련 카테고리 (주거/통신, 구독/미디어, 식비/배달, 교통, 쇼핑 등)",
                  },
                  type: {
                    type: Type.STRING,
                    description: "고정비 절약 또는 변동비 절약",
                  },
                  estimatedMonthlySavings: {
                    type: Type.INTEGER,
                    description: "월 예상 절약액 (원)",
                  },
                  difficulty: {
                    type: Type.STRING,
                    description: "난이도 (쉬움, 보통, 도전)",
                  },
                  currentIssue: {
                    type: Type.STRING,
                    description: "현재 지출 현황 및 문제점",
                  },
                  actionPlan: {
                    type: Type.STRING,
                    description: "구체적 실천 팁과 방법",
                  },
                  concreteExample: {
                    type: Type.STRING,
                    description: "Before & After 수치와 실행 브랜드/방법이 명시된 구체적 실천 예시",
                  },
                },
                required: [
                  "title",
                  "category",
                  "type",
                  "estimatedMonthlySavings",
                  "difficulty",
                  "currentIssue",
                  "actionPlan",
                  "concreteExample",
                ],
              },
            },
            habitImprovements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "습관 개선 타이틀" },
                  category: { type: Type.STRING, description: "습관 분류" },
                  description: { type: Type.STRING, description: "개선 원리 및 설명" },
                  concreteExample: { type: Type.STRING, description: "구체적 실천 사례" },
                  expectedMonthlyBenefit: { type: Type.INTEGER, description: "예상 월 혜택/절약액" },
                  badge: { type: Type.STRING, description: "핵심 효과 뱃지" },
                  tag: { type: Type.STRING, description: "분류 태그" },
                },
                required: [
                  "title",
                  "category",
                  "description",
                  "concreteExample",
                  "expectedMonthlyBenefit",
                  "badge",
                  "tag",
                ],
              },
            },
            weeklyActionChecklist: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "이번 주 즉시 실천할 3~4가지 액션 체크리스트",
            },
            coachEncouragement: {
              type: Type.STRING,
              description: "동기 부여가 되는 한마디",
            },
          },
          required: [
            "summary",
            "healthScore",
            "fixedRatioAnalysis",
            "variablePaceAnalysis",
            "totalPotentialMonthlySavings",
            "savingsRecommendations",
            "habitImprovements",
            "weeklyActionChecklist",
            "coachEncouragement",
          ],
        },
      },
    });

    const text = response.text || "{}";
    const parsedData = JSON.parse(text);

    // Save to SQLite ai_analyses table
    try {
      run(
        `INSERT OR REPLACE INTO ai_analyses (month, analysis_json, health_score, updated_at) VALUES (?, ?, ?, ?)`,
        [
          month || "2026-09",
          JSON.stringify(parsedData),
          parsedData.healthScore || 80,
          new Date().toISOString(),
        ]
      );
    } catch (dbErr) {
      console.error("[SQLite] Error saving AI analysis to DB:", dbErr);
    }

    res.json({ success: true, data: parsedData });
  } catch (error: any) {
    console.error("Gemini spending analysis error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to analyze spending with AI",
    });
  }
});

// AI SMS / Push Notification Parsing Endpoint
app.post("/api/ai/parse-sms", async (req, res) => {
  try {
    const { rawText } = req.body;

    if (!rawText || typeof rawText !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "rawText string is required" });
    }

    const prompt = `
다음 한국 은행/카드 결제 알림 문자(SMS) 또는 푸시 알림 텍스트를 분석하여 구조화된 가계부 거래 내역 JSON 배열로 변환하세요.
여러 건이 포함되어 있을 수 있습니다.

[알림 문자 텍스트]:
${rawText}

[분류 규칙]:
1. 금액(amount): 원 단위 숫자 (양의 정수)
2. 유형(type): "EXPENSE"(지출) 또는 "INCOME"(수입)
3. 지출구분(expenseType): 고정비 성격(월세, 관리비, 넷플릭스, 쿠팡와우, 유튜브, 통신요금, 보험료, 대출이자, 학원비 등 정기결제)은 "FIXED", 그 외 일반 소비(식비, 카페, 마트, 쇼핑, 택시 등)는 "VARIABLE". 수입인 경우 "INCOME".
4. 카테고리(category): "식비", "카페/간식", "주거/통신", "구독/미디어", "교통", "쇼핑", "문화/여가", "생활/의료", "금융/보험", "급여/상여", "기타수입", "기타지출" 중 하나로 매핑.
5. 날짜(date): YYYY-MM-DD 형식 (연도가 없으면 현재 연도 2025/2026 추정)
6. 시간(time): HH:mm (없으면 "12:00")
7. 결제수단(paymentMethod): 문자 내 카드명/계좌명 (예: "KB국민카드", "신한카드", "카카오뱅크", "토스뱅크" 등)
8. 가맹점/적요(merchant): 상호명 또는 입금처
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        systemInstruction:
          "한국 신용카드, 체크카드, 은행 입출금 SMS 및 푸시 알림 문자를 정확히 파싱하는 금융 NLP 도우미입니다.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  merchant: { type: Type.STRING },
                  amount: { type: Type.INTEGER },
                  type: { type: Type.STRING, enum: ["EXPENSE", "INCOME"] },
                  expenseType: {
                    type: Type.STRING,
                    enum: ["FIXED", "VARIABLE", "INCOME"],
                  },
                  category: { type: Type.STRING },
                  paymentMethod: { type: Type.STRING },
                  date: { type: Type.STRING },
                  time: { type: Type.STRING },
                  memo: { type: Type.STRING },
                },
                required: [
                  "merchant",
                  "amount",
                  "type",
                  "expenseType",
                  "category",
                  "paymentMethod",
                  "date",
                ],
              },
            },
          },
          required: ["transactions"],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{"transactions":[]}');
    res.json({ success: true, transactions: parsed.transactions });
  } catch (error: any) {
    console.error("Gemini SMS parse error:", error);
    res
      .status(500)
      .json({ success: false, error: error.message || "Failed to parse SMS" });
  }
});

// AI Spending Q&A / Coach Chat Endpoint
app.post("/api/ai/ask-coach", async (req, res) => {
  try {
    const { question, context } = req.body;

    const systemPrompt = `
당신은 사용자의 금융 데이터(총 수입, 고정비, 변동비, 카드 및 계좌 지출 내역)를 꼼꼼히 파악하고 있는 AI 스마트 머니 절약 코치입니다.
사용자의 질문에 대해 현실적이고 수치에 근거한 절약 조언, 예산 관리 팁, 고정비 절감 노하우를 명확하고 정중한 한국어로 답변하세요.
답변은 300자 내외로 핵심을 짚어주고, 2~3가지의 즉시 실행 가능한 행동 팁(Bullet points)을 포함하세요.
    `;

    const userContent = `
[사용자 현재 재무 상황 요약]:
${JSON.stringify(context || {})}

[질문]:
${question}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [
        { role: "user", parts: [{ text: userContent }] }
      ],
      config: {
        systemInstruction: systemPrompt,
      },
    });

    res.json({ success: true, answer: response.text });
  } catch (error: any) {
    console.error("Gemini coach chat error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get coach answer",
    });
  }
});

// Setup Vite middleware for development or serve static dist for production
async function startServer() {
  try {
    console.log("[Server] Initializing SQLite database...");
    await getDatabase();
    console.log("[Server] SQLite database ready.");
  } catch (err) {
    console.error("[Server] SQLite initialization error:", err);
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
