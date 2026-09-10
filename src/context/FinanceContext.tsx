import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import {
  ConnectedAccount,
  Transaction,
  AISpendingAnalysis,
  SavingsRecommendation,
  MonthlyBudgetConfig,
  CategoryBudgetStatus,
  BudgetAlert,
  CategoryType,
} from "../types/finance";
import {
  INITIAL_ACCOUNTS,
  INITIAL_TRANSACTIONS,
  INITIAL_AI_ANALYSIS,
  INITIAL_BUDGET_CONFIG,
  MONTHLY_HISTORICAL_DATA,
  YEARLY_HISTORICAL_DATA,
} from "../data/mockFinanceData";

interface MonthlyHistoricalItem {
  month: string;
  displayMonth: string;
  income: number;
  expense: number;
  fixed: number;
  variable: number;
  savings: number;
}

interface YearlyHistoricalItem {
  year: string;
  income: number;
  expense: number;
  fixed: number;
  variable: number;
  savings: number;
  categories: { category: string; amount: number; percentage: number }[];
}

export interface DBStatsInfo {
  path: string;
  sizeBytes: number;
  tables: Record<string, number>;
  lastSavedAt: string;
}

interface FinanceContextType {
  accounts: ConnectedAccount[];
  transactions: Transaction[];
  allTransactions: Transaction[];
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  aiAnalysis: AISpendingAnalysis | null;
  isAnalyzingAI: boolean;
  isSyncing: boolean;
  lastSyncTime: string;
  viewMode: "MOBILE_FRAME" | "RESPONSIVE_FULL";
  setViewMode: (mode: "MOBILE_FRAME" | "RESPONSIVE_FULL") => void;

  // SQLite Database
  dbStats: DBStatsInfo | null;
  refreshDbData: () => Promise<void>;
  resetToClean: () => Promise<void>;
  resetToSample: () => Promise<void>;
  exportDatabaseFile: () => void;

  // Actions
  addTransaction: (tx: Omit<Transaction, "id">) => void;
  addTransactions: (txs: Omit<Transaction, "id">[]) => void;
  deleteTransaction: (id: string) => void;
  addAccount: (acc: Omit<ConnectedAccount, "id" | "lastSyncedAt">) => void;
  deleteAccount: (id: string) => void;
  toggleFixedType: (id: string) => void;
  toggleRecommendation: (id: string) => void;
  runAISpendingAnalysis: () => Promise<void>;
  syncAccounts: () => Promise<void>;

  // Computed financial metrics
  totalIncome: number;
  totalExpense: number;
  fixedExpenseTotal: number;
  variableExpenseTotal: number;
  netSavings: number;
  fixedRatio: number;
  variableRatio: number;
  categoryExpenses: { category: string; amount: number; percentage: number }[];
  implementedSavingsTotal: number;

  // Budget Management & Alerts
  budgetConfig: MonthlyBudgetConfig;
  updateBudgetConfig: (partial: Partial<MonthlyBudgetConfig>) => void;
  setCategoryBudget: (category: string, amount: number) => void;
  autoAllocateBudgets: (income: number, fixed: number, savingsTarget: number) => void;
  budgetStatusList: CategoryBudgetStatus[];
  budgetAlerts: BudgetAlert[];
  dismissAlert: (id: string) => void;
  markAllAlertsAsRead: () => void;
  totalBudgeted: number;
  totalVariableBudget: number;
  totalVariableSpent: number;
  disposableIncome: number;

  // Historical Analytics Data
  monthlyHistoricalData: MonthlyHistoricalItem[];
  yearlyHistoricalData: YearlyHistoricalItem[];
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

const STORAGE_KEY_TX = "smart_money_transactions_v1";
const STORAGE_KEY_ACCOUNTS = "smart_money_accounts_v1";
const STORAGE_KEY_AI = "smart_money_ai_analysis_v1";
const STORAGE_KEY_BUDGET = "smart_money_budget_v1";
const STORAGE_KEY_DISMISSED_ALERTS = "smart_money_dismissed_alerts_v1";

export const FinanceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ACCOUNTS);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse accounts from localStorage", e);
      }
    }
    return INITIAL_ACCOUNTS;
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TX);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse transactions from localStorage", e);
      }
    }
    return INITIAL_TRANSACTIONS;
  });

  const [aiAnalysis, setAiAnalysis] = useState<AISpendingAnalysis | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_AI);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse AI analysis from localStorage", e);
      }
    }
    return INITIAL_AI_ANALYSIS;
  });

  const [budgetConfig, setBudgetConfig] = useState<MonthlyBudgetConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_BUDGET);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse budget config from localStorage", e);
      }
    }
    return INITIAL_BUDGET_CONFIG;
  });

  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_DISMISSED_ALERTS);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse dismissed alert IDs", e);
      }
    }
    return [];
  });

  const [selectedMonth, setSelectedMonth] = useState<string>("2026-09");
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState("방금 전");
  // Default to RESPONSIVE_FULL on actual mobile devices (<640px), MOBILE_FRAME on desktop preview
  const [viewMode, setViewMode] = useState<"MOBILE_FRAME" | "RESPONSIVE_FULL">(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      return "RESPONSIVE_FULL";
    }
    return "MOBILE_FRAME";
  });
  const [dbStats, setDbStats] = useState<DBStatsInfo | null>(null);

  // Load live data from SQLite Database via REST APIs
  const refreshDbData = async () => {
    try {
      // 1. Fetch DB Status
      fetch("/api/db/status")
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setDbStats({
              path: data.path,
              sizeBytes: data.sizeBytes,
              tables: data.tables,
              lastSavedAt: data.lastSavedAt,
            });
          }
        })
        .catch((err) => console.warn("DB status fetch warning:", err));

      // 2. Fetch Accounts
      const accRes = await fetch("/api/accounts");
      const accData = await accRes.json();
      if (accData.success && Array.isArray(accData.accounts)) {
        setAccounts(accData.accounts);
      }

      // 3. Fetch Transactions
      const txRes = await fetch("/api/transactions");
      const txData = await txRes.json();
      if (txData.success && Array.isArray(txData.transactions)) {
        setTransactions(txData.transactions);
      }

      // 4. Fetch Budgets
      const budgetRes = await fetch(`/api/budgets?month=${selectedMonth}`);
      const budgetData = await budgetRes.json();
      if (budgetData.success && budgetData.config) {
        setBudgetConfig(budgetData.config);
      }

      // 5. Fetch AI Analysis for month
      const aiRes = await fetch(`/api/ai/analysis?month=${selectedMonth}`);
      const aiData = await aiRes.json();
      if (aiData.success && aiData.data) {
        setAiAnalysis(aiData.data);
      }
    } catch (err) {
      console.error("Failed to refresh data from SQLite backend:", err);
    }
  };

  // Initial load from SQLite on mount and when selectedMonth changes
  useEffect(() => {
    refreshDbData();
  }, [selectedMonth]);

  // Save to LocalStorage as secondary offline backup
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(accounts));
  }, [accounts]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TX, JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    if (aiAnalysis) {
      localStorage.setItem(STORAGE_KEY_AI, JSON.stringify(aiAnalysis));
    }
  }, [aiAnalysis]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_BUDGET, JSON.stringify(budgetConfig));
  }, [budgetConfig]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DISMISSED_ALERTS, JSON.stringify(dismissedAlertIds));
  }, [dismissedAlertIds]);

  // Filter transactions by selected month
  const monthlyTransactions = useMemo(() => {
    return transactions.filter((tx) => tx.date.startsWith(selectedMonth));
  }, [transactions, selectedMonth]);

  // Derived metrics for currently selected month
  const totalIncome = useMemo(() => {
    return monthlyTransactions
      .filter((tx) => tx.type === "INCOME")
      .reduce((acc, cur) => acc + cur.amount, 0);
  }, [monthlyTransactions]);

  const totalExpense = useMemo(() => {
    return monthlyTransactions
      .filter((tx) => tx.type === "EXPENSE")
      .reduce((acc, cur) => acc + cur.amount, 0);
  }, [monthlyTransactions]);

  const fixedExpenseTotal = useMemo(() => {
    return monthlyTransactions
      .filter((tx) => tx.type === "EXPENSE" && tx.expenseType === "FIXED")
      .reduce((acc, cur) => acc + cur.amount, 0);
  }, [monthlyTransactions]);

  const variableExpenseTotal = useMemo(() => {
    return monthlyTransactions
      .filter((tx) => tx.type === "EXPENSE" && tx.expenseType === "VARIABLE")
      .reduce((acc, cur) => acc + cur.amount, 0);
  }, [monthlyTransactions]);

  const netSavings = totalIncome - totalExpense;

  const fixedRatio = totalExpense > 0 ? (fixedExpenseTotal / totalExpense) * 100 : 0;
  const variableRatio = totalExpense > 0 ? (variableExpenseTotal / totalExpense) * 100 : 0;

  // Category breakdown for expenses
  const categoryExpenses = useMemo(() => {
    const map: Record<string, number> = {};
    monthlyTransactions
      .filter((tx) => tx.type === "EXPENSE")
      .forEach((tx) => {
        map[tx.category] = (map[tx.category] || 0) + tx.amount;
      });

    const list = Object.entries(map).map(([category, amount]) => ({
      category,
      amount,
      percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
    }));

    return list.sort((a, b) => b.amount - a.amount);
  }, [monthlyTransactions, totalExpense]);

  // Total saved by implemented recommendations
  const implementedSavingsTotal = useMemo(() => {
    if (!aiAnalysis?.savingsRecommendations) return 0;
    return aiAnalysis.savingsRecommendations
      .filter((rec) => rec.isImplemented)
      .reduce((acc, cur) => acc + (cur.estimatedMonthlySavings || 0), 0);
  }, [aiAnalysis]);

  // Budget calculations
  const disposableIncome = Math.max(
    0,
    budgetConfig.monthlyIncome - budgetConfig.fixedExpenses - budgetConfig.savingsTarget
  );

  const totalBudgeted = useMemo(() => {
    return Object.values(budgetConfig.categoryBudgets || {}).reduce(
      (acc: number, cur) => acc + Number(cur || 0),
      0
    );
  }, [budgetConfig.categoryBudgets]);

  const totalVariableBudget = useMemo(() => {
    // Variable categories excluding housing/fixed items if separate
    return Object.entries(budgetConfig.categoryBudgets || {})
      .filter(([cat]) => cat !== "주거/통신" && cat !== "금융/보험")
      .reduce((acc: number, [, val]) => acc + Number(val || 0), 0);
  }, [budgetConfig.categoryBudgets]);

  const totalVariableSpent = variableExpenseTotal;

  // Category Budget Status List
  const budgetStatusList = useMemo<CategoryBudgetStatus[]>(() => {
    const categorySpentMap: Record<string, number> = {};
    monthlyTransactions
      .filter((t) => t.type === "EXPENSE")
      .forEach((t) => {
        categorySpentMap[t.category] = (categorySpentMap[t.category] || 0) + t.amount;
      });

    const allCategories = Array.from(
      new Set([
        ...Object.keys(budgetConfig.categoryBudgets || {}),
        ...Object.keys(categorySpentMap),
      ])
    );

    return allCategories.map((category) => {
      const budget = budgetConfig.categoryBudgets[category] || 0;
      const spent = categorySpentMap[category] || 0;
      const remaining = budget - spent;
      const percentage = budget > 0 ? (spent / budget) * 100 : spent > 0 ? 100 : 0;

      let status: "SAFE" | "WARNING" | "EXCEEDED" = "SAFE";
      if (budget > 0) {
        if (percentage >= 100) {
          status = "EXCEEDED";
        } else if (percentage >= (budgetConfig.alertThresholdPercent || 80)) {
          status = "WARNING";
        }
      }

      return {
        category,
        budget,
        spent,
        remaining,
        percentage,
        status,
      };
    }).sort((a, b) => b.percentage - a.percentage);
  }, [monthlyTransactions, budgetConfig]);

  // Active Budget Alerts
  const budgetAlerts = useMemo<BudgetAlert[]>(() => {
    if (!budgetConfig.enablePushAlerts) return [];

    const alerts: BudgetAlert[] = [];
    budgetStatusList.forEach((item) => {
      if (item.budget <= 0) return;

      const alertId = `${selectedMonth}-${item.category}-${item.status}`;
      if (dismissedAlertIds.includes(alertId)) return;

      if (item.status === "EXCEEDED") {
        alerts.push({
          id: alertId,
          category: item.category,
          type: "EXCEEDED",
          spent: item.spent,
          budget: item.budget,
          percentage: item.percentage,
          message: `[${item.category}] 예산 ${item.budget.toLocaleString()}원 대비 ${item.spent.toLocaleString()}원(${Math.round(
            item.percentage
          )}%)을 지출하여 예산을 초과했습니다!`,
          createdAt: new Date().toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        });
      } else if (item.status === "WARNING") {
        alerts.push({
          id: alertId,
          category: item.category,
          type: "WARNING",
          spent: item.spent,
          budget: item.budget,
          percentage: item.percentage,
          message: `[${item.category}] 예산의 ${Math.round(
            item.percentage
          )}%를 소진했습니다 (${(item.budget - item.spent).toLocaleString()}원 남음).`,
          createdAt: new Date().toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        });
      }
    });

    return alerts;
  }, [budgetStatusList, budgetConfig.enablePushAlerts, dismissedAlertIds, selectedMonth]);

  // Budget Actions
  const updateBudgetConfig = (partial: Partial<MonthlyBudgetConfig>) => {
    setBudgetConfig((prev) => {
      const next = { ...prev, ...partial };
      // Save to SQLite
      fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch((e) => console.error("Failed to save budget config to SQLite:", e));
      return next;
    });
  };

  const setCategoryBudget = (category: string, amount: number) => {
    setBudgetConfig((prev) => {
      const next = {
        ...prev,
        categoryBudgets: {
          ...prev.categoryBudgets,
          [category]: Math.max(0, amount),
        },
      };
      // Save to SQLite
      fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch((e) => console.error("Failed to save budget to SQLite:", e));
      return next;
    });
  };

  // AI Smart Auto-allocation based on 50/30/20 rule and past patterns
  const autoAllocateBudgets = (income: number, fixed: number, savingsTarget: number) => {
    const availableVariable = Math.max(0, income - fixed - savingsTarget);

    // Distribution ratios for standard variable spending
    const ratios: Record<string, number> = {
      "식비": 0.40,      // 40% of variable
      "카페/간식": 0.08,  // 8%
      "쇼핑": 0.18,       // 18%
      "교통": 0.12,       // 12%
      "문화/여가": 0.10,  // 10%
      "생활/의료": 0.07,  // 7%
      "기타지출": 0.05,   // 5%
    };

    const newBudgets: Record<string, number> = {
      ...budgetConfig.categoryBudgets,
      "주거/통신": 820000,
      "구독/미디어": 45000,
      "금융/보험": 160000,
    };

    Object.entries(ratios).forEach(([cat, ratio]) => {
      // Round to nearest 10,000 KRW
      newBudgets[cat] = Math.round((availableVariable * ratio) / 10000) * 10000;
    });

    const nextConfig = {
      ...budgetConfig,
      monthlyIncome: income,
      fixedExpenses: fixed,
      savingsTarget,
      categoryBudgets: newBudgets,
    };

    setBudgetConfig(nextConfig);

    // Save to SQLite
    fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextConfig),
    }).catch((e) => console.error("Failed to save auto budgets to SQLite:", e));
  };

  const dismissAlert = (id: string) => {
    setDismissedAlertIds((prev) => [...prev, id]);
  };

  const markAllAlertsAsRead = () => {
    setDismissedAlertIds((prev) => [
      ...prev,
      ...budgetAlerts.map((a) => a.id),
    ]);
  };

  // Actions
  const addTransaction = async (tx: Omit<Transaction, "id">) => {
    const tempId = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newTx: Transaction = {
      ...tx,
      id: tempId,
    };
    setTransactions((prev) => [newTx, ...prev]);

    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTx),
      });
      const data = await res.json();
      if (data.success && data.transaction) {
        setTransactions((prev) =>
          prev.map((t) => (t.id === tempId ? data.transaction : t))
        );
      }
      // Refresh accounts and db stats
      fetch("/api/accounts")
        .then((r) => r.json())
        .then((d) => d.success && setAccounts(d.accounts))
        .catch(() => {});
      fetch("/api/db/status")
        .then((r) => r.json())
        .then((d) => d.success && setDbStats(d))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to persist transaction to SQLite:", err);
    }
  };

  const addTransactions = async (txs: Omit<Transaction, "id">[]) => {
    const newItems: Transaction[] = txs.map((tx, idx) => ({
      ...tx,
      id: `tx-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
    }));
    setTransactions((prev) => [...newItems, ...prev]);

    try {
      await fetch("/api/transactions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: newItems }),
      });
      refreshDbData();
    } catch (err) {
      console.error("Failed to batch persist transactions to SQLite:", err);
    }
  };

  const deleteTransaction = async (id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    try {
      await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      fetch("/api/db/status")
        .then((r) => r.json())
        .then((d) => d.success && setDbStats(d))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to delete transaction from SQLite:", err);
    }
  };

  const addAccount = async (acc: Omit<ConnectedAccount, "id" | "lastSyncedAt">) => {
    const tempId = `acc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const syncTime = new Date().toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const newAcc: ConnectedAccount = {
      ...acc,
      id: tempId,
      lastSyncedAt: syncTime,
    };
    setAccounts((prev) => [newAcc, ...prev]);

    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAcc),
      });
      const data = await res.json();
      if (data.success && data.account) {
        setAccounts((prev) =>
          prev.map((a) => (a.id === tempId ? data.account : a))
        );
      }
      fetch("/api/db/status")
        .then((r) => r.json())
        .then((d) => d.success && setDbStats(d))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to save account to SQLite:", err);
    }
  };

  const deleteAccount = async (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      fetch("/api/db/status")
        .then((r) => r.json())
        .then((d) => d.success && setDbStats(d))
        .catch(() => {});
    } catch (err) {
      console.error("Failed to delete account from SQLite:", err);
    }
  };

  const toggleFixedType = async (id: string) => {
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const nextType = t.expenseType === "FIXED" ? "VARIABLE" : "FIXED";
        return { ...t, expenseType: nextType, isFixedRecurring: nextType === "FIXED" };
      })
    );
    try {
      await fetch(`/api/transactions/${id}/toggle-fixed`, { method: "PATCH" });
    } catch (err) {
      console.error("Failed to toggle fixed type in SQLite:", err);
    }
  };

  const toggleRecommendation = async (id: string) => {
    if (!aiAnalysis) return;
    setAiAnalysis((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        savingsRecommendations: prev.savingsRecommendations.map((rec) =>
          rec.id === id ? { ...rec, isImplemented: !rec.isImplemented } : rec
        ),
      };
    });
    try {
      await fetch(`/api/ai/recommendation/${id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: selectedMonth }),
      });
    } catch (err) {
      console.error("Failed to toggle recommendation in SQLite:", err);
    }
  };

  const syncAccounts = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/accounts/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setAccounts(data.accounts);
        setLastSyncTime(data.lastSyncTime || "방금 전");
      }
    } catch (err) {
      console.error("Failed to sync accounts with SQLite:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const runAISpendingAnalysis = async () => {
    setIsAnalyzingAI(true);
    try {
      const fixedItems = monthlyTransactions
        .filter((tx) => tx.type === "EXPENSE" && tx.expenseType === "FIXED")
        .map((t) => ({ merchant: t.merchant, amount: t.amount, category: t.category }));

      const res = await fetch("/api/ai/analyze-spending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: selectedMonth,
          totalIncome,
          totalExpense,
          fixedExpenseTotal,
          variableExpenseTotal,
          fixedItems,
          variableTopCategories: categoryExpenses.slice(0, 5),
          recentTransactions: monthlyTransactions.slice(0, 15),
        }),
      });

      const data = await res.json();
      if (data.success && data.data) {
        const result: AISpendingAnalysis = {
          ...data.data,
          savingsRecommendations: data.data.savingsRecommendations.map(
            (rec: any, idx: number) => ({
              ...rec,
              id: rec.id || `rec-${Date.now()}-${idx}`,
              isImplemented: false,
            })
          ),
          analyzedAt: new Date().toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setAiAnalysis(result);
      }
    } catch (err) {
      console.error("Failed to run AI spending analysis:", err);
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  const resetToSample = async () => {
    try {
      await fetch("/api/db/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "sample" }),
      });
      await refreshDbData();
    } catch (e) {
      console.error("Failed to reset SQLite DB to sample:", e);
    }
    setDismissedAlertIds([]);
    localStorage.removeItem(STORAGE_KEY_DISMISSED_ALERTS);
  };

  const resetToClean = async () => {
    try {
      await fetch("/api/db/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "clean" }),
      });
      await refreshDbData();
    } catch (e) {
      console.error("Failed to reset SQLite DB to clean:", e);
    }
    setDismissedAlertIds([]);
    localStorage.removeItem(STORAGE_KEY_DISMISSED_ALERTS);
  };

  const exportDatabaseFile = () => {
    const link = document.createElement("a");
    link.href = "/api/db/export";
    link.download = "finance.db";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <FinanceContext.Provider
      value={{
        accounts,
        transactions: monthlyTransactions,
        allTransactions: transactions,
        selectedMonth,
        setSelectedMonth,
        aiAnalysis,
        isAnalyzingAI,
        isSyncing,
        lastSyncTime,
        viewMode,
        setViewMode,
        dbStats,
        refreshDbData,
        resetToClean,
        resetToSample,
        exportDatabaseFile,
        addTransaction,
        addTransactions,
        deleteTransaction,
        addAccount,
        deleteAccount,
        toggleFixedType,
        toggleRecommendation,
        runAISpendingAnalysis,
        syncAccounts,
        totalIncome,
        totalExpense,
        fixedExpenseTotal,
        variableExpenseTotal,
        netSavings,
        fixedRatio,
        variableRatio,
        categoryExpenses,
        implementedSavingsTotal,
        budgetConfig,
        updateBudgetConfig,
        setCategoryBudget,
        autoAllocateBudgets,
        budgetStatusList,
        budgetAlerts,
        dismissAlert,
        markAllAlertsAsRead,
        totalBudgeted,
        totalVariableBudget,
        totalVariableSpent,
        disposableIncome,
        monthlyHistoricalData: MONTHLY_HISTORICAL_DATA,
        yearlyHistoricalData: YEARLY_HISTORICAL_DATA,
      }}
    >
      {children}
    </FinanceContext.Provider>
  );
};

export const useFinance = () => {
  const context = useContext(FinanceContext);
  if (!context) {
    throw new Error("useFinance must be used within a FinanceProvider");
  }
  return context;
};

