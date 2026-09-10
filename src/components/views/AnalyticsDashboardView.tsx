import React, { useState, useMemo } from "react";
import { useFinance } from "../../context/FinanceContext";
import {
  PieChart as PieIcon,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Calendar,
  Layers,
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
  "주거/통신": "#6366F1", // indigo
  "쇼핑": "#EC4899", // pink
  "교통": "#0EA5E9", // sky
  "카페/간식": "#F97316", // orange
  "문화/여가": "#8B5CF6", // purple
  "생활/의료": "#10B981", // emerald
  "구독/미디어": "#3B82F6", // blue
  "금융/보험": "#64748B", // slate
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

  const [timeframeMode, setTimeframeMode] = useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [activeChartType, setActiveChartType] = useState<"PIE" | "BAR" | "AREA">("PIE");
  const [selectedYear, setSelectedYear] = useState<string>("2026년 (예상 누적)");

  // Format currency
  const formatKRW = (val: number) => `${val.toLocaleString()}원`;
  const formatShortKRW = (val: number) => {
    if (val >= 100000000) return `${(val / 100000000).toFixed(1)}억원`;
    if (val >= 10000) return `${Math.round(val / 10000)}만원`;
    return `${val.toLocaleString()}원`;
  };

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
  const currentYearlyData = useMemo(() => {
    return (
      yearlyHistoricalData.find((y) => y.year === selectedYear) ||
      yearlyHistoricalData[1]
    );
  }, [yearlyHistoricalData, selectedYear]);

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
              월별·연도별 지출 비중과 소비 추이를 다양한 차트로 확인합니다.
            </p>
          </div>
        </div>

        {/* Timeframe Switcher Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-2xl">
          <button
            onClick={() => setTimeframeMode("MONTHLY")}
            className={`py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 ${
              timeframeMode === "MONTHLY"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>월별 소비 분석 ({selectedMonth.split("-")[1]}월)</span>
          </button>

          <button
            onClick={() => setTimeframeMode("YEARLY")}
            className={`py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 ${
              timeframeMode === "YEARLY"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>연도별 비교 분석</span>
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
                  >
                    {activePieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
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
              {activePieData.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between p-1.5 rounded-xl hover:bg-slate-50 transition text-xs"
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
                    <span className="text-[10px] text-slate-600 block">
                      {formatShortKRW(item.value)}
                    </span>
                  </div>
                </div>
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

      {/* Category Spending Rank Table */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-900">
            {timeframeMode === "MONTHLY" ? "카테고리별 지출 순위 & 비중" : "연간 카테고리별 지출 현황"}
          </h3>
          <span className="text-[10px] text-slate-400">지출액 기준 정렬</span>
        </div>

        <div className="space-y-2">
          {activePieData.map((item, idx) => {
            const isHighest = idx === 0;

            return (
              <div
                key={item.name}
                className="p-2.5 rounded-2xl bg-slate-50/80 border border-slate-100 flex items-center justify-between text-xs"
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
                  <span className="font-extrabold text-slate-900 block">
                    {formatKRW(item.value)}
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
              </div>
            );
          })}
        </div>
      </div>

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
