import type { Transaction } from "../types/finance";
import { isInstalment } from "./csvImport";
import { thisMonthKey } from "./trend";

/**
 * 계좌·카드 내역 화면이 내리는 판단들.
 *
 * `AccountLedgerModal` 안에 있던 것을 내렸습니다(§17.5). 그 파일은 1,474줄로
 * 이 저장소에서 가장 컸고, **타입 검사가 가장 얕게 닿는 계층에 가장 중요한
 * 산식**이 있었습니다 — 카드의 합계가 그것입니다. 실제로 그 규칙이 틀려
 * 명세서 소계와 34,000원 어긋난 적이 있습니다(§9.5).
 */

/** 어느 달로 세는가. 할부는 한 번 쓰고 여러 달 청구되므로 두 답이 다릅니다. */
export type MonthBasis = "USED" | "BILLED";

/**
 * 그 줄이 속한 달.
 *
 * 결제월이 기록되기 전에 들어온 줄은 이용월밖에 없고, 그것이 그동안 보여 온
 * 답이므로 그대로 씁니다.
 */
export function monthOf(tx: Transaction, basis: MonthBasis): string {
  if (basis === "BILLED") return tx.billingMonth || tx.date.slice(0, 7);
  return tx.date.slice(0, 7);
}

/** 내역이 실제로 있는 연월, 오래된 것부터. */
export function monthKeys(entries: Transaction[], basis: MonthBasis): string[] {
  return entries.map((tx) => monthOf(tx, basis)).sort();
}

export type PayKind = "CARD_LOAN" | "ONCE" | "INSTALMENT";

/**
 * 카드 한 줄이 셋 중 무엇인가.
 *
 * 현금서비스·카드대출은 분류가 `대출`로 보내고, 할부는 명세서가 메모로 실어
 * 준 회차가 말해 줍니다(§7.6). 나머지는 한 번에 낸 것입니다.
 */
export function payKindOf(tx: Transaction): PayKind {
  if (tx.category === "대출") return "CARD_LOAN";
  if (isInstalment(tx.memo || "")) return "INSTALMENT";
  return "ONCE";
}

export interface LedgerFilter {
  basis: MonthBasis;
  /** `MONTH` 면 `month` 만, `RANGE` 면 `from`~`to` 를 봅니다. */
  periodMode: "MONTH" | "RANGE";
  month?: string;
  from?: string;
  to?: string;
  /**
   * 방향과 정기성을 곱한 넷. 비우거나 `ALL` 이면 전부 (§6.6).
   *
   * 정기성이 수입에도 붙게 되면서 `INCOME` 하나로는 모자라게 되었습니다 —
   * 급여와 어쩌다 들어온 환급금은 다른 것입니다.
   */
  kind?: "ALL" | "FIXED" | "VARIABLE" | "INCOME_FIXED" | "INCOME_VARIABLE";
  /** 카드 전용. 비우거나 `ALL` 이면 전부. */
  pay?: "ALL" | PayKind;
  /** 비우면 전부. */
  category?: string | null;
}

/**
 * 그 줄이 고른 기간 안에 있는가.
 *
 * **한쪽이 비면 그쪽은 열어 둡니다** — 한 칸만 채운 구간은 "여기부터" 또는
 * "여기까지"로 읽는 것이 자연스럽습니다. 거꾸로 적어도 바로잡습니다.
 */
export function inPeriod(tx: Transaction, filter: LedgerFilter): boolean {
  const key = monthOf(tx, filter.basis);
  if (filter.periodMode === "MONTH") return key === filter.month;

  const from = filter.from || "0000-00";
  const to = filter.to || "9999-99";
  const [low, high] = from <= to ? [from, to] : [to, from];
  return key >= low && key <= high;
}

/** 조건을 모두 통과한 줄. 순서는 받은 그대로입니다(컨텍스트가 이미 정렬). */
export function filterEntries(
  entries: Transaction[],
  filter: LedgerFilter
): Transaction[] {
  const kind = filter.kind || "ALL";
  const pay = filter.pay || "ALL";

  return entries.filter((tx) => {
    if (!inPeriod(tx, filter)) return false;
    if (kind !== "ALL") {
      const wantsIncome = kind.startsWith("INCOME");
      if ((tx.type === "INCOME") !== wantsIncome) return false;
      const wantedRecurrence = kind.endsWith("FIXED") ? "FIXED" : "VARIABLE";
      if (tx.expenseType !== wantedRecurrence) return false;
    }
    if (pay !== "ALL" && payKindOf(tx) !== pay) return false;
    if (filter.category && tx.category !== filter.category) return false;
    return true;
  });
}

export interface LedgerTotals {
  income: number;
  expense: number;
  /**
   * 카드가 청구하는 금액 — `지출 − 차감·환불`.
   *
   * 카드는 한 덩어리를 청구하고 청구할인·환불은 그 금액을 **줄이는** 것이라,
   * 지출만 더하면 명세서의 소계와 어긋납니다 — 우리카드에서 34,000원 차이가
   * 났습니다. 그 합계가 출금과 정확히 같아야 카드대금이 연결되므로(§9.2) 이
   * 산식은 연결의 근거이기도 합니다.
   *
   * **계좌 화면은 이 값을 쓰지 않습니다.** 거기서 수입은 들어온 돈이지 줄어든
   * 청구액이 아니므로 `income`·`expense` 를 따로 보여 줍니다.
   */
  billed: number;
}

export function ledgerTotals(entries: Transaction[]): LedgerTotals {
  let income = 0;
  let expense = 0;
  for (const tx of entries) {
    if (tx.type === "INCOME") income += tx.amount;
    else expense += tx.amount;
  }
  return { income, expense, billed: expense - income };
}

/**
 * 골라 둔 것들의 합 — 고른 이유가 그 값입니다.
 *
 * **카드와 계좌에서 뜻이 갈립니다.** 카드는 위와 같이 차감을 빼고, 계좌에서는
 * 들어온 돈과 나간 돈이 각각이라 **더한 값**이 "고른 것들의 합"입니다(§9.5).
 */
export function selectedTotals(
  entries: Transaction[],
  selected: Set<string> | string[],
  isBank: boolean
): LedgerTotals & { total: number } {
  const ids = selected instanceof Set ? selected : new Set(selected);
  const totals = ledgerTotals(entries.filter((tx) => ids.has(tx.id)));

  return {
    ...totals,
    total: isBank ? totals.expense + totals.income : totals.billed,
  };
}

/** 달마다 묶어, 최근 달부터. */
export function groupByMonth(
  entries: Transaction[],
  basis: MonthBasis
): [string, Transaction[]][] {
  const map = new Map<string, Transaction[]>();
  for (const tx of entries) {
    const key = monthOf(tx, basis);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tx);
  }
  return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
}

/** 달마다 몇 건인지 — 빈 달을 헛되게 열지 않도록 연월 선택 창이 씁니다. */
export function countByMonth(
  entries: Transaction[],
  basis: MonthBasis
): Map<string, number> {
  const map = new Map<string, number>();
  for (const tx of entries) {
    const key = monthOf(tx, basis);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

/** 그 계좌가 실제로 쓰는 카테고리만 고를 만합니다. */
export function categoriesUsed(entries: Transaction[]): string[] {
  const names = new Set<string>();
  for (const tx of entries) names.add(tx.category);
  return Array.from(names).sort((a, b) => a.localeCompare(b, "ko"));
}

/**
 * 창을 열 때 착지할 달.
 *
 * `고른 기준월` → `읽던 달` → `내역이 있는 가장 최근 달` 순이고, **그 달에 이
 * 계좌 내역이 있을 때만** 그 답을 씁니다.
 *
 * 가장 최근 달로 가는 규칙은 `카드·계좌` 화면에 월 이동 바가 없어서(§12)
 * 생겼습니다. 그런데 홈의 자산 요약에서 열면 사정이 다릅니다 — **8월을 골라
 * 두고 카드를 눌렀는데 9월이 열렸습니다.** 방금 한 선택을 앱이 못 본 척한
 * 셈입니다.
 *
 * 고른 달에 내역이 **없으면 물러섭니다.** 아직 명세서를 넣지 않은 카드를
 * 열었을 때 `내역 없음` 만 보여 주는 것은 답이 아닙니다.
 */
export function landingMonth(options: {
  /** `monthKeys` 의 결과. */
  months: string[];
  /** 사용자가 상단 월 이동 바에서 고른 달. */
  selected?: string;
  /** 지난번에 읽던 달. */
  leftover?: string;
  /** 내역이 하나도 없을 때. 기본값은 이번 달입니다. */
  fallback?: string;
}): string {
  const { months, selected, leftover } = options;
  const fallback = options.fallback || thisMonthKey();

  if (selected && months.includes(selected)) return selected;
  if (leftover && months.includes(leftover)) return leftover;
  return months.length > 0 ? months[months.length - 1] : fallback;
}

/** 아직 손대지 않은 기간 칸에 넣을 양끝 — 기록된 전부. */
export function fullSpan(months: string[], fallback?: string): {
  from: string;
  to: string;
} {
  const edge = fallback || thisMonthKey();
  if (months.length === 0) return { from: edge, to: edge };
  return { from: months[0], to: months[months.length - 1] };
}
