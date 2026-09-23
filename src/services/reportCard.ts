import type { ConnectedAccount, Transaction } from "../types/finance";
import { actualRows } from "./actuals";
import { categoryBreakdown, summariseEntries, type CategoryShare } from "./history";
import { refundsIn, type RefundSummary } from "./refunds";
import { monthLabel, shiftMonth } from "./trend";

/**
 * 한 장으로 보는 결산 — 달과 해가 같은 틀을 씁니다 (§12.14).
 *
 * 가계부를 계속 쓰게 만드는 것은 결국 **돌아보는 재미**입니다. 그런데 이 앱은
 * 숫자를 화면 여섯 곳에 흩어 두고 있었습니다 — 결산 카드, 고정비 화면, 소비분석
 * 도넛, 예산의 실적, 연도별 비교. "8월이 어땠는가"에 한 번에 답하는 자리가
 * 없었습니다.
 *
 * **달과 해를 한 함수로 만듭니다.** 두 화면을 따로 만들면 같은 산식이 두 벌이
 * 되고, 한쪽만 고쳐질 자리가 생깁니다(§17.5에서 되풀이해 겪은 것). 기간을
 * 가리는 것은 `key` 하나뿐입니다 — `2026-08` 이면 그 달, `2026` 이면 그 해이고,
 * 날짜가 `YYYY-MM-DD` 라 **앞자리 비교 하나로** 둘 다 걸러집니다.
 *
 * **넘기는 목록은 이미 걸러져 있어야 합니다**(`spendingRows` — §6.5). 옮긴 돈을
 * 세지 않는 판단은 부르는 쪽이 하고, 여기서는 받은 것을 셈합니다 — `history.ts`
 * 와 같은 약속입니다.
 */

export type ReportScope = "MONTH" | "YEAR";

export interface ReportSlice {
  key: string;
  label: string;
  count: number;
  income: number;
  incomeFixed: number;
  expense: number;
  fixed: number;
  variable: number;
  savings: number;
  /** 수입 − 지출. 남은 돈입니다. */
  left: number;
}

export interface ReportChange {
  income: number;
  expense: number;
  fixed: number;
  variable: number;
}

export interface ReportCard {
  scope: ReportScope;
  key: string;
  label: string;
  now: ReportSlice;
  /** 앞 기간. 자료가 없으면 `null` — 지어내지 않습니다(§17.1). */
  before: ReportSlice | null;
  /** 앞 기간과의 차이. 앞 기간이 없으면 `null`. */
  change: ReportChange | null;
  /** 지출에서 차지하는 순서. 금액 큰 순. */
  categories: CategoryShare[];
  /** 해를 볼 때의 달별 흐름. 달을 볼 때는 비어 있습니다. */
  months: ReportSlice[];
  /** 가장 많이 쓴 달. 해를 볼 때만. */
  peak: ReportSlice | null;
  refunds: RefundSummary;
}

/** 그 기간에 든 것만. `2026` 은 그 해 전부, `2026-08` 은 그 달. */
function within(transactions: Transaction[], key: string): Transaction[] {
  return transactions.filter((tx) => tx.date.startsWith(key));
}

function labelFor(key: string): string {
  return key.length === 4 ? `${key}년` : monthLabel(key);
}

/** 앞 기간 — 달이면 지난달, 해면 지난해. */
function previousKey(key: string): string {
  if (key.length === 4) return String(Number(key) - 1);
  return shiftMonth(key, -1);
}

function sliceOf(
  transactions: Transaction[],
  key: string,
  accounts: ConnectedAccount[]
): ReportSlice {
  const rows = within(transactions, key);
  const totals = summariseEntries(rows);
  const sum = (kind: Parameters<typeof actualRows>[1]["kind"]) =>
    actualRows(transactions, { month: key, kind, accounts }).reduce(
      (total, tx) => total + tx.amount,
      0
    );

  return {
    key,
    label: labelFor(key),
    count: rows.length,
    income: totals.income,
    incomeFixed: sum("INCOME_FIXED"),
    expense: totals.expense,
    /*
      고정비·변동비·저축은 **예산 화면과 같은 정의**를 씁니다(§11.4). 여기서
      직접 걸러 내면 `고정비 + 변동비 + 저축 = 총지출` 이 이 화면에서만 어긋나고,
      어느 쪽이 맞는지 알 수 없게 됩니다.
    */
    fixed: sum("FIXED"),
    variable: sum("VARIABLE"),
    savings: sum("SAVINGS"),
    left: totals.income - totals.expense,
  };
}

/**
 * 몇 줄까지 보여 줄 것인가.
 *
 * 한 장에 담는 것이 이 화면의 요점이라, 카테고리를 전부 늘어놓으면 한 장이
 * 아니게 됩니다. 나머지는 소비분석에 이미 있습니다(§12.3).
 */
export const TOP_CATEGORIES = 6;

export function buildReportCard(options: {
  transactions: Transaction[];
  accounts: ConnectedAccount[];
  key: string;
  topCategories?: number;
}): ReportCard {
  const { transactions, accounts, key } = options;
  const top = options.topCategories ?? TOP_CATEGORIES;
  const scope: ReportScope = key.length === 4 ? "YEAR" : "MONTH";

  const now = sliceOf(transactions, key, accounts);

  const beforeKey = previousKey(key);
  const beforeRows = within(transactions, beforeKey);
  const before = beforeRows.length > 0 ? sliceOf(transactions, beforeKey, accounts) : null;

  const change: ReportChange | null = before
    ? {
        income: now.income - before.income,
        expense: now.expense - before.expense,
        fixed: now.fixed - before.fixed,
        variable: now.variable - before.variable,
      }
    : null;

  const categories = categoryBreakdown(within(transactions, key), now.expense).slice(
    0,
    top
  );

  /*
    해를 볼 때만 달별 줄을 만듭니다. **내역이 없는 달도 0으로 남깁니다** — 빼면
    "그 달에 쓰지 않았다"가 "그 달이 없었다"로 보입니다(§12.4와 같은 이유).
  */
  const months: ReportSlice[] =
    scope === "YEAR"
      ? Array.from({ length: 12 }, (_, index) =>
          sliceOf(transactions, `${key}-${String(index + 1).padStart(2, "0")}`, accounts)
        )
      : [];

  const spent = months.filter((month) => month.expense > 0);
  const peak =
    spent.length > 0
      ? spent.reduce((worst, month) => (month.expense > worst.expense ? month : worst))
      : null;

  const range =
    scope === "YEAR"
      ? { from: `${key}-01-01`, to: `${key}-12-31` }
      : { from: `${key}-01`, to: `${key}-31` };

  return {
    scope,
    key,
    label: labelFor(key),
    now,
    before,
    change,
    categories,
    months,
    peak,
    refunds: refundsIn(transactions, range),
  };
}

/**
 * 수입에서 남긴 비율.
 *
 * **수입이 0이면 `null` 입니다.** 0으로 나눈 값을 `∞`나 `0%`로 적는 대신 모른다고
 * 말합니다 — 기간 추이의 증감률과 같은 규칙입니다(§12.4 · §17.1).
 */
export function savingsRate(slice: ReportSlice): number | null {
  if (slice.income <= 0) return null;
  return (slice.left / slice.income) * 100;
}

/** `+12.3%` 처럼 적을 값. 앞 기간이 0이면 비율을 지어내지 않습니다. */
export function changeRatio(now: number, before: number): number | null {
  if (before <= 0) return null;
  return ((now - before) / before) * 100;
}
