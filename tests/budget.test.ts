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
  emptyPolicy,
  type BudgetPolicy,
} from "../src/services/budgetPolicy";

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
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
