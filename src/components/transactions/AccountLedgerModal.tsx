import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import type { CategoryType, ExpenseType, Transaction } from "../../types/finance";
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
import {
  buildRecurrenceIndex,
  describeRecurrence,
  recurrenceFor,
} from "../../services/recurrence";
import { won } from "../../utils/format";
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
} from "lucide-react";

/**
 * One card or account's own ledger: everything imported or entered against it,
 * newest first, with each entry opening for edit and any selection of them
 * classifiable in bulk.
 */
export const AccountLedgerModal: React.FC<{
  isOpen: boolean;
  accountId: string;
  onClose: () => void;
  onEdit: (tx: Transaction) => void;
  onAdd: () => void;
  onImport: () => void;
}> = ({ isOpen, accountId, onClose, onEdit, onAdd, onImport }) => {
  const { accounts, allTransactions, updateTransactions } = useFinance();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isClassifying, setIsClassifying] = useState(false);
  const [progress, setProgress] = useState<ClassifyProgress | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [summary, setSummary] = useState<ClassifySummary | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelected(new Set());
    setNotice(null);
    setProgress(null);
    setSummary(null);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const account = accounts.find((a) => a.id === accountId);

  const entries = useMemo(() => {
    const term = query.trim().toLowerCase();
    return allTransactions
      .filter((tx) => tx.accountId === accountId)
      .filter(
        (tx) =>
          !term ||
          tx.merchant.toLowerCase().includes(term) ||
          tx.category.toLowerCase().includes(term) ||
          (tx.memo || "").toLowerCase().includes(term)
      );
  }, [allTransactions, accountId, query]);

  /** Newest month first, entries already sorted by the context. */
  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of entries) {
      const month = tx.date.slice(0, 7);
      if (!map.has(month)) map.set(month, []);
      map.get(month)!.push(tx);
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

      const run = await classifyTransactions(items, setProgress);
      const results = run.results;

      let toFixed = 0;
      let toVariable = 0;
      let categoryCorrected = 0;
      let paymentDaySet = 0;
      let unchanged = 0;
      const changes: ClassifyChange[] = [];

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

        const category = (result.category as CategoryType) || tx.category;

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
        failed: run.failed,
        error: run.error,
        provider: activeProviderLabel(),
        changes,
      });
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : "자동 분류에 실패했습니다.",
      });
    } finally {
      setIsClassifying(false);
      setProgress(null);
    }
  };

  if (!isOpen || !account) return null;

  const isBank = account.type === "BANK";

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

        {/* Totals */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="text-[10px] text-slate-400">{isBank ? "잔액" : "청구액"}</div>
            <div className="text-xs font-black text-slate-900">
              {won(account.balanceOrBilled)}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-100">
            <div className="text-[10px] text-rose-600">지출 합계</div>
            <div className="text-xs font-black text-rose-700">{won(totals.expense)}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
            <div className="text-[10px] text-emerald-600">수입 합계</div>
            <div className="text-xs font-black text-emerald-700">{won(totals.income)}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onImport}
            className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>엑셀·CSV 가져오기</span>
          </button>
          <button
            type="button"
            onClick={onAdd}
            className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>직접 추가</span>
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

        {/* Bulk classification bar */}
        {entries.length > 0 && (
          <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 hover:text-slate-900 transition cursor-pointer"
              >
                {allSelected ? (
                  <CheckSquare className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400" />
                )}
                <span>전체 선택</span>
              </button>

              <span className="text-[10px] text-slate-400">
                {selectedCount > 0 ? `${selectedCount}건 선택됨` : `총 ${entries.length}건`}
              </span>
            </div>

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
              선택한 내역의 고정비/변동비와 카테고리를 AI가 분류합니다. 구분이 모호하면
              <strong> 서로 다른 3개월 이상 같은 날짜대에 같은 가맹점으로 반복</strong>되는지
              보고 판단하며(공휴일·월말 차이 보정), 고정비로 분류되면 매월 결제일을 자동으로
              채웁니다.
            </p>
          </div>
        )}

        {/* Entries */}
        {entries.length === 0 ? (
          <div className="py-10 text-center space-y-1.5">
            <FileSpreadsheet className="w-8 h-8 mx-auto text-slate-300" />
            <div className="text-xs font-bold text-slate-700">
              {query ? "검색 결과가 없습니다" : "등록된 내역이 없습니다"}
            </div>
            {!query && (
              <p className="text-[10px] text-slate-400 leading-relaxed">
                엑셀·CSV로 가져오거나 직접 추가해보세요.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([month, list]) => (
              <div key={month} className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-slate-700">
                    {month.replace("-", "년 ")}월
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
      <ClassifyResultModal summary={summary} onClose={() => setSummary(null)} />
    </>
  );
};
