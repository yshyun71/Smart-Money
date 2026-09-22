import type { Transaction } from "../types/finance";
import { spendingRows } from "./actuals";

/**
 * 고른 기간의 변동 추이 — 그리고 "어느 기간"을 말하는 한 가지 방식.
 *
 * 이 앱의 분석은 오래도록 **한 달** 또는 **한 해**만 볼 수 있었습니다. 그런데
 * "작년 3월부터 올해 2월까지 식비가 어떻게 움직였나" 같은 질문은 그 둘 어디에도
 * 들어맞지 않습니다. 기간을 값으로 다루면 같은 질문을 달·해·임의 구간에 똑같이
 * 던질 수 있고, 카테고리 상세 조회 창도 한 벌로 끝납니다.
 */

/** 시작일과 끝일을 함께 갖는 기간. 둘 다 `YYYY-MM-DD`, 양끝 포함입니다. */
export interface Period {
  start: string;
  end: string;
  /** 사람에게 보여 줄 이름 — `8월`, `2026년`, `2026.03 ~ 2027.02`. */
  label: string;
}

/*
  연월 한 칸을 다루는 네 가지. 같은 것이 `AccountLedgerModal`·`CardUsageModal`·
  `MonthPickerModal` 에 **세 벌**로 복사돼 있었습니다 — `formatPhone` 이 세 벌로
  돌아다닌 것과 같은 일입니다(§12.2). 기간을 말하는 자리가 여기이므로 여기 둡니다.
*/

const pad = (value: number) => String(value).padStart(2, "0");

/** 오늘이 속한 연월. */
export function thisMonthKey(today = new Date()): string {
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
}

/**
 * `"2026-09"` → `"2026년 09월"`.
 *
 * 읽을 수 없는 값에는 `-` 를 돌려줍니다. 지어내지 않습니다(§17.1).
 */
export function monthLabel(key: string): string {
  const [year, month] = (key || "").split("-");
  if (!year || !month) return "-";
  return `${year}년 ${month}월`;
}

/** 연월을 달 단위로 옮깁니다. 해를 넘기는 것은 `Date` 가 맡습니다. */
export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  const moved = new Date(year, month - 1 + delta, 1);
  return `${moved.getFullYear()}-${pad(moved.getMonth() + 1)}`;
}

/**
 * 달의 마지막 날을 `31`로 둡니다.
 *
 * 날짜를 **글자로** 견주므로(`YYYY-MM-DD`) 30일인 달에도 안전합니다 —
 * `"2026-09-30" <= "2026-09-31"` 이고 `"2026-10-01" > "2026-09-31"` 입니다.
 * 달마다 말일을 따로 구하는 코드를 두지 않는 편이 틀릴 여지가 적습니다.
 */
export function monthPeriod(month: string): Period {
  return {
    start: `${month}-01`,
    end: `${month}-31`,
    label: `${Number(month.slice(5, 7)) || ""}월`,
  };
}

export function yearPeriod(year: string): Period {
  return { start: `${year}-01-01`, end: `${year}-12-31`, label: `${year}년` };
}

/** 두 연월 사이(양끝 포함). 거꾸로 주어도 바로잡습니다. */
export function rangePeriod(from: string, to: string): Period {
  const [a, b] = from <= to ? [from, to] : [to, from];
  return {
    start: `${a}-01`,
    end: `${b}-31`,
    label: a === b ? monthPeriod(a).label : `${a.replace("-", ".")} ~ ${b.replace("-", ".")}`,
  };
}

/** 기간 안의 연월 목록. 지나치게 긴 구간은 잘라 냅니다(차트가 읽히지 않습니다). */
export function monthsBetween(from: string, to: string, limit = 120): string[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const months: string[] = [];

  let year = Number(a.slice(0, 4));
  let month = Number(a.slice(5, 7));
  if (!year || !month) return months;

  while (months.length < limit) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= b) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

export type Direction = "ALL" | "INCOME" | "EXPENSE";

export interface TrendPoint {
  month: string;
  /** 차트 축에 쓰는 짧은 이름. 해가 바뀌는 달만 연도를 답니다. */
  label: string;
  income: number;
  expense: number;
  /** 수입 − 지출. */
  net: number;
  /** 고른 구분에 해당하는 건수. */
  count: number;
}

/**
 * 달마다 한 점씩. **내역이 없는 달도 0으로 남깁니다.**
 *
 * 빈 달을 빼면 선이 이어져 버려 "그 달에 쓰지 않았다"가 "그 달이 없었다"로
 * 보입니다. 추이는 빈 곳이 보여야 추이입니다.
 *
 * 옮긴 돈(`이체`, 고정비 아님)은 세지 않습니다(§6.5) — `spendingRows` 를 여기서
 * 한 번 더 거르므로, 원본 목록을 넘겨도 다른 화면의 합계와 어긋나지 않습니다.
 */
export function monthlyTrend(
  transactions: Transaction[],
  options: { from: string; to: string; direction?: Direction; category?: string | null }
): TrendPoint[] {
  const { from, to, direction = "ALL", category } = options;
  const counted = spendingRows(transactions);

  return monthsBetween(from, to).map((month, index, all) => {
    const rows = counted.filter(
      (tx) =>
        tx.date.startsWith(month) && (!category || category === "ALL" || tx.category === category)
    );

    const income = rows
      .filter((tx) => tx.type === "INCOME")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const expense = rows
      .filter((tx) => tx.type === "EXPENSE")
      .reduce((sum, tx) => sum + tx.amount, 0);

    const counting =
      direction === "INCOME"
        ? rows.filter((tx) => tx.type === "INCOME")
        : direction === "EXPENSE"
          ? rows.filter((tx) => tx.type === "EXPENSE")
          : rows;

    // 해가 바뀌는 첫 점에만 연도를 답니다 — 12개월이 넘으면 축이 읽히지 않습니다
    const year = month.slice(0, 4);
    const showYear = index === 0 || all[index - 1].slice(0, 4) !== year;

    return {
      month,
      label: showYear ? `${year.slice(2)}/${month.slice(5, 7)}` : `${Number(month.slice(5, 7))}월`,
      income,
      expense,
      net: income - expense,
      count: counting.length,
    };
  });
}

/** 고른 구분에서 그 달의 값. */
export function valueOf(point: TrendPoint, direction: Direction): number {
  if (direction === "INCOME") return point.income;
  if (direction === "EXPENSE") return point.expense;
  return point.net;
}

export interface TrendStats {
  total: number;
  /** 달 수로 나눈 평균 — 내역이 없는 달도 한 달로 셉니다. */
  average: number;
  peak: TrendPoint | null;
  low: TrendPoint | null;
  months: number;
  entries: number;
  /** 첫 달 대비 마지막 달의 변화량. 첫 달이 0이면 비율은 `null` 입니다. */
  change: number;
  changeRatio: number | null;
}

export function trendStats(points: TrendPoint[], direction: Direction = "ALL"): TrendStats {
  if (points.length === 0) {
    return {
      total: 0,
      average: 0,
      peak: null,
      low: null,
      months: 0,
      entries: 0,
      change: 0,
      changeRatio: null,
    };
  }

  const values = points.map((point) => valueOf(point, direction));
  const total = values.reduce((sum, value) => sum + value, 0);

  let peak = points[0];
  let low = points[0];
  points.forEach((point, index) => {
    if (values[index] > valueOf(peak, direction)) peak = point;
    if (values[index] < valueOf(low, direction)) low = point;
  });

  const first = values[0];
  const last = values[values.length - 1];
  const change = last - first;

  return {
    total,
    // 정수로 맞춥니다 — 원 단위 아래는 뜻이 없습니다
    average: Math.round(total / points.length),
    peak,
    low,
    months: points.length,
    entries: points.reduce((sum, point) => sum + point.count, 0),
    change,
    /* 첫 달이 0이면 증감률이란 것이 없습니다. 0으로 나눠 ∞ 를 보여 주는 것보다
       모른다고 하는 편이 맞습니다(§17.1). */
    changeRatio: first !== 0 ? change / Math.abs(first) : null,
  };
}

/**
 * 그 기간에 **실제로 있는** 카테고리만, 금액 큰 순으로.
 *
 * 전체 목록을 드롭다운에 넣으면 고르는 대로 빈 차트가 나옵니다. 있는 것만
 * 보여 주고 금액을 함께 적어 두면 무엇을 볼지 그 자리에서 정할 수 있습니다.
 */
export function categoriesInRange(
  transactions: Transaction[],
  options: { from: string; to: string; direction?: Direction }
): { category: string; amount: number; count: number }[] {
  const { from, to, direction = "ALL" } = options;
  const period = rangePeriod(from, to);
  const map = new Map<string, { amount: number; count: number }>();

  spendingRows(transactions)
    .filter((tx) => tx.date >= period.start && tx.date <= period.end)
    .filter((tx) =>
      direction === "ALL"
        ? true
        : direction === "INCOME"
          ? tx.type === "INCOME"
          : tx.type === "EXPENSE"
    )
    .forEach((tx) => {
      const found = map.get(tx.category) || { amount: 0, count: 0 };
      map.set(tx.category, { amount: found.amount + tx.amount, count: found.count + 1 });
    });

  return Array.from(map.entries())
    .map(([category, totals]) => ({ category, ...totals }))
    .sort((a, b) => b.amount - a.amount);
}
