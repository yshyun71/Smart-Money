import type { ConnectedAccount, Transaction } from "../types/finance";
import { SAVINGS_CATEGORY } from "../constants/categories";

/**
 * 예산 화면의 세 칸이 무엇을 실적으로 보는가 — 그리고 그 달이 끝났는가.
 *
 * 화면이 아니라 여기에 두는 이유는 같은 정의가 **세 곳**에서 쓰이기 때문입니다:
 * 요약 숫자(`FinanceContext`), 그 숫자를 만든 내역 목록(`ActualsPickerModal`),
 * 그리고 "저장된 값이 지금 실적과 다르다"는 안내(`BudgetManagementView`).
 * 정의가 갈라지면 세 곳이 서로 다른 금액을 말하고, 그러면 사용자는 어느 쪽이
 * 맞는지 알 수 없습니다 — 실제로 고정비 칸에서 그런 일이 있었습니다(아래).
 */

export type ActualKind = "INCOME" | "FIXED" | "SAVINGS";

/**
 * 그 달의 실적을 만드는 거래들.
 *
 * - `INCOME` 그 달의 모든 수입.
 * - `FIXED` 고정비로 판정된 지출에서 **저축을 뺀 것**. 적금은 매달 같은 날 같은
 *   금액이라 §10 판정으로 고정비가 되는데, 가용 변동비가 `수입 − 고정비 − 저축`
 *   이므로 양쪽에 세면 같은 돈이 두 번 깎입니다.
 * - `SAVINGS` `저축` 카테고리 지출 중 **계좌에서 나간 것만**. 카드로 적금을 넣지는
 *   않으므로, 카드 내역에 저축이 붙어 있다면 잘못 분류된 것이고 그것을 더하면
 *   저축액이 부풀려집니다.
 */
export function actualRows(
  transactions: Transaction[],
  options: { month: string; kind: ActualKind; accounts?: ConnectedAccount[] }
): Transaction[] {
  const { month, kind, accounts } = options;

  const bankIds = new Set(
    (accounts || [])
      .filter((account) => account.type === "BANK")
      .map((account) => account.id)
  );

  return transactions.filter((tx) => {
    if (!tx.date.startsWith(month)) return false;

    if (kind === "INCOME") return tx.type === "INCOME";
    if (tx.type !== "EXPENSE") return false;

    if (kind === "SAVINGS") {
      return tx.category === SAVINGS_CATEGORY && bankIds.has(tx.accountId);
    }

    return tx.expenseType === "FIXED" && tx.category !== SAVINGS_CATEGORY;
  });
}

/**
 * 그 달 그 카테고리의 **지출** 내역.
 *
 * 예산 화면의 `지출: 460,000원` 을 눌렀을 때 열리는 목록입니다. 합계를 내는
 * 규칙(`budgetStatusList` 의 카테고리별 집계)과 **같은 조건**이어야 합니다 —
 * 목록의 합과 위에 적힌 금액이 다르면 둘 중 무엇이 맞는지 알 수 없습니다.
 * 카드·계좌를 가리지 않는 것도 그 집계와 같습니다.
 */
export function categorySpendRows(
  transactions: Transaction[],
  options: { month: string; category: string }
): Transaction[] {
  const { month, category } = options;
  return transactions.filter(
    (tx) =>
      tx.type === "EXPENSE" && tx.category === category && tx.date.startsWith(month)
  );
}

export interface ActualSum {
  /** 제외한 건을 뺀 금액 — 예산 칸에 들어가는 값. */
  total: number;
  /** 그 금액을 만든 건수. */
  counted: number;
  /** 제외하지 않았을 때의 금액. */
  full: number;
  /** 그 달에 있는 전체 건수. */
  rows: number;
  /** 제외한 건수와 금액. */
  excludedCount: number;
  excludedAmount: number;
}

/**
 * 제외 목록을 반영해 합을 냅니다.
 *
 * **모르는 id 는 조용히 무시합니다.** 제외해 둔 거래가 나중에 지워지거나 다시
 * 가져와 id 가 바뀔 수 있는데, 그때 오류를 내거나 합계를 비우면 예산이 통째로
 * 어긋납니다. 남아 있는 것만 보고 셈합니다.
 */
export function sumActuals(rows: Transaction[], excluded?: string[] | null): ActualSum {
  const skip = new Set(excluded || []);
  const kept = rows.filter((tx) => !skip.has(tx.id));
  const full = rows.reduce((sum, tx) => sum + tx.amount, 0);
  const total = kept.reduce((sum, tx) => sum + tx.amount, 0);

  return {
    total,
    counted: kept.length,
    full,
    rows: rows.length,
    excludedCount: rows.length - kept.length,
    excludedAmount: full - total,
  };
}

export type MonthPhase = "PAST" | "CURRENT" | "FUTURE";

/**
 * 그 달이 지났는가, 아직 진행 중인가, 오지 않았는가.
 *
 * 이것이 **낱말을 결정합니다.** 지난 달의 수입은 예상이 아니라 실적이고,
 * 지난 달의 저축은 목표가 아니라 실제로 떼어 둔 돈입니다. 같은 칸에 같은
 * 이름을 붙여 두면 8월을 보면서 "예상"이라고 읽게 됩니다.
 */
export function monthPhase(month: string, today: Date = new Date()): MonthPhase {
  const now = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  if (!month) return "CURRENT";
  if (month < now) return "PAST";
  if (month > now) return "FUTURE";
  return "CURRENT";
}

export interface FieldWording {
  label: string;
  hint: string;
}

/**
 * 세 칸의 이름과 설명.
 *
 * 달 이름을 항상 앞에 붙입니다 — 위쪽 월 이동으로 다른 달을 보면서 이 칸이
 * 어느 달의 값인지 헷갈린 적이 있고, 칸 이름이 곧 답입니다.
 */
export function budgetWording(
  phase: MonthPhase,
  monthName: string
): { income: FieldWording; fixed: FieldWording; savings: FieldWording } {
  if (phase === "PAST") {
    return {
      income: {
        label: `${monthName} 총 수입`,
        hint: `${monthName}에 실제로 들어온 급여 + 기타 수입`,
      },
      fixed: {
        label: `${monthName} 고정 지출`,
        hint: `${monthName}에 실제로 나간 월세·관리비·통신비·보험`,
      },
      savings: {
        label: `${monthName} 저축액`,
        hint: `${monthName}에 실제로 떼어 둔 금액 (계좌의 [저축] 카테고리)`,
      },
    };
  }

  const 미래 = phase === "FUTURE";
  return {
    income: {
      label: `${monthName} 예상 총 수입`,
      hint: `${monthName}에 들어올 것으로 보는 급여 + 기타 수입`,
    },
    fixed: {
      label: `${monthName} 예상 고정 지출`,
      hint: "월세·관리비·통신비·보험처럼 매달 나가는 돈",
    },
    savings: {
      label: `${monthName} 목표 저축액`,
      hint: 미래
        ? "먼저 떼어 둘 금액. 지난달 실적을 보고 정하면 무리가 없습니다"
        : "먼저 떼어 둘 금액. 계좌의 [저축] 카테고리 실적에서 채울 수 있습니다",
    },
  };
}
