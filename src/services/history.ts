import type { Transaction } from "../types/finance";

/**
 * 달·해 단위 집계와 카테고리 비중.
 *
 * 컨텍스트 안에 있던 것을 내렸습니다. 이유는 규율 그대로입니다(§17.5) —
 * 순수 함수라야 타입 검사와 회귀 세트가 닿고, 컨텍스트는 그것을 부르기만
 * 하면 됩니다. 1,852줄이던 파일에서 이 계산들이 나가면 남는 것은 상태와
 * 저장뿐입니다.
 *
 * **넘기는 목록은 이미 걸러져 있어야 합니다**(`spendingRows` — §6.5). 옮긴 돈을
 * 세지 않는 판단은 부르는 쪽이 하고, 여기서는 받은 것을 그대로 셈합니다.
 */

export interface PeriodTotals {
  income: number;
  expense: number;
  fixed: number;
  variable: number;
  /** 수입 − 지출. */
  savings: number;
}

export function summariseEntries(transactions: Transaction[]): PeriodTotals {
  const sum = (rows: Transaction[]) => rows.reduce((total, tx) => total + tx.amount, 0);

  const income = sum(transactions.filter((tx) => tx.type === "INCOME"));
  const expense = sum(transactions.filter((tx) => tx.type === "EXPENSE"));

  return {
    income,
    expense,
    fixed: sum(
      transactions.filter((tx) => tx.type === "EXPENSE" && tx.expenseType === "FIXED")
    ),
    variable: sum(
      transactions.filter((tx) => tx.type === "EXPENSE" && tx.expenseType === "VARIABLE")
    ),
    savings: income - expense,
  };
}

export interface CategoryShare {
  category: string;
  amount: number;
  /** 그 기간 지출에서 차지하는 비율. 지출이 0이면 0입니다. */
  percentage: number;
}

/**
 * 카테고리별 지출과 비중, 금액 큰 순.
 *
 * 비중의 분모를 **인자로 받습니다.** 화면에 적힌 총지출과 이 비중의 분모가
 * 달라지면 합이 100%가 되지 않습니다 — 같은 수를 쓰는지 부르는 쪽이 보이게
 * 두는 편이 안전합니다.
 */
export function categoryBreakdown(
  transactions: Transaction[],
  totalExpense: number
): CategoryShare[] {
  const map = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.type !== "EXPENSE") continue;
    map.set(tx.category, (map.get(tx.category) || 0) + tx.amount);
  }

  return Array.from(map.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export interface MonthTotals extends PeriodTotals {
  month: string;
  /** 축에 쓰는 짧은 이름. */
  displayMonth: string;
}

/**
 * 고른 달로 끝나는 최근 몇 달.
 *
 * **내역이 없는 달도 한 점으로 남깁니다** — 빼면 선이 이어져 "그 달에 쓰지
 * 않았다"가 "그 달이 없었다"로 보입니다(§12.4와 같은 이유).
 */
export function monthlyHistory(
  transactions: Transaction[],
  options: { until: string; months?: number }
): MonthTotals[] {
  const { until, months = 6 } = options;
  const year = Number(until.slice(0, 4));
  const month = Number(until.slice(5, 7));
  if (!year || !month) return [];

  const items: MonthTotals[] = [];

  for (let offset = months - 1; offset >= 0; offset--) {
    const at = new Date(year, month - 1 - offset, 1);
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
    items.push({
      month: key,
      displayMonth: `${at.getMonth() + 1}월`,
      ...summariseEntries(transactions.filter((tx) => tx.date.startsWith(key))),
    });
  }

  return items;
}

export interface YearTotals extends PeriodTotals {
  year: string;
  categories: CategoryShare[];
}

/** 자료가 있는 해만, 오래된 해부터. */
export function yearlyHistory(transactions: Transaction[]): YearTotals[] {
  const byYear = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    const year = tx.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(tx);
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, rows]) => {
      const totals = summariseEntries(rows);
      return { year, ...totals, categories: categoryBreakdown(rows, totals.expense) };
    });
}
