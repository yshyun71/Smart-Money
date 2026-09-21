import React, { useState, useMemo } from "react";
import { useFinance } from "../../context/FinanceContext";
import { CategorySpendingModal } from "../modals/CategorySpendingModal";
import { AddTransactionModal } from "../transactions/AddTransactionModal";
import { PeriodTrendPanel } from "./PeriodTrendPanel";
import { monthPeriod, yearPeriod } from "../../services/trend";
import { shortWon } from "../../utils/format";
import {
  PieChart as PieIcon,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Calendar,
  CalendarRange,
  Layers,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Info,
  SlidersHorizontal,
} from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";

const CATEGORY_COLORS: Record<string, string> = {
  "식비": "#F59E0B", // amber
  "주거": "#6366F1", // indigo
  "통신": "#06B6D4", // cyan
  "쇼핑": "#EC4899", // pink
  "교통": "#0EA5E9", // sky
  "카페/간식": "#F97316", // orange
  "문화/여가": "#8B5CF6", // purple
  "생활": "#84CC16", // lime
  "의료": "#EF4444", // red
  "구독/미디어": "#3B82F6", // blue
  "보험": "#0D9488", // teal
  "대출": "#7C3AED", // violet
  "기타 금융": "#4F46E5", // indigo
  "카드대금": "#6366F1", // indigo
  "이체": "#64748B", // slate — 쓴 돈이 아니라 옮긴 돈
  "기타지출": "#94A3B8", // gray
};

const DEFAULT_COLOR = "#94A3B8";

export const AnalyticsDashboardView: React.FC<{
  onNavigateToBudget?: () => void;
  onNavigateToSavings?: () => void;
}> = ({ onNavigateToBudget, onNavigateToSavings }) => {
  const {
    selectedMonth,
    setSelectedMonth,
    totalIncome,
    totalExpense,
    fixedExpenseTotal,
    variableExpenseTotal,
    netSavings,
    fixedRatio,
    variableRatio,
    categoryExpenses,
    monthlyHistoricalData,
    yearlyHistoricalData,
    aiAnalysis,
  } = useFinance();

  const [timeframeMode, setTimeframeMode] = useState<"MONTHLY" | "YEARLY" | "PERIOD">(
    "MONTHLY"
  );
  /*
    카테고리 순위표는 접어 둡니다.

    위의 도넛 범례와 같은 숫자를 다시 말하므로, 처음부터 둘 다 펼쳐 두면 화면의
    절반이 같은 내용입니다. 순위·비중·막대는 "전부 훑어볼 때" 쓰는 것이니
    그때 펼치면 됩니다.
  */
  const [showRanking, setShowRanking] = useState(false);
  /** 카테고리 금액을 눌러 연 상세 — 어느 카테고리인지만 기억하면 됩니다. */
  const [drillCategory, setDrillCategory] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<any>(null);
  const [activeChartType, setActiveChartType] = useState<"PIE" | "BAR" | "AREA">("PIE");
  const [selectedYear, setSelectedYear] = useState<string>("2026년 (예상 누적)");

  // Format currency
  const formatKRW = (val: number) => `${val.toLocaleString()}원`;
  const formatShortKRW = (val: number) => shortWon(val);

  /**
   * Insight strips under the charts. They describe the transactions actually
   * on this device, and stay hidden until there are at least two periods to
   * compare.
   */
  const trendInsight = useMemo(() => {
    if (timeframeMode === "MONTHLY") {
      const periods = monthlyHistoricalData.filter((m) => m.income > 0 || m.expense > 0);
      if (periods.length < 2) return null;

      const prev = periods[periods.length - 2];
      const curr = periods[periods.length - 1];
      const diff = curr.expense - prev.expense;
      const savingsRate =
        curr.income > 0 ? Math.round((curr.savings / curr.income) * 100) : null;

      return `💡 ${prev.displayMonth} 대비 ${curr.displayMonth} 지출이 ${formatShortKRW(
        Math.abs(diff)
      )} ${diff <= 0 ? "감소" : "증가"}했습니다.${
        savingsRate === null ? "" : ` 이번 달 저축률은 ${savingsRate}%입니다.`
      }`;
    }

    const years = yearlyHistoricalData.filter((y) => y.income > 0 || y.expense > 0);
    if (years.length < 2) return null;

    const prev = years[years.length - 2];
    const curr = years[years.length - 1];
    const diff = curr.savings - prev.savings;

    return `💡 ${prev.year}년 대비 ${curr.year}년 누적 저축액이 ${
      diff >= 0 ? "+" : "-"
    }${formatShortKRW(Math.abs(diff))} ${diff >= 0 ? "증가" : "감소"}했습니다.`;
  }, [timeframeMode, monthlyHistoricalData, yearlyHistoricalData]);

  const volatilityInsight = useMemo(() => {
    const periods = monthlyHistoricalData.filter((m) => m.expense > 0);
    if (periods.length < 2) return null;

    const fixedValues = periods.map((m) => m.fixed);
    const variableValues = periods.map((m) => m.variable);
    const fixedMin = Math.min(...fixedValues);
    const fixedMax = Math.max(...fixedValues);
    const variableMin = Math.min(...variableValues);
    const variableMax = Math.max(...variableValues);
    const driver = variableMax - variableMin >= fixedMax - fixedMin ? "변동비" : "고정비";

    return `📌 최근 ${periods.length}개월 고정비는 ${formatShortKRW(
      fixedMin
    )}~${formatShortKRW(fixedMax)}, 변동비는 ${formatShortKRW(variableMin)}~${formatShortKRW(
      variableMax
    )} 범위입니다. 총 지출 변동은 주로 ${driver} 편차에서 발생합니다.`;
  }, [monthlyHistoricalData]);

  const aiSavingsLabel =
    aiAnalysis?.totalPotentialMonthlySavings
      ? `월 ${formatShortKRW(aiAnalysis.totalPotentialMonthlySavings)} 절약`
      : "분석하면 절약 가능액이 계산됩니다";

  // Pie chart data for current selected month
  const monthlyPieData = useMemo(() => {
    return categoryExpenses.map((cat) => ({
      name: cat.category,
      value: cat.amount,
      percentage: Math.round(cat.percentage),
      color: CATEGORY_COLORS[cat.category] || DEFAULT_COLOR,
    }));
  }, [categoryExpenses]);

  // Yearly data lookup
  /*
    고른 해의 집계.

    예전에는 못 찾으면 `yearlyHistoricalData[1]` 로 떨어졌는데, 한 해 분량만
    있는 기기에서는 그것이 `undefined` 이고 아래에서 `.income` 을 읽는 순간
    화면이 죽습니다. 기본값을 `선택 → 가장 최근 해 → 빈 집계` 로 두어, 데이터가
    없으면 0과 `–` 가 보이게 합니다(§17.1).
  */
  const currentYearlyData = useMemo(() => {
    return (
      yearlyHistoricalData.find((y: { year: string }) => y.year === selectedYear) ||
      yearlyHistoricalData[yearlyHistoricalData.length - 1] || {
        year: selectedMonth.slice(0, 4),
        income: 0,
        expense: 0,
        fixed: 0,
        variable: 0,
        savings: 0,
        categories: [],
      }
    );
  }, [yearlyHistoricalData, selectedYear, selectedMonth]);

  // Yearly pie data
  const yearlyPieData = useMemo(() => {
    return (currentYearlyData?.categories || []).map((cat) => ({
      name: cat.category,
      value: cat.amount,
      percentage: Math.round(cat.percentage),
      color: CATEGORY_COLORS[cat.category] || DEFAULT_COLOR,
    }));
  }, [currentYearlyData]);

  // Active pie data based on mode
  const activePieData = timeframeMode === "MONTHLY" ? monthlyPieData : yearlyPieData;

  // Compare with previous month (August) for insight badge
  const prevMonthExpense = 2470000;
  const currentMonthProjected = totalExpense;
  const monthDiff = currentMonthProjected - prevMonthExpense;
  const monthDiffPercent = Math.round((monthDiff / prevMonthExpense) * 100);

  return (
    <div className="space-y-4 pt-1">
      {/* Top Header Card with Mode Switcher */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              소비 현황 시각 분석 대시보드
            </h2>
            <p className="text-[11px] text-slate-500">
                  월별·연도별 비중과 고른 기간의 변동 추이를 차트로 확인합니다.
            </p>
          </div>
        </div>

        {/* Timeframe Switcher Tabs */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-2xl">
          <button
            onClick={() => setTimeframeMode("MONTHLY")}
            className={`py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 ${
              timeframeMode === "MONTHLY"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">월별 ({Number(selectedMonth.split("-")[1])}월)</span>
          </button>

          <button
            onClick={() => setTimeframeMode("YEARLY")}
            className={`py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 ${
              timeframeMode === "YEARLY"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">연도별 비교</span>
          </button>

          {/*
            한 달도 한 해도 아닌 질문에 답하는 자리입니다 — "작년 3월부터 올해
            2월까지 식비가 어떻게 움직였나".
          */}
          <button
            onClick={() => setTimeframeMode("PERIOD")}
            className={`py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 ${
              timeframeMode === "PERIOD"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <CalendarRange className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">기간 추이</span>
          </button>
        </div>

        {/* Year Selector (if Yearly mode) */}
        {timeframeMode === "YEARLY" && (
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">분석 기준 연도</span>
            <div className="flex items-center gap-1.5">
              {yearlyHistoricalData.map((item) => (
                <button
                  key={item.year}
                  onClick={() => setSelectedYear(item.year)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                    selectedYear === item.year
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {item.year}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/*
        기간 추이는 아래의 월·연도 분석을 **대신합니다.** 같은 화면에 겹쳐 놓으면
        어느 숫자가 어느 기간의 것인지 알 수 없습니다.
      */}
      {timeframeMode === "PERIOD" ? (
        <PeriodTrendPanel />
      ) : (
        <>
      {/* Summary KPI Cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] font-semibold text-slate-500">
            {timeframeMode === "MONTHLY" ? "총 수입" : "연간 총수입"}
          </span>
          <div className="text-xs font-black text-slate-900 mt-1 truncate">
            {timeframeMode === "MONTHLY"
              ? formatShortKRW(totalIncome)
              : formatShortKRW(currentYearlyData.income)}
          </div>
          <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-0.5 mt-0.5">
            <ArrowUpRight className="w-2.5 h-2.5" />
            안정 입금
          </span>
        </div>

        <div className="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] font-semibold text-slate-500">
            {timeframeMode === "MONTHLY" ? "총 지출" : "연간 총지출"}
          </span>
          <div className="text-xs font-black text-rose-600 mt-1 truncate">
            {timeframeMode === "MONTHLY"
              ? formatShortKRW(totalExpense)
              : formatShortKRW(currentYearlyData.expense)}
          </div>
          <span className="text-[9px] text-slate-500 font-medium mt-0.5 block truncate">
            {timeframeMode === "MONTHLY"
              ? `고정비 ${Math.round(fixedRatio)}%`
              : `고정비 ${formatShortKRW(currentYearlyData.fixed)}`}
          </span>
        </div>

        <div className="bg-white rounded-2xl p-3 border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] font-semibold text-slate-500">
            {timeframeMode === "MONTHLY" ? "순 저축" : "연간 순저축"}
          </span>
          <div className="text-xs font-black text-emerald-600 mt-1 truncate">
            {timeframeMode === "MONTHLY"
              ? formatShortKRW(netSavings)
              : formatShortKRW(currentYearlyData.savings)}
          </div>
          <span className="text-[9px] text-emerald-700 font-bold bg-emerald-50 px-1 py-0.2 rounded-xs inline-block mt-0.5">
            {timeframeMode === "MONTHLY"
              ? totalIncome > 0
                ? `${Math.round((netSavings / totalIncome) * 100)}% 저축`
                : "0%"
              : `${Math.round((currentYearlyData.savings / currentYearlyData.income) * 100)}% 저축`}
          </span>
        </div>
      </div>

      {/* CHART SECTION: Category Breakdown (Pie Chart) & Trends (Bar / Area Chart) */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        {/* Chart Sub-navigation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-bold text-slate-900">
              {timeframeMode === "MONTHLY"
                ? activeChartType === "PIE"
                  ? "카테고리별 소비 비중 (원형 차트)"
                  : activeChartType === "BAR"
                  ? "최근 6개월 수입·지출 추이 (막대그래프)"
                  : "고정비 vs 변동비 추이 (영역 차트)"
                : activeChartType === "PIE"
                ? `${selectedYear} 카테고리별 지출 비중 (원형 차트)`
                : "2025 vs 2026 연간 비교 (막대그래프)"}
            </h3>
          </div>

          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl">
            <button
              onClick={() => setActiveChartType("PIE")}
              className={`p-1.5 rounded-lg text-xs font-bold transition ${
                activeChartType === "PIE"
                  ? "bg-white text-emerald-600 shadow-2xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
              title="원형 차트 (비중)"
            >
              <PieIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setActiveChartType("BAR")}
              className={`p-1.5 rounded-lg text-xs font-bold transition ${
                activeChartType === "BAR"
                  ? "bg-white text-emerald-600 shadow-2xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
              title="막대그래프 (추이)"
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            {timeframeMode === "MONTHLY" && (
              <button
                onClick={() => setActiveChartType("AREA")}
                className={`p-1.5 rounded-lg text-xs font-bold transition ${
                  activeChartType === "AREA"
                    ? "bg-white text-emerald-600 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
                title="추이 영역 그래프"
              >
                <TrendingUp className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 1. PIE CHART VIEW */}
        {activeChartType === "PIE" && (
          <div className="space-y-4">
            <div className="h-64 w-full flex items-center justify-center relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={activePieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={88}
                    paddingAngle={3}
                    dataKey="value"
                    /* 조각을 눌러도 같은 상세가 열립니다 */
                    onClick={(entry: any) => {
                      const name = entry?.name || entry?.payload?.name;
                      if (name) setDrillCategory(name);
                    }}
                  >
                    {activePieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} cursor="pointer" />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: number) => [`${val.toLocaleString()}원`, "지출액"]}
                    contentStyle={{
                      backgroundColor: "rgba(15, 23, 42, 0.95)",
                      borderRadius: "12px",
                      border: "none",
                      color: "#fff",
                      fontSize: "11px",
                      boxShadow: "0 10px 15px -3px rgba(0,0,0,0.3)",
                    }}
                    itemStyle={{ color: "#fff" }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Center donut text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] font-semibold text-slate-400">
                  {timeframeMode === "MONTHLY" ? "월 총지출" : "연간 지출"}
                </span>
                <span className="text-xs font-black text-slate-900 tracking-tight">
                  {timeframeMode === "MONTHLY"
                    ? formatShortKRW(totalExpense)
                    : formatShortKRW(currentYearlyData.expense)}
                </span>
              </div>
            </div>

            {/* Custom Interactive Legend with percentages */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
              {/* 금액을 누르면 그 카테고리의 내역이 열립니다 (11.7) */}
              {activePieData.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setDrillCategory(item.name)}
                  className="flex items-center justify-between p-1.5 rounded-xl hover:bg-slate-100 transition text-xs text-left cursor-pointer"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="font-semibold text-slate-700 truncate">
                      {item.name}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-bold text-slate-900 ml-1">
                      {item.percentage}%
                    </span>
                    <span className="text-[10px] text-slate-600 block underline decoration-slate-300 underline-offset-2">
                      {formatShortKRW(item.value)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 2. BAR CHART VIEW */}
        {activeChartType === "BAR" && (
          <div className="space-y-3">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {timeframeMode === "MONTHLY" ? (
                  <BarChart
                    data={monthlyHistoricalData}
                    margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis
                      dataKey="displayMonth"
                      tick={{ fontSize: 10, fill: "#64748B" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "#94A3B8" }}
                      tickFormatter={formatShortKRW}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(val: number) => [`${val.toLocaleString()}원`]}
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.95)",
                        borderRadius: "12px",
                        border: "none",
                        color: "#fff",
                        fontSize: "11px",
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                      formatter={(val) =>
                        val === "income" ? "수입" : val === "expense" ? "지출" : "순저축"
                      }
                    />
                    <Bar dataKey="income" fill="#10B981" radius={[4, 4, 0, 0]} name="income" />
                    <Bar dataKey="expense" fill="#F43F5E" radius={[4, 4, 0, 0]} name="expense" />
                    <Bar dataKey="savings" fill="#0EA5E9" radius={[4, 4, 0, 0]} name="savings" />
                  </BarChart>
                ) : (
                  <BarChart
                    data={yearlyHistoricalData}
                    margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis
                      dataKey="year"
                      tick={{ fontSize: 11, fill: "#475569" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "#94A3B8" }}
                      tickFormatter={formatShortKRW}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(val: number) => [`${val.toLocaleString()}원`]}
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.95)",
                        borderRadius: "12px",
                        border: "none",
                        color: "#fff",
                        fontSize: "11px",
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                      formatter={(val) =>
                        val === "income"
                          ? "연간 수입"
                          : val === "expense"
                          ? "연간 지출"
                          : "연간 순저축"
                      }
                    />
                    <Bar dataKey="income" fill="#10B981" radius={[4, 4, 0, 0]} name="income" />
                    <Bar dataKey="expense" fill="#F43F5E" radius={[4, 4, 0, 0]} name="expense" />
                    <Bar dataKey="savings" fill="#3B82F6" radius={[4, 4, 0, 0]} name="savings" />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {trendInsight && (
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 text-[11px] text-slate-600 flex items-center justify-between">
                <span>{trendInsight}</span>
              </div>
            )}
          </div>
        )}

        {/* 3. AREA CHART VIEW (Monthly Only) */}
        {activeChartType === "AREA" && timeframeMode === "MONTHLY" && (
          <div className="space-y-3">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={monthlyHistoricalData}
                  margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorFixed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366F1" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="colorVariable" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="displayMonth"
                    tick={{ fontSize: 10, fill: "#64748B" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "#94A3B8" }}
                    tickFormatter={formatShortKRW}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(val: number) => [`${val.toLocaleString()}원`]}
                    contentStyle={{
                      backgroundColor: "rgba(15, 23, 42, 0.95)",
                      borderRadius: "12px",
                      border: "none",
                      color: "#fff",
                      fontSize: "11px",
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                    formatter={(val) => (val === "fixed" ? "고정비" : "변동비")}
                  />
                  <Area
                    type="monotone"
                    dataKey="fixed"
                    stroke="#6366F1"
                    fillOpacity={1}
                    fill="url(#colorFixed)"
                    name="fixed"
                  />
                  <Area
                    type="monotone"
                    dataKey="variable"
                    stroke="#F59E0B"
                    fillOpacity={1}
                    fill="url(#colorVariable)"
                    name="variable"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {volatilityInsight && (
              <div className="p-3 bg-indigo-50/70 rounded-2xl border border-indigo-100 text-[11px] text-indigo-950 flex items-center justify-between">
                <span>{volatilityInsight}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/*
        카테고리 순위표.

        위의 도넛 범례가 같은 숫자를 이미 말하므로 **접어 둡니다.** 처음부터 둘 다
        펼치면 화면의 절반이 같은 내용이고, 스크롤을 내리는 사람에게는 아래쪽이
        새 정보처럼 보입니다. 순위·비중 막대는 "전부 훑어볼 때" 쓰는 것이니
        그때 펼치면 됩니다.
      */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <button
          type="button"
          onClick={() => setShowRanking((prev) => !prev)}
          className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
        >
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-slate-900 truncate">
              {timeframeMode === "MONTHLY" ? "카테고리별 지출 순위 & 비중" : "연간 카테고리별 지출 현황"}
            </h3>
            <span className="text-[10px] text-slate-400">
              {showRanking
                ? "지출액 기준 정렬 · 금액을 누르면 내역이 열립니다"
                : `${activePieData.length}개 카테고리 · 순위와 비중 보기`}
            </span>
          </div>
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition rounded-full px-2.5 py-1 whitespace-nowrap">
            {showRanking ? "접기" : "카테고리 전체 보기"}
            {showRanking ? (
              <ChevronDown className="w-3 h-3 rotate-180" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </span>
        </button>

        <div className={`space-y-2 ${showRanking ? "" : "hidden"}`}>
          {activePieData.map((item, idx) => {
            const isHighest = idx === 0;

            return (
              <button
                key={item.name}
                type="button"
                onClick={() => setDrillCategory(item.name)}
                className="w-full p-2.5 rounded-2xl bg-slate-50/80 border border-slate-100 flex items-center justify-between text-xs text-left hover:bg-slate-100 transition cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-5 h-5 rounded-full font-bold text-[10px] flex items-center justify-center ${
                      isHighest
                        ? "bg-rose-500 text-white shadow-2xs"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-800">{item.name}</span>
                      {isHighest && (
                        <span className="text-[9px] font-extrabold text-rose-600 bg-rose-50 px-1.5 py-0.2 rounded-full">
                          최다 지출
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400">
                      비중: {item.percentage}%
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-extrabold text-slate-900 flex items-center justify-end gap-0.5">
                    {formatKRW(item.value)}
                    <ChevronRight className="w-3 h-3 text-slate-400" />
                  </span>
                  <div className="w-20 h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden ml-auto">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${item.percentage}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

        </>
      )}

      {/*
        카테고리 금액을 누르면 열리는 상세. **기간은 보고 있는 모드가 정합니다** —
        월별에서는 그 달, 연도별에서는 그 해. 같은 창이 두 곳에 쓰입니다(11.7).
      */}
      <CategorySpendingModal
        isOpen={drillCategory !== null}
        category={drillCategory}
        period={
          timeframeMode === "YEARLY"
            ? yearPeriod((currentYearlyData.year || "").slice(0, 4))
            : monthPeriod(selectedMonth)
        }
        suspended={editingTx !== null}
        onClose={() => setDrillCategory(null)}
        onPick={(transaction) => setEditingTx(transaction)}
      />

      <AddTransactionModal
        isOpen={editingTx !== null}
        editing={editingTx}
        onClose={() => setEditingTx(null)}
      />

      {/* Quick Action Navigation to Budget and Savings */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onNavigateToBudget}
          className="p-3.5 rounded-3xl bg-slate-900 text-white font-bold text-xs flex items-center justify-between shadow-xs hover:bg-slate-800 transition active:scale-95"
        >
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
            <div className="text-left">
              <div>카테고리 예산 설정</div>
              <span className="text-[10px] text-slate-400 font-normal">초과 알림 받기</span>
            </div>
          </div>
          <span>→</span>
        </button>

        <button
          onClick={onNavigateToSavings}
          className="p-3.5 rounded-3xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-xs flex items-center justify-between shadow-xs hover:opacity-95 transition active:scale-95"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-200" />
            <div className="text-left">
              <div>AI 절약 항목 추천</div>
              <span className="text-[10px] text-emerald-100 font-normal">{aiSavingsLabel}</span>
            </div>
          </div>
          <span>→</span>
        </button>
      </div>
    </div>
  );
};
