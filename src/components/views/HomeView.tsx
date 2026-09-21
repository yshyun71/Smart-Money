import React, { useMemo, useState } from "react";
import { useFinance } from "../../context/FinanceContext";
import { spareOf } from "../../services/budgetPolicy";
import { describeBill, pendingBill } from "../../services/cardLink";
import { asOfLabel } from "../../utils/format";
import { SummaryCard } from "../dashboard/SummaryCard";
import { FixedVsVariableRatio } from "../dashboard/FixedVsVariableRatio";
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
  /** 그 계좌·카드의 내역 창을 엽니다(뿌리에서 `App` 이 들고 있습니다). */
  onOpenAccount?: (accountId: string) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onNavigateTab,
  onOpenAccount,
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
    allTransactions,
  } = useFinance();

  /*
    카드의 청구액은 **계산하는 값**입니다(§9.4).

    이 화면은 `accounts.balance_or_billed` 를 그대로 읽어 `0원 청구예정`이라고
    적고 있었습니다. 그 칸은 카드에 대해서는 **아무도 갱신하지 않습니다** —
    등록할 때 적어 둔 값이 그대로 남아 있을 뿐이고, 카드 행에는 수정 버튼조차
    없습니다(§8). 그래서 대금을 이미 낸 카드 넷이 모두 `0원 청구예정`으로,
    신한카드는 등록 때의 80,000원으로 보였습니다. 같은 카드를 두고 카드·계좌
    화면은 `8월 결재완료 1,162,344원` 이라고 말하고 있었습니다.

    `describeBill` 로 두 화면이 같은 말을 하게 합니다.
  */
  const cardBills = useMemo(() => {
    const map = new Map<string, ReturnType<typeof describeBill>>();
    for (const account of accounts) {
      if (account.type === "BANK") continue;
      map.set(account.id, describeBill(pendingBill(account.id, allTransactions)));
    }
    return map;
  }, [accounts, allTransactions]);

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
            {/*
              이름은 접히지 않습니다. 옆의 설명이 길어지자 flex 가 이 글자를
              줄여 `바로`/`가기` 두 줄로 쪼갰습니다 — §12.2 의 그 함정입니다.
              접을 곳이 있는 쪽은 설명뿐이고, 펼친 뒤에는 버튼들이 스스로
              말하므로 설명을 두지 않습니다.
            */}
            <span className="text-xs font-bold text-slate-900 shrink-0 whitespace-nowrap">
              바로가기
            </span>
            {!showShortcuts && (
              <span className="text-[10px] text-slate-400 truncate min-w-0">
                6개 기능 바로 열기
              </span>
            )}
          </div>
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition rounded-full px-2.5 py-1 whitespace-nowrap">
            {showShortcuts ? "접기" : "펼치기"}
            <ChevronDown className={`w-3 h-3 ${showShortcuts ? "rotate-180" : ""}`} />
          </span>
        </button>

        <div className={`px-3 pb-3 space-y-2 ${showShortcuts ? "" : "hidden"}`}>
          {/*
            순서로 성격을 보입니다 — 앞 줄은 **기록하기**, 뒷 줄은 **보기**.

            쪼개서 머리글을 하나 더 두지는 않습니다. 버튼은 숫자를 말하지
            않으므로 기준월과 모순될 수 없고(사용자가 불편을 느낀 원인은
            "8월이라고 적혀 있는데 숫자가 안 바뀐다"였습니다), 구역을 늘리면
            스크롤을 줄이려는 노력과 정면으로 부딪힙니다. 예전에는 `AI 코치`가
            기록 버튼들 사이에 끼어 있었습니다.

            앞 줄 셋은 기준월과 무관하고(문자는 문자에 적힌 날짜, 직접입력은
            오늘), 뒷 줄 셋은 고른 달을 그대로 따라갑니다.
          */}
          <div className="grid grid-cols-3 gap-1.5">
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
              onClick={onOpenAddModal}
              className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-indigo-500/50 hover:bg-indigo-50/30 transition text-center active:scale-95 group"
            >
              <div className="w-7 h-7 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 mb-1 group-hover:scale-110 transition">
                <Plus className="w-3.5 h-3.5" />
              </div>
              <span className="text-[11px] font-bold text-slate-800">직접입력</span>
              {/* 오늘 날짜로 시작합니다 — 새로 적는 기록은 거의 언제나 "지금"입니다 */}
              <span className="text-[9px] text-slate-500">오늘 날짜</span>
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
          </div>

          {/* 뒷 줄 — 고른 달을 따라가는 화면들 */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => onNavigateTab("analytics")}
              className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-emerald-500/50 hover:bg-emerald-50/30 transition text-center active:scale-95 group"
            >
              <div className="w-7 h-7 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 mb-1 group-hover:scale-110 transition">
                <BarChart3 className="w-3.5 h-3.5" />
              </div>
              <span className="text-[11px] font-bold text-slate-800">소비분석</span>
              <span className="text-[9px] text-slate-500">{monthName} 비중</span>
            </button>

            <button
              onClick={() => onNavigateTab("budget")}
              className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-emerald-500/50 hover:bg-emerald-50/30 transition text-center active:scale-95 group"
            >
              <div className="w-7 h-7 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 mb-1 group-hover:scale-110 transition">
                <Sliders className="w-3.5 h-3.5" />
              </div>
              <span className="text-[11px] font-bold text-slate-800">예산 관리</span>
              <span className="text-[9px] text-slate-500">한도·알림</span>
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

      {/*
        내역으로 가는 한 줄.

        예전에는 여기에 최근 4건을 늘어놓았습니다. 홈에서 값이 가장 낮은
        블록이었습니다 — 맛보기 4건이고, 전체 내역은 한 번만 누르면 되며,
        제목이 `최근`인데 실제로는 **그 달 안에서의 최근**이라 기준을 흐렸습니다.
        250px 가까운 높이가 아래의 자산 요약을 화면 밖으로 밀어내던 것이
        결정적이었습니다.
      */}
      <button
        onClick={() => onNavigateTab("ledger")}
        className="w-full bg-white rounded-3xl p-3.5 border border-slate-200/90 shadow-2xs flex items-center justify-between gap-2 hover:border-emerald-500/50 transition active:scale-98 cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
            <Receipt className="w-3.5 h-3.5" />
          </div>
          <div className="text-left min-w-0">
            <div className="text-xs font-bold text-slate-900 truncate">
              {monthName} 입출금 &amp; 카드 내역
            </div>
            <span className="text-[10px] text-slate-400">
              {transactions.length}건 — 검색·필터로 모두 보기
            </span>
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {/*
        기준이 바뀌는 경계.

        위는 전부 기준월을 따르고 아래는 `지금`입니다. 예전에는 이 둘이 섞여
        있어 기준이 다섯 번 바뀌었습니다 — 사용자가 "화면의 일관성이 없다"고
        말한 것이 그것입니다. 전환을 한 번으로 줄이고, 그 자리에 이름을 답니다.
        기준월 바에서 **멀리** 두는 것도 일부러입니다: 바로 밑에 놓으면
        `2026년 8월`에서 눈을 떼는 순간 안 바뀌는 숫자를 만납니다.
      */}
      <div className="flex items-center gap-2 pt-1">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
          지금 기준 · 기준월과 무관
        </span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      {/* Connected Accounts Snapshot */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 min-w-0">
            <CreditCard className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
              <h2 className="text-xs font-bold text-slate-900">
                연동된 계좌 및 카드 ({accounts.length}개)
              </h2>
              {/*
                **이 블록만 기준월을 따르지 않습니다.**

                잔액은 지금 통장에 있는 돈이고(그 자체로 기준일시를 가집니다,
                §8), 카드 금액은 지금 낼 돈입니다(§9.4의 `pendingBill` — 어느
                달을 보고 있는지와 무관합니다). 그래서 8월로 옮겨도 숫자가
                그대로인데, 화면이 그 사실을 말하지 않으면 **고장처럼 보입니다**
                — 눌러도 아무 일이 없는 조작기와 같은 문제입니다(§12).

                `카드·계좌` 탭은 아예 월 이동 바를 감춰 이 혼동을 없앴습니다.
                홈에는 그 바가 있어야 하므로, 대신 여기가 말합니다.
              */}
              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                지금 통장에 있는 돈과 낼 카드대금
              </p>
            </div>
          </div>

          <button
            onClick={() => onNavigateTab("assets")}
            className="shrink-0 whitespace-nowrap text-[11px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-xl transition flex items-center gap-1 border border-emerald-200/60"
          >
            <Plus className="w-3 h-3 shrink-0" />
            <span>새 카드/계좌 등록</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {accounts.map((acc) => {
            const bill = cardBills.get(acc.id);
            const isBank = acc.type === "BANK";
            /* 정산된 카드는 낸 금액과 `N월 결재완료` — 쓰지 않은 카드와 다릅니다 */
            const amount = isBank ? acc.balanceOrBilled : bill?.amount ?? 0;
            const settled = Boolean(bill && bill.headline.endsWith("결재완료"));

            return (
              <button
                key={acc.id}
                type="button"
                /* 그 계좌·카드의 내역으로 바로 들어갑니다 — 탭만 여는 것보다 한 걸음 짧습니다 */
                onClick={() => onOpenAccount?.(acc.id)}
                className="p-3 rounded-2xl bg-slate-50 hover:bg-slate-100/80 border border-slate-100 cursor-pointer flex flex-col justify-between transition active:scale-98 text-left"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-bold text-slate-500 truncate">
                    {acc.institution}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: accountTone(acc.type).hex }}
                  />
                </div>
                <div className="text-xs font-bold text-slate-800 truncate mt-1">
                  {acc.name}
                </div>
                <div className="text-xs font-black text-slate-900 mt-1 whitespace-nowrap">
                  {amount.toLocaleString()}원
                  <span
                    className={`text-[9px] font-normal ml-1 ${
                      settled ? "text-emerald-600 font-bold" : "text-slate-400"
                    }`}
                  >
                    {isBank ? "잔액" : bill?.headline ?? "청구예정"}
                  </span>
                </div>
                {/*
                  잔액은 금액만으로는 뜻이 반쪽입니다 — 언제 기준인지가 함께
                  있어야 그 숫자를 믿을 수 있습니다(§8).
                */}
                <div className="text-[9px] text-slate-400 mt-0.5 truncate">
                  {isBank
                    ? acc.balanceAsOf
                      ? `${asOfLabel(acc.balanceAsOf)} 기준`
                      : "기준일시 없음"
                    : bill?.detail || ""}
                </div>
              </button>
            );
          })}

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

    </div>
  );
};
