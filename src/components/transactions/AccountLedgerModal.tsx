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
import { AccountEditModal } from "../modals/AccountEditModal";
import { MonthPickerModal } from "./MonthPickerModal";
import { CardUsageModal } from "./CardUsageModal";
import {
  billingTotalsFor,
  matchBillingMonth,
  matchCardForBill,
} from "../../services/cardLink";
import { CARD_PAYMENT_CATEGORY } from "../../constants/categories";
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
import { accountTone } from "../../utils/accountTone";
import { isInstalment } from "../../services/csvImport";
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
  ChevronDown,
  Tag,
  Calculator,
  UserCheck,
  Trash2,
} from "lucide-react";

type PeriodMode = "MONTH" | "RANGE";

/** 고정비 / 변동비 / 수입, or everything. */
type KindFilter = "ALL" | "FIXED" | "VARIABLE" | "INCOME";

/** A card is only ever spent on, so it is not offered a 수입 filter. */
function kindOptions(isBank: boolean): { value: KindFilter; label: string }[] {
  const options: { value: KindFilter; label: string }[] = [
    { value: "ALL", label: "전체" },
    { value: "FIXED", label: "고정비" },
    { value: "VARIABLE", label: "변동비" },
  ];
  return isBank ? [...options, { value: "INCOME", label: "수입" }] : options;
}

/** How a card charge is settled. */
type PayFilter = "ALL" | "CARD_LOAN" | "ONCE" | "INSTALMENT";

const PAY_LABELS: { value: PayFilter; label: string }[] = [
  { value: "ALL", label: "전체" },
  { value: "CARD_LOAN", label: "카드대출" },
  { value: "ONCE", label: "일시불" },
  { value: "INSTALMENT", label: "할부" },
];

/**
 * Which of the three a card line is.
 *
 * A cash advance or card loan is filed under 대출 by the classifier, and an
 * instalment says so in the 할부 column the statement carries into the memo.
 * Everything else was paid at once.
 */
function payKindOf(tx: Transaction): Exclude<PayFilter, "ALL"> {
  if (tx.category === "대출") return "CARD_LOAN";
  if (isInstalment(tx.memo || "")) return "INSTALMENT";
  return "ONCE";
}

const ALL_CATEGORIES = "__ALL__";

/** Which month an entry is counted under. */
type MonthBasis = "USED" | "BILLED";

/**
 * The month a card entry falls in, by the chosen reading.
 *
 * An instalment is used once and billed for months afterwards, so the two
 * answers differ. An entry imported before billing months were recorded has
 * only the one it was used in, which is what it was always shown under.
 */
function monthOf(tx: Transaction, basis: MonthBasis): string {
  if (basis === "BILLED") return tx.billingMonth || tx.date.slice(0, 7);
  return tx.date.slice(0, 7);
}

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
    deleteTransactions,
    categories,
    categoryRules,
    saveCategoryRules,
  } = useFinance();

  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  const [payFilter, setPayFilter] = useState<PayFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES);
  const [showHelp, setShowHelp] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isClassifying, setIsClassifying] = useState(false);
  const [progress, setProgress] = useState<ClassifyProgress | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [summary, setSummary] = useState<ClassifySummary | null>(null);

  // Which slice of the ledger is on screen
  const [periodMode, setPeriodMode] = useState<PeriodMode>("MONTH");
  const [basis, setBasis] = useState<MonthBasis>("USED");
  const [month, setMonth] = useState<string>(thisMonthKey);
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");
  /** Once the user picks a span themselves, nothing else moves it. */
  const [rangeTouched, setRangeTouched] = useState(false);

  const [showRules, setShowRules] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  /*
    연월 선택 창을 어느 칸이 열었는가.

    월별의 기준 월과 기간별의 양끝이 **같은 창**을 씁니다(§12.6) — 창은 하나만
    두고 무엇을 고르는 중인지만 기억합니다. 예전에 기간별은 `type="month"` 였고,
    기기마다 다른 모양이 떠서 같은 일을 하는 칸이 화면 안에서 달라 보였습니다.
  */
  const [monthPicker, setMonthPicker] = useState<null | "MONTH" | "FROM" | "TO">(null);
  const [showDetails, setShowDetails] = useState(false);
  /** The card bill whose month of usage is being read, if any. */
  const [usage, setUsage] = useState<{
    accountId: string;
    month: string;
    /** The statement this payment settles, when one adds up to it. */
    billingMonth: string | null;
    amount: number;
  } | null>(null);

  const account = accounts.find((a: { id: string }) => a.id === accountId);
  /*
    훅 안에서도 쓰이므로 조기 반환보다 위에 둡니다(§14.2 — 훅은 위로, 그러면
    훅이 읽는 값도 위에 있어야 합니다). 아래에서 다시 선언하면 그 훅이 초기화
    전의 값을 읽어 화면이 통째로 죽습니다.
  */
  const isBank = account?.type === "BANK";

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
    setSelected(new Set());
    setNotice(null);
    setProgress(null);
    setSummary(null);
    setShowRules(false);
    setShowBalance(false);
    setMonthPicker(null);
    setShowDetails(false);
    setUsage(null);
    setShowHelp(false);
    setPeriodMode("MONTH");
    setBasis("USED");
    setKindFilter("ALL");
    setPayFilter("ALL");
    setCategoryFilter(ALL_CATEGORIES);
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
    const months = accountEntries.map((tx) => monthOf(tx, basis)).sort();
    const newest = months[months.length - 1] || thisMonthKey();
    const oldest = months[0] || thisMonthKey();

    setMonth((prev) => (months.includes(prev) ? prev : newest));
    if (!rangeTouched) {
      setRangeFrom(oldest);
      setRangeTo(newest);
    }
  }, [isOpen, accountId, accountEntries, rangeTouched, basis]);

  // Escape to close, and no scrolling behind the sheet
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // While a sheet of our own is on top, Escape belongs to it alone —
      // otherwise one press would dismiss this sheet out from under it.
      if (
        e.key === "Escape" &&
        !summary &&
        !showRules &&
        !showBalance &&
        !monthPicker &&
        !showDetails &&
        !usage
      ) {
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, summary, showRules, showBalance, monthPicker, showDetails, usage]);

  /** True when an entry falls inside the chosen month or span. */
  const inPeriod = useMemo(() => {
    if (periodMode === "MONTH") {
      return (tx: Transaction) => monthOf(tx, basis) === month;
    }
    // An open end stays open: a span with only one side filled in still reads
    // naturally as "from here on" or "up to here".
    const from = rangeFrom || "0000-00";
    const to = rangeTo || "9999-99";
    const [low, high] = from <= to ? [from, to] : [to, from];
    return (tx: Transaction) => {
      const key = monthOf(tx, basis);
      return key >= low && key <= high;
    };
  }, [periodMode, month, rangeFrom, rangeTo, basis]);

  const entries = useMemo(
    () =>
      accountEntries
        .filter(inPeriod)
        .filter((tx) => kindFilter === "ALL" || tx.expenseType === kindFilter)
        .filter((tx) => payFilter === "ALL" || payKindOf(tx) === payFilter)
        .filter(
          (tx) => categoryFilter === ALL_CATEGORIES || tx.category === categoryFilter
        ),
    [accountEntries, inPeriod, kindFilter, payFilter, categoryFilter]
  );

  /** Only the categories this account actually uses are worth offering. */
  const categoryOptions = useMemo(() => {
    const names = new Set<string>();
    for (const tx of accountEntries) names.add(tx.category);
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ko"));
  }, [accountEntries]);

  /** What the ticked entries come to, which is why they were ticked. */
  const selectedTotals = useMemo(() => {
    let expense = 0;
    let income = 0;
    for (const tx of entries) {
      if (!selected.has(tx.id)) continue;
      if (tx.type === "INCOME") income += tx.amount;
      else expense += tx.amount;
    }

    /*
      카드는 한 덩어리를 청구하므로 차감·환불이 그 금액을 줄입니다. 계좌에서는
      들어온 돈과 나간 돈이 각각이라 더한 값이 "고른 것들의 합"입니다(9.5).
    */
    return { expense, income, total: isBank ? expense + income : expense - income };
  }, [entries, selected, isBank]);

  /** Newest month first, entries already sorted by the context. */
  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of entries) {
      const key = monthOf(tx, basis);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tx);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [entries, basis]);

  const totals = useMemo(() => {
    const income = entries
      .filter((tx) => tx.type === "INCOME")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const expense = entries
      .filter((tx) => tx.type === "EXPENSE")
      .reduce((sum, tx) => sum + tx.amount, 0);

    /*
      A card bills one figure, and money coming off it is part of that figure:
      우리카드's 차감-[청구할인] and any refund lower what is owed. Showing only
      the charges put 이용 합계 34,000원 above the 소계 the statement prints,
      and it is the same sum that has to equal a withdrawal for the bill to be
      tied to it (9.2). A bank account keeps the two apart — there 수입 is
      money arriving, not a smaller bill.
    */
    return { income, expense, billed: expense - income };
  }, [entries]);

  /** How many entries each month holds, shown under the month being viewed. */
  const monthCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of accountEntries) {
      const key = monthOf(tx, basis);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [accountEntries, basis]);

  const allSelected = entries.length > 0 && entries.every((tx) => selected.has(tx.id));
  const selectedCount = entries.filter((tx) => selected.has(tx.id)).length;

  const toggleAll = () => {
    setNotice(null);
    setSelected(allSelected ? new Set() : new Set(entries.map((tx) => tx.id)));
  };

  /** Removes what is ticked, for a statement that came in wrong. */
  const handleDeleteSelected = () => {
    const targets = entries.filter((tx) => selected.has(tx.id));
    if (targets.length === 0) return;

    if (
      !confirm(
        `선택한 ${targets.length}건을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`
      )
    ) {
      return;
    }

    try {
      deleteTransactions(targets.map((tx) => tx.id));
      setSelected(new Set());
      setNotice({ ok: true, text: `${targets.length}건을 삭제했습니다.` });
    } catch {
      setNotice({ ok: false, text: "삭제하지 못했습니다. 잠시 후 다시 시도해주세요." });
    }
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

  /**
   * Each card bill paid out of this account, tied to the one billing month of
   * its card that adds up to the same figure.
   *
   * Payments are settled oldest first and a month claimed by one is not
   * offered to the next, so two withdrawals can never point at the same
   * statement. A bill that matches nothing is left alone rather than guessed.
   */
  const billingLinks = useMemo(() => {
    const links = new Map<string, string>();
    const totalsByCard = new Map<string, Map<string, number>>();
    const claimed = new Map<string, Set<string>>();

    const payments = accountEntries
      .filter((tx) => tx.category === CARD_PAYMENT_CATEGORY && tx.linkedAccountId)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));

    for (const tx of payments) {
      const cardId = tx.linkedAccountId as string;

      if (!totalsByCard.has(cardId)) {
        totalsByCard.set(cardId, billingTotalsFor(allTransactions, cardId));
        claimed.set(cardId, new Set());
      }

      const month = matchBillingMonth(
        totalsByCard.get(cardId)!,
        tx.amount,
        tx.date.slice(0, 7),
        claimed.get(cardId)!
      );

      if (month) {
        links.set(tx.id, month);
        claimed.get(cardId)!.add(month);
      }
    }

    return links;
  }, [accountEntries, allTransactions]);

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

      /*
        Statements already spoken for. A card bill belongs to one month of one
        card, so a month another payment settles is not on offer to this run.
      */
      const inBatch = new Set(targets.map((tx) => tx.id));
      const claimedBills = new Set<string>();
      for (const [txId, month] of billingLinks) {
        if (inBatch.has(txId)) continue;
        const settled = accountEntries.find((tx) => tx.id === txId);
        if (settled?.linkedAccountId) {
          claimedBills.add(`${settled.linkedAccountId}|${month}`);
        }
      }

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
        const builtIn = builtInCategoryFor(tx.merchant, tx.type === "INCOME");
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

        let linkedAccountId = tx.linkedAccountId;
        let settles = tx.billingMonth;
        if (category === CARD_PAYMENT_CATEGORY && !linkedAccountId) {
          const bill = matchCardForBill(
            tx.merchant,
            tx.amount,
            tx.date.slice(0, 7),
            accounts,
            allTransactions,
            claimedBills
          );
          if (bill) {
            linkedAccountId = bill.accountId;
            if (bill.billingMonth) {
              settles = bill.billingMonth;
              claimedBills.add(`${bill.accountId}|${bill.billingMonth}`);
            }
          }
        }

        const updated: Transaction = {
          ...tx,
          expenseType,
          category,
          isFixedRecurring: isFixed,
          recurringDay,
          linkedAccountId,
          billingMonth: settles,
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
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 ${
                accountTone(account.type).bg
              }`}

            >
              {isBank ? <Building className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">{account.name}</h3>
              <p className="text-[10px] text-slate-400 font-mono truncate">
                {account.institution} · {account.identifier}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              aria-label={isBank ? "계좌 정보 수정" : "카드 정보 수정"}
              title={isBank ? "계좌 정보 수정" : "카드 정보 수정"}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
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

        {/*
          A balance belongs to an account. A card carries what it will bill,
          which is managed where the card is registered — so its ledger shows
          only what the period actually came to.
        */}
        {isBank ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <button
                type="button"
                onClick={() => setShowBalance(true)}
                className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-emerald-400 hover:bg-emerald-50/40 transition text-center cursor-pointer"
              >
                <div className="text-[10px] text-slate-400 flex items-center justify-center gap-0.5">
                  <span>잔액</span>
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
          </>
        ) : (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-bold text-rose-600">이용 합계</span>
              {/* 명세서의 소계와 같은 값이 되도록, 차감·환불을 뺀 금액입니다 */}
              {totals.income > 0 && (
                <div className="text-[10px] text-rose-400 font-medium">
                  이용 {won(totals.expense)} − 차감·환불 {won(totals.income)}
                </div>
              )}
            </div>
            <span className="text-sm font-black text-rose-700">{won(totals.billed)}</span>
          </div>
        )}

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

        {/* Bulk classification */}
        {accountEntries.length > 0 && (
          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClassify}
              disabled={isClassifying}
              className="flex-1 min-w-0 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-95 text-white font-bold text-[11px] transition flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer"
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

            <button
              type="button"
              onClick={() => setShowHelp((prev) => !prev)}
              aria-label="AI 자동 분류 설명"
              aria-expanded={showHelp}
              title="AI 자동 분류 설명"
              className={`w-8 h-8 shrink-0 rounded-xl border flex items-center justify-center transition cursor-pointer ${
                showHelp
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : "bg-white border-slate-200 text-slate-400 hover:text-slate-700 hover:border-slate-300"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            </div>

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

            {showHelp && (
              <p className="p-2.5 rounded-xl bg-white border border-slate-200 text-[10px] text-slate-500 leading-relaxed">
                아래에서 선택한 내역의 고정비/변동비와 카테고리를 AI가 분류합니다. 구분이
                모호하면
                <strong> 서로 다른 3개월 이상 같은 날짜대에 같은 가맹점으로 반복</strong>되는지
                보고 판단하며(공휴일·월말 차이 보정), 고정비로 분류되면 매월 결제일을 자동으로
                채웁니다. <strong>카테고리 관리</strong>의 사용자 규칙이 AI 결과보다 먼저
                적용됩니다.
              </p>
            )}
          </div>
        )}

        {/* The conditions the list below obeys: which period, and what is picked */}
        <div className="p-2.5 rounded-2xl bg-white border border-slate-200 space-y-2.5">
          {/* A card is billed in one month for what was used in another */}
          {!isBank && (
            <div>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setBasis("BILLED")}
                  className={`py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                    basis === "BILLED"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  결제월 기준
                </button>
                <button
                  type="button"
                  onClick={() => setBasis("USED")}
                  className={`py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                    basis === "USED"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  이용일자 기준
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed px-1">
                {basis === "BILLED"
                  ? "명세서에 적힌 결제월로 묶어 보여줍니다. 결제월이 기록되지 않은 내역은 이용한 달로 표시됩니다."
                  : "카드를 실제로 사용한 날짜를 기준으로 보여줍니다."}
              </p>
            </div>
          )}

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
                <button
                  type="button"
                  onClick={() => setMonthPicker("MONTH")}
                  title="조회할 연월 직접 선택"
                  className="text-center px-1.5 py-0.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                >
                  <div className="text-xs font-black text-slate-900 whitespace-nowrap flex items-center gap-1">
                    <span>{monthLabel(month)}</span>
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  </div>
                  <div className="text-[9px] text-slate-400">
                    {monthCounts.get(month) || 0}건
                  </div>
                </button>
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
              <button
                type="button"
                onClick={() => setMonthPicker("FROM")}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-900 bg-white hover:border-emerald-400 transition truncate cursor-pointer"
              >
                {rangeFrom ? monthLabel(rangeFrom) : "시작 월"}
              </button>
              <span className="text-[10px] font-bold text-slate-500 shrink-0">부터</span>
              <button
                type="button"
                onClick={() => setMonthPicker("TO")}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-900 bg-white hover:border-emerald-400 transition truncate cursor-pointer"
              >
                {rangeTo ? monthLabel(rangeTo) : "끝 월"}
              </button>
              <span className="text-[10px] font-bold text-slate-500 shrink-0">까지</span>
            </div>
          )}

          {/* 고정비·변동비 */}
          <div
            className={`grid gap-1 p-1 bg-slate-100 rounded-xl ${
              isBank ? "grid-cols-4" : "grid-cols-3"
            }`}
          >
            {kindOptions(isBank).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setKindFilter(value)}
                className={`py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                  kindFilter === value
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 일시불·할부·카드대출 */}
          {!isBank && (
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl">
              {PAY_LABELS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPayFilter(value)}
                  className={`py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                    payFilter === value
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* 카테고리 */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-900 bg-white focus:border-emerald-400 focus:outline-none"
          >
            <option value={ALL_CATEGORIES}>전체 카테고리</option>
            {categoryOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

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

            <div className="flex items-center gap-2 shrink-0">
              {selectedCount > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-700 transition cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>선택 삭제</span>
                </button>
              )}
              <span className="text-[10px] text-slate-400">조회 {entries.length}건</span>
            </div>
          </div>

          {/* What the ticked entries come to */}
          <div
            className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 ${
              selectedCount > 0 ? "bg-emerald-50" : "bg-slate-50"
            }`}
          >
            <span
              className={`text-[10px] font-bold ${
                selectedCount > 0 ? "text-emerald-700" : "text-slate-400"
              }`}
            >
              선택 {selectedCount}건 합계
            </span>
            <div className="text-right min-w-0">
              <div
                className={`text-xs font-black ${
                  selectedCount > 0 ? "text-emerald-800" : "text-slate-400"
                }`}
              >
                {won(selectedTotals.total)}
              </div>
              {selectedTotals.expense > 0 && selectedTotals.income > 0 && (
                <div className="text-[9px] text-slate-400">
                  {isBank
                    ? `지출 ${won(selectedTotals.expense)} · 수입 ${won(selectedTotals.income)}`
                    : `이용 ${won(selectedTotals.expense)} − 차감·환불 ${won(
                        selectedTotals.income
                      )}`}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Entries */}
        {entries.length === 0 ? (
          <div className="py-10 text-center space-y-1.5">
            <FileSpreadsheet className="w-8 h-8 mx-auto text-slate-300" />
            <div className="text-xs font-bold text-slate-700">
              {accountEntries.length === 0
                ? "등록된 내역이 없습니다"
                : `${periodSummary}에는 조건에 맞는 내역이 없습니다`}
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              {accountEntries.length === 0
                ? "엑셀·CSV로 가져오거나 직접 추가해보세요."
                : "위에서 기간·구분·카테고리 조건을 바꿔보세요."}
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
                    /*
                       명세서 바로가기는 계좌의 출금 건에만 답니다. 카드 내역의
                       한 줄은 그 명세서의 일부일 뿐, 명세서를 대표하지 않습니다.
                     */
                    const linkedCard =
                      tx.linkedAccountId && isBank
                        ? accounts.find(
                            (a: { id: string }) => a.id === tx.linkedAccountId
                          )
                        : null;
                    const billedMonth =
                      tx.billingMonth || billingLinks.get(tx.id) || null;
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
                          className="flex-1 min-w-0 py-2.5 flex items-center gap-2 text-left hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer group"
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
                                {linkedCard && ` · ${linkedCard.name}`}
                              </div>
                            </div>
                            <Pencil className="w-3 h-3 shrink-0 text-slate-300 group-hover:text-slate-500 transition" />
                          </div>
                        </button>

                        {/* A settled card bill opens that month's usage */}
                        {linkedCard ? (
                          <button
                            type="button"
                            onClick={() =>
                              setUsage({
                                accountId: linkedCard.id,
                                month: tx.date.slice(0, 7),
                                billingMonth: billedMonth,
                                amount: tx.amount,
                              })
                            }
                            title={
                              billedMonth
                                ? `${linkedCard.name} ${Number(
                                    billedMonth.slice(5)
                                  )}월 명세서 보기`
                                : `${linkedCard.name} 이용 내역 보기`
                            }
                            className="shrink-0 pr-3 pl-1 py-2 text-right hover:bg-indigo-50/60 rounded-lg transition cursor-pointer group/bill"
                          >
                            <div className="text-xs font-black text-indigo-700">
                              {tx.type === "INCOME" ? "+" : "-"}
                              {won(tx.amount)}
                            </div>
                            <div className="text-[10px] font-bold text-indigo-500 flex items-center justify-end gap-0.5">
                              <CreditCard className="w-2.5 h-2.5" />
                              <span>
                                {billedMonth
                                  ? `${Number(billedMonth.slice(5))}월 명세서`
                                  : "이용 내역"}
                              </span>
                              <ChevronRight className="w-2.5 h-2.5 group-hover/bill:translate-x-0.5 transition" />
                            </div>
                          </button>
                        ) : (
                          <span
                            className={`shrink-0 pr-3 pl-1 py-2.5 text-xs font-black ${
                              tx.type === "INCOME" ? "text-emerald-600" : "text-slate-800"
                            }`}
                          >
                            {tx.type === "INCOME" ? "+" : "-"}
                            {won(tx.amount)}
                          </span>
                        )}
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
      <AccountEditModal
        isOpen={showDetails}
        accountId={accountId}
        onClose={() => setShowDetails(false)}
      />
      <CardUsageModal
        isOpen={Boolean(usage)}
        accountId={usage?.accountId || ""}
        paidMonth={usage?.month || ""}
        billingMonth={usage?.billingMonth || null}
        billedAmount={usage?.amount || 0}
        onClose={() => setUsage(null)}
      />
      {/*
        하나의 창이 세 칸을 맡습니다. 기간의 양끝은 서로를 넘지 못하게 범위를
        주어, 시작이 끝보다 뒤여서 조회가 조용히 0건이 되는 일을 막습니다.
      */}
      <MonthPickerModal
        isOpen={monthPicker !== null}
        value={
          monthPicker === "FROM" ? rangeFrom || month : monthPicker === "TO" ? rangeTo || month : month
        }
        counts={monthCounts}
        title={
          monthPicker === "FROM"
            ? "시작 월 선택"
            : monthPicker === "TO"
              ? "끝 월 선택"
              : "조회할 연월 선택"
        }
        max={monthPicker === "FROM" ? rangeTo || undefined : undefined}
        min={monthPicker === "TO" ? rangeFrom || undefined : undefined}
        onSelect={(picked) => {
          if (monthPicker === "FROM") {
            setRangeTouched(true);
            setRangeFrom(picked);
          } else if (monthPicker === "TO") {
            setRangeTouched(true);
            setRangeTo(picked);
          } else {
            setMonth(picked);
          }
        }}
        onClose={() => setMonthPicker(null)}
      />
      <ClassifyResultModal summary={summary} onClose={() => setSummary(null)} />
    </>
  );
};
