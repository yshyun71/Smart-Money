import React from "react";
import { useFinance } from "../../context/FinanceContext";
import { TrendingUp, TrendingDown, PiggyBank, Sparkles } from "lucide-react";

export const SummaryCard: React.FC<{ onNavigateToSavings?: () => void }> = ({
  onNavigateToSavings,
}) => {
  const {
    totalIncome,
    totalExpense,
    netSavings,
    fixedExpenseTotal,
    variableExpenseTotal,
    implementedSavingsTotal,
    aiAnalysis,
  } = useFinance();

  const expenseRatio =
    totalIncome > 0 ? Math.min(Math.round((totalExpense / totalIncome) * 100), 100) : 0;

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-3xl p-5 shadow-lg shadow-slate-900/10 relative overflow-hidden">
      {/* Decorative subtle ambient circle */}
      <div className="absolute -top-10 -right-10 w-36 h-36 bg-emerald-500/15 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-teal-500/15 rounded-full blur-2xl pointer-events-none" />

      {/* Top Header info */}
      <div className="flex items-center justify-between relative z-10 mb-3">
        <span className="text-xs font-medium text-slate-400">이번 달 가계부 결산</span>
        {aiAnalysis && (
          <div className="flex items-center gap-1 bg-emerald-500/20 text-emerald-300 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>재무 점수 {aiAnalysis.healthScore}점</span>
          </div>
        )}
      </div>

      {/* Main Net Savings / Remaining balance */}
      <div className="relative z-10 mb-4">
        <div className="text-xs text-slate-400 font-medium">이번 달 잔여 / 저축 가능액</div>
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
        {/* Total Income */}
        <div className="bg-slate-800/60 rounded-2xl p-2.5 border border-slate-700/40">
          <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium mb-0.5">
            <TrendingUp className="w-3 h-3" />
            <span>총 수입</span>
          </div>
          <div className="text-base font-bold text-white tracking-tight">
            {totalIncome.toLocaleString()}
            <span className="text-xs font-normal text-slate-400 ml-0.5">원</span>
          </div>
        </div>

        {/* Total Expense */}
        <div className="bg-slate-800/60 rounded-2xl p-2.5 border border-slate-700/40">
          <div className="flex items-center gap-1 text-[11px] text-rose-400 font-medium mb-0.5">
            <TrendingDown className="w-3 h-3" />
            <span>총 지출</span>
          </div>
          <div className="text-base font-bold text-white tracking-tight">
            {totalExpense.toLocaleString()}
            <span className="text-xs font-normal text-slate-400 ml-0.5">원</span>
          </div>
        </div>
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
      <div className="relative z-10 flex items-center justify-between text-xs bg-slate-800/40 rounded-xl px-3 py-2 border border-slate-700/30">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-400" />
          <span className="text-slate-400 text-[11px]">고정비:</span>
          <span className="font-semibold text-slate-200 text-[11px]">
            {fixedExpenseTotal.toLocaleString()}원
          </span>
        </div>
        <div className="w-px h-3 bg-slate-700" />
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-slate-400 text-[11px]">변동비:</span>
          <span className="font-semibold text-slate-200 text-[11px]">
            {variableExpenseTotal.toLocaleString()}원
          </span>
        </div>
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
    </div>
  );
};
