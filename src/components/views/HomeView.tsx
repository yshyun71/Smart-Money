import React, { useState } from "react";
import { useFinance } from "../../context/FinanceContext";
import { spareOf } from "../../services/budgetPolicy";
import { SummaryCard } from "../dashboard/SummaryCard";
import { FixedVsVariableRatio } from "../dashboard/FixedVsVariableRatio";
import { TransactionItem } from "../transactions/TransactionItem";
import { NavTab } from "../layout/BottomNavigation";
import { PWAHomeBanner } from "../pwa/PWAInstallButton";

/** 바로가기 묶음을 펼쳐 두었는지 기억하는 열쇠. */
const SHORTCUTS_KEY = "smartmoney_home_shortcuts";
import {
  Sparkles,
  Plus,
  Receipt,
  CreditCard,
  LayoutGrid,
  ChevronDown,
  ArrowRight,
  TrendingDown,
  ShieldAlert,
  BarChart3,
  Sliders,
  AlertTriangle,
  AlertCircle,
  PiggyBank,
} from "lucide-react";
import { accountTone } from "../../utils/accountTone";

interface HomeViewProps {
  onNavigateTab: (tab: NavTab) => void;
  onOpenAddModal: () => void;
  onOpenSMSModal: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onNavigateTab,
  onOpenAddModal,
  onOpenSMSModal,
}) => {
  const {
    transactions,
    aiAnalysis,
    accounts,
    budgetConfig,
    budgetAlerts,
    budgetStatusList,
    totalVariableSpent,
    totalBudgeted,
    selectedMonth,
  } = useFinance();

  const recentTransactions = transactions.slice(0, 4);
  const monthName = `${Number((selectedMonth || "").slice(5, 7)) || ""}월`;

  /*
    바로가기 묶음을 펼쳐 둘지.

    여섯 개 모두 **다른 화면으로 가는 버튼**이고 그 자체로는 정보가 없습니다.
    늘 펼쳐 두면 화면 위쪽을 차지해 결산·예산 같은 실제 정보가 밀립니다.
    마지막에 고른 상태를 기억하므로, 자주 쓰는 사람은 펼친 채로, 그렇지 않은
    사람은 접힌 채로 씁니다.

    localStorage 에 둡니다 — 이것은 가계부 데이터가 아니라 화면 취향이고,
    기기를 다시 열어도 그대로여야 뜻이 있습니다(숨긴 알림과 같은 취급, §5).
  */
  const [showShortcuts, setShowShortcuts] = useState(() => {
    try {
      return localStorage.getItem(SHORTCUTS_KEY) !== "closed";
    } catch {
      return true;
    }
  });

  const toggleShortcuts = () => {
    setShowShortcuts((prev: boolean) => {
      const next = !prev;
      try {
        localStorage.setItem(SHORTCUTS_KEY, next ? "open" : "closed");
      } catch {
        /* 사생활 보호 모드 등 — 기억하지 못해도 화면은 동작해야 합니다 */
      }
      return next;
    });
  };

  /*
    변동비 가용 한도는 `spareOf` 하나에서 옵니다.

    여기서 같은 식을 손으로 다시 적고 있었습니다(§11.4가 한 곳에 두라고 적어
    둔 바로 그 식입니다). 예산 화면에서 식이 바뀌면 이 화면만 옛 값을 말하게
    됩니다.
  */
  const variableBudgetTotal = spareOf({
    income: budgetConfig.monthlyIncome,
    fixed: budgetConfig.fixedExpenses,
    savings: budgetConfig.savingsTarget,
  });
  const variableSpentPercent =
    variableBudgetTotal > 0
      ? Math.round((totalVariableSpent / variableBudgetTotal) * 100)
      : 0;

  return (
    <div className="space-y-4 pt-1">
      {/* PWA Home Banner (prominently shown on mobile browser until installed) */}
      <PWAHomeBanner />

      {/* Top Monthly Summary Card */}
      <SummaryCard onNavigateToSavings={() => onNavigateTab("ai_coach")} />

      {/* Active Budget Alert Warning on Home (if triggered) */}
      {budgetAlerts.length > 0 && (
        <div
          onClick={() => onNavigateTab("budget")}
          className="bg-rose-50 border border-rose-200 rounded-3xl p-3.5 shadow-2xs cursor-pointer hover:bg-rose-100/60 transition active:scale-98"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600"></span>
              </span>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-rose-900">
                    예산 경고 알림 발생 ({budgetAlerts.length}건)
                  </span>
                  <span className="text-[9px] font-black bg-rose-600 text-white px-1.5 py-0.2 rounded-full">
                    주의
                  </span>
                </div>
                <p className="text-[11px] text-rose-700 mt-0.5 line-clamp-1">
                  {budgetAlerts[0]?.message}
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-rose-600 shrink-0" />
          </div>
        </div>
      )}

      {/*
        바로가기 묶음.

        여섯 개 모두 다른 화면으로 가는 버튼이고 그 자체로는 정보가 없습니다.
        늘 펼쳐 두면 화면 위쪽을 차지해 결산·예산 같은 **실제 정보가 밀립니다.**
        마지막에 고른 상태를 기억하므로 자주 쓰는 사람은 펼친 채로, 그렇지 않은
        사람은 접힌 채로 씁니다.
      */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <button
          type="button"
          onClick={toggleShortcuts}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 transition cursor-pointer"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <LayoutGrid className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-xs font-bold text-slate-900">바로가기</span>
            <span className="text-[10px] text-slate-400 truncate">
              {showShortcuts
                ? "문자등록 · 카드·계좌 · 직접입력 · AI 코치 · 대시보드 · 예산"
                : "6개 기능 바로 열기"}
            </span>
          </div>
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition rounded-full px-2.5 py-1 whitespace-nowrap">
            {showShortcuts ? "접기" : "펼치기"}
            <ChevronDown className={`w-3 h-3 ${showShortcuts ? "rotate-180" : ""}`} />
          </span>
        </button>

        <div className={`px-3 pb-3 space-y-2 ${showShortcuts ? "" : "hidden"}`}>
      <div className="grid grid-cols-4 gap-1.5">
        <button
          onClick={onOpenSMSModal}
          className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-emerald-500/50 hover:bg-emerald-50/30 transition text-center active:scale-95 group"
        >
          <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 mb-1 group-hover:scale-110 transition">
            <Receipt className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold text-slate-800">문자등록</span>
          <span className="text-[9px] text-slate-500">SMS 자동</span>
        </button>

        <button
          onClick={() => onNavigateTab("assets")}
          className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-amber-500/50 hover:bg-amber-50/30 transition text-center active:scale-95 group"
        >
          <div className="w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 mb-1 group-hover:scale-110 transition">
            <CreditCard className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold text-slate-800">카드·계좌</span>
          <span className="text-[9px] text-slate-500">등록/연동</span>
        </button>

        <button
          onClick={onOpenAddModal}
          className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-indigo-500/50 hover:bg-indigo-50/30 transition text-center active:scale-95 group"
        >
          <div className="w-7 h-7 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 mb-1 group-hover:scale-110 transition">
            <Plus className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold text-slate-800">직접입력</span>
          <span className="text-[9px] text-slate-500">수기 작성</span>
        </button>

        <button
          onClick={() => onNavigateTab("ai_coach")}
          className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-xs hover:shadow-md transition active:scale-95 text-center group"
        >
          <div className="w-7 h-7 rounded-xl bg-white/20 flex items-center justify-center text-white mb-1 group-hover:scale-110 transition">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="text-[11px] font-bold">AI 코치</span>
          <span className="text-[9px] text-emerald-100">절약 추천</span>
        </button>
      </div>

      {/* Feature Navigation Cards: Visual Dashboard & Budget Management */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onNavigateTab("analytics")}
          className="p-3.5 rounded-3xl bg-white border border-slate-200/90 shadow-2xs hover:border-emerald-500/50 transition text-left active:scale-98 flex items-start justify-between"
        >
          <div className="space-y-1">
            <div className="w-7 h-7 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">소비 시각 대시보드</div>
            <span className="text-[10px] text-slate-500 block">원형·막대 차트 분석</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400 mt-1" />
        </button>

        <button
          onClick={() => onNavigateTab("budget")}
          className="p-3.5 rounded-3xl bg-white border border-slate-200/90 shadow-2xs hover:border-emerald-500/50 transition text-left active:scale-98 flex items-start justify-between"
        >
          <div className="space-y-1">
            <div className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Sliders className="w-4 h-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">카테고리 예산 관리</div>
            <span className="text-[10px] text-slate-500 block">한도 설정 & 초과 알림</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400 mt-1" />
        </button>
      </div>
        </div>
      </div>

      {/* Monthly Budget Consumption Snapshot Bar */}
      <div
        onClick={() => onNavigateTab("budget")}
        className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs cursor-pointer hover:border-slate-300 transition"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <PiggyBank className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-slate-900">
              {monthName} 변동비 예산 소진 현황
            </span>
          </div>
          <span
            className={`text-xs font-black ${
              variableSpentPercent >= 100
                ? "text-rose-600"
                : variableSpentPercent >= 80
                ? "text-amber-600"
                : "text-emerald-600"
            }`}
          >
            {variableSpentPercent}% 소진
          </span>
        </div>

        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              variableSpentPercent >= 100
                ? "bg-rose-500"
                : variableSpentPercent >= 80
                ? "bg-amber-500"
                : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(100, variableSpentPercent)}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2">
          <span>
            사용:{" "}
            <strong className="text-slate-900 font-bold">
              {totalVariableSpent.toLocaleString()}원
            </strong>
          </span>
          <span>
            가용 한도:{" "}
            <strong className="text-slate-900 font-bold">
              {variableBudgetTotal.toLocaleString()}원
            </strong>
          </span>
        </div>
      </div>

      {/* Fixed vs Variable Ratio */}
      <FixedVsVariableRatio onTabSelect={onNavigateTab} />

      {/* AI 절약 하이라이트 배너 */}
      {aiAnalysis && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/80 rounded-3xl p-4 shadow-2xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-900">
                    AI 머니 코치의 절약 조언
                  </span>
                  <span className="text-[10px] bg-emerald-600 text-white font-bold px-1.5 py-0.2 rounded-full">
                    월 {aiAnalysis.totalPotentialMonthlySavings?.toLocaleString()}원 절약 가능
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                  {aiAnalysis.summary}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-emerald-200/50 flex items-center justify-between">
            <span className="text-[11px] text-emerald-800 font-medium">
              발견된 절약 기회: {aiAnalysis.savingsRecommendations?.length || 0}개 항목
            </span>
            <button
              onClick={() => onNavigateTab("ai_coach")}
              className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
            >
              <span>추천 항목 확인하기</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Connected Accounts Snapshot */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-emerald-600" />
            <h2 className="text-xs font-bold text-slate-900">연동된 계좌 및 카드 ({accounts.length}개)</h2>
          </div>
          <button
            onClick={() => onNavigateTab("assets")}
            className="text-[11px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-xl transition flex items-center gap-1 border border-emerald-200/60"
          >
            <Plus className="w-3 h-3" />
            <span>새 카드/계좌 등록</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {accounts.map((acc) => (
            <div
              key={acc.id}
              onClick={() => onNavigateTab("assets")}
              className="p-3 rounded-2xl bg-slate-50 hover:bg-slate-100/80 border border-slate-100 cursor-pointer flex flex-col justify-between transition active:scale-98"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500">
                  {acc.institution}
                </span>
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: accountTone(acc.type).hex }}
                />
              </div>
              <div className="text-xs font-bold text-slate-800 truncate mt-1">
                {acc.name}
              </div>
              <div className="text-xs font-black text-slate-900 mt-1">
                {acc.balanceOrBilled.toLocaleString()}원
                <span className="text-[9px] font-normal text-slate-400 ml-1">
                  {acc.type === "BANK" ? "잔액" : "청구예정"}
                </span>
              </div>
            </div>
          ))}

          {/* Quick Add Card Slot */}
          <button
            onClick={() => onNavigateTab("assets")}
            className="p-3 rounded-2xl border border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50/40 flex flex-col items-center justify-center text-center transition group active:scale-98 min-h-[78px]"
          >
            <Plus className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 mb-1 transition" />
            <span className="text-[11px] font-bold text-slate-600 group-hover:text-emerald-700">
              카드/통장 추가
            </span>
          </button>
        </div>
      </div>

      {/* Recent Transactions List */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold text-slate-900">최근 입출금 & 카드 내역</h2>
          <button
            onClick={() => onNavigateTab("ledger")}
            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5"
          >
            <span>전체 내역 ({transactions.length})</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        <div className="space-y-2">
          {recentTransactions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">
              내역이 없습니다. 문자 자동등록이나 직접 추가로 기록해보세요!
            </div>
          ) : (
            recentTransactions.map((tx) => (
              <TransactionItem key={tx.id} transaction={tx} />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
