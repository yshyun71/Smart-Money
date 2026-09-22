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
import {
  summariseEntries,
  categoryBreakdown,
  monthlyHistory,
  yearlyHistory,
} from "../src/services/history";
import { runQuery, queryTotals, toCsv, csvFileName } from "../src/services/query";
import { recurringItems, looksStopped } from "../src/services/recurrence";

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
section("이력 집계 — 달·해·카테고리 비중");
// ---------------------------------------------------------------------------
{
  const rows: any[] = [
    tx("2026-07-05", 300_000, { expenseType: "FIXED", category: "주거" }),
    tx("2026-07-10", 120_000, { category: "식비" }),
    tx("2026-07-11", 2_000_000, { type: "INCOME", category: "급여" }),
    tx("2026-08-03", 80_000, { category: "식비" }),
    tx("2025-12-25", 50_000, { category: "쇼핑" }),
  ];

  const july = summariseEntries(rows.filter((t) => t.date.startsWith("2026-07")));
  check("수입", july.income === 2_000_000, july);
  check("지출", july.expense === 420_000, july);
  check("고정비", july.fixed === 300_000, july);
  check("변동비", july.variable === 120_000, july);
  check("순저축은 수입 − 지출", july.savings === 1_580_000, july);

  const shares = categoryBreakdown(rows.filter((t) => t.date.startsWith("2026-07")), july.expense);
  check("금액 큰 순", shares[0].category === "주거", shares);
  check("비중", Math.round(shares[0].percentage) === 71, shares[0]);
  /* 지출이 0이면 비중이란 것이 없습니다 — 0으로 나누지 않습니다 */
  check("분모가 0이면 0%", categoryBreakdown(rows, 0)[0].percentage === 0);
  check("수입은 비중에 없음", !shares.some((s) => s.category === "급여"), shares);

  const months = monthlyHistory(rows, { until: "2026-08", months: 3 });
  check("고른 달로 끝남", months[months.length - 1].month === "2026-08", months.map((m) => m.month));
  check("석 달", months.length === 3, months.map((m) => m.month));
  /*
    내역이 없는 달도 한 점으로 남깁니다 — 빼면 "그 달에 쓰지 않았다"가
    "그 달이 없었다"로 보입니다.
  */
  check("빈 달도 0으로", months[0].month === "2026-06" && months[0].expense === 0, months[0]);
  check("축 이름", months[0].displayMonth === "6월", months[0]);
  check("해를 넘겨도 셈", monthlyHistory(rows, { until: "2026-01", months: 2 })[0].month === "2025-12");
  check("달이 깨져 있으면 빈 목록", monthlyHistory(rows, { until: "" }).length === 0);

  const years = yearlyHistory(rows);
  check("자료가 있는 해만", years.map((y) => y.year).join() === "2025,2026", years.map((y) => y.year));
  check("오래된 해부터", years[0].year === "2025", years.map((y) => y.year));
  check("해 합계", years[1].expense === 500_000, years[1]);
  check("해마다 카테고리 비중", years[1].categories[0].category === "주거", years[1].categories);
}

// ---------------------------------------------------------------------------
section("내역 찾기 — 기간·범위·카테고리·유사 항목 (§12.9)");
// ---------------------------------------------------------------------------
{
  const row = (id: string, date: string, o: any = {}): any => ({
    id,
    accountId: o.acc || "bank",
    date,
    time: "12:00",
    type: o.type || "EXPENSE",
    expenseType: o.et || (o.type === "INCOME" ? "INCOME" : "VARIABLE"),
    category: o.cat || "식비",
    merchant: o.m || "가맹점",
    amount: o.a || 1000,
    paymentMethod: "카드",
    memo: o.memo,
    note: o.note,
  });

  const rows = [
    row("1", "2025-12-05", { m: "스타벅스 강남지점", a: 5_000, cat: "카페/간식" }),
    row("2", "2026-03-10", { m: "스타벅스강남", a: 6_000, cat: "카페/간식" }),
    row("3", "2026-08-01", { m: "서울대병원", a: 120_000, cat: "의료", acc: "card1" }),
    row("4", "2026-08-02", { m: "월세", a: 500_000, cat: "주거", et: "FIXED" }),
    row("5", "2026-08-03", { m: "급여", a: 3_000_000, type: "INCOME", cat: "급여" }),
  ];
  const ids = (q: any) => runQuery(rows, q).map((tx: any) => tx.id).join();

  check("조건이 없으면 전부", ids({}) === "1,2,3,4,5");
  check("기간", ids({ from: "2026-08", to: "2026-08" }) === "3,4,5");
  /* 한쪽만 주면 그 달만 — 사용자가 한 칸만 채우는 일이 흔합니다 */
  check("한쪽만 주면 그 달", ids({ from: "2026-03" }) === "2");
  check("범위(계좌)", ids({ accountIds: ["card1"] }) === "3");
  check("카테고리", ids({ categories: ["카페/간식"] }) === "1,2");
  check("수입만", ids({ direction: "INCOME" }) === "5");
  check("고정비만", ids({ kind: "FIXED" }) === "4");
  /* 고정·변동은 지출의 구분이라 수입 건은 걸리지 않습니다(§9.6) */
  check("고정비 조건에 수입은 안 걸림", !ids({ kind: "FIXED" }).includes("5"));
  check("검색어는 공백을 무시", ids({ text: "스타 벅스" }) === "1,2");
  /*
    **유사 항목은 글자 그대로 비교하지 않습니다.** 명세서가 같은 곳을 지점·
    법인 표기를 붙여 여러 모양으로 적습니다(§10).
  */
  check("이름 모양이 달라도 같은 가맹점", ids({ similarTo: "스타벅스 강남지점" }) === "1,2");
  check("조건을 겹쳐 쓸 수 있음", ids({ from: "2026-01", to: "2026-12", categories: ["의료"] }) === "3");

  const totals = queryTotals(rows);
  check("합계", totals.expense === 631_000 && totals.income === 3_000_000, totals);
  check("순액", totals.net === 2_369_000, totals);

  const csv = toCsv(rows.slice(0, 2), [{ id: "bank", name: "KB, 국민은행" } as any]);
  const lines = csv.split("\r\n");
  check("머리글", lines[0].startsWith("날짜,시각,구분"), lines[0]);
  /*
    **금액에 콤마를 넣지 않습니다.** CSV 는 다시 계산에 쓰이는 파일이고, 콤마가
    든 숫자는 엑셀에서 문자가 됩니다 — `parseInt("1,234")` 가 1이던 것과 같은
    함정입니다(§12.2).
  */
  check("금액은 숫자만", lines[1].includes("5000") && !lines[1].includes("5,000"), lines[1]);
  check("콤마 든 값은 감쌈", lines[1].includes('"KB, 국민은행"'), lines[1]);
  check("따옴표는 두 번으로", toCsv([row("x", "2026-01-01", { m: '가"게' })]).includes('"가""게"'));
  check("파일 이름이 무엇을 담았는지 말함", csvFileName({ categories: ["의료"] }, 3).includes("의료"));
  check("기간이 없으면 전체기간", csvFileName({}, 1).includes("전체기간"));
}

// ---------------------------------------------------------------------------
section("정기 결제 모아 보기 (§12.10)");
// ---------------------------------------------------------------------------
{
  const sub = (month: string, day: string, amount: number, name = "넷플릭스"): any => ({
    id: `${name}${month}`,
    accountId: "card1",
    date: `${month}-${day}`,
    time: "12:00",
    type: "EXPENSE",
    expenseType: "FIXED",
    category: "구독/미디어",
    merchant: name,
    amount,
    paymentMethod: "카드",
  });

  const rows = [
    sub("2026-06", "05", 13_500),
    sub("2026-07", "05", 13_500),
    sub("2026-08", "06", 17_000),
    /* 두 달치뿐인 것은 정기 결제가 아닙니다 — §10 의 3개월 규칙 */
    sub("2026-07", "11", 9_900, "왓챠"),
    sub("2026-08", "11", 9_900, "왓챠"),
  ];

  const items = recurringItems(rows);
  check("3개월 이상만", items.length === 1, items.map((i) => i.merchant));
  check("보여 줄 이름은 최근 것", items[0].merchant === "넷플릭스", items[0]);
  check("결제일", items[0].paymentDay === 5, items[0]);
  /*
    **최근 금액과 평균을 함께** 줍니다. 구독료가 오르면 둘이 벌어지고, 그
    차이가 곧 알아차려야 할 사실입니다.
  */
  check("금액은 가장 최근", items[0].amount === 17_000, items[0]);
  check("평균은 따로", items[0].average === 14_667, items[0].average);
  check("마지막으로 찍힌 날", items[0].lastSeen === "2026-08-06", items[0]);

  /* 두 달 넘게 안 보이면 표시만 합니다 — 목록에서 빼지 않습니다(§17.1) */
  check("오래되면 끊긴 것으로 표시", looksStopped(items[0], new Date("2026-12-01")));
  check("최근이면 아님", !looksStopped(items[0], new Date("2026-09-01")));
  check("날짜가 깨져 있으면 판단하지 않음", !looksStopped({ ...items[0], lastSeen: "어제" }));

  /* 수입은 정기 결제가 아닙니다 — 급여가 목록에 오르면 뜻이 달라집니다 */
  const withSalary = recurringItems([
    ...rows,
    { ...sub("2026-06", "25", 3_000_000, "급여"), type: "INCOME", expenseType: "INCOME" },
    { ...sub("2026-07", "25", 3_000_000, "급여"), type: "INCOME", expenseType: "INCOME" },
    { ...sub("2026-08", "25", 3_000_000, "급여"), type: "INCOME", expenseType: "INCOME" },
  ]);
  check("수입은 빠짐", !withSalary.some((i) => i.merchant === "급여"), withSalary.map((i) => i.merchant));
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
