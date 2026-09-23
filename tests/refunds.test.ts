/**
 * 환불·취소 짝짓기 (§12.13).
 *
 * 이 판정의 위험은 **거짓 짝**입니다. 실제 자료 1,420건에서 금액과 방향만 보면
 * `양은실` 출금과 `양승표` 입금이 70,000원으로 짝이 되었습니다 — 남남인 이체이고,
 * 그것을 환불이라고 적으면 그 달 지출이 실제보다 적어 보입니다. 짝을 못 찾는
 * 것보다 나쁩니다(§17.2).
 *
 * 그래서 여기서 지키는 것의 절반은 **짝지어서는 안 되는 것**입니다.
 */
import { refundPairs, refundsIn, REFUND_WINDOW_DAYS } from "../src/services/refunds";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

let serial = 0;
const tx = (over: Record<string, unknown> = {}): any => ({
  id: `t${serial++}`,
  accountId: "card",
  date: "2026-08-03",
  time: "12:00",
  type: "EXPENSE",
  expenseType: "VARIABLE",
  category: "쇼핑",
  merchant: "무신사",
  amount: 30_000,
  paymentMethod: "카드",
  ...over,
});

// ---------------------------------------------------------------------------
section("짝이 되는 경우");
// ---------------------------------------------------------------------------
{
  const charge = tx({ id: "c1", date: "2026-08-03" });
  const refund = tx({ id: "r1", date: "2026-08-10", type: "INCOME" });
  const pairs = refundPairs([charge, refund]);

  check("같은 이름·같은 금액·반대 방향", pairs.length === 1, pairs);
  check("어느 결제였는지", pairs[0]?.charge.id === "c1");
  check("며칠 뒤였는지", pairs[0]?.days === 7, pairs[0]?.days);

  /* 실제 자료에서 찾은 유일한 진짜 짝: `서울페이` → `서울페이환불` */
  const real = refundPairs([
    tx({ id: "c2", merchant: "서울페이", amount: 270_000, date: "2026-05-20" }),
    tx({ id: "r2", merchant: "서울페이환불", amount: 270_000, date: "2026-05-27", type: "INCOME" }),
  ]);
  check("환불 줄에 붙는 말을 떼고 견줍니다", real.length === 1, real);

  /* 명세서가 다음 달로 넘겨 청구하는 일이 흔합니다 */
  check(
    "두 달 안이면 짝이 됩니다",
    refundPairs([
      tx({ id: "c3", date: "2026-07-05" }),
      tx({ id: "r3", date: "2026-08-25", type: "INCOME" }),
    ]).length === 1
  );
  check("기본 창은 60일", REFUND_WINDOW_DAYS === 60);
}

// ---------------------------------------------------------------------------
section("짝이 되어서는 안 되는 경우");
// ---------------------------------------------------------------------------
{
  /* 실제 자료의 오답 — 같은 계좌·같은 금액인데 남남입니다 */
  check(
    "이름이 다르면 짝이 아닙니다",
    refundPairs([
      tx({ id: "c", accountId: "bank", merchant: "양은실", amount: 70_000, date: "2026-07-30" }),
      tx({
        id: "r",
        accountId: "bank",
        merchant: "양승표",
        amount: 70_000,
        date: "2026-08-02",
        type: "INCOME",
      }),
    ]).length === 0
  );

  /*
    방향이 있는 포함이라야 합니다. 거꾸로 두면 `카뱅오픈양승현` 출금과 `양승현`
    입금이 짝이 되어(200만원) 남의 이름이 든 이체가 환불로 둔갑합니다.
  */
  check(
    "결제 쪽이 환불 쪽을 품는 것은 짝이 아닙니다",
    refundPairs([
      tx({ id: "c", accountId: "bank", merchant: "카뱅오픈양승현", amount: 2_000_000, category: "기타지출" }),
      tx({
        id: "r",
        accountId: "bank",
        merchant: "양승현",
        amount: 2_000_000,
        date: "2026-08-10",
        type: "INCOME",
        category: "기타수입",
      }),
    ]).length === 0
  );

  check(
    "금액이 다르면 짝이 아닙니다",
    refundPairs([
      tx({ id: "c", amount: 30_000 }),
      tx({ id: "r", amount: 29_000, date: "2026-08-10", type: "INCOME" }),
    ]).length === 0
  );

  check(
    "다른 계좌는 짝이 아닙니다",
    refundPairs([
      tx({ id: "c", accountId: "card" }),
      tx({ id: "r", accountId: "bank", date: "2026-08-10", type: "INCOME" }),
    ]).length === 0
  );

  check(
    "환불이 결제보다 먼저일 수는 없습니다",
    refundPairs([
      tx({ id: "c", date: "2026-08-20" }),
      tx({ id: "r", date: "2026-08-10", type: "INCOME" }),
    ]).length === 0
  );

  check(
    "석 달 뒤는 짝이 아닙니다",
    refundPairs([
      tx({ id: "c", date: "2026-05-01" }),
      tx({ id: "r", date: "2026-08-10", type: "INCOME" }),
    ]).length === 0
  );

  /* 옮긴 돈은 애초에 지출로 세지 않고(§6.5), 나갔다 들어온 모양이 환불과 같습니다 */
  check(
    "이체는 짝짓지 않습니다",
    refundPairs([
      tx({ id: "c", category: "이체", merchant: "내계좌" }),
      tx({ id: "r", category: "이체", merchant: "내계좌", date: "2026-08-10", type: "INCOME" }),
    ]).length === 0
  );
  check(
    "카드대금도 짝짓지 않습니다",
    refundPairs([
      tx({ id: "c", category: "카드대금", merchant: "우리카드" }),
      tx({
        id: "r",
        category: "카드대금",
        merchant: "우리카드",
        date: "2026-08-10",
        type: "INCOME",
      }),
    ]).length === 0
  );
}

// ---------------------------------------------------------------------------
section("한 결제는 한 번만 쓰입니다");
// ---------------------------------------------------------------------------
{
  /* 같은 곳에서 같은 금액을 두 번 쓰고 한 번 환불받으면 짝은 하나입니다 */
  const one = refundPairs([
    tx({ id: "c1", date: "2026-08-01" }),
    tx({ id: "c2", date: "2026-08-05" }),
    tx({ id: "r1", date: "2026-08-10", type: "INCOME" }),
  ]);
  check("환불 하나에 결제 하나", one.length === 1, one);
  check("가장 가까운 결제를 고릅니다", one[0]?.charge.id === "c2", one[0]?.charge.id);

  const two = refundPairs([
    tx({ id: "c1", date: "2026-08-01" }),
    tx({ id: "c2", date: "2026-08-05" }),
    tx({ id: "r1", date: "2026-08-10", type: "INCOME" }),
    tx({ id: "r2", date: "2026-08-11", type: "INCOME" }),
  ]);
  check("환불 둘이면 결제 둘", two.length === 2, two);
  check(
    "같은 결제를 두 번 쓰지 않습니다",
    new Set(two.map((pair) => pair.charge.id)).size === 2,
    two.map((pair) => pair.charge.id)
  );
}

// ---------------------------------------------------------------------------
section("그 기간에 돌아온 돈");
// ---------------------------------------------------------------------------
{
  const rows = [
    tx({ id: "c1", date: "2026-07-28" }),
    tx({ id: "r1", date: "2026-08-02", type: "INCOME" }),
    tx({ id: "c2", date: "2026-09-01", amount: 12_000 }),
    tx({ id: "r2", date: "2026-09-04", amount: 12_000, type: "INCOME" }),
  ];

  const august = refundsIn(rows, { from: "2026-08-01", to: "2026-08-31" });
  check("그 달에 돌아온 것만", august.count === 1, august);
  check("금액을 더합니다", august.amount === 30_000, august.amount);
  /* 결제가 지난달이어도 짝은 그대로 보여 줍니다 — 그것이 답해야 할 질문입니다 */
  check("결제가 지난달이어도 보여 줍니다", august.pairs[0]?.charge.date === "2026-07-28");

  const september = refundsIn(rows, { from: "2026-09-01", to: "2026-09-30" });
  check("다른 달은 그 달 것만", september.count === 1 && september.amount === 12_000);

  const none = refundsIn(rows, { from: "2026-06-01", to: "2026-06-30" });
  check("없으면 0건 0원", none.count === 0 && none.amount === 0);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
