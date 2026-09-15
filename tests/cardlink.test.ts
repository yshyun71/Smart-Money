/**
 * 카드 결제대금 ↔ 은행 출금 연결 회귀 세트.
 *
 * 이 연결은 두 쪽에서 완성됩니다 — 카드 명세서가 들어오거나, 그 대금을 낸
 * 출금이 들어오거나. 한쪽만 지켜보다가 "6월은 금액이 같은데 연결되지 않는"
 * 일이 실제로 있었습니다. 그래서 판단을 순수 함수로 꺼내 여기서 확인합니다.
 */
import { planCardLinks, matchBillingMonth, billingTotalsFor } from "../src/services/cardLink";

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

const CARD_PAYMENT = "카드대금";

const bank: any = { id: "bank", name: "KB국민은행", institution: "KB국민은행", type: "BANK" };
const kb: any = {
  id: "kb",
  name: "KB국민카드",
  institution: "KB국민카드",
  type: "CARD",
  paymentAccountId: "bank",
};

let serial = 0;
const use = (cardId: string, month: string, amount: number, date?: string): any => ({
  id: `u${serial++}`,
  accountId: cardId,
  date: date || `${month}-05`,
  billingMonth: month,
  amount,
  type: "EXPENSE",
  category: "쇼핑",
  merchant: "가맹점",
});

const pay = (amount: number, date: string, extra: any = {}): any => ({
  id: `p${serial++}`,
  accountId: "bank",
  date,
  amount,
  type: "EXPENSE",
  category: CARD_PAYMENT,
  merchant: "KB국민카드출금",
  ...extra,
});

// ---------------------------------------------------------------------------
section("어느 쪽이 들어와도 연결된다");
// ---------------------------------------------------------------------------
{
  const june = use("kb", "2026-06", 281_894);
  const payment = pay(281_894, "2026-06-25");

  // 카드 명세서가 나중에 들어온 경우 — 카드 쪽이 바뀌었다
  const byCard = planCardLinks([bank, kb], [june, payment], ["kb"], CARD_PAYMENT);
  check("카드 등록으로 연결", byCard.length === 1, byCard);
  check("어느 카드인지", byCard[0]?.linkedAccountId === "kb", byCard[0]);
  check("어느 결제월인지", byCard[0]?.billingMonth === "2026-06", byCard[0]);

  /*
    은행 거래내역이 나중에 들어온 경우 — 이쪽이 오래 빠져 있었다. 카드만 보고
    있었기 때문에 금액이 정확히 같아도 6월이 연결되지 않았다.
  */
  const byBank = planCardLinks([bank, kb], [june, payment], ["bank"], CARD_PAYMENT);
  check("은행 등록으로도 연결", byBank.length === 1, byBank);
  check("결제월까지 기록", byBank[0]?.billingMonth === "2026-06", byBank[0]);

  // 관계없는 계좌가 바뀐 것이라면 아무것도 건드리지 않는다
  const other = planCardLinks([bank, kb], [june, payment], ["somewhere"], CARD_PAYMENT);
  check("무관한 변화엔 반응하지 않음", other.length === 0, other);

  // 이미 같은 값으로 연결돼 있으면 다시 쓰지 않는다 (StrictMode 재실행 안전)
  const linked = { ...payment, linkedAccountId: "kb", billingMonth: "2026-06" };
  const again = planCardLinks([bank, kb], [june, linked], ["kb"], CARD_PAYMENT);
  check("멱등 — 바뀔 게 없으면 빈 목록", again.length === 0, again);
}

// ---------------------------------------------------------------------------
section("금액이 정확히 같을 때만");
// ---------------------------------------------------------------------------
{
  // 수수료 46원이 빠졌던 7월이 이 모양이었다
  const july = use("kb", "2026-07", 281_848);
  const payment = pay(281_894, "2026-07-25");

  const plan = planCardLinks([bank, kb], [july, payment], ["kb"], CARD_PAYMENT);
  check("46원이 달라도 연결하지 않음", plan.length === 0, plan);

  const exact = planCardLinks(
    [bank, kb],
    [use("kb", "2026-07", 281_894), payment],
    ["kb"],
    CARD_PAYMENT
  );
  check("맞으면 연결", exact[0]?.billingMonth === "2026-07", exact);
}

// ---------------------------------------------------------------------------
section("명세서가 사라지면 연결도 풀린다");
// ---------------------------------------------------------------------------
{
  const payment = pay(281_894, "2026-06-25", {
    linkedAccountId: "kb",
    billingMonth: "2026-06",
  });

  const plan = planCardLinks([bank, kb], [payment], ["kb"], CARD_PAYMENT);
  check("맞는 달이 없으면 해지", plan.length === 1, plan);
  check("연결과 결제월을 함께", !plan[0]?.linkedAccountId && !plan[0]?.billingMonth, plan[0]);

  // 다른 달은 그대로 둔다
  const may = use("kb", "2026-05", 100_000);
  const mayPaid = pay(100_000, "2026-05-25", {
    linkedAccountId: "kb",
    billingMonth: "2026-05",
  });
  const partial = planCardLinks([bank, kb], [may, mayPaid, payment], ["kb"], CARD_PAYMENT);
  check("남아 있는 달은 건드리지 않음", partial.length === 1 && partial[0].id === payment.id, partial);

  /*
    사람이 직접 걸어 둔 연결은 금액으로 설명되지 않을 수 있다(명세서를 아직
    등록하지 않은 카드). 은행 거래내역을 넣었다는 이유로 그것을 풀면 안 된다 —
    해지는 카드 쪽 내역이 실제로 바뀌었을 때만이다.
  */
  const byHand = pay(123_456, "2026-06-25", { linkedAccountId: "kb", billingMonth: "2026-06" });
  const onBank = planCardLinks([bank, kb], [byHand], ["bank"], CARD_PAYMENT);
  check("은행 등록은 수동 연결을 풀지 않음", onBank.length === 0, onBank);

  const onCard = planCardLinks([bank, kb], [byHand], ["kb"], CARD_PAYMENT);
  check("카드 내역이 바뀌면 해지", onCard.length === 1, onCard);
}

// ---------------------------------------------------------------------------
section("한 출금은 한 명세서에만");
// ---------------------------------------------------------------------------
{
  const entries = [
    use("kb", "2026-06", 50_000),
    use("kb", "2026-07", 50_000),
    pay(50_000, "2026-06-25"),
    pay(50_000, "2026-07-25"),
  ];

  const plan = planCardLinks([bank, kb], entries, ["kb"], CARD_PAYMENT);
  const months = plan.map((tx) => tx.billingMonth).sort();
  check("같은 금액이어도 1:1", months.length === 2, plan);
  check("각각 다른 달", months[0] === "2026-06" && months[1] === "2026-07", months);
}

// ---------------------------------------------------------------------------
section("다른 카드가 가져간 출금은 빼앗지 않는다");
// ---------------------------------------------------------------------------
{
  const other: any = {
    id: "kb2",
    name: "KB국민카드 세컨",
    institution: "KB국민카드",
    type: "CARD",
    paymentAccountId: "bank",
  };

  const entries = [
    use("kb", "2026-06", 70_000),
    use("kb2", "2026-06", 70_000),
    pay(70_000, "2026-06-25", { linkedAccountId: "kb2", billingMonth: "2026-06" }),
  ];

  const plan = planCardLinks([bank, kb, other], entries, ["kb", "kb2"], CARD_PAYMENT);
  check("이미 다른 카드에 연결된 출금은 그대로", plan.length === 0, plan);
}

// ---------------------------------------------------------------------------
section("결제 계좌를 등록하지 않은 카드");
// ---------------------------------------------------------------------------
{
  const loose: any = { id: "kb3", name: "KB국민카드", institution: "KB국민카드", type: "CARD" };
  const june = use("kb3", "2026-06", 281_894);
  const payment = { ...pay(281_894, "2026-06-25"), accountId: "bank" };

  const plan = planCardLinks([bank, loose], [june, payment], ["bank"], CARD_PAYMENT);
  check("카드사 이름이 적혀 있고 그 카드가 하나뿐이면 연결", plan.length === 1, plan);
  check("결제월도 기록", plan[0]?.billingMonth === "2026-06", plan[0]);

  // 같은 카드사 카드가 둘이면 어느 쪽인지 알 수 없다
  const twin: any = { id: "kb4", name: "KB국민카드 둘", institution: "KB국민카드", type: "CARD" };
  const ambiguous = planCardLinks(
    [bank, loose, twin],
    [june, payment],
    ["bank"],
    CARD_PAYMENT
  );
  check("같은 카드사가 둘이면 연결하지 않음", ambiguous.length === 0, ambiguous);

  // 카드사 이름이 없으면 근거가 없다
  const unnamed = { ...payment, merchant: "체크카드출금" };
  const noName = planCardLinks([bank, loose], [june, unnamed], ["bank"], CARD_PAYMENT);
  check("카드사 이름이 없으면 연결하지 않음", noName.length === 0, noName);
}

// ---------------------------------------------------------------------------
section("합계와 달 고르기");
// ---------------------------------------------------------------------------
{
  const totals = billingTotalsFor(
    [use("kb", "2026-06", 10_000), use("kb", "2026-06", 5_000), use("kb", "2026-07", 3_000)],
    "kb"
  );
  check("결제월별 합계", totals.get("2026-06") === 15_000 && totals.get("2026-07") === 3_000, [
    ...totals,
  ]);

  // 환불은 그 달에서 빠진다
  const refunded = billingTotalsFor(
    [
      use("kb", "2026-06", 10_000),
      { ...use("kb", "2026-06", 4_000), type: "INCOME" },
    ],
    "kb"
  );
  check("환불은 차감", refunded.get("2026-06") === 6_000, [...refunded]);

  // 같은 금액의 달이 둘이면 낸 달에 가까운 쪽
  const twoWays = new Map([
    ["2026-01", 9_000],
    ["2026-06", 9_000],
  ]);
  check("가까운 달이 이김", matchBillingMonth(twoWays, 9_000, "2026-07") === "2026-06");
  check("이미 가져간 달은 제외", matchBillingMonth(twoWays, 9_000, "2026-07", new Set(["2026-06"])) === "2026-01");
  check("맞는 달이 없으면 없음", matchBillingMonth(twoWays, 1, "2026-07") === null);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
