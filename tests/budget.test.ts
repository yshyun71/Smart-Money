/**
 * 예산 기준(정책)과 고정비 가이드.
 *
 * 매달 열두 카테고리를 손으로 다시 적는 일은 아무도 계속하지 못하고, 그러면
 * 예산은 몇 달 전 값에 멈춰 아무 뜻이 없어집니다. 기준을 한 번 정해 두고 어느
 * 달에든 적용하는 것이 이 모듈이 하는 일입니다.
 */
import {
  allocate,
  spareOf,
  policyCheck,
  fixedBaselines,
  rulesFromBaselines,
  belowBaseline,
  historyAllocate,
  emptyPolicy,
  type BudgetPolicy,
} from "../src/services/budgetPolicy";
import {
  actualRows,
  sumActuals,
  monthPhase,
  budgetWording,
  categorySpendRows,
} from "../src/services/actuals";

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
const fixedTx = (category: string, month: string, amount: number): any => ({
  id: `f${serial++}`,
  accountId: "bank",
  date: `${month}-05`,
  time: "12:00",
  type: "EXPENSE",
  expenseType: "FIXED",
  category,
  merchant: `${category} 고정`,
  amount,
  paymentMethod: "카드",
});

const varTx = (category: string, month: string, amount: number): any => ({
  ...fixedTx(category, month, amount),
  expenseType: "VARIABLE",
});

const inputs = { income: 3_000_000, fixed: 1_000_000, savings: 500_000 };

// ---------------------------------------------------------------------------
section("가용 변동비 — 저축을 빼고 셉니다");
// ---------------------------------------------------------------------------
{
  check("수입 − 고정비 − 저축", spareOf(inputs) === 1_500_000, spareOf(inputs));
  check(
    "음수가 되면 0",
    spareOf({ income: 100, fixed: 200, savings: 100 }) === 0,
    spareOf({ income: 100, fixed: 200, savings: 100 })
  );
}

// ---------------------------------------------------------------------------
section("세 가지 방식");
// ---------------------------------------------------------------------------
{
  // (1) 금액을 직접
  const amount: BudgetPolicy = { mode: "AMOUNT", rules: { 식비: 400_000, 교통: 120_000 } };
  const a = allocate(amount, inputs);
  check("금액 그대로", a["식비"] === 400_000 && a["교통"] === 120_000, a);

  // (2) 수입 기준 비율
  const byIncome: BudgetPolicy = { mode: "INCOME_RATIO", rules: { 식비: 12, 교통: 4 } };
  const b = allocate(byIncome, inputs);
  check("수입의 12%", b["식비"] === 360_000, b);
  check("수입의 4%", b["교통"] === 120_000, b);

  // (3) 가용 변동비 기준 비율
  const bySpare: BudgetPolicy = { mode: "SPARE_RATIO", rules: { 식비: 30, 교통: 10 } };
  const c = allocate(bySpare, inputs);
  check("가용의 30%", c["식비"] === 450_000, c);
  check("가용의 10%", c["교통"] === 150_000, c);

  // 원 단위로 떨어집니다
  const odd = allocate({ mode: "INCOME_RATIO", rules: { 식비: 12.345 } }, inputs);
  check("소수가 남지 않음", Number.isInteger(odd["식비"]), odd);

  // 규칙 없는 카테고리는 0으로 만들지 않고 빼둡니다 — "예산 없음"과 "0원"은 다른 말
  check("0 이하 규칙은 제외", !("쇼핑" in allocate({ mode: "AMOUNT", rules: { 쇼핑: 0 } }, inputs)));
  check("빈 기준은 빈 결과", Object.keys(allocate(emptyPolicy(), inputs)).length === 0);
}

// ---------------------------------------------------------------------------
section("넘치면 막지 않고 알려 줍니다");
// ---------------------------------------------------------------------------
{
  const tight: BudgetPolicy = { mode: "AMOUNT", rules: { 식비: 1_000_000, 쇼핑: 900_000 } };
  const report = policyCheck(tight, inputs);
  check("합계", report.total === 1_900_000, report);
  check("가용", report.spare === 1_500_000, report);
  check("초과분을 알려 줌", report.over === 400_000, report);

  const fits = policyCheck({ mode: "AMOUNT", rules: { 식비: 500_000 } }, inputs);
  check("들어가면 초과 0", fits.over === 0, fits);

  // 비율 모드는 합이 100%를 넘는지도 봅니다
  const ratios = policyCheck({ mode: "SPARE_RATIO", rules: { 식비: 70, 쇼핑: 50 } }, inputs);
  check("비율 합계", ratios.ratioTotal === 120, ratios);
  check("금액 모드에선 비율 합계가 없음", policyCheck(tight, inputs).ratioTotal === 0);
}

// ---------------------------------------------------------------------------
section("고정비 가이드 — 카테고리별 월평균");
// ---------------------------------------------------------------------------
{
  const rows = [
    fixedTx("주거", "2026-04", 500_000),
    fixedTx("주거", "2026-05", 500_000),
    fixedTx("주거", "2026-06", 520_000),
    fixedTx("통신", "2026-04", 60_000),
    fixedTx("통신", "2026-05", 60_000),
    fixedTx("통신", "2026-06", 45_000),
    // 같은 달에 두 건이면 더해서 그 달의 금액
    fixedTx("보험", "2026-06", 30_000),
    fixedTx("보험", "2026-06", 20_000),
    // 변동비는 가이드에 들어가지 않습니다
    varTx("식비", "2026-06", 400_000),
  ];

  const lines = fixedBaselines(rows, { months: 6, upTo: "2026-07" });
  const of = (category: string) => lines.find((line) => line.category === category);

  check("변동비는 제외", !of("식비"), lines.map((l) => l.category));
  check("주거 평균", of("주거")?.average === 506_667, of("주거"));
  check("주거 3개월", of("주거")?.months === 3, of("주거"));
  check("같은 달 두 건은 합산", of("보험")?.average === 50_000, of("보험"));
  check("금액 큰 순", lines[0]?.category === "주거", lines.map((l) => l.category));

  // 추이 — 5% 안쪽 흔들림은 추이로 보지 않습니다
  check("주거는 평균 수준", of("주거")?.trend === "FLAT", of("주거"));
  check("통신은 내려가는 중", of("통신")?.trend === "DOWN", of("통신"));

  // 이번 달은 아직 끝나지 않았으므로 평균에서 뺍니다
  const withThisMonth = fixedBaselines([...rows, fixedTx("주거", "2026-07", 10_000)], {
    upTo: "2026-07",
  });
  check(
    "진행 중인 달은 평균에 넣지 않음",
    withThisMonth.find((l) => l.category === "주거")?.average === 506_667,
    withThisMonth.find((l) => l.category === "주거")
  );

  // 창을 좁히면 오래된 달이 빠집니다
  const recent = fixedBaselines(rows, { months: 2, upTo: "2026-07" });
  check("최근 2개월만", recent.find((l) => l.category === "주거")?.months === 2, recent[0]);
}

// ---------------------------------------------------------------------------
section("가이드를 기준으로 옮기기");
// ---------------------------------------------------------------------------
{
  const lines = fixedBaselines(
    [
      fixedTx("주거", "2026-05", 500_000),
      fixedTx("주거", "2026-06", 500_000),
      fixedTx("통신", "2026-05", 60_000),
      fixedTx("통신", "2026-06", 60_000),
    ],
    { upTo: "2026-07" }
  );

  const asAmount = rulesFromBaselines(lines, "AMOUNT", inputs);
  check("금액 모드는 평균 그대로", asAmount["주거"] === 500_000, asAmount);

  const asIncome = rulesFromBaselines(lines, "INCOME_RATIO", inputs);
  check("수입 대비 비율", asIncome["주거"] === 16.7, asIncome);
  check("작은 항목도 0이 되지 않음", asIncome["통신"] === 2, asIncome);

  const asSpare = rulesFromBaselines(lines, "SPARE_RATIO", inputs);
  check("가용 대비 비율", asSpare["주거"] === 33.3, asSpare);

  // 어느 모드든 다시 배분하면 평균에 가까운 금액이 나와야 합니다
  const back = allocate({ mode: "SPARE_RATIO", rules: asSpare }, inputs);
  check("되돌려도 평균 근처", Math.abs(back["주거"] - 500_000) < 5_000, back);
}

// ---------------------------------------------------------------------------
section("고정비보다 낮은 예산은 시작부터 초과입니다");
// ---------------------------------------------------------------------------
{
  const lines = fixedBaselines(
    [
      fixedTx("주거", "2026-05", 500_000),
      fixedTx("주거", "2026-06", 500_000),
      fixedTx("통신", "2026-05", 60_000),
      fixedTx("통신", "2026-06", 60_000),
    ],
    { upTo: "2026-07" }
  );

  const short = belowBaseline({ 주거: 300_000, 통신: 60_000 }, lines);
  check("모자란 것만 집어냄", short.length === 1 && short[0].category === "주거", short);
  check("얼마가 모자란지 알 수 있음", short[0].average === 500_000 && short[0].budget === 300_000, short[0]);

  // 예산이 아예 없으면 0으로 보고 모자란 것에 넣습니다
  const none = belowBaseline({}, lines);
  check("예산 미설정도 모자란 것", none.length === 2, none);

  const enough = belowBaseline({ 주거: 600_000, 통신: 70_000 }, lines);
  check("충분하면 비어 있음", enough.length === 0, enough);
}

// ---------------------------------------------------------------------------
section("내역 기반 배분 — 코드에 박힌 비율이 아니라 그 사람이 쓴 대로");
// ---------------------------------------------------------------------------
{
  const rows = [
    // 주거: 전부 고정비, 매달 50만
    fixedTx("주거", "2026-05", 500_000),
    fixedTx("주거", "2026-06", 500_000),
    // 식비: 전부 변동비, 매달 40만
    varTx("식비", "2026-05", 400_000),
    varTx("식비", "2026-06", 400_000),
    // 교통: 변동비 10만
    varTx("교통", "2026-05", 100_000),
    varTx("교통", "2026-06", 100_000),
  ];

  const out = historyAllocate(rows, { spare: 1_000_000, upTo: "2026-07" });
  const of = (category: string) => out.shares.find((row) => row.category === category);

  check("두 달을 셈", out.months === 2, out.months);

  /*
    고정비는 그대로 주고, 변동비는 비중대로 가용을 나눕니다.
    식비:교통 = 40만:10만 = 4:1 → 80만 / 20만
  */
  check("주거 = 고정비 평균", of("주거")?.budget === 500_000, of("주거"));
  check("식비 = 변동 비중 80%", of("식비")?.budget === 800_000, of("식비"));
  check("교통 = 변동 비중 20%", of("교통")?.budget === 200_000, of("교통"));
  check("고정비와 변동비를 나눠 봄", of("주거")?.fixed === 500_000 && of("주거")?.variable === 0, of("주거"));
  check("큰 금액 순", out.shares[0]?.category === "식비", out.shares.map((r) => r.category));
  check("바로 저장할 수 있는 형태", out.budgets["식비"] === 800_000, out.budgets);

  // 한 달만 쓴 항목이 매달 그 금액이 되면 안 됩니다
  const once = historyAllocate(
    [...rows, varTx("문화/여가", "2026-06", 600_000)],
    { spare: 1_000_000, upTo: "2026-07" }
  );
  const spike = once.shares.find((row) => row.category === "문화/여가");
  check("어쩌다 한 번은 달 수로 나눠 희석", (spike?.variable ?? 0) === 300_000, spike);
  check("그 달만 나왔다고 기록", spike?.months === 1, spike);

  // 사용자가 만든 카테고리도 배분받습니다 — 고정 비율 방식이 못 하던 것
  const custom = historyAllocate(
    [varTx("반려동물", "2026-05", 200_000), varTx("반려동물", "2026-06", 200_000)],
    { spare: 500_000, upTo: "2026-07" }
  );
  check("사용자 카테고리도 배분", custom.budgets["반려동물"] === 500_000, custom.budgets);

  // 카드대금은 카드 명세서와 겹쳐 두 번 세게 됩니다
  const withBill = historyAllocate(
    [...rows, varTx("카드대금", "2026-06", 900_000)],
    { spare: 1_000_000, upTo: "2026-07" }
  );
  check("카드대금은 제외", !("카드대금" in withBill.budgets), withBill.budgets);

  // 진행 중인 달은 평균에서 뺍니다
  const partial = historyAllocate([...rows, varTx("식비", "2026-07", 10_000)], {
    spare: 1_000_000,
    upTo: "2026-07",
  });
  check("이번 달은 세지 않음", partial.shares.find((r) => r.category === "식비")?.budget === 800_000, partial.shares);

  // 기록이 없으면 배분할 근거가 없습니다
  const empty = historyAllocate([], { spare: 1_000_000, upTo: "2026-07" });
  check("기록이 없으면 빈 결과", empty.shares.length === 0 && empty.months === 0, empty);

  // 전부 고정비면 나눌 변동비가 없어 고정비만 줍니다
  const allFixed = historyAllocate(
    [fixedTx("주거", "2026-05", 500_000), fixedTx("주거", "2026-06", 500_000)],
    { spare: 1_000_000, upTo: "2026-07" }
  );
  check("변동비가 없으면 고정비만", allFixed.budgets["주거"] === 500_000, allFixed.budgets);

  // 가용이 0이어도 고정비 몫은 남습니다 — 줄일 수 없는 돈이기 때문
  const noSpare = historyAllocate(rows, { spare: 0, upTo: "2026-07" });
  check("가용 0이어도 고정비는 유지", noSpare.budgets["주거"] === 500_000, noSpare.budgets);
  check("변동비 카테고리는 0이 되어 빠짐", !("식비" in noSpare.budgets), noSpare.budgets);

  // 특정 카테고리만 배분할 수도 있습니다
  const only = historyAllocate(rows, { spare: 1_000_000, upTo: "2026-07", only: ["식비"] });
  check("고른 카테고리만", Object.keys(only.budgets).join() === "식비", only.budgets);
  check("그 안에서 가용을 다 씀", only.budgets["식비"] === 1_000_000, only.budgets);
}

// ---------------------------------------------------------------------------
section("저축은 카테고리 예산에서 빠집니다");
// ---------------------------------------------------------------------------
{
  /*
    적금은 매달 같은 날 같은 금액으로 나가 §10의 판정으로 고정비가 됩니다.
    그런데 가용 변동비가 `수입 − 고정비 − 저축`이라, 고정비 가이드에도 세고
    저축에도 세면 같은 돈이 두 번 깎입니다.
  */
  const rows = [
    fixedTx("저축", "2026-05", 500_000),
    fixedTx("저축", "2026-06", 500_000),
    fixedTx("주거", "2026-05", 400_000),
    fixedTx("주거", "2026-06", 400_000),
    varTx("식비", "2026-05", 300_000),
    varTx("식비", "2026-06", 300_000),
  ];

  const guide = fixedBaselines(rows, { upTo: "2026-07" });
  check(
    "고정비 가이드에 저축이 없음",
    !guide.some((line) => line.category === "저축"),
    guide.map((l) => l.category)
  );
  check("주거는 그대로 있음", guide.some((line) => line.category === "주거"), guide);

  const plan = historyAllocate(rows, { spare: 600_000, upTo: "2026-07" });
  check("배분에도 저축이 없음", !("저축" in plan.budgets), plan.budgets);
  check("나머지는 정상 배분", plan.budgets["식비"] === 600_000, plan.budgets);
  check("주거는 고정비 그대로", plan.budgets["주거"] === 400_000, plan.budgets);

  const short = belowBaseline({ 저축: 0, 주거: 400_000 }, guide);
  check("저축은 '모자란 한도'로도 잡히지 않음", !short.some((r) => r.category === "저축"), short);

  // 카드대금도 같은 이유로 빠집니다
  const withBoth = historyAllocate(
    [...rows, varTx("카드대금", "2026-06", 900_000)],
    { spare: 600_000, upTo: "2026-07" }
  );
  check("카드대금도 빠짐", !("카드대금" in withBoth.budgets), withBoth.budgets);
}

// ---------------------------------------------------------------------------
section("실적 — 세 칸이 무엇을 세는가");
// ---------------------------------------------------------------------------
{
  const accounts: any = [
    { id: "bank", name: "통장", type: "BANK" },
    { id: "card", name: "카드", type: "CARD" },
  ];

  const income = (amount: number, id: string): any => ({
    id,
    accountId: "bank",
    date: "2026-08-10",
    time: "12:00",
    type: "INCOME",
    expenseType: "INCOME",
    category: "급여",
    merchant: "급여",
    amount,
    paymentMethod: "계좌입금",
  });

  const rows: any[] = [
    income(2_052_140, "i1"),
    income(1_000_000, "i2"),
    { ...income(5_261_934, "i3"), category: "기타수입", merchant: "펌뱅킹 이체" },
    fixedTx("주거", "2026-08", 500_000),
    fixedTx("저축", "2026-08", 300_000),
    { ...varTx("저축", "2026-08", 100_000), id: "card-savings", accountId: "card" },
    varTx("식비", "2026-08", 200_000),
    income(9_999, "other-month"),
  ];
  rows[rows.length - 1].date = "2026-07-10";

  const inc = actualRows(rows, { month: "2026-08", kind: "INCOME", accounts });
  check("수입은 그 달의 수입 전부", sumActuals(inc).total === 8_314_074, sumActuals(inc));
  check("다른 달은 세지 않음", inc.length === 3, inc.length);

  /*
    고정비에서 저축을 뺍니다. 가용 변동비가 `수입 − 고정비 − 저축`이라 양쪽에
    세면 같은 돈이 두 번 깎입니다.
  */
  const fixed = actualRows(rows, { month: "2026-08", kind: "FIXED", accounts });
  check("고정비에 저축이 없음", sumActuals(fixed).total === 500_000, sumActuals(fixed));

  /*
    저축은 계좌에서 나간 것만. 카드로 적금을 넣지는 않으므로 카드에 붙은 저축은
    잘못 분류된 것이고, 더하면 저축액이 부풀려집니다.
  */
  const savings = actualRows(rows, { month: "2026-08", kind: "SAVINGS", accounts });
  check("저축은 계좌에서만", sumActuals(savings).total === 300_000, sumActuals(savings));
  check("카드의 저축은 빠짐", !savings.some((tx: any) => tx.accountId === "card"), savings);

  // 계좌 목록을 주지 않으면 저축을 셀 수 없습니다 — 지어내지 않고 비웁니다
  check(
    "계좌를 모르면 저축은 0건",
    actualRows(rows, { month: "2026-08", kind: "SAVINGS" }).length === 0
  );
}

// ---------------------------------------------------------------------------
section("실적에서 뺀 항목");
// ---------------------------------------------------------------------------
{
  const rows: any[] = [
    { id: "a", date: "2026-08-01", type: "INCOME", amount: 2_052_140, category: "급여" },
    { id: "b", date: "2026-08-02", type: "INCOME", amount: 1_000_000, category: "급여" },
    { id: "c", date: "2026-08-03", type: "INCOME", amount: 5_261_934, category: "기타수입" },
  ];

  const kept = sumActuals(rows, ["c"]);
  check("뺀 금액은 합계에서 빠짐", kept.total === 3_052_140, kept);
  check("전체는 그대로 알 수 있음", kept.full === 8_314_074, kept);
  check("건수", kept.counted === 2 && kept.rows === 3, kept);
  check("뺀 건수와 금액", kept.excludedCount === 1 && kept.excludedAmount === 5_261_934, kept);

  /*
    제외해 둔 거래가 나중에 지워질 수 있습니다. 그때 오류를 내거나 합계를
    비우면 예산이 통째로 어긋나므로, 모르는 id 는 조용히 무시합니다.
  */
  const ghost = sumActuals(rows, ["없는-id"]);
  check("모르는 id 는 무시", ghost.total === 8_314_074 && ghost.excludedCount === 0, ghost);
  check("빈 목록·null 도 안전", sumActuals(rows, null).total === 8_314_074);
}

// ---------------------------------------------------------------------------
section("지난 달은 예상이 아니라 실적입니다");
// ---------------------------------------------------------------------------
{
  const today = new Date("2026-09-18T09:00:00");
  check("지난 달", monthPhase("2026-08", today) === "PAST");
  check("이번 달", monthPhase("2026-09", today) === "CURRENT");
  check("다음 달", monthPhase("2026-10", today) === "FUTURE");
  check("해를 넘겨도", monthPhase("2025-12", today) === "PAST");

  const past = budgetWording("PAST", "8월");
  check("지난 달 수입에 '예상'이 없음", past.income.label === "8월 총 수입", past.income);
  check("지난 달 저축은 '목표'가 아님", past.savings.label === "8월 저축액", past.savings);
  check("지난 달 고정비", past.fixed.label === "8월 고정 지출", past.fixed);
  check(
    "설명도 실제로 들어온 돈이라고 말함",
    past.income.hint.includes("실제로"),
    past.income.hint
  );

  const now = budgetWording("CURRENT", "9월");
  check("이번 달은 예상", now.income.label === "9월 예상 총 수입", now.income);
  check("이번 달 저축은 목표", now.savings.label === "9월 목표 저축액", now.savings);

  // 어느 달의 값인지 이름만 봐도 알 수 있어야 합니다
  check(
    "세 칸 모두 달 이름을 달고 있음",
    [past, now].every((w) =>
      [w.income.label, w.fixed.label, w.savings.label].every((label) => /^\d+월/.test(label))
    )
  );
}

// ---------------------------------------------------------------------------
section("카테고리 지출 펼쳐 보기 — 합계와 목록이 같은 말을 할 것");
// ---------------------------------------------------------------------------
{
  const rows: any[] = [
    varTx("식비", "2026-08", 30_000),
    varTx("식비", "2026-08", 12_000),
    fixedTx("식비", "2026-08", 8_000),
    varTx("교통", "2026-08", 50_000),
    varTx("식비", "2026-07", 99_000),
    {
      ...varTx("식비", "2026-08", 500_000),
      type: "INCOME",
      expenseType: "INCOME",
    },
  ];

  const food = categorySpendRows(rows, { month: "2026-08", category: "식비" });
  check("그 달 그 카테고리만", food.length === 3, food.length);
  check(
    "합계",
    food.reduce((sum: number, tx: any) => sum + tx.amount, 0) === 50_000,
    food
  );
  check("다른 달 제외", !food.some((tx: any) => tx.date.startsWith("2026-07")), food);
  check("다른 카테고리 제외", !food.some((tx: any) => tx.category === "교통"), food);

  /*
    환불(수입)은 빼야 합니다 — 예산의 소진율은 지출만 보고 계산하므로,
    목록에 수입이 섞이면 목록의 합과 위에 적힌 금액이 달라집니다.
  */
  check("수입은 목록에 없음", !food.some((tx: any) => tx.type === "INCOME"), food);

  // 고정비도 그 카테고리의 지출입니다(예산 소진율이 고정비를 포함해 셉니다)
  check("고정비도 포함", food.some((tx: any) => tx.expenseType === "FIXED"), food);

  /*
    **이 목록의 합은 예산 화면에 적힌 `지출:` 금액과 같아야 합니다.** 여기서
    그 집계(`budgetStatusList`)와 같은 규칙인지 직접 견줍니다 — 두 곳이 갈리면
    사용자는 어느 쪽이 맞는지 알 수 없습니다.
  */
  const grouped: Record<string, number> = {};
  rows
    .filter((tx: any) => tx.type === "EXPENSE" && tx.date.startsWith("2026-08"))
    .forEach((tx: any) => {
      grouped[tx.category] = (grouped[tx.category] || 0) + tx.amount;
    });

  for (const category of Object.keys(grouped)) {
    const listed = categorySpendRows(rows, { month: "2026-08", category }).reduce(
      (sum: number, tx: any) => sum + tx.amount,
      0
    );
    check(`${category}: 목록의 합 == 집계`, listed === grouped[category], {
      listed,
      grouped: grouped[category],
    });
  }

  check(
    "없는 카테고리는 빈 목록",
    categorySpendRows(rows, { month: "2026-08", category: "의료" }).length === 0
  );
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
