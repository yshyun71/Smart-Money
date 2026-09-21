/**
 * 기간 추이 (§12.4).
 *
 * 한 달도 한 해도 아닌 구간을 묻는 기능이라, 달을 세는 일과 값을 고르는 일이
 * 전부입니다. 여기서 지키는 것은 **빈 달을 빼지 않을 것**, 옮긴 돈을 세지 않을
 * 것, 그리고 모르는 증감률을 지어내지 않을 것입니다.
 */
import {
  monthPeriod,
  yearPeriod,
  rangePeriod,
  monthsBetween,
  monthlyTrend,
  trendStats,
  valueOf,
  categoriesInRange,
} from "../src/services/trend";

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
const tx = (
  date: string,
  amount: number,
  options: { type?: string; category?: string; expenseType?: string } = {}
): any => ({
  id: `t${serial++}`,
  accountId: "bank",
  date,
  time: "12:00",
  type: options.type || "EXPENSE",
  expenseType: options.expenseType || (options.type === "INCOME" ? "INCOME" : "VARIABLE"),
  category: options.category || "식비",
  merchant: "가맹점",
  amount,
  paymentMethod: "카드",
});

// ---------------------------------------------------------------------------
section("기간 — 달·해·구간을 같은 값으로");
// ---------------------------------------------------------------------------
{
  const month = monthPeriod("2026-08");
  check("달의 시작", month.start === "2026-08-01", month);
  /*
    말일을 31로 둡니다. 날짜를 글자로 견주므로 30일인 달에도 안전합니다 —
    달마다 말일을 따로 구하는 코드를 두지 않는 편이 틀릴 여지가 적습니다.
  */
  check("달의 끝은 31", month.end === "2026-08-31", month);
  check("30일인 달도 안전", "2026-09-30" <= monthPeriod("2026-09").end);
  check("다음 달은 넘지 않음", !("2026-10-01" <= monthPeriod("2026-09").end));
  check("이름", month.label === "8월", month);

  check("해", yearPeriod("2026").start === "2026-01-01" && yearPeriod("2026").end === "2026-12-31");

  const span = rangePeriod("2026-03", "2027-02");
  check("구간", span.start === "2026-03-01" && span.end === "2027-02-31", span);
  check("구간 이름", span.label === "2026.03 ~ 2027.02", span.label);
  // 거꾸로 주어도 바로잡습니다
  check("거꾸로", rangePeriod("2027-02", "2026-03").start === "2026-03-01");
  check("같은 달이면 달 이름", rangePeriod("2026-08", "2026-08").label === "8월");
}

// ---------------------------------------------------------------------------
section("달 세기");
// ---------------------------------------------------------------------------
{
  check("양끝 포함", monthsBetween("2026-08", "2026-10").join() === "2026-08,2026-09,2026-10");
  check("한 달", monthsBetween("2026-08", "2026-08").join() === "2026-08");
  check("해를 넘김", monthsBetween("2026-11", "2027-02").join() === "2026-11,2026-12,2027-01,2027-02");
  check("거꾸로 주어도", monthsBetween("2026-10", "2026-08").length === 3);
  // 차트가 읽히지 않을 만큼 긴 구간은 잘라 냅니다
  check("상한", monthsBetween("1990-01", "2030-01").length === 120);
}

// ---------------------------------------------------------------------------
section("추이 — 빈 달도 한 점입니다");
// ---------------------------------------------------------------------------
{
  const rows: any[] = [
    tx("2026-06-05", 100_000),
    tx("2026-06-20", 50_000),
    // 7월은 없습니다
    tx("2026-08-10", 300_000),
    tx("2026-08-11", 2_000_000, { type: "INCOME", category: "급여" }),
  ];

  const points = monthlyTrend(rows, { from: "2026-06", to: "2026-08", direction: "EXPENSE" });
  check("석 달 모두", points.length === 3, points.map((p) => p.month));
  /*
    내역이 없는 달을 빼면 선이 이어져 "그 달에 쓰지 않았다"가 "그 달이 없었다"로
    보입니다. 추이는 빈 곳이 보여야 추이입니다.
  */
  check("빈 달도 0으로 남음", points[1].month === "2026-07" && points[1].expense === 0, points[1]);
  check("6월 지출", points[0].expense === 150_000, points[0]);
  check("8월 수입", points[2].income === 2_000_000, points[2]);
  check("순액", points[2].net === 1_700_000, points[2]);

  const stats = trendStats(points, "EXPENSE");
  check("합계", stats.total === 450_000, stats);
  // 평균은 빈 달도 한 달로 셉니다 — 그래야 "월평균"입니다
  check("월평균", stats.average === 150_000, stats);
  check("가장 많은 달", stats.peak?.month === "2026-08", stats.peak);
  check("가장 적은 달", stats.low?.month === "2026-07", stats.low);
  check("처음 대비 끝", stats.change === 150_000, stats);
  check("증감률", stats.changeRatio === 1, stats);

  check("구분에 따라 값이 달라짐", valueOf(points[2], "INCOME") === 2_000_000);
  check("전체는 순액", valueOf(points[2], "ALL") === 1_700_000);
}

// ---------------------------------------------------------------------------
section("카테고리를 고르면 그 카테고리만");
// ---------------------------------------------------------------------------
{
  const rows: any[] = [
    tx("2026-07-01", 100_000, { category: "식비" }),
    tx("2026-07-02", 400_000, { category: "쇼핑" }),
    tx("2026-08-01", 120_000, { category: "식비" }),
  ];

  const food = monthlyTrend(rows, { from: "2026-07", to: "2026-08", category: "식비" });
  check("식비만", food[0].expense === 100_000 && food[1].expense === 120_000, food);
  const all = monthlyTrend(rows, { from: "2026-07", to: "2026-08", category: "ALL" });
  check("ALL 은 전체", all[0].expense === 500_000, all[0]);

  const options = categoriesInRange(rows, { from: "2026-07", to: "2026-08" });
  check("금액 큰 순", options[0].category === "쇼핑", options);
  check("건수도 함께", options.find((o) => o.category === "식비")?.count === 2, options);
  // 그 구분에 없는 카테고리는 목록에 올리지 않습니다 — 고르면 빈 차트가 됩니다
  check(
    "수입만 볼 때는 지출 카테고리가 없음",
    categoriesInRange(rows, { from: "2026-07", to: "2026-08", direction: "INCOME" }).length === 0
  );
}

// ---------------------------------------------------------------------------
section("옮긴 돈은 추이에도 없습니다");
// ---------------------------------------------------------------------------
{
  const rows: any[] = [
    tx("2026-08-01", 200_000, { category: "식비" }),
    tx("2026-08-02", 1_000_000, { category: "이체" }),
    tx("2026-08-03", 2_000_000, { type: "INCOME", category: "이체" }),
    tx("2026-08-04", 300_000, { category: "이체", expenseType: "FIXED" }),
  ];

  const points = monthlyTrend(rows, { from: "2026-08", to: "2026-08", direction: "EXPENSE" });
  /*
    일회성 이체는 빠지고 고정으로 표시한 이체는 남습니다(§6.5) — 다른 화면의
    합계와 어긋나지 않도록 이 모듈이 스스로 한 번 더 거릅니다.
  */
  check("일회성 이체 제외, 고정 이체 포함", points[0].expense === 500_000, points[0]);
  check("받은 이체는 수입이 아님", points[0].income === 0, points[0]);
  check(
    "카테고리 목록에도 고정 이체만",
    categoriesInRange(rows, { from: "2026-08", to: "2026-08" }).find(
      (o) => o.category === "이체"
    )?.amount === 300_000
  );
}

// ---------------------------------------------------------------------------
section("모르는 것은 지어내지 않습니다");
// ---------------------------------------------------------------------------
{
  const empty = trendStats([], "EXPENSE");
  check("빈 추이", empty.total === 0 && empty.peak === null && empty.months === 0, empty);
  check("빈 추이의 증감률은 null", empty.changeRatio === null, empty);

  /*
    첫 달이 0이면 증감률이란 것이 없습니다. 0으로 나눠 ∞ 를 보여 주는 것보다
    모른다고 하는 편이 맞습니다.
  */
  const fromZero = trendStats(
    monthlyTrend([tx("2026-08-01", 50_000)], { from: "2026-07", to: "2026-08" }),
    "EXPENSE"
  );
  check("0에서 시작하면 비율 없음", fromZero.changeRatio === null, fromZero);
  check("그래도 변화량은 말합니다", fromZero.change === 50_000, fromZero);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
