/**
 * 계좌·카드 내역 화면의 산식.
 *
 * 이 판정들은 1,474줄짜리 컴포넌트 안에 있었습니다 — 타입 검사와 회귀 세트가
 * 가장 얕게 닿는 자리에 **카드의 합계**가 있었던 셈입니다. 그 규칙이 틀려
 * 명세서 소계와 34,000원 어긋난 적이 있고(§9.5), 홈에서 8월을 골라 두고 카드를
 * 눌렀는데 9월이 열린 적이 있습니다.
 */
import {
  monthOf,
  monthKeys,
  payKindOf,
  inPeriod,
  filterEntries,
  ledgerTotals,
  selectedTotals,
  groupByMonth,
  countByMonth,
  categoriesUsed,
  landingMonth,
  fullSpan,
  type LedgerFilter,
} from "../src/services/ledger";
import { monthLabel, shiftMonth, thisMonthKey } from "../src/services/trend";

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
  category: "식비",
  merchant: "가맹점",
  amount: 10_000,
  paymentMethod: "카드",
  ...over,
});

const month = (over: Record<string, unknown> = {}): LedgerFilter => ({
  basis: "USED",
  periodMode: "MONTH",
  month: "2026-08",
  ...over,
});

// ---------------------------------------------------------------------------
section("어느 달로 세는가 — 할부는 두 답이 다릅니다");
// ---------------------------------------------------------------------------
{
  const instalment = tx({ date: "2026-06-10", billingMonth: "2026-09" });
  check("이용일자 기준", monthOf(instalment, "USED") === "2026-06");
  check("결제월 기준", monthOf(instalment, "BILLED") === "2026-09");

  /* 결제월이 기록되기 전에 들어온 줄은 이용월밖에 없습니다 */
  const old = tx({ date: "2026-06-10" });
  check("결제월이 없으면 이용월", monthOf(old, "BILLED") === "2026-06");

  check(
    "연월 목록은 오래된 것부터",
    JSON.stringify(
      monthKeys([tx({ date: "2026-09-01" }), tx({ date: "2026-07-01" })], "USED")
    ) === JSON.stringify(["2026-07", "2026-09"])
  );
}

// ---------------------------------------------------------------------------
section("카드 한 줄이 셋 중 무엇인가");
// ---------------------------------------------------------------------------
{
  check("카드대출은 분류로", payKindOf(tx({ category: "대출" })) === "CARD_LOAN");
  check("할부는 메모의 회차로", payKindOf(tx({ memo: "4/10" })) === "INSTALMENT");
  check("회차만 적힌 것도", payKindOf(tx({ memo: "9회차" })) === "INSTALMENT");
  check("나머지는 일시불", payKindOf(tx({ memo: "일시불" })) === "ONCE");
  check("메모가 없어도 일시불", payKindOf(tx()) === "ONCE");
  /* 분류가 먼저입니다 — 카드대출을 할부로 나눠 갚는 경우가 있습니다 */
  check(
    "대출이 할부보다 셉니다",
    payKindOf(tx({ category: "대출", memo: "3/6" })) === "CARD_LOAN"
  );
}

// ---------------------------------------------------------------------------
section("기간 — 한쪽이 비면 그쪽은 열어 둡니다");
// ---------------------------------------------------------------------------
{
  const july = tx({ date: "2026-07-20" });
  const august = tx({ date: "2026-08-20" });
  const september = tx({ date: "2026-09-20" });

  check("월별은 그 달만", inPeriod(august, month()) && !inPeriod(july, month()));

  const span: LedgerFilter = {
    basis: "USED",
    periodMode: "RANGE",
    from: "2026-07",
    to: "2026-08",
  };
  check("구간 안", inPeriod(july, span) && inPeriod(august, span));
  check("구간 밖", !inPeriod(september, span));

  const openEnd: LedgerFilter = { basis: "USED", periodMode: "RANGE", from: "2026-08" };
  check(
    "끝을 비우면 여기부터 끝까지",
    inPeriod(august, openEnd) && inPeriod(september, openEnd) && !inPeriod(july, openEnd)
  );

  const openStart: LedgerFilter = { basis: "USED", periodMode: "RANGE", to: "2026-08" };
  check(
    "시작을 비우면 처음부터 여기까지",
    inPeriod(july, openStart) && !inPeriod(september, openStart)
  );

  const reversed: LedgerFilter = {
    basis: "USED",
    periodMode: "RANGE",
    from: "2026-08",
    to: "2026-07",
  };
  check(
    "거꾸로 적어도 바로잡습니다",
    inPeriod(july, reversed) && inPeriod(august, reversed)
  );
}

// ---------------------------------------------------------------------------
section("조회 조건은 모두 함께 걸립니다");
// ---------------------------------------------------------------------------
{
  const rows = [
    tx({ date: "2026-08-01", expenseType: "FIXED", category: "통신", memo: "일시불" }),
    tx({ date: "2026-08-02", expenseType: "VARIABLE", category: "식비", memo: "3/6" }),
    tx({
      date: "2026-08-03",
      type: "INCOME",
      expenseType: "VARIABLE",
      category: "기타수입",
      amount: 5_000,
    }),
    tx({
      date: "2026-08-04",
      type: "INCOME",
      expenseType: "FIXED",
      category: "급여",
      amount: 3_000_000,
    }),
    tx({ date: "2026-07-30", expenseType: "VARIABLE", category: "식비" }),
  ];

  check("달로 걸러짐", filterEntries(rows, month()).length === 4);
  check("고정지출만", filterEntries(rows, month({ kind: "FIXED" })).length === 1);
  check(
    "변동지출만",
    filterEntries(rows, month({ kind: "VARIABLE" })).map((r) => r.date).join() ===
      "2026-08-02"
  );
  /* 정기성이 수입에도 붙습니다 (§6.6) — 급여와 환급금은 다른 것입니다 */
  check(
    "고정수입만",
    filterEntries(rows, month({ kind: "INCOME_FIXED" })).map((r) => r.category).join() ===
      "급여"
  );
  check(
    "변동수입만",
    filterEntries(rows, month({ kind: "INCOME_VARIABLE" })).map((r) => r.category).join() ===
      "기타수입"
  );
  check("할부만", filterEntries(rows, month({ pay: "INSTALMENT" })).length === 1);
  check("카테고리로", filterEntries(rows, month({ category: "식비" })).length === 1);
  check(
    "ALL 과 빈 값은 같은 뜻",
    filterEntries(rows, month({ kind: "ALL", pay: "ALL", category: null })).length === 4
  );
  /* 컨텍스트가 이미 정렬해 두었으므로 순서를 흔들지 않습니다 */
  check(
    "받은 순서를 지킵니다",
    filterEntries(rows, month())
      .map((r) => r.date)
      .join() === "2026-08-01,2026-08-02,2026-08-03,2026-08-04"
  );
}

// ---------------------------------------------------------------------------
section("카드의 합계는 지출 − 차감·환불 (§9.5 — 34,000원 사고)");
// ---------------------------------------------------------------------------
{
  /* 우리카드의 `차감-[청구할인]` 은 청구액을 줄입니다 */
  const rows = [
    tx({ amount: 700_000 }),
    tx({ type: "INCOME", amount: 34_000, merchant: "차감-[청구할인]" }),
  ];
  const totals = ledgerTotals(rows);

  check("이용액", totals.expense === 700_000);
  check("차감", totals.income === 34_000);
  check("청구액은 그 차이", totals.billed === 666_000, totals.billed);
  /* 이 값이 출금과 정확히 같아야 카드대금이 연결됩니다(§9.2) */
  check("지출만 더하지 않습니다", totals.billed !== totals.expense);

  const empty = ledgerTotals([]);
  check("빈 목록은 0", empty.income === 0 && empty.expense === 0 && empty.billed === 0);
}

// ---------------------------------------------------------------------------
section("고른 것들의 합 — 카드와 계좌에서 뜻이 갈립니다");
// ---------------------------------------------------------------------------
{
  const spend = tx({ id: "a", amount: 700_000 });
  const back = tx({ id: "b", type: "INCOME", amount: 34_000 });
  const other = tx({ id: "c", amount: 1_000 });
  const rows = [spend, back, other];

  const card = selectedTotals(rows, new Set(["a", "b"]), false);
  check("카드는 차감을 뺍니다", card.total === 666_000, card.total);

  const bank = selectedTotals(rows, new Set(["a", "b"]), true);
  check("계좌는 더합니다", bank.total === 734_000, bank.total);

  check("고르지 않은 것은 빠집니다", card.expense === 700_000);
  check("배열로 줘도 같습니다", selectedTotals(rows, ["a", "b"], false).total === 666_000);
  check("아무것도 고르지 않으면 0", selectedTotals(rows, [], false).total === 0);
}

// ---------------------------------------------------------------------------
section("달로 묶기와 건수");
// ---------------------------------------------------------------------------
{
  const rows = [
    tx({ date: "2026-09-02" }),
    tx({ date: "2026-08-20" }),
    tx({ date: "2026-08-01" }),
  ];

  const grouped = groupByMonth(rows, "USED");
  check("최근 달부터", grouped.map(([key]) => key).join() === "2026-09,2026-08");
  check("달 안의 건수", grouped[1][1].length === 2);
  check(
    "달 안의 순서는 받은 그대로",
    grouped[1][1].map((r) => r.date).join() === "2026-08-20,2026-08-01"
  );

  const counts = countByMonth(rows, "USED");
  check("달마다 건수", counts.get("2026-08") === 2 && counts.get("2026-09") === 1);
  check("없는 달은 없음", counts.get("2026-07") === undefined);

  /* 결제월 기준으로 묶으면 할부가 다른 달로 갑니다 */
  const billed = groupByMonth(
    [tx({ date: "2026-06-10", billingMonth: "2026-09" })],
    "BILLED"
  );
  check("결제월 기준", billed[0][0] === "2026-09");
}

// ---------------------------------------------------------------------------
section("쓰는 카테고리만 고를 만합니다");
// ---------------------------------------------------------------------------
{
  const names = categoriesUsed([
    tx({ category: "통신" }),
    tx({ category: "식비" }),
    tx({ category: "식비" }),
  ]);
  check("중복 없이", names.length === 2, names);
  check("한글 순서로", names.join() === "식비,통신", names);
  check("빈 목록", categoriesUsed([]).length === 0);
}

// ---------------------------------------------------------------------------
section("착지할 달 — 방금 한 선택을 못 본 척하지 않습니다");
// ---------------------------------------------------------------------------
{
  const months = ["2026-07", "2026-08", "2026-09"];

  check(
    "고른 기준월이 먼저",
    landingMonth({ months, selected: "2026-08", leftover: "2026-09" }) === "2026-08"
  );
  /* 고른 달에 이 계좌 내역이 없으면 빈 화면을 띄우는 대신 물러섭니다 */
  check(
    "그 달에 내역이 없으면 물러섭니다",
    landingMonth({ months, selected: "2026-03" }) === "2026-09"
  );
  check("읽던 달은 지킵니다", landingMonth({ months, leftover: "2026-07" }) === "2026-07");
  check(
    "읽던 달에 내역이 없으면 가장 최근",
    landingMonth({ months, leftover: "2025-01" }) === "2026-09"
  );
  check("아무것도 없으면 이번 달", landingMonth({ months: [] }) === thisMonthKey());
  check(
    "물러설 곳을 지정할 수 있습니다",
    landingMonth({ months: [], fallback: "2026-05" }) === "2026-05"
  );

  const span = fullSpan(months);
  check("기간 칸의 양끝은 기록된 전부", span.from === "2026-07" && span.to === "2026-09");
  const none = fullSpan([], "2026-05");
  check("내역이 없으면 양끝이 같습니다", none.from === "2026-05" && none.to === "2026-05");
}

// ---------------------------------------------------------------------------
section("연월 한 칸 — 세 벌로 복사돼 있던 것들");
// ---------------------------------------------------------------------------
{
  check("이름", monthLabel("2026-09") === "2026년 09월");
  check("읽을 수 없으면 지어내지 않습니다", monthLabel("") === "-");
  check("절반만 있어도", monthLabel("2026") === "-");

  check("한 달 뒤", shiftMonth("2026-09", 1) === "2026-10");
  check("해를 넘김", shiftMonth("2026-12", 1) === "2027-01");
  check("거꾸로 해를 넘김", shiftMonth("2026-01", -1) === "2025-12");
  check("여러 달", shiftMonth("2026-09", -14) === "2025-07");
  check("읽을 수 없으면 그대로", shiftMonth("", 1) === "");

  check(
    "이번 달",
    thisMonthKey(new Date(2026, 8, 22)) === "2026-09",
    thisMonthKey(new Date(2026, 8, 22))
  );
  check("한 자리 달은 0 을 채웁니다", thisMonthKey(new Date(2026, 0, 5)) === "2026-01");
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
