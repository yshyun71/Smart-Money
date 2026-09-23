import type { ConnectedAccount, Transaction } from "../types/finance";
import { SAVINGS_CATEGORY, TRANSFER_CATEGORY } from "../constants/categories";

/**
 * 예산 화면의 세 칸이 무엇을 실적으로 보는가 — 그리고 그 달이 끝났는가.
 *
 * 화면이 아니라 여기에 두는 이유는 같은 정의가 **세 곳**에서 쓰이기 때문입니다:
 * 요약 숫자(`FinanceContext`), 그 숫자를 만든 내역 목록(`ActualsPickerModal`),
 * 그리고 "저장된 값이 지금 실적과 다르다"는 안내(`BudgetManagementView`).
 * 정의가 갈라지면 세 곳이 서로 다른 금액을 말하고, 그러면 사용자는 어느 쪽이
 * 맞는지 알 수 없습니다 — 실제로 고정비 칸에서 그런 일이 있었습니다(아래).
 */

/**
 * 쓴 돈이 아니라 **옮긴 돈**인가.
 *
 * `이체` 카테고리이면서 고정비가 **아닌** 줄입니다. 내 계좌 사이를 오간 돈은
 * 가계부를 떠나지 않았으므로 수입에도 지출에도 세지 않습니다 — 세면 그 달
 * 수입과 지출이 함께 부풀고, 예산·소비분석·AI 진단이 전부 그 위에서 계산됩니다.
 *
 * **고정비로 표시한 이체는 뺍니다.** 매달 같은 날 같은 금액이 나가는 이체는
 * 사람이 "이건 내 고정 지출"이라고 판단한 것이고, 그 판단을 앱이 뒤집을 이유가
 * 없습니다. 판단을 담는 칸을 새로 만들지 않고 이미 있는 고정비 여부를 쓰는 것이
 * 요점입니다.
 *
 * 수입에는 고정비라는 것이 없으므로(`expenseType === "INCOME"`) 이 한 줄이
 * 양쪽을 모두 덮습니다 — 들어온 이체는 언제나 빠집니다.
 *
 * **잔액은 이 판정과 무관합니다**(§8). 옮긴 돈도 그 통장에서는 실제로 나갔고,
 * 계좌 내역 화면의 입출금 합계도 그대로입니다. 여기서 가리는 것은 "소비로
 * 세느냐"뿐입니다.
 */
export function isAssetMove(tx: Transaction): boolean {
  return tx.category === TRANSFER_CATEGORY && tx.expenseType !== "FIXED";
}

/**
 * 소비·수입으로 세는 줄만 남깁니다.
 *
 * 합계를 내는 모든 자리가 이 목록을 씁니다 — 월 총수입·총지출, 소비분석,
 * 카테고리 예산, 내역 기반 배분, AI 분석 입력. 한 곳이라도 원본 목록을 쓰면
 * 그 화면만 다른 금액을 말하게 됩니다.
 */
export function spendingRows(transactions: Transaction[]): Transaction[] {
  return transactions.filter((tx) => !isAssetMove(tx));
}

export type ActualKind =
  | "INCOME"
  | "INCOME_FIXED"
  | "INCOME_VARIABLE"
  | "EXPENSE"
  | "FIXED"
  | "SAVINGS"
  | "VARIABLE";

/**
 * 그 달의 실적을 만드는 거래들.
 *
 * - `INCOME` 그 달의 모든 수입. `INCOME_FIXED`·`INCOME_VARIABLE` 은 그것을
 *   정기성으로 가른 것입니다(§6.6) — 급여와 어쩌다 들어온 돈은 다릅니다.
 * - `FIXED` 고정비로 판정된 지출에서 **저축을 뺀 것**. 적금은 매달 같은 날 같은
 *   금액이라 §10 판정으로 고정비가 되는데, 가용 변동비가 `수입 − 고정비 − 저축`
 *   이므로 양쪽에 세면 같은 돈이 두 번 깎입니다.
 * - `SAVINGS` `저축` 카테고리 지출 중 **계좌에서 나간 것만**. 카드로 적금을 넣지는
 *   않으므로, 카드 내역에 저축이 붙어 있다면 잘못 분류된 것이고 그것을 더하면
 *   저축액이 부풀려집니다.
 * - `VARIABLE` 변동비로 판정된 지출에서 **저축을 뺀 것**. `FIXED` 와 같은 이유입니다 —
 *   저축은 예산 화면에서 따로 셈하므로 양쪽에 세면 두 번 깎입니다.
 * - `EXPENSE` 그 달의 **모든 지출** — 저축도 고정비도 변동비도 다 들어갑니다.
 *   홈 화면의 `총 지출`이 그 값이고, `고정비 + 변동비 + 저축` 과 같아야 합니다.
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
    /*
      **수입도 고정과 변동으로 갈립니다** (§6.6). 급여처럼 매달 들어오는 돈과
      어쩌다 들어온 환급금을 한 덩어리로 세면 "다음 달에 얼마가 확실히
      들어오는가"에 답할 수 없습니다 — 고정비/변동비를 가른 것과 같은 까닭입니다.
    */
    if (kind === "INCOME_FIXED") {
      return tx.type === "INCOME" && tx.expenseType === "FIXED";
    }
    if (kind === "INCOME_VARIABLE") {
      return tx.type === "INCOME" && tx.expenseType !== "FIXED";
    }
    if (tx.type !== "EXPENSE") return false;
    if (kind === "EXPENSE") return true;

    if (kind === "SAVINGS") {
      return tx.category === SAVINGS_CATEGORY && bankIds.has(tx.accountId);
    }

    if (kind === "VARIABLE") {
      return tx.expenseType === "VARIABLE" && tx.category !== SAVINGS_CATEGORY;
    }

    return tx.expenseType === "FIXED" && tx.category !== SAVINGS_CATEGORY;
  });
}

/**
 * 어느 기간 그 카테고리의 내역.
 *
 * 카테고리 합계 금액을 눌렀을 때 열리는 목록입니다 — 예산 화면의
 * `지출: 460,000원`, 소비분석의 도넛 범례와 지출 순위, 연도별 카테고리 현황이
 * 모두 이것을 씁니다. 합계를 내는 규칙과 **같은 조건**이어야 합니다: 목록의
 * 합과 위에 적힌 금액이 다르면 둘 중 무엇이 맞는지 알 수 없습니다.
 *
 * **달이 아니라 기간을 받습니다.** 같은 창이 한 달·한 해·임의 구간에 모두
 * 쓰이기 때문입니다(`trend.monthPeriod` 등). 날짜는 `YYYY-MM-DD` 글자 비교이고
 * 양끝을 포함합니다.
 *
 * `direction` 은 기본이 `EXPENSE` 입니다 — 카테고리 합계는 거의 언제나 지출이고,
 * 환불(수입)이 섞이면 목록의 합이 화면의 금액과 어긋납니다. 수입 카테고리를
 * 볼 때만 `INCOME` 을 줍니다.
 */
export function categorySpendRows(
  transactions: Transaction[],
  options: {
    category: string;
    start: string;
    end: string;
    direction?: "INCOME" | "EXPENSE" | "ALL";
  }
): Transaction[] {
  const { category, start, end, direction = "EXPENSE" } = options;
  return transactions.filter(
    (tx) =>
      tx.category === category &&
      tx.date >= start &&
      tx.date <= end &&
      (direction === "ALL" ? true : tx.type === direction)
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
