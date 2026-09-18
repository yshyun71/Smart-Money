import type { Transaction } from "../types/finance";
import { BUDGET_EXCLUDED_CATEGORIES } from "../constants/categories";

/**
 * 카테고리 예산에서 빼는 항목 — 카드대금과 저축.
 *
 * 둘 다 다른 자리에서 이미 셈해지는 돈입니다. 카드대금은 그 카드의 명세서와
 * 겹치고, 저축은 `목표 저축액`으로 가용 변동비에서 이미 빠져 있어, 여기에
 * 다시 예산을 주면 없는 돈을 배분하게 됩니다.
 */
const excluded = (category: string) =>
  BUDGET_EXCLUDED_CATEGORIES.includes(category as never);

/**
 * A standing rule for how much each category gets, so a budget is not retyped
 * every month.
 *
 * Setting twelve categories by hand, twelve times a year, is work nobody
 * keeps up — the budget then sits at whatever it was months ago and stops
 * meaning anything. The rule is kept once and applied to whichever month is
 * open; the figures it produces are still ordinary category budgets that can
 * be nudged afterwards.
 *
 * Three ways to express it, because people think about money in all three:
 *
 * - `AMOUNT`      — 식비 400,000원. Plain and stable.
 * - `INCOME_RATIO`— 식비, 수입의 12%. Follows a changing income.
 * - `SPARE_RATIO` — 식비, 가용 변동비의 20%. Follows what is actually left.
 *
 * 가용 변동비 here is 수입 − 고정비 − 저축, the same figure the budget screen
 * shows. Leaving savings out of it would let the ratios quietly spend the
 * savings target, which is the one number on that screen the user set as
 * untouchable.
 */

export type BudgetPolicyMode = "AMOUNT" | "INCOME_RATIO" | "SPARE_RATIO";

export interface BudgetPolicy {
  mode: BudgetPolicyMode;
  /** 카테고리 → 금액(AMOUNT) 또는 퍼센트(나머지 둘). */
  rules: Record<string, number>;
}

export function emptyPolicy(): BudgetPolicy {
  return { mode: "AMOUNT", rules: {} };
}

/** 원 단위로 떨어뜨립니다 — 비율 계산이 소수를 만들기 때문입니다. */
const won = (value: number) => Math.max(0, Math.round(value));

export interface PolicyInputs {
  income: number;
  fixed: number;
  savings: number;
}

/** 수입 − 고정비 − 저축. 예산 화면이 보여 주는 그 값입니다. */
export function spareOf({ income, fixed, savings }: PolicyInputs): number {
  return Math.max(0, income - fixed - savings);
}

/**
 * What each category would get under this rule.
 *
 * Categories with no rule are left out rather than set to zero: a budget of
 * zero reads as "spend nothing here", while no entry means "not budgeted",
 * and those are different claims.
 */
export function allocate(
  policy: BudgetPolicy,
  inputs: PolicyInputs
): Record<string, number> {
  const out: Record<string, number> = {};
  const spare = spareOf(inputs);

  for (const [category, value] of Object.entries(policy.rules)) {
    if (!Number.isFinite(value) || value <= 0) continue;

    if (policy.mode === "AMOUNT") {
      out[category] = won(value);
    } else if (policy.mode === "INCOME_RATIO") {
      out[category] = won((inputs.income * value) / 100);
    } else {
      out[category] = won((spare * value) / 100);
    }
  }

  return out;
}

/**
 * Whether the rule adds up to something the month can pay for.
 *
 * Told rather than enforced. Going over is a real decision — a month with a
 * planned trip in it — and the screen's job is to say so, not to refuse.
 */
export function policyCheck(
  policy: BudgetPolicy,
  inputs: PolicyInputs
): { total: number; spare: number; over: number; ratioTotal: number } {
  const allocated = allocate(policy, inputs);
  const total = Object.values(allocated).reduce((sum, value) => sum + value, 0);
  const spare = spareOf(inputs);

  const ratioTotal =
    policy.mode === "AMOUNT"
      ? 0
      : Object.values(policy.rules).reduce(
          (sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0),
          0
        );

  return { total, spare, over: Math.max(0, total - spare), ratioTotal };
}

// ---------------------------------------------------------------------------
// 고정비 가이드
// ---------------------------------------------------------------------------

export interface FixedBaseline {
  category: string;
  /** 고정비가 잡힌 달의 수. 한 달치만으로는 평균이라 할 수 없습니다. */
  months: number;
  /** 그 달들의 평균 금액 — 예산의 최소선으로 제시합니다. */
  average: number;
  /** 가장 최근 달의 금액. */
  latest: number;
  /** 평균보다 오르는 중인지 내리는 중인지. */
  trend: "UP" | "DOWN" | "FLAT";
  /** 달별 금액, 오래된 것부터. 추이를 보여 주기 위한 것입니다. */
  history: { month: string; amount: number }[];
}

/**
 * 카테고리마다 고정비로 얼마가 매달 나가는지.
 *
 * 고정비는 줄일 수 없는 돈이라, 그 카테고리의 예산이 이보다 낮으면 달이
 * 시작되는 순간 이미 초과입니다. 그래서 최소선으로 제시합니다.
 *
 * 고정비 판정은 `recurrence.ts`가 하고(서로 다른 3개월 이상, 같은 내역명,
 * 같은 날짜대) 여기서는 그 결과(`expenseType === "FIXED"`)만 셉니다. 판정이
 * 아직 안 붙은 내역은 이 가이드에 나타나지 않습니다 — AI 자동 분류를 돌리지
 * 않았다면 값이 비어 보이는 것이 정상입니다.
 *
 * `upTo`가 주어지면 그 달까지만 셉니다. 이번 달은 아직 끝나지 않아, 평균에
 * 넣으면 한 달치가 반 달치로 깎입니다.
 */
export function fixedBaselines(
  transactions: Transaction[],
  options: { months?: number; upTo?: string } = {}
): FixedBaseline[] {
  const window = options.months ?? 6;
  const byCategory = new Map<string, Map<string, number>>();

  for (const tx of transactions) {
    if (tx.type !== "EXPENSE" || tx.expenseType !== "FIXED") continue;
    // 적금은 매달 같은 날 나가 고정비로 판정되지만, 저축으로 따로 셉니다
    if (excluded(tx.category)) continue;

    const month = (tx.date || "").slice(0, 7);
    if (!month) continue;
    if (options.upTo && month >= options.upTo) continue;

    if (!byCategory.has(tx.category)) byCategory.set(tx.category, new Map());
    const months = byCategory.get(tx.category)!;
    months.set(month, (months.get(month) || 0) + tx.amount);
  }

  const out: FixedBaseline[] = [];

  for (const [category, months] of byCategory) {
    // 최근 것부터 window 개월만
    const history = Array.from(months.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-window)
      .map(([month, amount]) => ({ month, amount }));

    if (history.length === 0) continue;

    const total = history.reduce((sum, row) => sum + row.amount, 0);
    const average = Math.round(total / history.length);
    const latest = history[history.length - 1].amount;

    /*
      5% 안쪽의 차이는 추이라고 하지 않습니다. 관리비처럼 달마다 조금씩
      흔들리는 항목이 매달 "올랐다/내렸다"로 보이면 신호가 되지 못합니다.
    */
    const drift = average > 0 ? (latest - average) / average : 0;
    const trend = drift > 0.05 ? "UP" : drift < -0.05 ? "DOWN" : "FLAT";

    out.push({ category, months: history.length, average, latest, trend, history });
  }

  return out.sort((a, b) => b.average - a.average);
}

/**
 * 고정비 가이드를 기준으로 바꿔 넣습니다.
 *
 * `AMOUNT`면 평균 금액 그대로, 비율 모드면 그 평균이 차지하는 비율입니다 —
 * 어느 모드에서든 "최소한 고정비만큼"이라는 같은 뜻이 됩니다.
 */
export function rulesFromBaselines(
  baselines: FixedBaseline[],
  mode: BudgetPolicyMode,
  inputs: PolicyInputs
): Record<string, number> {
  const rules: Record<string, number> = {};
  const base =
    mode === "INCOME_RATIO" ? inputs.income : mode === "SPARE_RATIO" ? spareOf(inputs) : 0;

  for (const line of baselines) {
    if (line.average <= 0) continue;

    if (mode === "AMOUNT") {
      rules[line.category] = line.average;
    } else if (base > 0) {
      // 소수 한 자리까지 — 0으로 떨어지면 최소선의 뜻이 사라집니다
      rules[line.category] = Math.round((line.average / base) * 1000) / 10;
    }
  }

  return rules;
}

/** 예산이 고정비 평균보다 낮은 카테고리 — 달 시작부터 초과인 것들. */
export function belowBaseline(
  budgets: Record<string, number>,
  baselines: FixedBaseline[]
): { category: string; budget: number; average: number }[] {
  const out: { category: string; budget: number; average: number }[] = [];

  for (const line of baselines) {
    const budget = budgets[line.category] ?? 0;
    if (line.average > 0 && budget < line.average) {
      out.push({ category: line.category, budget, average: line.average });
    }
  }

  return out.sort((a, b) => b.average - a.average);
}

// ---------------------------------------------------------------------------
// 내역 기반 배분
// ---------------------------------------------------------------------------

export interface HistoryShare {
  category: string;
  /** 고정비 월평균 — 줄일 수 없는 부분. */
  fixed: number;
  /** 변동비 월평균 — 줄일 수 있는 부분. */
  variable: number;
  /** 배분된 한도 = fixed + (variable 비중 × 가용 변동비). */
  budget: number;
  /** 이 카테고리를 셈한 달의 수. */
  months: number;
}

export interface HistoryAllocation {
  shares: HistoryShare[];
  /** 카테고리 → 한도. 바로 저장할 수 있는 형태. */
  budgets: Record<string, number>;
  /** 변동비 기록이 있는 달의 수. 0이면 배분의 근거가 없습니다. */
  months: number;
  /** 고정비 평균의 합 — 카테고리 한도에 이미 포함돼 있습니다. */
  fixedTotal: number;
  /** 가용 변동비 중 실제로 나눠 준 금액. */
  variableTotal: number;
}

/**
 * 지난 내역으로 이번 달 카테고리 한도를 정합니다.
 *
 * 코드에 박힌 비율(식비 40%, 쇼핑 18% …)은 누구의 삶도 설명하지 못하고,
 * 사용자가 만든 카테고리는 한 푼도 받지 못했습니다. 실제로 어디에 얼마를 써
 * 왔는지가 그 사람에게 맞는 유일한 근거입니다.
 *
 * 한 카테고리의 한도는 두 조각으로 만듭니다.
 *
 *   한도 = 고정비 월평균 + (그 카테고리의 변동비 비중 × 가용 변동비)
 *
 * 고정비를 더하는 이유: 카테고리의 소진율은 **고정비까지 포함한** 그 달의 지출
 * 전체로 계산됩니다(`budgetStatusList`). 고정비를 빼놓고 한도를 주면 주거·통신
 * 처럼 고정비가 대부분인 카테고리가 달 시작부터 초과로 표시됩니다.
 *
 * 변동비만 비중으로 나누는 이유: 가용 변동비가 이미 `수입 − 고정비 − 저축`이라
 * 고정비를 두 번 세지 않기 위함입니다.
 *
 * 진행 중인 달은 평균에서 뺍니다(`upTo`). 반 달치를 한 달치로 세면 한도가
 * 실제보다 낮게 잡힙니다.
 */
export function historyAllocate(
  transactions: Transaction[],
  options: {
    spare: number;
    months?: number;
    upTo?: string;
    /** 이 목록에 있는 카테고리만 배분합니다. 비우면 내역에 나온 것 전부. */
    only?: string[];
  }
): HistoryAllocation {
  const window = options.months ?? 6;
  const allowed = options.only && options.only.length > 0 ? new Set(options.only) : null;

  /** 카테고리 → 달 → { fixed, variable } */
  const seen = new Map<string, Map<string, { fixed: number; variable: number }>>();
  const monthsSeen = new Set<string>();

  for (const tx of transactions) {
    if (tx.type !== "EXPENSE") continue;
    if (excluded(tx.category)) continue;
    if (allowed && !allowed.has(tx.category)) continue;

    const month = (tx.date || "").slice(0, 7);
    if (!month) continue;
    if (options.upTo && month >= options.upTo) continue;

    if (!seen.has(tx.category)) seen.set(tx.category, new Map());
    const byMonth = seen.get(tx.category)!;
    const cell = byMonth.get(month) || { fixed: 0, variable: 0 };
    if (tx.expenseType === "FIXED") cell.fixed += tx.amount;
    else cell.variable += tx.amount;
    byMonth.set(month, cell);
  }

  // 창 안의 달만 — 최근 것부터 window 개월
  const allMonths = Array.from(
    new Set(Array.from(seen.values()).flatMap((byMonth) => Array.from(byMonth.keys())))
  )
    .sort()
    .slice(-window);
  for (const month of allMonths) monthsSeen.add(month);

  const rows: { category: string; fixed: number; variable: number; months: number }[] = [];

  for (const [category, byMonth] of seen) {
    let fixedSum = 0;
    let variableSum = 0;
    let count = 0;

    for (const month of allMonths) {
      const cell = byMonth.get(month);
      if (!cell) continue;
      fixedSum += cell.fixed;
      variableSum += cell.variable;
      count++;
    }

    if (count === 0) continue;

    /*
      나눌 때 쓰는 것은 "그 카테고리가 나온 달"이 아니라 "창 안의 달 전체"
      입니다. 6개월 중 한 달만 쓴 항목을 그 달 금액 그대로 매달 주면, 어쩌다
      한 번 산 것이 고정 지출이 됩니다.
    */
    const span = allMonths.length || 1;
    rows.push({
      category,
      fixed: Math.round(fixedSum / span),
      variable: Math.round(variableSum / span),
      months: count,
    });
  }

  const variableSum = rows.reduce((sum, row) => sum + row.variable, 0);
  const spare = Math.max(0, options.spare);

  const shares: HistoryShare[] = rows
    .map((row) => {
      /*
        변동비 비중대로 가용 변동비를 나눕니다. 지난 달들의 변동비 합이 0이면
        (전부 고정비였거나 기록이 없으면) 나눌 근거가 없어 고정비만 줍니다.
      */
      const portion = variableSum > 0 ? (spare * row.variable) / variableSum : 0;
      return {
        category: row.category,
        fixed: row.fixed,
        variable: row.variable,
        months: row.months,
        // 만원 단위로 떨어뜨립니다 — 예산은 눈으로 읽는 값입니다
        budget: Math.round((row.fixed + portion) / 10_000) * 10_000,
      };
    })
    .filter((row) => row.budget > 0)
    .sort((a, b) => b.budget - a.budget);

  return {
    shares,
    budgets: Object.fromEntries(shares.map((row) => [row.category, row.budget])),
    months: allMonths.length,
    fixedTotal: rows.reduce((sum, row) => sum + row.fixed, 0),
    variableTotal: Math.min(spare, variableSum > 0 ? spare : 0),
  };
}
