import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ConnectedAccount,
  Transaction,
  AISpendingAnalysis,
  MonthlyBudgetConfig,
  CategoryBudgetStatus,
  CategoryRule,
  CategoryType,
  TransactionType,
  BudgetAlert,
  RuleSource,
  ValueSource,
} from "../types/finance";
import {
  exportDatabaseBytes,
  getDatabase,
  getDbStats,
  importDatabaseBytes,
} from "../db/database";
import * as repo from "../db/repository";
import { useAuth } from "./AuthContext";
import { analyzeSpending } from "../services/aiClient";
import { resolveCategory } from "../services/categoryRules";
import {
  BUILT_IN_CATEGORIES,
  FIXED_BUDGET_CATEGORIES,
} from "../constants/categories";

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
  schemaVersion: number;
  /** Rows belonging to the signed-in user, not the whole device. */
  userAccounts: number;
  userTransactions: number;
}

interface FinanceContextType {
  accounts: ConnectedAccount[];
  transactions: Transaction[];
  allTransactions: Transaction[];
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  aiAnalysis: AISpendingAnalysis | null;
  isAnalyzingAI: boolean;
  aiError: string | null;
  clearAiError: () => void;
  isSyncing: boolean;
  lastSyncTime: string;
  viewMode: "MOBILE_FRAME" | "RESPONSIVE_FULL";
  setViewMode: (mode: "MOBILE_FRAME" | "RESPONSIVE_FULL") => void;

  // On-device database
  isDbReady: boolean;
  dbStats: DBStatsInfo | null;
  refreshDbData: () => Promise<void>;
  resetToClean: () => Promise<void>;
  resetToSample: () => Promise<void>;
  exportDatabaseFile: () => void;
  importDatabaseFile: (file: File) => Promise<void>;

  // Actions
  addTransaction: (tx: Omit<Transaction, "id">) => void;
  addTransactions: (txs: Omit<Transaction, "id">[]) => void;
  updateTransaction: (tx: Transaction) => void;
  /** Rewrites several entries under one save — used by the bulk classifier. */
  updateTransactions: (txs: Transaction[]) => void;
  deleteTransaction: (id: string) => void;
  /** Applies a statement import: new rows inserted, chosen duplicates rewritten. */
  importTransactions: (inserts: Omit<Transaction, "id">[], updates: Transaction[]) => void;
  addAccount: (acc: Omit<ConnectedAccount, "id" | "lastSyncedAt">) => void;
  deleteAccount: (id: string) => void;
  /** Records a balance together with the moment it is true as of. */
  setAccountBalance: (
    id: string,
    balance: number,
    asOf: string,
    source?: ValueSource
  ) => void;

  /** Every category on offer: the built-in list plus the user's own. */
  categories: CategoryType[];
  /** Registers a category the user typed in. Existing names are ignored. */
  addCategory: (name: string) => void;
  deleteCategory: (name: string) => void;

  // Standing category rules
  categoryRules: CategoryRule[];
  /** The category a standing rule assigns to a description, if any. */
  categoryForMerchant: (
    merchant: string,
    accountId: string,
    isIncome?: boolean
  ) => CategoryType | null;
  saveCategoryRule: (rule: {
    id?: string;
    accountId: string;
    pattern: string;
    category: CategoryType;
    source: RuleSource;
  }) => void;
  saveCategoryRules: (
    rules: {
      accountId: string;
      pattern: string;
      category: CategoryType;
      source: RuleSource;
    }[]
  ) => void;
  deleteCategoryRule: (id: string) => void;
  setCategoryRuleSource: (id: string, source: RuleSource) => void;
  toggleFixedType: (id: string) => void;
  toggleRecommendation: (id: string) => void;
  runAISpendingAnalysis: () => Promise<void>;
  syncAccounts: () => Promise<void>;

  // Derived metrics
  totalIncome: number;
  totalExpense: number;
  fixedExpenseTotal: number;
  variableExpenseTotal: number;
  netSavings: number;
  fixedRatio: number;
  variableRatio: number;
  categoryExpenses: { category: string; amount: number; percentage: number }[];
  implementedSavingsTotal: number;

  // Budget
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

  // History
  monthlyHistoricalData: MonthlyHistoricalItem[];
  yearlyHistoricalData: YearlyHistoricalItem[];
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

const STORAGE_KEY_DISMISSED_ALERTS = "smart_money_dismissed_alerts_v1";

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function emptyBudgetConfig(month: string): MonthlyBudgetConfig {
  return {
    month,
    monthlyIncome: 0,
    fixedExpenses: 0,
    savingsTarget: 0,
    categoryBudgets: {},
    alertThresholdPercent: 80,
    enablePushAlerts: true,
  };
}

export const FinanceProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { currentUserId } = useAuth();
  const [isDbReady, setIsDbReady] = useState(false);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<AISpendingAnalysis | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey);
  const [budgetConfig, setBudgetConfig] = useState<MonthlyBudgetConfig>(() =>
    emptyBudgetConfig(currentMonthKey())
  );

  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_DISMISSED_ALERTS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState("아직 동기화 안 함");
  const [dbStats, setDbStats] = useState<DBStatsInfo | null>(null);

  // Default to RESPONSIVE_FULL on actual mobile devices (<640px), MOBILE_FRAME on desktop preview
  const [viewMode, setViewMode] = useState<"MOBILE_FRAME" | "RESPONSIVE_FULL">(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      return "RESPONSIVE_FULL";
    }
    return "MOBILE_FRAME";
  });

  // -------------------------------------------------------------------------
  // On-device database
  // -------------------------------------------------------------------------

  const readStats = useCallback((): DBStatsInfo => {
    const counts = repo.countUserRows();
    return {
      ...getDbStats(),
      userAccounts: counts.accounts,
      userTransactions: counts.transactions,
    };
  }, []);

  const refreshDbData = useCallback(async () => {
    await getDatabase();

    // Nobody signed in yet: hold empty state rather than reading another
    // user's ledger.
    if (!currentUserId) {
      setAccounts([]);
      setTransactions([]);
      setCategoryRules([]);
      setCustomCategories([]);
      setBudgetConfig(emptyBudgetConfig(selectedMonth));
      setAiAnalysis(null);
      setDbStats(null);
      return;
    }

    setAccounts(repo.listAccounts());
    setTransactions(repo.listTransactions());
    setCategoryRules(repo.listCategoryRules());
    setCustomCategories(repo.listCustomCategories());
    setBudgetConfig(repo.getBudgetConfig(selectedMonth));
    setAiAnalysis(repo.getAnalysis(selectedMonth));
    setDbStats(readStats());
  }, [selectedMonth, currentUserId, readStats]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshDbData();
      } catch (error) {
        console.error("기기 내 데이터베이스를 여는 데 실패했습니다:", error);
      } finally {
        if (!cancelled) setIsDbReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshDbData]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_DISMISSED_ALERTS, JSON.stringify(dismissedAlertIds));
  }, [dismissedAlertIds]);

  const syncStats = useCallback(() => {
    try {
      setDbStats(readStats());
    } catch {
      /* database not open, or nobody signed in */
    }
  }, [readStats]);

  // -------------------------------------------------------------------------
  // Derived metrics for the selected month
  // -------------------------------------------------------------------------

  const monthlyTransactions = useMemo(
    () => transactions.filter((tx) => tx.date.startsWith(selectedMonth)),
    [transactions, selectedMonth]
  );

  const totalIncome = useMemo(
    () =>
      monthlyTransactions
        .filter((tx) => tx.type === "INCOME")
        .reduce((acc, cur) => acc + cur.amount, 0),
    [monthlyTransactions]
  );

  const totalExpense = useMemo(
    () =>
      monthlyTransactions
        .filter((tx) => tx.type === "EXPENSE")
        .reduce((acc, cur) => acc + cur.amount, 0),
    [monthlyTransactions]
  );

  const fixedExpenseTotal = useMemo(
    () =>
      monthlyTransactions
        .filter((tx) => tx.type === "EXPENSE" && tx.expenseType === "FIXED")
        .reduce((acc, cur) => acc + cur.amount, 0),
    [monthlyTransactions]
  );

  const variableExpenseTotal = useMemo(
    () =>
      monthlyTransactions
        .filter((tx) => tx.type === "EXPENSE" && tx.expenseType === "VARIABLE")
        .reduce((acc, cur) => acc + cur.amount, 0),
    [monthlyTransactions]
  );

  const netSavings = totalIncome - totalExpense;
  const fixedRatio = totalExpense > 0 ? (fixedExpenseTotal / totalExpense) * 100 : 0;
  const variableRatio = totalExpense > 0 ? (variableExpenseTotal / totalExpense) * 100 : 0;

  const categoryExpenses = useMemo(() => {
    const map: Record<string, number> = {};
    monthlyTransactions
      .filter((tx) => tx.type === "EXPENSE")
      .forEach((tx) => {
        map[tx.category] = (map[tx.category] || 0) + tx.amount;
      });

    return Object.entries(map)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthlyTransactions, totalExpense]);

  const implementedSavingsTotal = useMemo(() => {
    if (!aiAnalysis?.savingsRecommendations) return 0;
    return aiAnalysis.savingsRecommendations
      .filter((rec) => rec.isImplemented)
      .reduce((acc, cur) => acc + (cur.estimatedMonthlySavings || 0), 0);
  }, [aiAnalysis]);

  // -------------------------------------------------------------------------
  // History, derived from the transactions actually on this device
  // -------------------------------------------------------------------------

  const summarise = (txs: Transaction[]) => {
    const income = txs.filter((t) => t.type === "INCOME").reduce((a, c) => a + c.amount, 0);
    const expense = txs.filter((t) => t.type === "EXPENSE").reduce((a, c) => a + c.amount, 0);
    const fixed = txs
      .filter((t) => t.type === "EXPENSE" && t.expenseType === "FIXED")
      .reduce((a, c) => a + c.amount, 0);
    const variable = txs
      .filter((t) => t.type === "EXPENSE" && t.expenseType === "VARIABLE")
      .reduce((a, c) => a + c.amount, 0);
    return { income, expense, fixed, variable, savings: income - expense };
  };

  const monthlyHistoricalData = useMemo<MonthlyHistoricalItem[]>(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const items: MonthlyHistoricalItem[] = [];

    for (let offset = 5; offset >= 0; offset--) {
      const date = new Date(year, month - 1 - offset, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const totals = summarise(transactions.filter((tx) => tx.date.startsWith(key)));
      items.push({
        month: key,
        displayMonth: `${date.getMonth() + 1}월`,
        ...totals,
      });
    }

    return items;
  }, [transactions, selectedMonth]);

  const yearlyHistoricalData = useMemo<YearlyHistoricalItem[]>(() => {
    const byYear = new Map<string, Transaction[]>();
    transactions.forEach((tx) => {
      const year = tx.date.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year)!.push(tx);
    });

    return Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, txs]) => {
        const totals = summarise(txs);
        const categoryMap: Record<string, number> = {};
        txs
          .filter((tx) => tx.type === "EXPENSE")
          .forEach((tx) => {
            categoryMap[tx.category] = (categoryMap[tx.category] || 0) + tx.amount;
          });

        const categories = Object.entries(categoryMap)
          .map(([category, amount]) => ({
            category,
            amount,
            percentage: totals.expense > 0 ? (amount / totals.expense) * 100 : 0,
          }))
          .sort((a, b) => b.amount - a.amount);

        return { year, ...totals, categories };
      });
  }, [transactions]);

  // -------------------------------------------------------------------------
  // Budget
  // -------------------------------------------------------------------------

  const disposableIncome = Math.max(
    0,
    budgetConfig.monthlyIncome - budgetConfig.fixedExpenses - budgetConfig.savingsTarget
  );

  const totalBudgeted = useMemo(
    () =>
      Object.values(budgetConfig.categoryBudgets || {}).reduce(
        (acc: number, cur) => acc + Number(cur || 0),
        0
      ),
    [budgetConfig.categoryBudgets]
  );

  const totalVariableBudget = useMemo(
    () =>
      Object.entries(budgetConfig.categoryBudgets || {})
        .filter(([cat]) => !FIXED_BUDGET_CATEGORIES.includes(cat as never))
        .reduce((acc: number, [, val]) => acc + Number(val || 0), 0),
    [budgetConfig.categoryBudgets]
  );

  const totalVariableSpent = variableExpenseTotal;

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

    return allCategories
      .map((category) => {
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

        return { category, budget, spent, remaining, percentage, status };
      })
      .sort((a, b) => b.percentage - a.percentage);
  }, [monthlyTransactions, budgetConfig]);

  const budgetAlerts = useMemo<BudgetAlert[]>(() => {
    if (!budgetConfig.enablePushAlerts) return [];

    const alerts: BudgetAlert[] = [];
    budgetStatusList.forEach((item) => {
      if (item.budget <= 0) return;

      const alertId = `${selectedMonth}-${item.category}-${item.status}`;
      if (dismissedAlertIds.includes(alertId)) return;

      const createdAt = new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      });

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
          createdAt,
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
          createdAt,
        });
      }
    });

    return alerts;
  }, [budgetStatusList, budgetConfig.enablePushAlerts, dismissedAlertIds, selectedMonth]);

  const persistBudget = (next: MonthlyBudgetConfig) => {
    try {
      repo.saveBudgetConfig(next);
      syncStats();
    } catch (error) {
      console.error("예산을 저장하지 못했습니다:", error);
    }
  };

  const updateBudgetConfig = (partial: Partial<MonthlyBudgetConfig>) => {
    setBudgetConfig((prev) => {
      const next = { ...prev, ...partial, month: prev.month || selectedMonth };
      persistBudget(next);
      return next;
    });
  };

  const setCategoryBudget = (category: string, amount: number) => {
    setBudgetConfig((prev) => {
      const next = {
        ...prev,
        month: prev.month || selectedMonth,
        categoryBudgets: {
          ...prev.categoryBudgets,
          [category]: Math.max(0, amount),
        },
      };
      persistBudget(next);
      return next;
    });
  };

  const autoAllocateBudgets = (income: number, fixed: number, savingsTarget: number) => {
    const availableVariable = Math.max(0, income - fixed - savingsTarget);

    const ratios: Record<string, number> = {
      "식비": 0.4,
      "카페/간식": 0.08,
      "쇼핑": 0.18,
      "교통": 0.12,
      "문화/여가": 0.1,
      "생활/의료": 0.07,
      "기타지출": 0.05,
    };

    const newBudgets: Record<string, number> = { ...budgetConfig.categoryBudgets };
    Object.entries(ratios).forEach(([cat, ratio]) => {
      // Round to nearest 10,000 KRW
      newBudgets[cat] = Math.round((availableVariable * ratio) / 10000) * 10000;
    });

    const nextConfig: MonthlyBudgetConfig = {
      ...budgetConfig,
      month: budgetConfig.month || selectedMonth,
      monthlyIncome: income,
      fixedExpenses: fixed,
      savingsTarget,
      categoryBudgets: newBudgets,
    };

    setBudgetConfig(nextConfig);
    persistBudget(nextConfig);
  };

  const dismissAlert = (id: string) => {
    setDismissedAlertIds((prev) => [...prev, id]);
  };

  const markAllAlertsAsRead = () => {
    setDismissedAlertIds((prev) => [...prev, ...budgetAlerts.map((a) => a.id)]);
  };

  // -------------------------------------------------------------------------
  // Transactions & accounts
  // -------------------------------------------------------------------------

  const newId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  /**
   * A standing rule decides the category of anything arriving later that
   * matches it — whether typed in by hand or read out of a statement.
   */
  const withRule = <
    T extends {
      merchant: string;
      accountId: string;
      category: CategoryType;
      type: TransactionType;
    }
  >(
    tx: T
  ): T => {
    const decided = resolveCategory(
      categoryRules,
      tx.merchant,
      tx.accountId,
      tx.type === "INCOME"
    );
    return decided ? { ...tx, category: decided } : tx;
  };

  /*
    No standing rule is applied here: this is the one entry point where the
    user picked the category on the form in front of them, and the form
    already offers the matching rule as a suggestion before saving.
  */
  const addTransaction = (tx: Omit<Transaction, "id">) => {
    const newTx: Transaction = { ...tx, id: newId("tx") };
    try {
      repo.insertTransaction(newTx);
      setTransactions((prev) => [newTx, ...prev]);
      setAccounts(repo.listAccounts());
      syncStats();
    } catch (error) {
      console.error("거래를 저장하지 못했습니다:", error);
    }
  };

  const addTransactions = (txs: Omit<Transaction, "id">[]) => {
    const newItems: Transaction[] = txs.map((tx, idx) => ({
      ...withRule(tx),
      id: `tx-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
    }));
    try {
      repo.insertTransactions(newItems);
      setTransactions((prev) => [...newItems, ...prev]);
      setAccounts(repo.listAccounts());
      syncStats();
    } catch (error) {
      console.error("거래를 일괄 저장하지 못했습니다:", error);
    }
  };

  const updateTransaction = (tx: Transaction) => {
    try {
      repo.updateTransaction(tx);
      setTransactions((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
    } catch (error) {
      console.error("거래를 수정하지 못했습니다:", error);
    }
  };

  const updateTransactions = (txs: Transaction[]) => {
    if (txs.length === 0) return;
    try {
      repo.applyImport([], txs);
      setTransactions((prev) =>
        prev.map((t) => txs.find((candidate) => candidate.id === t.id) ?? t)
      );
    } catch (error) {
      console.error("거래를 일괄 수정하지 못했습니다:", error);
      throw error;
    }
  };

  const deleteTransaction = (id: string) => {
    try {
      repo.deleteTransaction(id);
      setTransactions((prev) => prev.filter((t) => t.id !== id));
      syncStats();
    } catch (error) {
      console.error("거래를 삭제하지 못했습니다:", error);
    }
  };

  const importTransactions = (
    inserts: Omit<Transaction, "id">[],
    updates: Transaction[]
  ) => {
    const withIds: Transaction[] = inserts.map((tx, idx) => ({
      ...withRule(tx),
      id: `tx-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
    }));
    const rewritten = updates.map(withRule);
    try {
      repo.applyImport(withIds, rewritten);
      setTransactions((prev) => {
        const replaced = prev.map(
          (t) => rewritten.find((u) => u.id === t.id) ?? t
        );
        return [...withIds, ...replaced].sort((a, b) =>
          `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
        );
      });
      syncStats();
    } catch (error) {
      console.error("가져오기를 저장하지 못했습니다:", error);
      throw error;
    }
  };

  const addAccount = (acc: Omit<ConnectedAccount, "id" | "lastSyncedAt">) => {
    const newAcc: ConnectedAccount = {
      ...acc,
      id: newId("acc"),
      lastSyncedAt: new Date().toLocaleString("ko-KR", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    };
    try {
      repo.insertAccount(newAcc);
      setAccounts((prev) => [newAcc, ...prev]);
      syncStats();
    } catch (error) {
      console.error("계좌를 저장하지 못했습니다:", error);
    }
  };

  const deleteAccount = (id: string) => {
    try {
      repo.deleteAccount(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      setCategoryRules(repo.listCategoryRules());
      syncStats();
    } catch (error) {
      console.error("계좌를 삭제하지 못했습니다:", error);
    }
  };

  const setAccountBalance = (
    id: string,
    balance: number,
    asOf: string,
    source: ValueSource = "USER"
  ) => {
    try {
      repo.updateAccountBalance(id, balance, asOf, source);
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, balanceOrBilled: balance, balanceAsOf: asOf, balanceSource: source }
            : a
        )
      );
      syncStats();
    } catch (error) {
      console.error("잔액을 수정하지 못했습니다:", error);
    }
  };

  // -------------------------------------------------------------------------
  // Standing category rules
  // -------------------------------------------------------------------------

  const categoryForMerchant = useCallback(
    (merchant: string, accountId: string, isIncome = false): CategoryType | null =>
      resolveCategory(categoryRules, merchant, accountId, isIncome),
    [categoryRules]
  );

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  /** The shipped list first, then whatever the user added, in the order added. */
  const categories = useMemo<CategoryType[]>(() => {
    const seen = new Set<string>(BUILT_IN_CATEGORIES);
    const extra = customCategories.filter((name) => name && !seen.has(name));
    return [...BUILT_IN_CATEGORIES, ...extra];
  }, [customCategories]);

  const addCategory = (name: string) => {
    const trimmed = (name || "").trim();
    if (!trimmed || categories.includes(trimmed)) return;
    try {
      repo.addCustomCategory(trimmed);
      setCustomCategories(repo.listCustomCategories());
    } catch (error) {
      console.error("카테고리를 추가하지 못했습니다:", error);
    }
  };

  const deleteCategory = (name: string) => {
    try {
      repo.deleteCustomCategory(name);
      setCustomCategories((prev) => prev.filter((item) => item !== name));
    } catch (error) {
      console.error("카테고리를 삭제하지 못했습니다:", error);
    }
  };

  const saveCategoryRule = (rule: {
    id?: string;
    accountId: string;
    pattern: string;
    category: CategoryType;
    source: RuleSource;
  }) => {
    try {
      repo.saveCategoryRule(rule);
      setCategoryRules(repo.listCategoryRules());
    } catch (error) {
      console.error("카테고리 규칙을 저장하지 못했습니다:", error);
    }
  };

  const saveCategoryRules = (
    rules: {
      accountId: string;
      pattern: string;
      category: CategoryType;
      source: RuleSource;
    }[]
  ) => {
    if (rules.length === 0) return;
    try {
      repo.saveCategoryRules(rules);
      setCategoryRules(repo.listCategoryRules());
    } catch (error) {
      console.error("카테고리 규칙을 일괄 저장하지 못했습니다:", error);
    }
  };

  const deleteCategoryRule = (id: string) => {
    try {
      repo.deleteCategoryRule(id);
      setCategoryRules((prev) => prev.filter((rule) => rule.id !== id));
    } catch (error) {
      console.error("카테고리 규칙을 삭제하지 못했습니다:", error);
    }
  };

  const setCategoryRuleSource = (id: string, source: RuleSource) => {
    try {
      repo.setCategoryRuleSource(id, source);
      setCategoryRules(repo.listCategoryRules());
    } catch (error) {
      console.error("등록 구분을 변경하지 못했습니다:", error);
    }
  };

  const toggleFixedType = (id: string) => {
    try {
      const next = repo.toggleTransactionFixed(id);
      if (!next) return;
      setTransactions((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, expenseType: next, isFixedRecurring: next === "FIXED" } : t
        )
      );
    } catch (error) {
      console.error("고정비 구분을 변경하지 못했습니다:", error);
    }
  };

  const syncAccounts = async () => {
    setIsSyncing(true);
    try {
      const label = repo.touchAccountSync();
      setAccounts(repo.listAccounts());
      setLastSyncTime(label);
    } catch (error) {
      console.error("계좌 동기화에 실패했습니다:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  // -------------------------------------------------------------------------
  // AI
  // -------------------------------------------------------------------------

  const clearAiError = () => setAiError(null);

  const toggleRecommendation = (id: string) => {
    setAiAnalysis((prev) => {
      if (!prev) return prev;
      const next: AISpendingAnalysis = {
        ...prev,
        savingsRecommendations: prev.savingsRecommendations.map((rec) =>
          rec.id === id ? { ...rec, isImplemented: !rec.isImplemented } : rec
        ),
      };
      try {
        repo.saveAnalysis(selectedMonth, next);
      } catch (error) {
        console.error("추천 실천 상태를 저장하지 못했습니다:", error);
      }
      return next;
    });
  };

  const runAISpendingAnalysis = async () => {
    setIsAnalyzingAI(true);
    setAiError(null);
    try {
      const fixedItems = monthlyTransactions
        .filter((tx) => tx.type === "EXPENSE" && tx.expenseType === "FIXED")
        .map((t) => ({ merchant: t.merchant, amount: t.amount, category: t.category }));

      const data = await analyzeSpending({
        month: selectedMonth,
        totalIncome,
        totalExpense,
        fixedExpenseTotal,
        variableExpenseTotal,
        fixedItems,
        variableTopCategories: categoryExpenses.slice(0, 5),
        recentTransactions: monthlyTransactions.slice(0, 15),
      });

      const result: AISpendingAnalysis = {
        ...data,
        savingsRecommendations: (data.savingsRecommendations || []).map((rec, idx) => ({
          ...rec,
          id: rec.id || `rec-${Date.now()}-${idx}`,
          isImplemented: false,
        })),
        analyzedAt: new Date().toLocaleDateString("ko-KR", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setAiAnalysis(result);
      repo.saveAnalysis(selectedMonth, result);
      syncStats();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "AI 분석에 실패했습니다.";
      console.error("AI 분석 실패:", error);
      setAiError(message);
    } finally {
      setIsAnalyzingAI(false);
    }
  };

  // -------------------------------------------------------------------------
  // Database maintenance
  // -------------------------------------------------------------------------

  // Both reset only the signed-in user's ledger; other users are untouched.
  const resetToClean = async () => {
    try {
      await repo.clearUserData();
      await refreshDbData();
    } catch (error) {
      console.error("데이터를 비우지 못했습니다:", error);
    }
    setDismissedAlertIds([]);
  };

  const resetToSample = async () => {
    try {
      await repo.clearUserData();
      await repo.installSampleData();
      await refreshDbData();
    } catch (error) {
      console.error("샘플 데이터를 설치하지 못했습니다:", error);
    }
    setDismissedAlertIds([]);
  };

  const exportDatabaseFile = () => {
    try {
      const bytes = exportDatabaseBytes();
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: "application/x-sqlite3",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `smartmoney-${stamp}.db`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("백업 파일을 만들지 못했습니다:", error);
    }
  };

  const importDatabaseFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    await importDatabaseBytes(new Uint8Array(buffer));
    await refreshDbData();
    setDismissedAlertIds([]);
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
        aiError,
        clearAiError,
        isSyncing,
        lastSyncTime,
        viewMode,
        setViewMode,
        isDbReady,
        dbStats,
        refreshDbData,
        resetToClean,
        resetToSample,
        exportDatabaseFile,
        importDatabaseFile,
        addTransaction,
        addTransactions,
        updateTransaction,
        updateTransactions,
        deleteTransaction,
        importTransactions,
        addAccount,
        deleteAccount,
        setAccountBalance,
        categories,
        addCategory,
        deleteCategory,
        categoryRules,
        categoryForMerchant,
        saveCategoryRule,
        saveCategoryRules,
        deleteCategoryRule,
        setCategoryRuleSource,
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
        monthlyHistoricalData,
        yearlyHistoricalData,
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
