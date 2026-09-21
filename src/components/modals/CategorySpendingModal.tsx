import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { won, withCommas } from "../../utils/format";
import { categorySpendRows } from "../../services/actuals";
import type { Transaction, ConnectedAccount } from "../../types/finance";
import { X, Calendar, Lock, ChevronRight, ArrowUpDown, CreditCard, Landmark } from "lucide-react";

/**
 * `지출: 460,000원` 뒤에 무엇이 있는지 보는 화면.
 *
 * 예산 화면은 카테고리마다 합계 하나만 보여 줍니다. 한도를 넘었다는 말은
 * 들었는데 **무엇 때문인지 모르면** 할 수 있는 일이 없습니다 — 줄여야 할 것이
 * 무엇인지, 애초에 카테고리가 잘못 붙은 건은 아닌지. 그래서 줄 단위로 펼치고,
 * 누르면 그 자리에서 고칠 수 있게 거래 수정으로 넘깁니다.
 *
 * 합계를 내는 규칙은 `categorySpendRows` 하나에서 옵니다(11.7). 이 목록의 합과
 * 위에 적힌 금액이 다르면 둘 중 무엇이 맞는지 알 수 없습니다.
 */
export const CategorySpendingModal: React.FC<{
  isOpen: boolean;
  /** 어느 카테고리인가. */
  category: string | null;
  /** 어느 달인가 (YYYY-MM). */
  month: string;
  /** 그 달 이 카테고리의 한도. 0이면 정하지 않은 것입니다. */
  budget?: number;
  /** 위에 거래 수정 화면이 떠 있는가 — 그때는 Escape 를 가로채지 않습니다(14.4). */
  suspended?: boolean;
  onClose: () => void;
  /** 한 건을 골랐습니다. 부모가 거래 수정 화면을 엽니다. */
  onPick: (transaction: Transaction) => void;
}> = ({ isOpen, category, month, budget = 0, suspended = false, onClose, onPick }) => {
  const { allTransactions, accounts } = useFinance();
  const [sortBy, setSortBy] = useState<"AMOUNT" | "DATE">("AMOUNT");

  const rows: Transaction[] = useMemo(() => {
    if (!category) return [];
    const found = categorySpendRows(allTransactions, { month, category });
    return found
      .slice()
      .sort((a: Transaction, b: Transaction) =>
        sortBy === "AMOUNT"
          ? b.amount - a.amount
          : `${b.date} ${b.time || ""}`.localeCompare(`${a.date} ${a.time || ""}`)
      );
  }, [allTransactions, month, category, sortBy]);

  /*
    큰 것부터 봅니다 — 줄일 것을 찾으러 열었을 가능성이 가장 높고, 그때
    날짜순은 도움이 되지 않습니다. 다시 열 때도 그 기준으로 시작합니다.
  */
  useEffect(() => {
    if (!isOpen) return;
    setSortBy("AMOUNT");
  }, [isOpen, category, month]);

  useEffect(() => {
    if (!isOpen || suspended) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, suspended, onClose]);

  if (!isOpen || !category) return null;

  const total = rows.reduce((sum, tx) => sum + tx.amount, 0);
  const monthName = `${Number(month.slice(5, 7)) || ""}월`;
  const over = budget > 0 ? total - budget : 0;

  const accountOf = (id: string): ConnectedAccount | undefined =>
    accounts.find((account: ConnectedAccount) => account.id === id);

  const content = (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 truncate">
              {monthName} {category} 지출
            </h3>
            <p className="text-[10px] text-slate-400">
              {rows.length}건 · 누르면 그 내역을 고칠 수 있습니다
            </p>
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

        {rows.length === 0 ? (
          <div className="py-8 text-center space-y-1.5">
            <Calendar className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs font-bold text-slate-500">
              {monthName}에 기록된 {category} 지출이 없습니다
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              카드·계좌 내역을 가져오면 이 목록이 채워집니다.
            </p>
          </div>
        ) : (
          <>
            {/* 합계 — 예산 화면에 적힌 금액과 같아야 합니다 */}
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/70 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-600">합계</span>
                <span className="text-sm font-black text-slate-900">{won(total)}</span>
              </div>
              {budget > 0 && (
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">한도 {withCommas(budget)}원</span>
                  <span className={over > 0 ? "font-bold text-rose-600" : "text-emerald-700"}>
                    {over > 0
                      ? `${withCommas(over)}원 초과`
                      : `잔여 ${withCommas(-over)}원`}
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSortBy((prev) => (prev === "AMOUNT" ? "DATE" : "AMOUNT"))}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                {sortBy === "AMOUNT" ? "금액 큰 순" : "최근 날짜 순"}
              </span>
              <span className="text-slate-400">
                {sortBy === "AMOUNT" ? "날짜순으로" : "금액순으로"} 보기
              </span>
            </button>

            <div className="space-y-1.5">
              {rows.map((tx) => {
                const account = accountOf(tx.accountId);
                const isCard = account ? account.type !== "BANK" : false;
                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => onPick(tx)}
                    className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition flex items-center gap-2.5 cursor-pointer"
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        isCard ? "bg-amber-50 text-amber-600" : "bg-indigo-50 text-indigo-600"
                      }`}
                    >
                      {isCard ? (
                        <CreditCard className="w-3.5 h-3.5" />
                      ) : (
                        <Landmark className="w-3.5 h-3.5" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {tx.merchant}
                        {tx.expenseType === "FIXED" && (
                          <Lock className="w-2.5 h-2.5 inline -mt-0.5 ml-1 text-indigo-500" />
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {tx.date.slice(5).replace("-", "/")}
                        {account ? ` · ${account.name}` : ""}
                        {tx.note ? ` · ${tx.note}` : tx.memo ? ` · ${tx.memo}` : ""}
                      </div>
                    </div>

                    <span className="text-xs font-black text-slate-800 shrink-0 whitespace-nowrap">
                      {won(tx.amount)}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  </button>
                );
              })}
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              카테고리가 잘못 붙은 건이 있으면 눌러서 바꾸세요. 같은 내역명 전체에
              적용할지도 그 화면에서 고를 수 있습니다.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
        >
          닫기
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
