import React, { useState } from "react";
import { useFinance } from "../../context/FinanceContext";
import { monthPhase } from "../../services/actuals";
import { ActualsPickerModal } from "../modals/ActualsPickerModal";
import { AddTransactionModal } from "../transactions/AddTransactionModal";
import type { ActualKind } from "../../services/actuals";
import { shortWon } from "../../utils/format";
import { TrendingUp, TrendingDown, PiggyBank, Sparkles, ChevronRight } from "lucide-react";
import type { Transaction } from "../../types/finance";

export const SummaryCard: React.FC<{ onNavigateToSavings?: () => void }> = ({
  onNavigateToSavings,
}) => {
  const {
    totalIncome,
    incomeSplit,
    totalExpense,
    netSavings,
    fixedExpenseTotal,
    variableExpenseTotal,
    implementedSavingsTotal,
    aiAnalysis,
    aiAnalysisDrift,
    selectedMonth,
  } = useFinance();

  /** 어느 금액의 속을 보는 중인가. 넷 다 같은 창을 씁니다(§11.7과 같은 길). */
  const [looking, setLooking] = useState<ActualKind | null>(null);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const expenseRatio =
    totalIncome > 0 ? Math.min(Math.round((totalExpense / totalIncome) * 100), 100) : 0;

  /*
    제목이 달을 따라갑니다.

    카드의 숫자는 전부 고른 달의 것인데 제목만 `이번 달`로 고정돼 있었습니다 —
    7월을 보고 있으면 **틀린 말**입니다. 달 이름을 적고, 이번 달이 아닐 때만
    그 사실을 배지로 알립니다(§12.5의 "어느 달의 값인지 이름이 답한다").
  */
  const monthName = `${Number((selectedMonth || "").slice(5, 7)) || ""}월`;
  const phase = monthPhase(selectedMonth);
  const phaseLabel = phase === "PAST" ? "지난 달" : phase === "FUTURE" ? "다음 달" : null;

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-3xl p-5 shadow-lg shadow-slate-900/10 relative overflow-hidden">
      {/* Decorative subtle ambient circle */}
      <div className="absolute -top-10 -right-10 w-36 h-36 bg-emerald-500/15 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-teal-500/15 rounded-full blur-2xl pointer-events-none" />

      {/* Top Header info */}
      <div className="flex items-center justify-between relative z-10 mb-3 gap-2">
        <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5 min-w-0">
          <span className="truncate">
            {selectedMonth.slice(0, 4)}년 {monthName} 가계부 결산
          </span>
          {phaseLabel && (
            <span className="text-[9px] font-bold text-slate-400 bg-slate-700/60 px-1.5 py-0.5 rounded-full shrink-0">
              {phaseLabel}
            </span>
          )}
        </span>

        {/*
          재무 점수는 **그 달의 AI 분석 결과**입니다(`ai_analyses` PK(user_id, month)).
          분석을 돌리지 않은 달에는 없으므로 예전에는 배지가 아예 사라졌고, 왜
          없는지 알 방법이 없었습니다 — 최근 달에서만 보이는 이유입니다.
          숫자를 지어내지 않되 **자리는 지킵니다**(§12.2).
        */}
        <button
          type="button"
          onClick={onNavigateToSavings}
          className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0 transition cursor-pointer ${
            aiAnalysis
              ? aiAnalysisDrift?.stale
                ? "bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30"
                : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30"
              : "bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700"
          }`}
        >
          <Sparkles
            className={`w-3 h-3 ${aiAnalysis ? (aiAnalysisDrift?.stale ? "text-amber-400" : "text-emerald-400") : "text-slate-500"}`}
          />
          <span className="whitespace-nowrap">
            {aiAnalysis
              ? `재무 점수 ${aiAnalysis.healthScore}점${aiAnalysisDrift?.stale ? " · 갱신 필요" : ""}`
              : `${monthName} 분석 전`}
          </span>
          <ChevronRight className="w-2.5 h-2.5 opacity-70" />
        </button>
      </div>

      {/* Main Net Savings / Remaining balance */}
      <div className="relative z-10 mb-4">
        <div className="text-xs text-slate-400 font-medium">
          {monthName} 잔여 / 저축 가능액
        </div>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span
            className={`text-2xl font-black tracking-tight ${
              netSavings >= 0 ? "text-white" : "text-rose-400"
            }`}
          >
            {netSavings >= 0 ? "+" : ""}
            {netSavings.toLocaleString()}
          </span>
          <span className="text-sm font-semibold text-slate-300">원</span>
        </div>
      </div>

      {/* Income & Expense Two Column Grid */}
      <div className="grid grid-cols-2 gap-3 relative z-10 pt-3 border-t border-slate-700/60 mb-4">
        {/*
          네 금액 모두 누르면 그 속이 열립니다 — 예산·소비분석의 카테고리 금액과
          같은 길입니다(§11.7). 합계만 보여 주는 화면은 "무엇 때문인가"에 답하지
          못하고, 그러면 사용자가 할 수 있는 일이 없습니다.
        */}
        <button
          type="button"
          onClick={() => setLooking("INCOME")}
          className="bg-slate-800/60 rounded-2xl p-2.5 border border-slate-700/40 text-left hover:bg-slate-800 hover:border-slate-600 transition cursor-pointer"
        >
          <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium mb-0.5">
            <TrendingUp className="w-3 h-3" />
            <span>총 수입</span>
            <ChevronRight className="w-2.5 h-2.5 text-slate-500 ml-auto" />
          </div>
          <div className="text-base font-bold text-white tracking-tight">
            {totalIncome.toLocaleString()}
            <span className="text-xs font-normal text-slate-400 ml-0.5">원</span>
          </div>
          {/*
            **다음 달에도 들어올 돈이 얼마인가** (§6.6).

            합계 하나로는 그 달만 유난히 큰 이유를 알 수 없습니다 — 급여와 어쩌다
            들어온 환급금이 한 덩어리이기 때문입니다. 고정비/변동비를 가른 것과
            같은 까닭으로 가릅니다.
          */}
          {incomeSplit.fixed > 0 && (
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              고정 {shortWon(incomeSplit.fixed)}
              {incomeSplit.variable > 0 && ` · 변동 ${shortWon(incomeSplit.variable)}`}
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={() => setLooking("EXPENSE")}
          className="bg-slate-800/60 rounded-2xl p-2.5 border border-slate-700/40 text-left hover:bg-slate-800 hover:border-slate-600 transition cursor-pointer"
        >
          <div className="flex items-center gap-1 text-[11px] text-rose-400 font-medium mb-0.5">
            <TrendingDown className="w-3 h-3" />
            <span>총 지출</span>
            <ChevronRight className="w-2.5 h-2.5 text-slate-500 ml-auto" />
          </div>
          <div className="text-base font-bold text-white tracking-tight">
            {totalExpense.toLocaleString()}
            <span className="text-xs font-normal text-slate-400 ml-0.5">원</span>
          </div>
        </button>
      </div>

      {/* Spending Progress Bar vs Income */}
      <div className="relative z-10 mb-3">
        <div className="flex items-center justify-between text-[11px] mb-1.5">
          <span className="text-slate-400">수입 대비 지출률</span>
          <span className="font-bold text-slate-200">{expenseRatio}%</span>
        </div>
        <div className="w-full h-2.5 bg-slate-700/60 rounded-full overflow-hidden p-0.5">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              expenseRatio > 80
                ? "bg-rose-500"
                : expenseRatio > 60
                ? "bg-amber-400"
                : "bg-emerald-400"
            }`}
            style={{ width: `${Math.min(expenseRatio, 100)}%` }}
          />
        </div>
      </div>

      {/* Fixed vs Variable Mini Breakdown Badges */}
      <div className="relative z-10 flex items-center justify-between text-xs bg-slate-800/40 rounded-xl border border-slate-700/30">
        <button
          type="button"
          onClick={() => setLooking("FIXED")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-l-xl hover:bg-slate-700/40 transition cursor-pointer min-w-0"
        >
          <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
          <span className="text-slate-400 text-[11px]">고정비:</span>
          <span className="font-semibold text-slate-200 text-[11px] truncate">
            {fixedExpenseTotal.toLocaleString()}원
          </span>
        </button>
        <div className="w-px h-3 bg-slate-700 shrink-0" />
        <button
          type="button"
          onClick={() => setLooking("VARIABLE")}
          className="flex items-center gap-1.5 px-3 py-2 rounded-r-xl hover:bg-slate-700/40 transition cursor-pointer min-w-0"
        >
          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
          <span className="text-slate-400 text-[11px]">변동비:</span>
          <span className="font-semibold text-slate-200 text-[11px] truncate">
            {variableExpenseTotal.toLocaleString()}원
          </span>
        </button>
      </div>

      {/* Implemented Savings Callout (if any) */}
      {implementedSavingsTotal > 0 && (
        <button
          onClick={onNavigateToSavings}
          className="mt-3 w-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-xl p-2 flex items-center justify-between text-emerald-300 transition text-xs"
        >
          <div className="flex items-center gap-1.5">
            <PiggyBank className="w-4 h-4 text-emerald-400" />
            <span className="font-medium">실천한 절약으로 아낀 돈</span>
          </div>
          <span className="font-bold">+{implementedSavingsTotal.toLocaleString()}원/월</span>
        </button>
      )}

      {/*
        읽기 전용 목록. 이 금액들은 적는 값이 아니라 실적이므로 고를 것이 없고,
        줄을 누르면 그 거래를 고치러 갑니다.
      */}
      <ActualsPickerModal
        isOpen={looking !== null}
        kind={looking ?? "EXPENSE"}
        month={selectedMonth}
        readOnly
        onPick={(transaction) => setEditingTx(transaction)}
        onClose={() => setLooking(null)}
        onApply={() => {}}
      />

      <AddTransactionModal
        isOpen={editingTx !== null}
        editing={editingTx}
        onClose={() => setEditingTx(null)}
      />
    </div>
  );
};
