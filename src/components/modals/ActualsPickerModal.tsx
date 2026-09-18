import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { won } from "../../utils/format";
import type { Transaction } from "../../types/finance";
import {
  DollarSign,
  Lock,
  X,
  CheckSquare,
  Square,
  Calendar,
} from "lucide-react";

/**
 * 어떤 내역이 그 금액을 만들었는지 열어 보고, 뺄 것을 빼는 화면.
 *
 * "실적 반영 3,482,000원"은 합계일 뿐이라, 무엇이 들어갔는지 알 수 없습니다.
 * 한 번 들어온 상여금이나 이사 비용처럼 **다음 달에는 없을 돈**이 섞여 있으면
 * 그 합계로 세운 예산은 처음부터 틀립니다. 그래서 줄 단위로 보여 주고 체크로
 * 빼게 합니다.
 *
 * 제외한 항목은 기억하지 않습니다 — 여기서 정하는 것은 예산에 쓸 **한 숫자**
 * 이고, 거래 자체는 아무것도 바뀌지 않습니다. 다시 열면 전부 선택된 상태에서
 * 시작하므로, 무엇을 뺐는지는 이 화면에서 그때그때 확인합니다.
 */
export const ActualsPickerModal: React.FC<{
  isOpen: boolean;
  /** 수입을 고르는지, 고정비를 고르는지. */
  kind: "INCOME" | "FIXED";
  /** 어느 달의 내역인지 (YYYY-MM). */
  month: string;
  onClose: () => void;
  onApply: (total: number, counted: number) => void;
}> = ({ isOpen, kind, month, onClose, onApply }) => {
  const { allTransactions } = useFinance();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const rows: Transaction[] = useMemo(() => {
    return allTransactions
      .filter((tx: Transaction) => {
        if (!tx.date.startsWith(month)) return false;
        return kind === "INCOME"
          ? tx.type === "INCOME"
          : tx.type === "EXPENSE" && tx.expenseType === "FIXED";
      })
      .slice()
      .sort((a: Transaction, b: Transaction) => b.amount - a.amount);
  }, [allTransactions, month, kind]);

  useEffect(() => {
    if (!isOpen) return;
    setExcluded(new Set());
  }, [isOpen, month, kind]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const kept = rows.filter((tx) => !excluded.has(tx.id));
  const total = kept.reduce((sum, tx) => sum + tx.amount, 0);
  const full = rows.reduce((sum, tx) => sum + tx.amount, 0);
  const allChosen = excluded.size === 0;

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const label = kind === "INCOME" ? "수입" : "고정비";
  const monthName = `${Number(month.slice(5, 7)) || ""}월`;

  const content = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                kind === "INCOME"
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-indigo-50 text-indigo-600"
              }`}
            >
              {kind === "INCOME" ? (
                <DollarSign className="w-4 h-4" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">
                {monthName} {label} 내역 {rows.length}건
              </h3>
              <p className="text-[10px] text-slate-400">
                뺄 항목의 체크를 풀고 [선택한 금액 적용]을 누르세요
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

        {rows.length === 0 ? (
          <div className="py-8 text-center space-y-1.5">
            <Calendar className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs font-bold text-slate-500">
              {monthName}에 기록된 {label} 내역이 없습니다
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {kind === "FIXED"
                ? "고정비 판정은 서로 다른 3개월 이상 반복될 때 붙습니다. 계좌·카드 내역에서 [AI 자동 분류]를 먼저 돌려보세요."
                : "계좌 내역을 먼저 가져오면 이 목록이 채워집니다."}
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                setExcluded(allChosen ? new Set(rows.map((tx) => tx.id)) : new Set())
              }
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70 text-[11px] font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                {allChosen ? (
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-400" />
                )}
                전체 선택
              </span>
              <span className="text-slate-400">
                {kept.length}/{rows.length}건
              </span>
            </button>

            <div className="space-y-1.5">
              {rows.map((tx) => {
                const chosen = !excluded.has(tx.id);
                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => toggle(tx.id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition flex items-center gap-2.5 cursor-pointer ${
                      chosen
                        ? "bg-white border-slate-200"
                        : "bg-slate-50 border-slate-200/60 opacity-60"
                    }`}
                  >
                    {chosen ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-300 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs font-bold truncate ${
                          chosen ? "text-slate-900" : "text-slate-400 line-through"
                        }`}
                      >
                        {tx.merchant}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {tx.date.slice(5).replace("-", "/")} · {tx.category}
                        {tx.note ? ` · ${tx.note}` : ""}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-black shrink-0 ${
                        chosen ? "text-slate-800" : "text-slate-400 line-through"
                      }`}
                    >
                      {won(tx.amount)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-100">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-800">선택한 금액</span>
                <span className="text-sm font-black text-emerald-900">{won(total)}</span>
              </div>
              {excluded.size > 0 && (
                <p className="text-[10px] text-emerald-700 mt-0.5">
                  {excluded.size}건 제외 · 전체는 {won(full)}이었습니다
                </p>
              )}
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              거래 내역 자체는 바뀌지 않습니다. 여기서 정한 금액이 예산 화면의{" "}
              {label} 칸에만 들어갑니다.
            </p>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
          >
            닫기
          </button>
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() => {
              onApply(total, kept.length);
              onClose();
            }}
            className="py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer disabled:opacity-40"
          >
            선택한 금액 적용
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
