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

export interface RecurringItem {
  /** 정규화된 이름을 열쇠로 묶고, 보여 줄 이름은 가장 최근 것입니다. */
  key: string;
  merchant: string;
  /** 매달 나가는 금액으로 볼 값 — 가장 최근 금액. */
  amount: number;
  /** 최근 6개월 평균. 금액이 오르내리면 이쪽이 실제에 가깝습니다. */
  average: number;
  paymentDay: number;
  monthCount: number;
  /** 마지막으로 찍힌 날. 끊긴 구독을 가려냅니다. */
  lastSeen: string;
  category: string;
  accountId: string;
  amountStable: boolean;
}

/**
 * 매달 빠져나가는 것들을 모아 봅니다 (§12.10).
 *
 * 고정비 판정(§10)이 이미 반복을 찾아내는데 **모아 볼 자리가 없었습니다** —
 * 고정비 화면의 한 줄 요약뿐이었습니다. 구독이 늘어난 것을 알아차리는 일은
 * 개인 가계부에서 가장 값이 큰 점검이고, 계산은 이미 다 되어 있습니다.
 *
 * **금액은 가장 최근 것과 평균을 함께** 줍니다. 구독료가 오르면 둘이 벌어지고,
 * 그 차이가 곧 알아차려야 할 사실입니다.
 */
export function recurringItems(transactions: Transaction[]): RecurringItem[] {
  const index = buildRecurrenceIndex(transactions.filter((tx) => tx.type === "EXPENSE"));
  const items: RecurringItem[] = [];

  for (const [key, info] of index) {
    if (!info.isRecurring) continue;

    /* 그 이름의 거래 중 가장 최근 것이 보여 줄 이름·금액·카테고리를 정합니다 */
    const rows = transactions
      .filter((tx) => tx.type === "EXPENSE" && normaliseMerchant(tx.merchant) === key)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (rows.length === 0) continue;

    const latest = rows[0];
    const recent = info.amounts.slice(-6);
    const average = Math.round(
      recent.reduce((sum, amount) => sum + amount, 0) / (recent.length || 1)
    );

    items.push({
      key,
      merchant: latest.merchant,
      amount: latest.amount,
      average,
      paymentDay: info.paymentDay,
      monthCount: info.monthCount,
      lastSeen: latest.date,
      category: latest.category,
      accountId: latest.accountId,
      amountStable: info.amountStable,
    });
  }

  /* 금액 큰 순 — 줄일 것을 찾으러 열었을 가능성이 가장 높습니다 */
  return items.sort((a, b) => b.amount - a.amount);
}

/**
 * 마지막으로 찍힌 지 오래된 것.
 *
 * 매달 나가던 것이 두 달 넘게 안 보이면 **끊겼거나, 이름이 바뀌었거나, 명세서를
 * 아직 안 넣은 것**입니다. 셋 다 사용자가 알아야 할 사실이라 표시만 하고
 * 목록에서 빼지는 않습니다(§17.1 — 판단은 사람이).
 */
export function looksStopped(item: RecurringItem, today: Date = new Date()): boolean {
  const last = new Date(item.lastSeen);
  if (Number.isNaN(last.getTime())) return false;
  const days = (today.getTime() - last.getTime()) / 86400000;
  return days > 65;
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
