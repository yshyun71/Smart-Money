import type { ConnectedAccount, Transaction } from "../types/finance";

/**
 * 처음 쓰는 사람에게 무엇부터 하라고 말할 것인가.
 *
 * 등록을 마치면 **빈 화면**이었습니다. 카드·계좌를 등록하고 명세서를 받아
 * 가져오라는 흐름을 스스로 알아내야 했고, 빈 상태 문구는 화면마다 흩어져
 * 있었습니다(93개). 한 흐름으로 묶어 홈에서 한 번에 보여 줍니다.
 *
 * 판단은 여기, 표시는 화면 — 무엇이 끝났는지는 **데이터가 말합니다**. 사용자가
 * "했다"고 체크하는 목록이 아니라, 실제로 되어 있으면 끝난 것입니다. 그래서
 * 앱을 다시 깔아도, 백업을 복원해도 상태가 맞습니다.
 */

export type StepId = "ACCOUNT" | "IMPORT" | "CLASSIFY" | "BUDGET";

export interface SetupStep {
  id: StepId;
  title: string;
  hint: string;
  done: boolean;
}

export interface SetupInputs {
  accounts: ConnectedAccount[];
  transactions: Transaction[];
  /** 그 달의 카테고리 한도. 하나라도 정해 두었으면 끝난 것으로 봅니다. */
  categoryBudgets?: Record<string, number>;
}

/**
 * 네 걸음. **순서가 곧 의존 관계**입니다 — 계좌가 없으면 가져올 곳이 없고,
 * 내역이 없으면 분류할 것이 없고, 분류가 안 되면 예산이 뜻을 갖지 못합니다.
 */
export function setupSteps(inputs: SetupInputs): SetupStep[] {
  const { accounts, transactions, categoryBudgets } = inputs;

  const hasAccount = accounts.length > 0;
  const hasEntries = transactions.length > 0;
  /*
    분류가 됐는가 — **고정비로 판정된 건이 하나라도 있는가**로 봅니다.
    가져온 직후에는 전부 변동비 추정이고, AI 자동 분류나 사람의 손이 닿아야
    고정비가 생깁니다(§10). 완벽한 지표는 아니지만 "손을 댔는가"는 말해 줍니다.
  */
  const hasClassified = transactions.some(
    (tx) => tx.type === "EXPENSE" && tx.expenseType === "FIXED"
  );
  const hasBudget = Object.values(categoryBudgets || {}).some((amount) => amount > 0);

  return [
    {
      id: "ACCOUNT",
      title: "카드·계좌 등록",
      hint: hasAccount
        ? `${accounts.length}개 등록됨`
        : "쓰는 카드와 통장을 먼저 등록합니다",
      done: hasAccount,
    },
    {
      id: "IMPORT",
      title: "명세서 가져오기",
      hint: hasEntries
        ? `${transactions.length.toLocaleString()}건 들어옴`
        : "은행·카드사에서 받은 엑셀·CSV 를 넣습니다",
      done: hasEntries,
    },
    {
      id: "CLASSIFY",
      title: "고정비 가려내기",
      hint: hasClassified
        ? "고정비가 판정되어 있습니다"
        : "AI 자동 분류를 한 번 돌리면 매달 나가는 돈이 갈립니다",
      done: hasClassified,
    },
    {
      id: "BUDGET",
      title: "예산 정하기",
      hint: hasBudget ? "한도가 정해져 있습니다" : "카테고리별 한도를 정하면 알림이 옵니다",
      done: hasBudget,
    },
  ];
}

/**
 * 다음에 할 일 — 끝나지 않은 첫 걸음.
 *
 * 하나만 가리킵니다. 네 개를 동시에 권하면 아무것도 고르지 못합니다.
 */
export function nextStep(steps: SetupStep[]): SetupStep | null {
  return steps.find((step) => !step.done) ?? null;
}

/**
 * 안내를 보여 줄 것인가.
 *
 * **다 끝났으면 사라집니다.** 끝난 목록을 계속 띄우는 것은 화면을 빼앗는
 * 일입니다 — 홈에서 가장 값진 자리를 체크 표시가 차지할 이유가 없습니다.
 */
export function shouldGuide(steps: SetupStep[]): boolean {
  return steps.some((step) => !step.done);
}
