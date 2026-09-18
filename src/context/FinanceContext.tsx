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
  allocate,
  belowBaseline,
  emptyPolicy,
  fixedBaselines,
  spareOf,
  type BudgetPolicy,
  type FixedBaseline,
} from "../services/budgetPolicy";
import {
  encryptBackup,
  decryptBackup,
  isEncryptedBackup,
} from "../services/backupCrypto";
import {
  exportDatabaseBytes,
  getDatabase,
  databaseFailure,
  getDbStats,
  importDatabaseBytes,
} from "../db/database";
import * as repo from "../db/repository";
import { useAuth } from "./AuthContext";
import { analyzeSpending } from "../services/aiClient";
import { resolveCategory } from "../services/categoryRules";
import {
  matchCardForBill,
  planCardLinks,
  settlesFromBank,
} from "../services/cardLink";
import {
  BUILT_IN_CATEGORIES,
  CARD_PAYMENT_CATEGORY,
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
  /**
   * Set when the stored ledger could not be opened. Distinct from "no data":
   * an empty screen and an unreachable one mean opposite things.
   */
  dbError: string | null;
  dbStats: DBStatsInfo | null;
  refreshDbData: () => Promise<void>;
  resetToClean: () => Promise<void>;
  resetToSample: () => Promise<void>;
  /** Writes a backup out; a passphrase locks it, nothing leaves it plain as before. */
  exportDatabaseFile: (passphrase?: string) => Promise<void>;
  /** Restores a backup. A locked one needs the passphrase it was written with. */
  importDatabaseFile: (file: File, passphrase?: string) => Promise<void>;

  // Actions
  addTransaction: (tx: Omit<Transaction, "id">) => void;
  addTransactions: (txs: Omit<Transaction, "id">[]) => void;
  updateTransaction: (tx: Transaction) => void;
  /** Rewrites several entries under one save — used by the bulk classifier. */
  updateTransactions: (txs: Transaction[]) => void;
  deleteTransaction: (id: string) => void;
  /** Removes a whole selection at once. */
  deleteTransactions: (ids: string[]) => void;
  /** Applies a statement import: new rows inserted, chosen duplicates rewritten. */
  importTransactions: (inserts: Omit<Transaction, "id">[], updates: Transaction[]) => void;
  addAccount: (acc: Omit<ConnectedAccount, "id" | "lastSyncedAt">) => void;
  deleteAccount: (id: string) => void;
  /** Corrects the name, institution, number or kind of an account. */
  updateAccountDetails: (
    id: string,
    details: {
      name: string;
      institution: string;
      identifier: string;
      type: ConnectedAccount["type"];
    }
  ) => void;
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

  /** 달에 매이지 않는 카테고리별 한도 기준 (11.5). */
  budgetPolicy: BudgetPolicy;
  saveBudgetPolicy: (policy: BudgetPolicy) => void;
  /** 기준대로 이 달의 카테고리 예산을 채웁니다. 바꾼 카테고리 수를 돌려줍니다. */
  applyBudgetPolicy: () => number;
  /** 카테고리마다 고정비로 매달 얼마가 나가는지 — 예산의 최소선. */
  fixedBaselineList: FixedBaseline[];
  /** 예산이 그 최소선보다 낮은 카테고리들. */
  underFixedList: { category: string; budget: number; average: number }[];
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
  const [dbError, setDbError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<AISpendingAnalysis | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthKey);
  const [budgetPolicy, setBudgetPolicyState] = useState<BudgetPolicy>(emptyPolicy);
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
      setBudgetPolicyState(emptyPolicy());
      setAiAnalysis(null);
      setDbStats(null);
      return;
    }

    setAccounts(repo.listAccounts());
    setTransactions(repo.listTransactions());
    setCategoryRules(repo.listCategoryRules());
    setCustomCategories(repo.listCustomCategories());
    setBudgetConfig(repo.getBudgetConfig(selectedMonth));
    setBudgetPolicyState(repo.getBudgetPolicy());
    setAiAnalysis(repo.getAnalysis(selectedMonth));
    setDbStats(readStats());
  }, [selectedMonth, currentUserId, readStats]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshDbData();
        if (!cancelled) setDbError(null);
      } catch (error) {
        console.error("기기 내 데이터베이스를 여는 데 실패했습니다:", error);
        /*
          Swallowing this left the app showing a perfectly ordinary empty
          ledger, which is how a device with its data intact came to display
          the first-run setup screen. It is said out loud now.
        */
        if (!cancelled) {
          setDbError(
            databaseFailure()?.message ||
              (error instanceof Error
                ? error.message
                : "기기 내 가계부를 여는 데 실패했습니다.")
          );
        }
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

  /*
    가용 변동비. 예산 기준의 비율 모드가 기준으로 삼는 값과 같은 것이어야
    하므로 `spareOf` 하나만 씁니다 — 같은 식을 두 곳에 두면 한쪽만 고쳐집니다.
  */
  const disposableIncome = spareOf({
    income: budgetConfig.monthlyIncome,
    fixed: budgetConfig.fixedExpenses,
    savings: budgetConfig.savingsTarget,
  });

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

        /*
          예산을 정하지 않은 칸은 안전한 것도 초과한 것도 아닙니다. 예전에는
          `SAFE`로 남아, 지출이 46만원인 칸이 초록 막대를 가득 채운 채
          "안전 · 100% 소진"이라고 적혀 있었습니다.
        */
        let status: "SAFE" | "WARNING" | "EXCEEDED" | "UNSET" = "SAFE";
        if (budget <= 0) {
          status = "UNSET";
        } else if (percentage >= 100) {
          status = "EXCEEDED";
        } else if (percentage >= (budgetConfig.alertThresholdPercent || 80)) {
          status = "WARNING";
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

  /*
    고정비 가이드.

    이번 달은 아직 끝나지 않았으므로 평균에서 뺍니다 — 반 달치를 한 달치로
    세면 최소선이 실제보다 낮게 제시되고, 그러면 가이드가 아니라 오해가 됩니다.
    `transactions` 전체를 보되 최근 6개월만 셉니다.
  */
  const fixedBaselineList = useMemo(
    () => fixedBaselines(transactions, { months: 6, upTo: selectedMonth }),
    [transactions, selectedMonth]
  );

  const underFixedList = useMemo(
    () => belowBaseline(budgetConfig.categoryBudgets || {}, fixedBaselineList),
    [budgetConfig.categoryBudgets, fixedBaselineList]
  );

  const saveBudgetPolicy = (policy: BudgetPolicy) => {
    try {
      repo.saveBudgetPolicy(policy);
      setBudgetPolicyState(policy);
    } catch (error) {
      console.error("예산 기준을 저장하지 못했습니다:", error);
    }
  };

  /**
   * 기준대로 이 달의 카테고리 예산을 채웁니다.
   *
   * 기준에 없는 카테고리는 건드리지 않습니다 — 기준을 적용했다고 해서 손으로
   * 정해 둔 다른 칸을 0으로 만들 이유가 없습니다.
   */
  const applyBudgetPolicy = (): number => {
    const wanted = allocate(budgetPolicy, {
      income: budgetConfig.monthlyIncome,
      fixed: budgetConfig.fixedExpenses,
      savings: budgetConfig.savingsTarget,
    });

    const entries = Object.entries(wanted).filter(
      ([category, amount]) => (budgetConfig.categoryBudgets[category] || 0) !== amount
    );
    if (entries.length === 0) return 0;

    setBudgetConfig((prev) => {
      const next = {
        ...prev,
        month: prev.month || selectedMonth,
        categoryBudgets: { ...prev.categoryBudgets, ...Object.fromEntries(entries) },
      };
      persistBudget(next);
      return next;
    });

    return entries.length;
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
      "생활": 0.04,
      "의료": 0.03,
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
      linkedAccountId?: string;
      billingMonth?: string;
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
    const next = decided ? { ...tx, category: decided } : tx;

    /*
       A card bill says which issuer it settles; if exactly one registered card
       matches, the payment points at it from the start.

       Only ever on a bank account. A card's own statement carries lines that
       name an issuer — 우리카드's "차감-[청구할인] … 우리카드II …" — and linking
       one of those pointed a statement at itself.
     */
    if (
      next.category === CARD_PAYMENT_CATEGORY &&
      !next.linkedAccountId &&
      settlesFromBank(tx.accountId, accounts)
    ) {
      const bill = matchCardForBill(
        next.merchant,
        Number((next as { amount?: number }).amount || 0),
        (next as { date?: string }).date?.slice(0, 7) || "",
        accounts,
        transactions
      );
      if (bill) {
        return {
          ...next,
          linkedAccountId: bill.accountId,
          billingMonth: bill.billingMonth || next.billingMonth,
        };
      }
    }

    return next;
  };

  /*
    No standing rule is applied here: this is the one entry point where the
    user picked the category on the form in front of them, and the form
    already offers the matching rule as a suggestion before saving.
  */
  /**
   * Ties a card's statements to the withdrawals that settle them, and lets go
   * when they no longer do.
   *
   * A statement arriving is what makes the link possible: the month's total
   * now equals a withdrawal sitting in the account the card is paid from. The
   * same reasoning run backwards is what releases it — delete the month and
   * the withdrawal matches nothing, so the link it carried is cleared rather
   * than left pointing at a statement that is no longer there.
   *
   * Returns the transaction list with those links applied. The deciding is
   * done by `planCardLinks`, which is where it can be tested; this only writes
   * down what it decides.
   */
  const reconcileCardBills = (
    next: Transaction[],
    touchedAccountIds: string[]
  ): Transaction[] => {
    const updates = planCardLinks(
      accounts,
      next,
      touchedAccountIds,
      CARD_PAYMENT_CATEGORY
    );

    if (updates.length === 0) return next;

    try {
      repo.applyImport([], updates);
    } catch (error) {
      console.error("카드 대금 연결을 정리하지 못했습니다:", error);
      return next;
    }

    return next.map((tx) => updates.find((update) => update.id === tx.id) ?? tx);
  };

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
    const touched = transactions.find((t) => t.id === id)?.accountId;
    try {
      repo.deleteTransaction(id);
      setTransactions((prev) =>
        reconcileCardBills(
          prev.filter((t) => t.id !== id),
          touched ? [touched] : []
        )
      );
      syncStats();
    } catch (error) {
      console.error("거래를 삭제하지 못했습니다:", error);
    }
  };

  const deleteTransactions = (ids: string[]) => {
    if (ids.length === 0) return;
    const removing = new Set(ids);
    const touched: string[] = Array.from(
      new Set(transactions.filter((t) => removing.has(t.id)).map((t) => t.accountId))
    );
    try {
      repo.deleteTransactions(ids);
      setTransactions((prev) =>
        reconcileCardBills(
          prev.filter((t) => !removing.has(t.id)),
          touched
        )
      );
      syncStats();
    } catch (error) {
      console.error("거래를 일괄 삭제하지 못했습니다:", error);
      throw error;
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
        const merged = [...withIds, ...replaced].sort((a, b) =>
          `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)
        );
        return reconcileCardBills(
          merged,
          Array.from(new Set([...withIds, ...rewritten].map((tx) => tx.accountId)))
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

  const updateAccountDetails = (
    id: string,
    details: {
      name: string;
      institution: string;
      identifier: string;
      type: ConnectedAccount["type"];
    }
  ) => {
    try {
      repo.updateAccountDetails(id, details);
      setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...details } : a)));
    } catch (error) {
      console.error("계좌 정보를 수정하지 못했습니다:", error);
      throw error;
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

  /**
   * Writes a backup out, locked with a passphrase when one is given.
   *
   * The file is the only thing that leaves the device, so it is the only place
   * a lock helps. An empty passphrase means the plain .db as before — there
   * are backups already written that way, and refusing to make another would
   * be deciding for the user.
   */
  const exportDatabaseFile = async (passphrase?: string) => {
    try {
      const plain = exportDatabaseBytes();
      const locked = passphrase ? await encryptBackup(plain, passphrase) : plain;

      const blob = new Blob([locked.slice().buffer as ArrayBuffer], {
        type: passphrase ? "application/octet-stream" : "application/x-sqlite3",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      // A different extension, so a locked file is never taken for a database
      link.download = `smartmoney-${stamp}.${passphrase ? "smbk" : "db"}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("백업 파일을 만들지 못했습니다:", error);
      throw error;
    }
  };

  /**
   * Restores a backup, unlocking it first when it is one of the locked ones.
   *
   * The passphrase is wrong or the file is damaged — AES-GCM cannot tell those
   * apart, and both mean the same thing here: nothing is written. Handing a
   * failed decryption to the database reader would open rubbish as a ledger.
   */
  const importDatabaseFile = async (file: File, passphrase?: string) => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const plain = isEncryptedBackup(bytes)
      ? await decryptBackup(bytes, passphrase || "")
      : bytes;

    await importDatabaseBytes(plain);
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
        dbError,
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
        deleteTransactions,
        importTransactions,
        addAccount,
        deleteAccount,
        setAccountBalance,
        updateAccountDetails,
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
        budgetPolicy,
        saveBudgetPolicy,
        applyBudgetPolicy,
        fixedBaselineList,
        underFixedList,
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
