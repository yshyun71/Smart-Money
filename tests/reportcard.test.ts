/**
 * 한 장으로 보는 결산 (§12.14).
 *
 * 달과 해가 **같은 함수**를 씁니다. 두 벌로 만들면 한쪽만 고쳐지고, 그때
 * 사용자는 어느 숫자가 맞는지 알 수 없습니다 — 이 앱에서 세 번 겪은 일입니다
 * (§11.7 · §9.5 · §12.7). 그래서 여기서 가장 중요한 확인은 **두 범위가 같은
 * 정의를 쓰는가**입니다.
 */
import {
  buildReportCard,
  savingsRate,
  changeRatio,
  TOP_CATEGORIES,
} from "../src/services/reportCard";

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
  accountId: "bank",
  date: "2026-08-03",
  time: "12:00",
  type: "EXPENSE",
  expenseType: "VARIABLE",
  category: "식비",
  merchant: "가맹점",
  amount: 10_000,
  paymentMethod: "계좌",
  ...over,
});

const accounts: any[] = [
  { id: "bank", name: "국민은행", type: "BANK" },
  { id: "card", name: "우리카드", type: "CARD" },
];

const ledger = [
  /* 8월 */
  tx({ date: "2026-08-25", type: "INCOME", expenseType: "FIXED", category: "급여", amount: 3_000_000 }),
  tx({ date: "2026-08-01", expenseType: "FIXED", category: "주거", amount: 700_000 }),
  tx({ date: "2026-08-05", category: "식비", amount: 200_000 }),
  tx({ date: "2026-08-06", category: "쇼핑", amount: 100_000 }),
  tx({ date: "2026-08-10", expenseType: "FIXED", category: "저축", amount: 500_000 }),
  /* 7월 */
  tx({ date: "2026-07-25", type: "INCOME", expenseType: "FIXED", category: "급여", amount: 3_000_000 }),
  tx({ date: "2026-07-01", expenseType: "FIXED", category: "주거", amount: 700_000 }),
  tx({ date: "2026-07-05", category: "식비", amount: 150_000 }),
];

// ---------------------------------------------------------------------------
section("한 달");
// ---------------------------------------------------------------------------
{
  const card = buildReportCard({ transactions: ledger, accounts, key: "2026-08" });

  check("범위를 키로 가립니다", card.scope === "MONTH");
  check("이름", card.label === "2026년 08월", card.label);
  check("건수", card.now.count === 5, card.now.count);
  check("수입", card.now.income === 3_000_000);
  check("지출", card.now.expense === 1_500_000, card.now.expense);
  check("남은 돈", card.now.left === 1_500_000);

  /*
    예산 화면과 같은 정의여야 합니다(§11.4) — 고정비에서 저축을 빼지 않으면
    같은 돈이 두 번 세어집니다.
  */
  check("고정비에서 저축을 뺍니다", card.now.fixed === 700_000, card.now.fixed);
  check("저축은 계좌에서 나간 것만", card.now.savings === 500_000);
  check("변동비", card.now.variable === 300_000, card.now.variable);
  check(
    "고정 + 변동 + 저축 = 총지출",
    card.now.fixed + card.now.variable + card.now.savings === card.now.expense
  );
  check("고정수입", card.now.incomeFixed === 3_000_000);

  check("앞 달을 함께 냅니다", card.before?.key === "2026-07");
  check("지출 차이", card.change?.expense === 650_000, card.change?.expense);
  check("수입 차이 0", card.change?.income === 0);

  check("카테고리는 금액 큰 순", card.categories[0]?.category === "주거", card.categories);
  check("비중은 지출 기준", Math.round(card.categories[0]?.percentage || 0) === 47);
  check("달을 볼 때 달별 줄은 없습니다", card.months.length === 0);

  /* 앞 기간에 자료가 없으면 지어내지 않습니다 */
  const first = buildReportCard({ transactions: ledger, accounts, key: "2026-07" });
  check("앞 달 자료가 없으면 null", first.before === null);
  check("차이도 null", first.change === null);
}

// ---------------------------------------------------------------------------
section("한 해 — 같은 함수, 키만 다릅니다");
// ---------------------------------------------------------------------------
{
  const card = buildReportCard({ transactions: ledger, accounts, key: "2026" });

  check("범위", card.scope === "YEAR");
  check("이름", card.label === "2026년");
  check("한 해 전부", card.now.count === 8, card.now.count);
  check("수입 합", card.now.income === 6_000_000);
  check("지출 합", card.now.expense === 2_350_000, card.now.expense);
  check(
    "여기서도 고정 + 변동 + 저축 = 총지출",
    card.now.fixed + card.now.variable + card.now.savings === card.now.expense
  );

  check("열두 달을 모두 남깁니다", card.months.length === 12);
  check("내역이 없는 달도 0 으로", card.months[0]?.expense === 0);
  check("8월이 여덟 번째", card.months[7]?.key === "2026-08");
  check("가장 많이 쓴 달", card.peak?.key === "2026-08", card.peak?.key);

  /* 해의 앞 기간은 지난해입니다 */
  check("지난해 자료가 없으면 null", card.before === null);

  const withLastYear = buildReportCard({
    transactions: [...ledger, tx({ date: "2025-05-01", amount: 1_000_000 })],
    accounts,
    key: "2026",
  });
  check("지난해가 있으면 견줍니다", withLastYear.before?.key === "2025");
  check("지난해와의 차이", withLastYear.change?.expense === 1_350_000, withLastYear.change?.expense);
}

// ---------------------------------------------------------------------------
section("환불은 그 기간에 돌아온 것만");
// ---------------------------------------------------------------------------
{
  const rows = [
    ...ledger,
    tx({ id: "c", date: "2026-08-11", merchant: "무신사", amount: 40_000, category: "쇼핑" }),
    tx({
      id: "r",
      date: "2026-08-18",
      merchant: "무신사환불",
      amount: 40_000,
      type: "INCOME",
      category: "기타수입",
    }),
  ];

  const august = buildReportCard({ transactions: rows, accounts, key: "2026-08" });
  check("그 달 환불을 셉니다", august.refunds.count === 1, august.refunds);
  check("금액", august.refunds.amount === 40_000);

  const july = buildReportCard({ transactions: rows, accounts, key: "2026-07" });
  check("다른 달에는 없습니다", july.refunds.count === 0);

  const year = buildReportCard({ transactions: rows, accounts, key: "2026" });
  check("한 해로 보면 그 안에 듭니다", year.refunds.count === 1);
}

// ---------------------------------------------------------------------------
section("나누는 값은 지어내지 않습니다");
// ---------------------------------------------------------------------------
{
  const card = buildReportCard({ transactions: ledger, accounts, key: "2026-08" });
  check("남긴 비율", Math.round(savingsRate(card.now) || 0) === 50, savingsRate(card.now));

  /* 수입이 0이면 비율이 없습니다 — 0% 도 ∞ 도 거짓입니다(§17.1) */
  check("수입이 없으면 null", savingsRate({ ...card.now, income: 0, left: -500 }) === null);

  check("증감률", Math.round(changeRatio(150, 100) || 0) === 50);
  check("앞이 0이면 null", changeRatio(150, 0) === null);

  check("카테고리는 몇 줄까지", TOP_CATEGORIES === 6);
  const many = buildReportCard({
    transactions: Array.from({ length: 10 }, (_, index) =>
      tx({ date: "2026-08-02", category: `분류${index}`, amount: (index + 1) * 1_000 })
    ),
    accounts,
    key: "2026-08",
  });
  check("한 장에 담길 만큼만", many.categories.length === TOP_CATEGORIES, many.categories.length);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
