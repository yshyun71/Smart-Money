import type { Transaction } from "../types/finance";
import { normaliseMerchant } from "./recurrence";

/**
 * 환불·취소를 원래 결제와 짝지어 봅니다 (§12.13).
 *
 * 환불은 두 줄로 남습니다 — 나간 줄과 돌아온 줄. 합계에서는 서로 상쇄되지만
 * (카드는 `지출 − 차감·환불`, §9.5) **목록에서는 따로 놓여** 그 달에 실제보다
 * 많이 쓴 것처럼 보입니다. 짝을 지어 보여 주면 "이건 되돌아온 돈"이라는 사실을
 * 한눈에 알 수 있습니다.
 *
 * **자동으로 지우거나 합치지 않습니다.** 두 줄 다 명세서에 실제로 있는 줄이고,
 * 없애면 명세서와 가계부가 달라집니다(§17.3). 짝을 **보여 주기만** 합니다.
 *
 * ## 무엇으로 짝을 짓는가 — 실제 자료로 확인한 것
 *
 * 1,420건에 세 가지 규칙을 차례로 걸어 봤습니다.
 *
 * | 규칙 | 결과 |
 * | --- | --- |
 * | 같은 계좌 · 같은 금액 · 반대 방향 | 후보 25건 이상, **거의 전부 오답** — `양은실` 출금과 `양승표` 입금이 70,000원으로 같다고 짝이 되었습니다. 남남인 이체입니다. |
 * | 위 + 가맹점 이름이 **정확히** 같을 것 | **0건.** 환불 줄은 이름이 그대로 오지 않습니다 — `서울페이` / `서울페이환불`. |
 * | 위 + 환불 쪽 이름이 결제 쪽 이름을 **품을 것** | **1건**, 그리고 그 1건이 진짜 환불이었습니다. |
 *
 * 그래서 마지막 규칙을 씁니다. **방향이 있는 포함**인 것이 중요합니다 — 반대로
 * 두면 `카뱅오픈양승현` 출금과 `양승현` 입금이 짝이 되어(200만원, 40일 뒤) 남의
 * 이름이 든 이체가 환불로 둔갑합니다. 환불 줄은 결제 줄의 이름에 `환불`·`취소`가
 * 붙는 모양이지 그 반대가 아닙니다.
 *
 * 놓치는 것이 있습니다 — 명세서가 `(주)무신사` 로 청구하고 `무신사` 로 돌려주면
 * 잡히지 않습니다. **그쪽이 맞습니다**(§17.2): 없는 짝을 만들어 그 달 지출을
 * 줄여 보이는 것보다, 못 찾고 두 줄로 두는 편이 낫습니다.
 */

/** 환불 줄에 덧붙는 말. 이름을 견주기 전에 떼어 냅니다. */
const CANCEL_WORDS = /(환불|취소|반품|차감|refund|cancel)/gi;

/**
 * 짝을 지을 수 있는 최대 간격.
 *
 * 카드 환불은 보통 며칠이지만 명세서가 다음 달로 넘겨 청구하는 일이 흔해
 * 두 달을 봅니다. 더 넓히면 우연히 같은 금액인 다른 거래가 걸립니다.
 */
export const REFUND_WINDOW_DAYS = 60;

/**
 * 짝짓기에서 빼는 카테고리.
 *
 * `이체` 는 옮긴 돈이라 애초에 지출로 세지 않고(§6.5), 나갔다 들어온 모양이
 * 환불과 똑같아서 **거짓 짝이 가장 많이 나오는 자리**입니다. `카드대금` 은 그
 * 카드의 명세서가 따로 있으므로 여기서 짝지을 것이 없습니다.
 */
const SKIP_CATEGORIES = new Set(["이체", "카드대금"]);

function base(name: string): string {
  return normaliseMerchant((name || "").replace(CANCEL_WORDS, ""));
}

/** 환불 쪽 이름이 결제 쪽 이름을 품는가. */
function answersFor(refundName: string, chargeName: string): boolean {
  const refund = base(refundName);
  const charge = base(chargeName);
  if (!refund || !charge) return false;
  if (refund === charge) return true;
  return charge.length >= 2 && refund.includes(charge);
}

function dayGap(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86400000);
}

export interface RefundPair {
  /** 돌아온 줄. */
  refund: Transaction;
  /** 그 돈을 나가게 한 줄. */
  charge: Transaction;
  /** 결제에서 환불까지 걸린 날 수. */
  days: number;
}

/**
 * 짝지을 수 있는 환불을 찾습니다.
 *
 * **한 결제는 한 번만 쓰입니다.** 같은 가맹점에서 같은 금액을 두 번 썼는데
 * 한 번만 환불받았다면, 짝은 하나여야 합니다 — 둘 다 짝지으면 되돌아온 돈이
 * 두 배로 보입니다. 환불에 가장 **가까운** 결제를 고릅니다.
 */
export function refundPairs(
  transactions: Transaction[],
  options: { windowDays?: number } = {}
): RefundPair[] {
  const windowDays = options.windowDays ?? REFUND_WINDOW_DAYS;

  const usable = transactions.filter((tx) => !SKIP_CATEGORIES.has(tx.category));
  const charges = usable.filter((tx) => tx.type === "EXPENSE");
  const refunds = usable
    .filter((tx) => tx.type === "INCOME")
    .sort((a, b) => a.date.localeCompare(b.date));

  const taken = new Set<string>();
  const pairs: RefundPair[] = [];

  for (const refund of refunds) {
    let best: Transaction | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    for (const charge of charges) {
      if (taken.has(charge.id)) continue;
      if (charge.accountId !== refund.accountId) continue;
      if (charge.amount !== refund.amount) continue;
      if (charge.date > refund.date) continue;
      const gap = dayGap(charge.date, refund.date);
      if (gap > windowDays) continue;
      if (!answersFor(refund.merchant, charge.merchant)) continue;
      /* 가장 가까운 결제 — 같은 간격이면 먼저 만난 것 */
      if (gap < bestGap) {
        best = charge;
        bestGap = gap;
      }
    }

    if (!best) continue;
    taken.add(best.id);
    pairs.push({ refund, charge: best, days: bestGap });
  }

  return pairs;
}

export interface RefundSummary {
  count: number;
  amount: number;
  pairs: RefundPair[];
}

/**
 * 그 기간 안에서 **환불이 일어난** 짝만 추립니다.
 *
 * 기준은 환불 줄의 날짜입니다 — 그 달의 지출이 실제보다 커 보이게 만드는 것은
 * 그 달에 돌아온 돈이기 때문입니다. 결제가 지난달이어도 짝은 그대로 보여
 * 줍니다(그것이 이 화면이 답하는 질문입니다).
 */
export function refundsIn(
  transactions: Transaction[],
  range: { from: string; to: string },
  options: { windowDays?: number } = {}
): RefundSummary {
  const pairs = refundPairs(transactions, options).filter(
    (pair) => pair.refund.date >= range.from && pair.refund.date <= range.to
  );

  return {
    count: pairs.length,
    amount: pairs.reduce((total, pair) => total + pair.refund.amount, 0),
    pairs,
  };
}
