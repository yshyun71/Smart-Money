import type { Transaction } from "../types/finance";

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
