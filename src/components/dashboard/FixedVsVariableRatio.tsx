import React from "react";
import { useFinance } from "../../context/FinanceContext";
import { Pin, ShoppingBag, Info, AlertCircle, CheckCircle2 } from "lucide-react";

export const FixedVsVariableRatio: React.FC<{
  onTabSelect?: (tab: "fixed_variable" | "ai_coach") => void;
}> = ({ onTabSelect }) => {
  const {
    fixedExpenseTotal,
    variableExpenseTotal,
    totalExpense,
    fixedRatio,
    variableRatio,
    aiAnalysis,
  } = useFinance();

  const isHealthyFixed = fixedRatio <= 45;

  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-xs">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-bold text-slate-900 tracking-tight">
            고정비 vs 변동비 분석
          </h2>
          <span className="text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-sm">
            지출 구조
          </span>
        </div>
        {onTabSelect && (
          <button
            onClick={() => onTabSelect("fixed_variable")}
            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
          >
            상세보기 →
          </button>
        )}
      </div>

      {/* Stacked Proportional Bar */}
      <div className="space-y-1.5 mb-4">
        <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex p-0.5">
          <div
            className="bg-indigo-600 rounded-l-full transition-all duration-500"
            style={{ width: `${Math.max(fixedRatio, 5)}%` }}
            title={`고정비 ${Math.round(fixedRatio)}%`}
          />
          <div
            className="bg-amber-500 rounded-r-full transition-all duration-500"
            style={{ width: `${Math.max(variableRatio, 5)}%` }}
            title={`변동비 ${Math.round(variableRatio)}%`}
          />
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between text-xs pt-1">
          <div className="flex items-center gap-1.5 text-indigo-700 font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
            <span>고정비 {Math.round(fixedRatio)}%</span>
          </div>
          <div className="flex items-center gap-1.5 text-amber-700 font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>변동비 {Math.round(variableRatio)}%</span>
          </div>
        </div>
      </div>

      {/* Two cards detailing each */}
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        {/* Fixed card */}
        <div className="bg-indigo-50/60 rounded-2xl p-3 border border-indigo-100/80">
          <div className="flex items-center gap-1.5 text-indigo-900 text-xs font-bold mb-1">
            <Pin className="w-3.5 h-3.5 text-indigo-600 rotate-45" />
            <span>월간 고정비</span>
          </div>
          <div className="text-base font-extrabold text-indigo-950 tracking-tight">
            {fixedExpenseTotal.toLocaleString()}원
          </div>
          <p className="text-[10px] text-indigo-700/80 mt-1 leading-tight">
            월세, 관리비, 통신비, 정기구독, 보험료 등
          </p>
        </div>

        {/* Variable card */}
        <div className="bg-amber-50/60 rounded-2xl p-3 border border-amber-100/80">
          <div className="flex items-center gap-1.5 text-amber-900 text-xs font-bold mb-1">
            <ShoppingBag className="w-3.5 h-3.5 text-amber-600" />
            <span>월간 변동비</span>
          </div>
          <div className="text-base font-extrabold text-amber-950 tracking-tight">
            {variableExpenseTotal.toLocaleString()}원
          </div>
          <p className="text-[10px] text-amber-700/80 mt-1 leading-tight">
            식비, 배달앱, 카페, 쇼핑, 택시 등 일상소비
          </p>
        </div>
      </div>

      {/* Financial Health Tip / Rule of Thumb */}
      <div
        className={`p-3 rounded-2xl border text-xs flex items-start gap-2 ${
          isHealthyFixed
            ? "bg-emerald-50/70 border-emerald-100 text-emerald-900"
            : "bg-amber-50/70 border-amber-100 text-amber-900"
        }`}
      >
        {isHealthyFixed ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        )}
        <div className="space-y-0.5 leading-snug">
          <div className="font-bold text-[11px]">
            {isHealthyFixed
              ? "고정비 비중이 안정적입니다"
              : "고정비 비중이 다소 높은 편입니다"}
          </div>
          <p className="text-[11px] text-slate-600">
            {aiAnalysis?.fixedRatioAnalysis ||
              "고정비는 총 지출의 40% 이하로 유지하는 것이 이상적입니다. 미사용 구독 및 통신 요금제를 점검해보세요."}
          </p>
        </div>
      </div>
    </div>
  );
};
