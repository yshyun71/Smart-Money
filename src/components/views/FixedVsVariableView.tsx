import React, { useState, useMemo } from "react";
import { useFinance } from "../../context/FinanceContext";
import { TransactionItem } from "../transactions/TransactionItem";
import {
  Pin,
  ShoppingBag,
  Calendar,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  TrendingDown,
  ChevronRight,
} from "lucide-react";

export const FixedVsVariableView: React.FC<{
  onNavigateToSavings: () => void;
}> = ({ onNavigateToSavings }) => {
  const {
    transactions,
    fixedExpenseTotal,
    variableExpenseTotal,
    totalExpense,
    totalIncome,
    fixedRatio,
    variableRatio,
    aiAnalysis,
  } = useFinance();

  const [activeSubTab, setActiveSubTab] = useState<"FIXED" | "VARIABLE">("FIXED");

  // Fixed transactions
  const fixedItems = useMemo(() => {
    return transactions.filter(
      (tx) => tx.type === "EXPENSE" && tx.expenseType === "FIXED"
    );
  }, [transactions]);

  // Variable transactions
  const variableItems = useMemo(() => {
    return transactions.filter(
      (tx) => tx.type === "EXPENSE" && tx.expenseType === "VARIABLE"
    );
  }, [transactions]);

  // Category breakdown for variable items
  const variableCategoryStats = useMemo(() => {
    const map: { [cat: string]: number } = {};
    variableItems.forEach((tx) => {
      map[tx.category] = (map[tx.category] || 0) + tx.amount;
    });

    return Object.entries(map)
      .map(([cat, amount]) => ({
        cat,
        amount,
        percentage:
          variableExpenseTotal > 0 ? (amount / variableExpenseTotal) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [variableItems, variableExpenseTotal]);

  // Top spending merchants in variable
  const variableTopMerchants = useMemo(() => {
    const map: { [m: string]: number } = {};
    variableItems.forEach((tx) => {
      map[tx.merchant] = (map[tx.merchant] || 0) + tx.amount;
    });

    return Object.entries(map)
      .map(([merchant, amount]) => ({ merchant, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [variableItems]);

  return (
    <div className="space-y-4 pb-24 pt-1">
      {/* Top Title & Sub-Tab Switcher */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              고정비 vs 변동비 심층 분석
            </h2>
            <p className="text-[11px] text-slate-500">
              숨만 쉬어도 나가는 고정비와 일상 소비 패턴을 정밀 진단합니다.
            </p>
          </div>
        </div>

        {/* Dual Tab Buttons */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
          <button
            onClick={() => setActiveSubTab("FIXED")}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition ${
              activeSubTab === "FIXED"
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Pin className="w-3.5 h-3.5 rotate-45" />
            <span>월간 고정비 ({fixedItems.length}건)</span>
          </button>

          <button
            onClick={() => setActiveSubTab("VARIABLE")}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition ${
              activeSubTab === "VARIABLE"
                ? "bg-amber-500 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>월간 변동비 ({variableItems.length}건)</span>
          </button>
        </div>
      </div>

      {/* FIXED EXPENSES TAB */}
      {activeSubTab === "FIXED" && (
        <div className="space-y-4 animate-in fade-in">
          {/* Fixed Overview Card */}
          <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-900 text-white rounded-3xl p-5 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between text-xs text-indigo-200 mb-1">
              <span>이번 달 고정비 지출 총액</span>
              <span className="bg-indigo-700/60 px-2 py-0.5 rounded-full font-semibold">
                총 지출의 {Math.round(fixedRatio)}%
              </span>
            </div>
            <div className="text-2xl font-black tracking-tight text-white mb-3">
              {fixedExpenseTotal.toLocaleString()}원
            </div>

            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-indigo-700/50 text-xs">
              <div>
                <span className="text-[11px] text-indigo-300">월 수입 대비 비중</span>
                <div className="font-bold text-white text-sm">
                  {totalIncome > 0
                    ? `${Math.round((fixedExpenseTotal / totalIncome) * 100)}%`
                    : "0%"}
                  <span className="text-[10px] text-indigo-300 font-normal ml-1">
                    (권장 35% 이내)
                  </span>
                </div>
              </div>
              <div>
                <span className="text-[11px] text-indigo-300">연간 누적 예상치</span>
                <div className="font-bold text-white text-sm">
                  {(fixedExpenseTotal * 12).toLocaleString()}원
                </div>
              </div>
            </div>
          </div>

          {/* AI Fixed Cost Leak Tip Banner */}
          <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="font-bold text-[11px] text-amber-950">
                고정비 누수 감지: 알뜰폰 전환 & OTT 정기구독 정리
              </div>
              <p className="text-[11px] text-amber-800 leading-snug">
                통신비(85,000원)와 4개 정기구독(넷플릭스, 유튜브, 디즈니+, 쿠팡)에
                매달 약 134,690원이 자동 청구되고 있습니다.
              </p>
              <button
                onClick={onNavigateToSavings}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 underline mt-1"
              >
                <Sparkles className="w-3 h-3 text-amber-600" />
                <span>AI가 추천하는 고정비 월 61,900원 절약법 보기 →</span>
              </button>
            </div>
          </div>

          {/* Fixed Items Recurring List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-900">
                  매월 고정 지출 항목 리스트 ({fixedItems.length}개)
                </h3>
              </div>
              <span className="text-[10px] text-slate-400">자동이체 / 카드청구</span>
            </div>

            <div className="space-y-1.5">
              {fixedItems.map((item) => (
                <TransactionItem key={item.id} transaction={item} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VARIABLE EXPENSES TAB */}
      {activeSubTab === "VARIABLE" && (
        <div className="space-y-4 animate-in fade-in">
          {/* Variable Overview Card */}
          <div className="bg-gradient-to-br from-amber-600 to-orange-700 text-white rounded-3xl p-5 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between text-xs text-amber-100 mb-1">
              <span>이번 달 변동비 지출 총액</span>
              <span className="bg-amber-700/60 px-2 py-0.5 rounded-full font-semibold">
                총 지출의 {Math.round(variableRatio)}%
              </span>
            </div>
            <div className="text-2xl font-black tracking-tight text-white mb-3">
              {variableExpenseTotal.toLocaleString()}원
            </div>

            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-amber-500/50 text-xs">
              <div>
                <span className="text-[11px] text-amber-200">일 평균 지출액</span>
                <div className="font-bold text-white text-sm">
                  {Math.round(variableExpenseTotal / 8).toLocaleString()}원/일
                </div>
              </div>
              <div>
                <span className="text-[11px] text-amber-200">주요 지출처</span>
                <div className="font-bold text-white text-sm truncate">
                  배달앱 / 외식 / 카페
                </div>
              </div>
            </div>
          </div>

          {/* Category Breakdown Progress Bars */}
          <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-900">
              변동비 카테고리별 비중
            </h3>

            <div className="space-y-2.5">
              {variableCategoryStats.map((stat) => (
                <div key={stat.cat} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{stat.cat}</span>
                    <span className="font-bold text-slate-900">
                      {stat.amount.toLocaleString()}원 ({Math.round(stat.percentage)}%)
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all"
                      style={{ width: `${stat.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top 5 Variable Merchants */}
          <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs">
            <h3 className="text-xs font-bold text-slate-900 mb-2.5">
              가장 많이 쓴 곳 TOP 5
            </h3>
            <div className="divide-y divide-slate-100">
              {variableTopMerchants.map((m, idx) => (
                <div
                  key={m.merchant}
                  className="py-2 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 font-bold text-[10px] flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-slate-800">
                      {m.merchant}
                    </span>
                  </div>
                  <span className="font-bold text-slate-900">
                    {m.amount.toLocaleString()}원
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Variable Items List */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-900 px-1">
              변동 지출 전체 내역 ({variableItems.length}개)
            </h3>
            <div className="space-y-1.5">
              {variableItems.map((item) => (
                <TransactionItem key={item.id} transaction={item} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
