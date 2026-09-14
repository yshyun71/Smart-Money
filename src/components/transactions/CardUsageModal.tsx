import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import type { Transaction } from "../../types/finance";
import { won } from "../../utils/format";
import { accountTone } from "../../utils/accountTone";
import {
  X,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";

const pad = (value: number) => String(value).padStart(2, "0");

function monthLabel(key: string): string {
  const [year, month] = (key || "").split("-");
  if (!year || !month) return "-";
  return `${year}년 ${month}월`;
}

type MonthBasis = "USED" | "BILLED";

/** An instalment is used once and billed for months, so a month means two things. */
function monthOf(tx: Transaction, basis: MonthBasis): string {
  if (basis === "BILLED") return tx.billingMonth || tx.date.slice(0, 7);
  return tx.date.slice(0, 7);
}

function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  const moved = new Date(year, month - 1 + delta, 1);
  return `${moved.getFullYear()}-${pad(moved.getMonth() + 1)}`;
}

/**
 * What a card was used for in one month, opened from the bill that settles it.
 *
 * Read-only on purpose: this is the answer to "무엇 때문에 이 금액이 나왔나",
 * and the card's own ledger is where its entries are edited.
 */
export const CardUsageModal: React.FC<{
  isOpen: boolean;
  /** The card whose usage is being read. */
  accountId: string;
  /** The month the bill was paid out of the account. */
  paidMonth: string;
  /**
   * The statement this payment settles, where one adds up to exactly the
   * amount withdrawn. The view opens on it; without one it opens on the month
   * the payment was made.
   */
  billingMonth?: string | null;
  /** The amount of that bill, shown for comparison. */
  billedAmount: number;
  onClose: () => void;
}> = ({ isOpen, accountId, paidMonth, billingMonth, billedAmount, onClose }) => {
  const { accounts, allTransactions } = useFinance();

  const [month, setMonth] = useState(paidMonth);
  const [basis, setBasis] = useState<MonthBasis>("BILLED");

  useEffect(() => {
    if (!isOpen) return;
    setMonth(billingMonth || paidMonth);
    // The bill is the question being asked, so billing month leads
    setBasis("BILLED");
  }, [isOpen, paidMonth, billingMonth]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const account = accounts.find((a: { id: string }) => a.id === accountId);

  const entries: Transaction[] = useMemo(
    () =>
      allTransactions.filter(
        (tx: Transaction) => tx.accountId === accountId && monthOf(tx, basis) === month
      ),
    [allTransactions, accountId, month, basis]
  );

  const totals = useMemo(() => {
    let spent = 0;
    let refunded = 0;
    for (const tx of entries) {
      if (tx.type === "INCOME") refunded += tx.amount;
      else spent += tx.amount;
    }
    return { spent, refunded, net: spent - refunded };
  }, [entries]);

  if (!isOpen || !account) return null;

  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  const modalContent = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
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
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                {account.name} 이용 내역
              </h3>
              <p className="text-[10px] text-slate-400 truncate">
                {monthLabel(paidMonth)} 결제 {won(billedAmount)}
                {billingMonth ? ` · ${monthLabel(billingMonth)} 명세서` : ""}
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

        {/* Which month: the one it was billed in, or the one it was used in */}
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

        {/* Month */}
        <div className="flex items-center justify-between gap-2 p-2 rounded-2xl bg-slate-50 border border-slate-200/80">
          <button
            type="button"
            onClick={() => setMonth(previous)}
            aria-label="이전 달"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-white transition cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <div className="text-xs font-black text-slate-900">{monthLabel(month)}</div>
            <div className="text-[9px] text-slate-400">이용 {entries.length}건</div>
          </div>
          <button
            type="button"
            onClick={() => setMonth(next)}
            aria-label="다음 달"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-white transition cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-100">
            <div className="text-[10px] text-rose-600">이용 합계</div>
            <div className="text-xs font-black text-rose-700">{won(totals.spent)}</div>
          </div>
          <div
            className={`p-2.5 rounded-xl border ${
              Math.round(totals.net) === Math.round(billedAmount)
                ? "bg-emerald-50 border-emerald-100"
                : "bg-slate-50 border-slate-200/80"
            }`}
          >
            <div
              className={`text-[10px] ${
                Math.round(totals.net) === Math.round(billedAmount)
                  ? "text-emerald-600"
                  : "text-slate-500"
              }`}
            >
              {Math.round(totals.net) === Math.round(billedAmount)
                ? "결제액과 일치"
                : "결제액과 차이"}
            </div>
            <div
              className={`text-xs font-black ${
                Math.round(totals.net) === Math.round(billedAmount)
                  ? "text-emerald-700"
                  : "text-slate-800"
              }`}
            >
              {won(Math.abs(totals.net - billedAmount))}
            </div>
          </div>
        </div>

        <p className="text-[10px] text-slate-400 leading-relaxed">
          {billingMonth
            ? `출금액과 합계가 정확히 일치하는 ${monthLabel(
                billingMonth
              )} 명세서를 찾아 연결했습니다.`
            : basis === "BILLED"
            ? "이 출금액과 합계가 일치하는 명세서를 찾지 못해 결제한 달로 열었습니다. 명세서를 가져올 때 결제월을 지정하면 정확히 연결됩니다."
            : "카드를 실제로 사용한 날짜 기준입니다. 청구액은 보통 전월 이용분이라 결제한 달과 다를 수 있습니다."}
        </p>

        {/* Entries */}
        {entries.length === 0 ? (
          <div className="py-10 text-center space-y-1.5">
            <CreditCard className="w-8 h-8 mx-auto text-slate-300" />
            <div className="text-xs font-bold text-slate-700">
              {monthLabel(month)}에 등록된 이용 내역이 없습니다
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              카드 명세서를 가져오면 이 카드의 이용 내역을 볼 수 있습니다.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {entries.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      tx.type === "INCOME"
                        ? "bg-emerald-50 text-emerald-600"
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
                    </div>
                  </div>
                </div>
                <span
                  className={`text-xs font-black shrink-0 ${
                    tx.type === "INCOME" ? "text-emerald-600" : "text-slate-800"
                  }`}
                >
                  {tx.type === "INCOME" ? "+" : "-"}
                  {won(tx.amount)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition active:scale-98 touch-manipulation cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
