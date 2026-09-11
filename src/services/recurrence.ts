import type { Transaction } from "../types/finance";

/**
 * Working out which entries are actually recurring.
 *
 * The rule: when it is not obvious from the name whether something is a fixed
 * cost, treat it as one if the same merchant appears at the same point in at
 * least three different months. "The same point" has to tolerate a few days —
 * a payment due on a weekend or a holiday is taken on the next working day,
 * and month-end dates land on the 28th, 30th or 31st depending on the month.
 *
 * This is arithmetic over the user's own history, so it is computed here
 * rather than asked of the model. The result is handed to the model as
 * evidence, and the payment day it produces is used directly.
 */

/** Days either side of the usual date still counted as the same point. */
const DAY_TOLERANCE = 4;
/** From this day onward, treat everything as "month end". */
const MONTH_END_FROM = 26;
const MIN_MONTHS = 3;

/**
 * Collapses the variations a statement writes the same payee as: branch
 * suffixes, approval numbers, spacing, casing.
 */
export function normaliseMerchant(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // (주), (강남점)
    .replace(/[0-9]{3,}/g, "") // approval or card numbers
    .replace(/(지점|점포|본점|센터|매장)$/g, "")
    .replace(/[\s\-_*.,/]/g, "")
    .trim();
}

export interface RecurrenceInfo {
  /** Distinct YYYY-MM the merchant was seen in. */
  months: string[];
  monthCount: number;
  /** Day of month for each occurrence. */
  days: number[];
  /** The day to bill on: the middle of the observed days. */
  paymentDay: number;
  /** Largest distance from that day, after month-end and holiday tolerance. */
  daySpread: number;
  amounts: number[];
  /** Amounts within 10% of each other — a subscription rather than a habit. */
  amountStable: boolean;
  /** Meets the three-month, same-point rule. */
  isRecurring: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

/** Distance in days, counting all month-end dates as the same point. */
function dayDistance(day: number, reference: number): number {
  if (day >= MONTH_END_FROM && reference >= MONTH_END_FROM) return 0;
  return Math.abs(day - reference);
}

function summarise(entries: Transaction[]): RecurrenceInfo {
  const months = Array.from(new Set(entries.map((tx) => tx.date.slice(0, 7)))).sort();
  const days = entries.map((tx) => Number(tx.date.slice(8, 10)));
  const amounts = entries.map((tx) => tx.amount);

  const paymentDay = median(days);
  const daySpread = days.reduce(
    (worst, day) => Math.max(worst, dayDistance(day, paymentDay)),
    0
  );

  const maxAmount = Math.max(...amounts);
  const minAmount = Math.min(...amounts);
  const amountStable = maxAmount === 0 || (maxAmount - minAmount) / maxAmount <= 0.1;

  return {
    months,
    monthCount: months.length,
    days,
    paymentDay,
    daySpread,
    amounts,
    amountStable,
    isRecurring: months.length >= MIN_MONTHS && daySpread <= DAY_TOLERANCE,
  };
}

/**
 * One entry per normalised merchant, built from the user's whole history —
 * not just the rows being classified, since the evidence for a monthly charge
 * usually sits outside the selection.
 */
export function buildRecurrenceIndex(
  transactions: Transaction[]
): Map<string, RecurrenceInfo> {
  const groups = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    const key = normaliseMerchant(tx.merchant);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  const index = new Map<string, RecurrenceInfo>();
  for (const [key, entries] of groups) {
    index.set(key, summarise(entries));
  }
  return index;
}

export function recurrenceFor(
  tx: Transaction,
  index: Map<string, RecurrenceInfo>
): RecurrenceInfo | undefined {
  return index.get(normaliseMerchant(tx.merchant));
}

/** A short line describing the evidence, for the model and for the user. */
export function describeRecurrence(info: RecurrenceInfo | undefined): string {
  if (!info) return "이력 없음";
  if (info.monthCount < 2) return "1개월치만 확인됨";
  return [
    `${info.monthCount}개월(${info.months.join(", ")})`,
    `매월 ${info.paymentDay}일 전후(편차 ${info.daySpread}일)`,
    info.amountStable ? "금액 일정" : "금액 변동",
    info.isRecurring ? "→ 반복 결제 조건 충족" : "→ 반복 조건 미충족",
  ].join(" · ");
}
