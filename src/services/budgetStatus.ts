import type { BudgetAlert, CategoryBudgetStatus, Transaction } from "../types/finance";
import { BUDGET_EXCLUDED_CATEGORIES } from "../constants/categories";

/**
 * 카테고리마다 얼마를 썼고 한도에 얼마나 닿았는가 — 그리고 그것이 알림이
 * 될 때.
 *
 * 컨텍스트 안에 있던 계산을 내렸습니다(§17.5). 알림 문구와 상태 판정은 사용자가
 * 보는 것 중 가장 자주 읽히는 값이고, 그런 것이 회귀 세트 밖에 있을 이유가
 * 없습니다.
 */

export interface StatusInputs {
  /** 이미 걸러진 그 달의 목록 (§6.5 — 옮긴 돈은 빼고). */
  transactions: Transaction[];
  categoryBudgets: Record<string, number>;
  /** 이 비율에 닿으면 `WARNING`. 비어 있으면 80. */
  alertThresholdPercent?: number;
}

/**
 * 한도와 지출을 나란히 놓은 목록, 소진율 높은 순.
 *
 * - **`카드대금`·`저축`은 빼둡니다**(`BUDGET_EXCLUDED_CATEGORIES`). 둘 다 다른
 *   자리에서 이미 셈해지는 돈입니다 — 카드대금은 그 카드의 명세서로, 저축은
 *   `목표 저축액`으로. 가용 변동비가 저축을 뺀 금액이라 저축에 또 예산을 주면
 *   없는 돈을 배분하게 됩니다.
 * - **한도를 정하지 않은 칸은 `UNSET`** 입니다. 예전에는 `SAFE` 로 남아, 지출이
 *   46만원인 칸이 초록 막대를 가득 채운 채 "안전 · 100% 소진"이라고 적혀
 *   있었습니다. 안전한 것도 초과한 것도 아니라 **아직 정하지 않은 것**입니다.
 * - 한도를 정한 칸과 지출이 있는 칸을 **합집합**으로 봅니다. 한도만 있고 안 쓴
 *   칸도, 한도 없이 쓴 칸도 모두 보여야 합니다.
 */
export function categoryStatuses(inputs: StatusInputs): CategoryBudgetStatus[] {
  const { transactions, categoryBudgets, alertThresholdPercent } = inputs;
  const threshold = alertThresholdPercent || 80;

  const spentByCategory = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.type !== "EXPENSE") continue;
    spentByCategory.set(tx.category, (spentByCategory.get(tx.category) || 0) + tx.amount);
  }

  const categories = Array.from(
    new Set([...Object.keys(categoryBudgets || {}), ...spentByCategory.keys()])
  ).filter((category) => !BUDGET_EXCLUDED_CATEGORIES.includes(category as never));

  return categories
    .map((category) => {
      const budget = (categoryBudgets || {})[category] || 0;
      const spent = spentByCategory.get(category) || 0;
      const percentage = budget > 0 ? (spent / budget) * 100 : spent > 0 ? 100 : 0;

      let status: CategoryBudgetStatus["status"] = "SAFE";
      if (budget <= 0) status = "UNSET";
      else if (percentage >= 100) status = "EXCEEDED";
      else if (percentage >= threshold) status = "WARNING";

      return { category, budget, spent, remaining: budget - spent, percentage, status };
    })
    .sort((a, b) => b.percentage - a.percentage);
}

export interface AlertInputs {
  statuses: CategoryBudgetStatus[];
  month: string;
  /** 사용자가 이미 닫은 알림의 id. */
  dismissedIds?: string[];
  /** 알림을 끄면 아무것도 만들지 않습니다. */
  enabled?: boolean;
  /** 시각 문구를 만들 때 쓰는 시점. 테스트에서 고정할 수 있게 인자로 받습니다. */
  now?: Date;
}

/**
 * 지금 띄워야 할 알림.
 *
 * **id 가 `달-카테고리-상태`** 입니다. 같은 카테고리가 `WARNING` 에서
 * `EXCEEDED` 로 넘어가면 **다른 알림**이 되어 닫아 둔 것이 되살아나고, 같은
 * 상태에 머무는 동안에는 한 번만 보입니다. 기기 알림도 이 id 로 중복을
 * 가립니다(§11.8).
 *
 * **한도를 정하지 않은 칸(`UNSET`)은 알리지 않습니다.** 넘길 한도가 없습니다.
 */
export function budgetAlertsFor(inputs: AlertInputs): BudgetAlert[] {
  const { statuses, month, dismissedIds = [], enabled = true, now = new Date() } = inputs;
  if (!enabled) return [];

  const dismissed = new Set(dismissedIds);
  const createdAt = now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  const alerts: BudgetAlert[] = [];

  for (const item of statuses) {
    if (item.budget <= 0) continue;
    if (item.status !== "EXCEEDED" && item.status !== "WARNING") continue;

    const id = `${month}-${item.category}-${item.status}`;
    if (dismissed.has(id)) continue;

    const rounded = Math.round(item.percentage);

    alerts.push({
      id,
      category: item.category,
      type: item.status,
      spent: item.spent,
      budget: item.budget,
      percentage: item.percentage,
      message:
        item.status === "EXCEEDED"
          ? `[${item.category}] 예산 ${item.budget.toLocaleString()}원 대비 ${item.spent.toLocaleString()}원(${rounded}%)을 지출하여 예산을 초과했습니다!`
          : `[${item.category}] 예산의 ${rounded}%를 소진했습니다 (${(
              item.budget - item.spent
            ).toLocaleString()}원 남음).`,
      createdAt,
    });
  }

  return alerts;
}
