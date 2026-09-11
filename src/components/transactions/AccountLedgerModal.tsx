import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import type {
  CategoryRule,
  CategoryType,
  ExpenseType,
  Transaction,
} from "../../types/finance";
import {
  activeProviderLabel,
  classifyTransactions,
  type ClassifyItem,
  type ClassifyProgress,
} from "../../services/aiClient";
import {
  ClassifyResultModal,
  type ClassifyChange,
  type ClassifySummary,
} from "./ClassifyResultModal";
import { CategoryRulesModal } from "./CategoryRulesModal";
import { BalanceEditModal } from "../modals/BalanceEditModal";
import {
  builtInCategoryFor,
  pickRule,
  suggestPattern,
  userRulesOnly,
} from "../../services/categoryRules";
import {
  buildRecurrenceIndex,
  describeRecurrence,
  recurrenceFor,
} from "../../services/recurrence";
import { asOfLabel, won } from "../../utils/format";
import {
  X,
  Search,
  Plus,
  FileSpreadsheet,
  Pencil,
  CreditCard,
  Building,
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  CheckSquare,
  Square,
  ChevronLeft,
  ChevronRight,
  Tag,
  Calculator,
  UserCheck,
} from "lucide-react";

type PeriodMode = "MONTH" | "RANGE";

const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-09" → "2026년 09월" */
function monthLabel(key: string): string {
  const [year, month] = (key || "").split("-");
  if (!year || !month) return "-";
  return `${year}년 ${month}월`;
}

/** Steps a YYYY-MM key by whole months, rolling the year over. */
function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  const moved = new Date(year, month - 1 + delta, 1);
  return `${moved.getFullYear()}-${pad(moved.getMonth() + 1)}`;
}

function thisMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/**
 * One card or account's own ledger: everything imported or entered against it,
 * newest first, narrowed to a month or a span of months, with each entry
 * opening for edit and any selection of them classifiable in bulk.
 */
export const AccountLedgerModal: React.FC<{
  isOpen: boolean;
  accountId: string;
  onClose: () => void;
  onEdit: (tx: Transaction) => void;
  onAdd: () => void;
  onImport: () => void;
}> = ({ isOpen, accountId, onClose, onEdit, onAdd, onImport }) => {
  const {
    accounts,
    allTransactions,
    updateTransactions,
    categories,
    categoryRules,
    saveCategoryRules,
  } = useFinance();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isClassifying, setIsClassifying] = useState(false);
  const [progress, setProgress] = useState<ClassifyProgress | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [summary, setSummary] = useState<ClassifySummary | null>(null);

  // Which slice of the ledger is on screen
  const [periodMode, setPeriodMode] = useState<PeriodMode>("MONTH");
  const [month, setMonth] = useState<string>(thisMonthKey);
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");
  /** Once the user picks a span themselves, nothing else moves it. */
  const [rangeTouched, setRangeTouched] = useState(false);

  const [showRules, setShowRules] = useState(false);
  const [showBalance, setShowBalance] = useState(false);

  const account = accounts.find((a: { id: string }) => a.id === accountId);

  /** Every entry on this account, before any filtering. */
  const accountEntries: Transaction[] = useMemo(
    () => allTransactions.filter((tx: Transaction) => tx.accountId === accountId),
    [allTransactions, accountId]
  );

  /*
    Reset only when the sheet opens.

    This used to share an effect with the Escape listener below, which depends
    on `onClose` — an inline arrow from the parent, so a new function on every
    parent render. Saving the classified rows re-renders the parent, the effect
    re-ran, and it cleared the result summary a moment after it appeared and
    dropped the selection meant to survive for a retry.
  */
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelected(new Set());
    setNotice(null);
    setProgress(null);
    setSummary(null);
    setShowRules(false);
    setShowBalance(false);
    setPeriodMode("MONTH");
  }, [isOpen]);

  // A span the user has not chosen belongs to whichever account is open
  useEffect(() => {
    if (!isOpen) return;
    setRangeTouched(false);
  }, [isOpen, accountId]);

  /*
    Land on a month that actually holds entries — today is empty right after a
    statement from last year is imported, and so is the month left over from
    the account opened before this one. A month the user is already reading
    stays put. The span follows everything recorded until the user sets one.
  */
  useEffect(() => {
    if (!isOpen) return;
    const months = accountEntries.map((tx) => tx.date.slice(0, 7)).sort();
    const newest = months[months.length - 1] || thisMonthKey();
    const oldest = months[0] || thisMonthKey();

    setMonth((prev) => (months.includes(prev) ? prev : newest));
    if (!rangeTouched) {
      setRangeFrom(oldest);
      setRangeTo(newest);
    }
  }, [isOpen, accountId, accountEntries, rangeTouched]);

  // Escape to close, and no scrolling behind the sheet
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // While a sheet of our own is on top, Escape belongs to it alone —
      // otherwise one press would dismiss this sheet out from under it.
      if (e.key === "Escape" && !summary && !showRules && !showBalance) onClose();
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, summary, showRules, showBalance]);

  /** True when an entry falls inside the chosen month or span. */
  const inPeriod = useMemo(() => {
    if (periodMode === "MONTH") {
      return (tx: Transaction) => tx.date.slice(0, 7) === month;
    }
    // An open end stays open: a span with only one side filled in still reads
    // naturally as "from here on" or "up to here".
    const from = rangeFrom || "0000-00";
    const to = rangeTo || "9999-99";
    const [low, high] = from <= to ? [from, to] : [to, from];
    return (tx: Transaction) => {
      const key = tx.date.slice(0, 7);
      return key >= low && key <= high;
    };
  }, [periodMode, month, rangeFrom, rangeTo]);

  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();
    return accountEntries.filter(inPeriod).filter(
      (tx) =>
        !term ||
        tx.merchant.toLowerCase().includes(term) ||
        tx.category.toLowerCase().includes(term) ||
        (tx.memo || "").toLowerCase().includes(term)
    );
  }, [accountEntries, inPeriod, query]);

  /** Newest month first, entries already sorted by the context. */
  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of entries) {
      const key = tx.date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tx);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [entries]);

  const totals = useMemo(() => {
    const income = entries
      .filter((tx) => tx.type === "INCOME")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const expense = entries
      .filter((tx) => tx.type === "EXPENSE")
      .reduce((sum, tx) => sum + tx.amount, 0);
    return { income, expense };
  }, [entries]);

  /** How many entries each month holds, shown under the month being viewed. */
  const monthCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of accountEntries) {
      const key = tx.date.slice(0, 7);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [accountEntries]);

  const allSelected = entries.length > 0 && entries.every((tx) => selected.has(tx.id));
  const selectedCount = entries.filter((tx) => selected.has(tx.id)).length;

  const toggleAll = () => {
    setNotice(null);
    setSelected(allSelected ? new Set() : new Set(entries.map((tx) => tx.id)));
  };

  const toggleOne = (id: string) => {
    setNotice(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const rulesHere: CategoryRule[] = useMemo(
    () => categoryRules.filter((rule: CategoryRule) => rule.accountId === accountId),
    [categoryRules, accountId]
  );

  /**
   * Recurrence is measured over the user's whole history, not just this
   * account's rows — the evidence for a monthly charge usually sits outside
   * whatever is selected.
   */
  const handleClassify = async () => {
    const targets = entries.filter((tx) => selected.has(tx.id));
    if (targets.length === 0) {
      setNotice({ ok: false, text: "분류할 내역을 먼저 선택해주세요." });
      return;
    }

    setIsClassifying(true);
    setNotice(null);
    setProgress({ done: 0, total: targets.length });

    try {
      const index = buildRecurrenceIndex(allTransactions);
      const confirmed = userRulesOnly(rulesHere);

      const items: ClassifyItem[] = targets.map((tx, position) => {
        const info = recurrenceFor(tx, index);
        return {
          index: position,
          date: tx.date,
          merchant: tx.merchant,
          amount: tx.amount,
          isIncome: tx.type === "INCOME",
          currentCategory: tx.category,
          currentExpenseType: tx.expenseType,
          recurrence: describeRecurrence(info),
          recurrenceQualifies: Boolean(info?.isRecurring),
          paymentDay: info?.paymentDay ?? null,
        };
      });

      const run = await classifyTransactions(items, setProgress, categories);
      const results = run.results;

      let toFixed = 0;
      let toVariable = 0;
      let categoryCorrected = 0;
      let paymentDaySet = 0;
      let unchanged = 0;
      let ruleApplied = 0;
      const changes: ClassifyChange[] = [];
      // One rule per description pattern, even when a dozen rows share it
      const learned = new Map<string, { pattern: string; category: CategoryType }>();

      const describe = (tx: Transaction) =>
        `${
          tx.expenseType === "INCOME"
            ? "수입"
            : tx.expenseType === "FIXED"
            ? "고정비"
            : "변동비"
        } · ${tx.category}${
          tx.expenseType === "FIXED" && tx.recurringDay ? ` · 매월 ${tx.recurringDay}일` : ""
        }`;

      const updates = results.flatMap((result) => {
        const tx = targets[result.index];
        if (!tx) return [];

        const expenseType: ExpenseType =
          tx.type === "INCOME"
            ? "INCOME"
            : result.expenseType === "INCOME"
            ? "VARIABLE"
            : result.expenseType;

        const isFixed = expenseType === "FIXED";

        // The billing day comes from the dates themselves, not the model
        const info = recurrenceFor(tx, index);
        const recurringDay = isFixed
          ? info?.paymentDay ?? Number(tx.date.slice(8, 10))
          : undefined;

        /*
          A rule the user confirmed outranks whatever the model says — that is
          the point of keeping the two apart. Next comes what the app can tell
          from the description alone (a card bill). Only past both does the
          model's answer stand, and that one is written back as an AI rule so
          the same description lands the same way next time.
        */
        const confirmedRule = pickRule(confirmed, tx.merchant, accountId);
        const builtIn = builtInCategoryFor(tx.merchant);
        const modelCategory = (result.category as CategoryType) || tx.category;
        const category = confirmedRule
          ? confirmedRule.category
          : builtIn ?? modelCategory;

        if (confirmedRule) {
          ruleApplied++;
        } else if (!builtIn) {
          // Nothing to learn from a description the app already recognises
          const pattern = suggestPattern(tx.merchant);
          if (pattern) learned.set(pattern, { pattern, category: modelCategory });
        }

        const typeChanged = tx.expenseType !== expenseType;
        const categoryChanged = tx.category !== category;
        const dayChanged = (tx.recurringDay ?? null) !== (recurringDay ?? null);

        if (typeChanged && isFixed) toFixed++;
        if (typeChanged && expenseType === "VARIABLE") toVariable++;
        if (categoryChanged) categoryCorrected++;
        if (dayChanged && recurringDay) paymentDaySet++;

        const updated: Transaction = {
          ...tx,
          expenseType,
          category,
          isFixedRecurring: isFixed,
          recurringDay,
        };

        if (typeChanged || categoryChanged || dayChanged) {
          changes.push({
            merchant: tx.merchant,
            date: tx.date,
            amount: tx.amount,
            before: describe(tx),
            after: describe(updated),
          });
        } else {
          unchanged++;
        }

        return [updated];
      });

      updateTransactions(updates);

      // Recorded as AI rules, which the user can review, correct or confirm in
      // 카테고리 관리. Saving never overwrites a rule the user stands behind.
      const newRules = Array.from(learned.values()).map((rule) => ({
        accountId,
        pattern: rule.pattern,
        category: rule.category,
        source: "AI" as const,
      }));
      saveCategoryRules(newRules);

      // Anything that came back is done; leave the rest selected so a retry
      // picks up exactly what failed.
      const settled = new Set(updates.map((tx) => tx.id));
      setSelected((prev) => new Set([...prev].filter((id) => !settled.has(id))));

      // Shown as a popup, so the outcome is waiting whenever the user returns
      setSummary({
        requested: targets.length,
        classified: updates.length,
        toFixed,
        toVariable,
        categoryCorrected,
        paymentDaySet,
        unchanged,
        ruleApplied,
        rulesLearned: newRules.length,
        failed: run.failed,
        error: run.error,
        provider: activeProviderLabel(),
        changes,
      });
    } catch (error) {
      // The popup carries the outcome either way — a run that classified
      // nothing still needs to say why, and the user may be away from the
      // screen when it gives up.
      setSummary({
        requested: targets.length,
        classified: 0,
        toFixed: 0,
        toVariable: 0,
        categoryCorrected: 0,
        paymentDaySet: 0,
        unchanged: 0,
        ruleApplied: 0,
        rulesLearned: 0,
        failed: targets.length,
        error: error instanceof Error ? error.message : "자동 분류에 실패했습니다.",
        provider: activeProviderLabel(),
        changes: [],
      });
    } finally {
      setIsClassifying(false);
      setProgress(null);
    }
  };

  if (!isOpen || !account) return null;

  const isBank = account.type === "BANK";
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  const periodSummary =
    periodMode === "MONTH"
      ? monthLabel(month)
      : `${monthLabel(rangeFrom || month)} ~ ${monthLabel(rangeTo || month)}`;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3.5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
              style={{ backgroundColor: account.color || "#334155" }}
            >
              {isBank ? <Building className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">{account.name}</h3>
              <p className="text-[10px] text-slate-400 font-mono truncate">
                {account.identifier}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-11 h-11 flex items-center justify-center -mr-2 -mt-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Totals — the balance tile opens for edit, which was otherwise nowhere */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <button
            type="button"
            onClick={() => setShowBalance(true)}
            className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-emerald-400 hover:bg-emerald-50/40 transition text-center cursor-pointer"
          >
            <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5">
              <span>{isBank ? "잔액" : "청구액"}</span>
              <Pencil className="w-2.5 h-2.5" />
            </div>
            <div className="text-xs font-black text-slate-900">
              {won(account.balanceOrBilled)}
            </div>
          </button>
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-100">
            <div className="text-[10px] text-rose-600">지출 합계</div>
            <div className="text-xs font-black text-rose-700">{won(totals.expense)}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
            <div className="text-[10px] text-emerald-600">수입 합계</div>
            <div className="text-xs font-black text-emerald-700">{won(totals.income)}</div>
          </div>
        </div>

        {/* Where the balance came from, and as of when */}
        <button
          type="button"
          onClick={() => setShowBalance(true)}
          className="w-full -mt-1.5 flex items-center justify-between gap-2 px-1 text-[10px] text-slate-400 hover:text-slate-600 transition cursor-pointer"
        >
          <span className="truncate">기준 {asOfLabel(account.balanceAsOf)}</span>
          <span
            className={`font-bold px-1.5 py-0.5 rounded-full shrink-0 flex items-center gap-0.5 ${
              account.balanceSource === "AUTO"
                ? "bg-indigo-100 text-indigo-700"
                : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {account.balanceSource === "AUTO" ? (
              <Calculator className="w-2.5 h-2.5" />
            ) : (
              <UserCheck className="w-2.5 h-2.5" />
            )}
            {account.balanceSource === "AUTO" ? "자동 산출" : "사용자 입력"}
          </span>
        </button>

        {/* Actions */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onImport}
            className="py-2.5 px-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] transition flex items-center justify-center gap-1 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">엑셀·CSV</span>
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="py-2.5 px-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition flex items-center justify-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">직접 추가</span>
          </button>
          <button
            type="button"
            onClick={() => setShowRules(true)}
            className="py-2.5 px-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] transition flex items-center justify-center gap-1 cursor-pointer"
          >
            <Tag className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">카테고리 관리</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="가맹점·분류·메모 검색"
            className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-emerald-400 focus:outline-none"
          />
        </div>

        {/* Bulk classification */}
        {accountEntries.length > 0 && (
          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <button
              type="button"
              onClick={handleClassify}
              disabled={isClassifying}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 text-white font-bold text-[11px] transition flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer"
            >
              {isClassifying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="truncate">
                    {progress?.note
                      ? progress.note
                      : `AI 분류 중${
                          progress ? ` (${progress.done}/${progress.total})` : ""
                        }...`}
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI 자동 분류</span>
                </>
              )}
            </button>

            {notice && (
              <div
                className={`p-2 rounded-xl text-[10px] font-bold flex items-start gap-1.5 ${
                  notice.ok
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-rose-50 text-rose-700"
                }`}
              >
                {notice.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                )}
                <span className="min-w-0 break-words whitespace-pre-line">{notice.text}</span>
              </div>
            )}

            <p className="text-[10px] text-slate-400 leading-relaxed">
              아래에서 선택한 내역의 고정비/변동비와 카테고리를 AI가 분류합니다. 구분이
              모호하면
              <strong> 서로 다른 3개월 이상 같은 날짜대에 같은 가맹점으로 반복</strong>되는지
              보고 판단하며(공휴일·월말 차이 보정), 고정비로 분류되면 매월 결제일을 자동으로
              채웁니다. <strong>카테고리 관리</strong>의 사용자 규칙이 AI 결과보다 먼저
              적용됩니다.
            </p>
          </div>
        )}

        {/* The conditions the list below obeys: which period, and what is picked */}
        <div className="p-2.5 rounded-2xl bg-white border border-slate-200 space-y-2.5">
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setPeriodMode("MONTH")}
              className={`py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                periodMode === "MONTH"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              월별
            </button>
            <button
              type="button"
              onClick={() => setPeriodMode("RANGE")}
              className={`py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                periodMode === "RANGE"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              기간별
            </button>
          </div>

          {periodMode === "MONTH" ? (
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={() => setMonth(prevMonth)}
                className="text-[10px] text-slate-400 hover:text-slate-700 transition truncate cursor-pointer"
              >
                {monthLabel(prevMonth)}
              </button>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setMonth(prevMonth)}
                  aria-label="이전 달"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-center px-1">
                  <div className="text-xs font-black text-slate-900 whitespace-nowrap">
                    {monthLabel(month)}
                  </div>
                  <div className="text-[9px] text-slate-400">
                    {monthCounts.get(month) || 0}건
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMonth(nextMonth)}
                  aria-label="다음 달"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setMonth(nextMonth)}
                className="text-[10px] text-slate-400 hover:text-slate-700 transition truncate cursor-pointer"
              >
                {monthLabel(nextMonth)}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <input
                type="month"
                value={rangeFrom}
                onChange={(e) => {
                  setRangeTouched(true);
                  setRangeFrom(e.target.value);
                }}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-2 py-1.5 text-[11px] text-slate-900 bg-white focus:border-emerald-400 focus:outline-none"
              />
              <span className="text-[10px] font-bold text-slate-500 shrink-0">부터</span>
              <input
                type="month"
                value={rangeTo}
                onChange={(e) => {
                  setRangeTouched(true);
                  setRangeTo(e.target.value);
                }}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-2 py-1.5 text-[11px] text-slate-900 bg-white focus:border-emerald-400 focus:outline-none"
              />
              <span className="text-[10px] font-bold text-slate-500 shrink-0">까지</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={toggleAll}
              disabled={entries.length === 0}
              className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 hover:text-slate-900 transition disabled:opacity-40 cursor-pointer"
            >
              {allSelected ? (
                <CheckSquare className="w-4 h-4 text-emerald-600" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span>전체 선택</span>
            </button>

            <span className="text-[10px] text-slate-400">
              {selectedCount > 0
                ? `${selectedCount}건 선택됨 · 조회 ${entries.length}건`
                : `조회 ${entries.length}건`}
            </span>
          </div>
        </div>

        {/* Entries */}
        {entries.length === 0 ? (
          <div className="py-10 text-center space-y-1.5">
            <FileSpreadsheet className="w-8 h-8 mx-auto text-slate-300" />
            <div className="text-xs font-bold text-slate-700">
              {accountEntries.length === 0
                ? "등록된 내역이 없습니다"
                : query
                ? "검색 결과가 없습니다"
                : `${periodSummary}에는 내역이 없습니다`}
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              {accountEntries.length === 0
                ? "엑셀·CSV로 가져오거나 직접 추가해보세요."
                : "위에서 다른 기간을 선택해보세요."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([key, list]) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-slate-700">
                    {monthLabel(key)}
                  </span>
                  <span className="text-[10px] text-slate-400">{list.length}건</span>
                </div>

                <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                  {list.map((tx) => {
                    const isChecked = selected.has(tx.id);
                    return (
                      <div
                        key={tx.id}
                        className={`flex items-center gap-1 transition ${
                          isChecked ? "bg-emerald-50/60" : "bg-white"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleOne(tx.id)}
                          aria-label={isChecked ? "선택 해제" : "선택"}
                          className="pl-3 pr-1 py-2.5 shrink-0 cursor-pointer"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onEdit(tx)}
                          className="flex-1 min-w-0 pr-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                tx.type === "INCOME"
                                  ? "bg-emerald-50 text-emerald-600"
                                  : tx.expenseType === "FIXED"
                                  ? "bg-indigo-50 text-indigo-600"
                                  : "bg-amber-50 text-amber-600"
                              }`}
                            >
                              {tx.type === "INCOME" ? (
                                <ArrowDownLeft className="w-3.5 h-3.5" />
                              ) : (
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-slate-900 truncate">
                                {tx.merchant}
                              </div>
                              <div className="text-[10px] text-slate-400 truncate">
                                {tx.date.slice(5).replace("-", "/")} · {tx.category}
                                {tx.expenseType === "FIXED" &&
                                  ` · 고정비${
                                    tx.recurringDay ? ` 매월 ${tx.recurringDay}일` : ""
                                  }`}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className={`text-xs font-black ${
                                tx.type === "INCOME" ? "text-emerald-600" : "text-slate-800"
                              }`}
                            >
                              {tx.type === "INCOME" ? "+" : "-"}
                              {won(tx.amount)}
                            </span>
                            <Pencil className="w-3 h-3 text-slate-300 group-hover:text-slate-500 transition" />
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[10px] text-slate-400 text-center">
          내역을 누르면 수정하거나 삭제할 수 있습니다.
        </p>

        {/* Bottom Close Button for Mobile Convenience */}
        <div className="pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition active:scale-98 touch-manipulation cursor-pointer flex items-center justify-center"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return (
    <>
      {createPortal(modalContent, document.body)}
      <CategoryRulesModal
        isOpen={showRules}
        accountId={accountId}
        onClose={() => setShowRules(false)}
      />
      <BalanceEditModal
        isOpen={showBalance}
        accountId={accountId}
        onClose={() => setShowBalance(false)}
      />
      <ClassifyResultModal summary={summary} onClose={() => setSummary(null)} />
    </>
  );
};
