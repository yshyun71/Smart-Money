import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
} from "recharts";
import { useFinance } from "../../context/FinanceContext";
import { shortWon, won, withCommas } from "../../utils/format";
import {
  categoriesInRange,
  monthlyTrend,
  trendStats,
  valueOf,
  rangePeriod,
  monthPeriod,
  type Direction,
  type TrendPoint,
} from "../../services/trend";
import { CategorySpendingModal } from "../modals/CategorySpendingModal";
import { MonthPickerModal } from "../transactions/MonthPickerModal";
import { AddTransactionModal } from "../transactions/AddTransactionModal";
import { TrendingUp, TrendingDown, Minus, ChevronRight, CalendarRange } from "lucide-react";
import type { Transaction } from "../../types/finance";

/**
 * 고른 기간의 변동 추이.
 *
 * 월별 분석은 한 달을, 연도별 비교는 한 해를 봅니다. 그 사이의 질문 — "작년
 * 3월부터 올해 2월까지 식비가 어떻게 움직였나" — 에 답할 자리가 없었습니다.
 * 기간 · 구분(전체·수입·지출) · 카테고리 셋을 고르면 그 조합의 달별 추이가
 * 나옵니다.
 *
 * 숫자는 전부 `services/trend.ts` 가 냅니다(§17.5). 이 파일은 고르고 그리는
 * 일만 합니다.
 */

const DIRECTIONS: { key: Direction; label: string }[] = [
  { key: "ALL", label: "전체" },
  { key: "INCOME", label: "수입" },
  { key: "EXPENSE", label: "지출" },
];

/** 기본은 최근 6개월 — 계절성이 보이기 시작하는 가장 짧은 구간입니다. */
const monthsAgo = (base: string, count: number) => {
  const year = Number(base.slice(0, 4));
  const month = Number(base.slice(5, 7));
  const shifted = new Date(year, month - 1 - count, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
};

export const PeriodTrendPanel: React.FC = () => {
  const { spendingTransactions, selectedMonth } = useFinance();

  const [from, setFrom] = useState(() => monthsAgo(selectedMonth, 5));
  const [to, setTo] = useState(selectedMonth);
  const [direction, setDirection] = useState<Direction>("EXPENSE");
  const [category, setCategory] = useState<string>("ALL");
  /** 막대를 눌러 연 상세 — 그 달 그 카테고리의 내역. */
  const [drill, setDrill] = useState<{ month: string; category: string } | null>(null);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  /** 기간의 양끝은 계좌 내역·상단 바와 **같은 창**으로 고릅니다(§12.6). */
  const [picking, setPicking] = useState<null | "FROM" | "TO">(null);

  /** 달마다 몇 건인지 — 고르는 창에서 빈 달을 가려 줍니다. */
  const monthCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of spendingTransactions as { date: string }[]) {
      const key = tx.date.slice(0, 7);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [spendingTransactions]);

  const points: TrendPoint[] = useMemo(
    () => monthlyTrend(spendingTransactions, { from, to, direction, category }),
    [spendingTransactions, from, to, direction, category]
  );

  const stats = useMemo(() => trendStats(points, direction), [points, direction]);

  const available = useMemo(
    () => categoriesInRange(spendingTransactions, { from, to, direction }),
    [spendingTransactions, from, to, direction]
  );

  /*
    구분을 바꾸면 고른 카테고리가 그 구분에 없을 수 있습니다 — `식비`를 보다가
    `수입`으로 바꾸면 빈 차트가 나옵니다. 없으면 전체로 되돌립니다.
  */
  useEffect(() => {
    if (category === "ALL") return;
    if (!available.some((item) => item.category === category)) setCategory("ALL");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available]);

  const label = category === "ALL" ? "전체 카테고리" : category;
  const what = direction === "INCOME" ? "수입" : direction === "EXPENSE" ? "지출" : "순액";
  const span = rangePeriod(from, to);

  /** 한 달만 고르면 추이라고 할 것이 없으므로 그 사실을 말합니다. */
  const singleMonth = points.length <= 1;

  const quick = (count: number, name: string) => (
    <button
      key={name}
      type="button"
      onClick={() => {
        setFrom(monthsAgo(selectedMonth, count - 1));
        setTo(selectedMonth);
      }}
      className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition cursor-pointer ${
        from === monthsAgo(selectedMonth, count - 1) && to === selectedMonth
          ? "bg-slate-900 text-white"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {name}
    </button>
  );

  return (
    <div className="space-y-3">
      {/* 고르는 자리 — 기간 → 구분 → 카테고리 순서 그대로 */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-center gap-1.5">
          <CalendarRange className="w-4 h-4 text-emerald-600 shrink-0" />
          <h3 className="text-xs font-bold text-slate-900">기간 추이 분석</h3>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPicking("FROM")}
              className="flex-1 min-w-0 px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 hover:border-emerald-400 transition truncate cursor-pointer"
            >
              {`${from.slice(0, 4)}년 ${Number(from.slice(5, 7))}월`}
            </button>
            <span className="text-[10px] font-bold text-slate-500 shrink-0">부터</span>
            <button
              type="button"
              onClick={() => setPicking("TO")}
              className="flex-1 min-w-0 px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 hover:border-emerald-400 transition truncate cursor-pointer"
            >
              {`${to.slice(0, 4)}년 ${Number(to.slice(5, 7))}월`}
            </button>
            <span className="text-[10px] font-bold text-slate-500 shrink-0">까지</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[quick(3, "최근 3개월"), quick(6, "최근 6개월"), quick(12, "최근 12개월")]}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-2xl">
          {DIRECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setDirection(item.key)}
              className={`py-2 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                direction === item.key
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/*
          있는 카테고리만 보여 줍니다 — 전체 목록을 넣으면 고르는 대로 빈
          차트가 나옵니다. 금액을 함께 적어 두면 무엇을 볼지 그 자리에서 정합니다.
        */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white focus:border-emerald-500 focus:outline-hidden"
        >
          <option value="ALL">전체 카테고리</option>
          {available.map((item) => (
            <option key={item.category} value={item.category}>
              {item.category} · {withCommas(item.amount)}원 ({item.count}건)
            </option>
          ))}
        </select>
      </div>

      {/* 요약 — 차트보다 먼저 읽히는 숫자입니다 */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-slate-900 truncate">
              {label} {what}
            </h3>
            <p className="text-[10px] text-slate-400">
              {span.label} · {stats.months}개월 · {stats.entries}건
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-base font-black text-slate-900 tracking-tight">
              {won(stats.total)}
            </div>
            <span className="text-[10px] text-slate-400">
              월평균 {withCommas(stats.average)}원
            </span>
          </div>
        </div>

        {stats.entries === 0 ? (
          <p className="py-6 text-center text-[11px] text-slate-400 leading-relaxed">
            이 기간에 기록된 {label} {what} 내역이 없습니다.
            <br />
            기간이나 카테고리를 바꿔보세요.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/60">
                <span className="text-[9px] font-bold text-slate-400 block">가장 많은 달</span>
                <span className="text-[11px] font-black text-slate-800">
                  {stats.peak ? `${stats.peak.label} ${shortWon(valueOf(stats.peak, direction))}` : "–"}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/60">
                <span className="text-[9px] font-bold text-slate-400 block">가장 적은 달</span>
                <span className="text-[11px] font-black text-slate-800">
                  {stats.low ? `${stats.low.label} ${shortWon(valueOf(stats.low, direction))}` : "–"}
                </span>
              </div>
              <div className="p-2 rounded-xl bg-slate-50 border border-slate-200/60">
                <span className="text-[9px] font-bold text-slate-400 block">처음 대비 끝</span>
                <span
                  className={`text-[11px] font-black flex items-center justify-center gap-0.5 ${
                    stats.change === 0
                      ? "text-slate-500"
                      : /*
                          지출이 늘면 붉은색, 수입이 늘면 초록색입니다. 같은
                          "증가"가 구분에 따라 반대 뜻입니다.
                        */
                        (direction === "EXPENSE" ? stats.change > 0 : stats.change < 0)
                        ? "text-rose-600"
                        : "text-emerald-600"
                  }`}
                >
                  {stats.change === 0 ? (
                    <Minus className="w-3 h-3" />
                  ) : stats.change > 0 ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  {shortWon(Math.abs(stats.change))}
                  {stats.changeRatio !== null &&
                    ` (${Math.abs(Math.round(stats.changeRatio * 100))}%)`}
                </span>
              </div>
            </div>

            {singleMonth && (
              <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-xl px-2.5 py-2">
                한 달만 골라 두면 추이가 보이지 않습니다. 시작 월을 앞으로 옮겨보세요.
              </p>
            )}

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {direction === "ALL" ? (
                  <ComposedChart
                    data={points}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "#64748B" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "#94A3B8" }}
                      tickFormatter={shortWon}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(val: number, name: string) => [
                        `${val.toLocaleString()}원`,
                        name === "income" ? "수입" : name === "expense" ? "지출" : "순액",
                      ]}
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.95)",
                        borderRadius: "12px",
                        border: "none",
                        color: "#fff",
                        fontSize: "11px",
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "10px", paddingTop: "6px" }}
                      formatter={(val) =>
                        val === "income" ? "수입" : val === "expense" ? "지출" : "순액"
                      }
                    />
                    <ReferenceLine y={0} stroke="#CBD5E1" />
                    <Bar dataKey="income" name="income" fill="#10B981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="expense" fill="#F43F5E" radius={[4, 4, 0, 0]} />
                    <Line
                      type="monotone"
                      dataKey="net"
                      name="net"
                      stroke="#6366F1"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </ComposedChart>
                ) : (
                  <BarChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "#64748B" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "#94A3B8" }}
                      tickFormatter={shortWon}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(val: number) => [`${val.toLocaleString()}원`, what]}
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.95)",
                        borderRadius: "12px",
                        border: "none",
                        color: "#fff",
                        fontSize: "11px",
                      }}
                    />
                    {/* 월평균 선 — 어느 달이 평균을 넘었는지가 추이에서 가장 먼저 궁금해집니다 */}
                    <ReferenceLine
                      y={stats.average}
                      stroke="#94A3B8"
                      strokeDasharray="4 4"
                      label={{
                        value: `평균 ${shortWon(stats.average)}`,
                        position: "insideTopRight",
                        fontSize: 9,
                        fill: "#64748B",
                      }}
                    />
                    <Bar
                      dataKey={direction === "INCOME" ? "income" : "expense"}
                      radius={[4, 4, 0, 0]}
                      /* 누르면 그 달의 내역으로 들어갑니다 */
                      /*
                      `recharts` 는 클릭 payload 를 타입으로 내주지 않습니다 —
                      모양이 버전마다 달라(`name` 이 바로 오기도, `payload` 안에
                      들어오기도) 양쪽을 다 봅니다. 여기의 `any` 는 그 까닭입니다.
                      */
                      onClick={(entry: any) => {
                        if (direction !== "EXPENSE") return;
                        const month = entry?.payload?.month;
                        if (month && category !== "ALL") setDrill({ month, category });
                      }}
                    >
                      {points.map((point) => (
                        <Cell
                          key={point.month}
                          cursor={direction === "EXPENSE" && category !== "ALL" ? "pointer" : "default"}
                          fill={
                            direction === "INCOME"
                              ? "#10B981"
                              : valueOf(point, direction) > stats.average
                                ? "#F43F5E"
                                : "#FB7185"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* 달별 금액 — 차트에서 읽기 어려운 정확한 값, 그리고 상세로 가는 길 */}
            <div className="space-y-1 pt-1 border-t border-slate-100">
              {points
                .slice()
                .reverse()
                .map((point) => {
                  const value = valueOf(point, direction);
                  const share =
                    stats.peak && valueOf(stats.peak, direction) > 0
                      ? Math.round((Math.abs(value) / Math.abs(valueOf(stats.peak, direction))) * 100)
                      : 0;

                  return (
                    <button
                      key={point.month}
                      type="button"
                      disabled={point.count === 0 || direction === "ALL" || category === "ALL"}
                      onClick={() => setDrill({ month: point.month, category })}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-xl hover:bg-slate-50 transition text-[11px] disabled:hover:bg-transparent cursor-pointer disabled:cursor-default"
                    >
                      <span className="font-bold text-slate-600 shrink-0 w-14 text-left">
                        {point.month.slice(2).replace("-", ".")}
                      </span>
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            direction === "INCOME"
                              ? "bg-emerald-500"
                              : direction === "EXPENSE"
                                ? "bg-rose-400"
                                : value >= 0
                                  ? "bg-emerald-500"
                                  : "bg-rose-400"
                          }`}
                          style={{ width: `${Math.min(100, share)}%` }}
                        />
                      </div>
                      <span className="font-black text-slate-800 shrink-0 whitespace-nowrap">
                        {point.count === 0 ? "–" : withCommas(value)}
                      </span>
                      {direction !== "ALL" && category !== "ALL" && point.count > 0 && (
                        <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                      )}
                    </button>
                  );
                })}
            </div>

            {direction !== "ALL" && category !== "ALL" && (
              <p className="text-[10px] text-slate-400">
                달을 누르면 그 달의 {category} 내역이 열립니다.
              </p>
            )}
          </>
        )}
      </div>

      <CategorySpendingModal
        isOpen={drill !== null}
        category={drill?.category ?? null}
        period={drill ? monthPeriod(drill.month) : null}
        direction={direction === "INCOME" ? "INCOME" : "EXPENSE"}
        suspended={editingTx !== null}
        onClose={() => setDrill(null)}
        onPick={(transaction) => setEditingTx(transaction)}
      />

      <AddTransactionModal
        isOpen={editingTx !== null}
        editing={editingTx}
        onClose={() => setEditingTx(null)}
      />

      {/* 기간의 양끝 — 서로를 넘지 못하게 범위를 줍니다 */}
      <MonthPickerModal
        isOpen={picking !== null}
        value={picking === "TO" ? to : from}
        counts={monthCounts}
        title={picking === "TO" ? "끝 월 선택" : "시작 월 선택"}
        max={picking === "FROM" ? to : undefined}
        min={picking === "TO" ? from : undefined}
        onSelect={(picked) => {
          if (picking === "TO") setTo(picked);
          else setFrom(picked);
        }}
        onClose={() => setPicking(null)}
      />
    </div>
  );
};
