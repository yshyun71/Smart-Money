/**
 * AI 분석이 아직 지금의 가계부를 말하고 있는가 (11.6).
 *
 * 분석은 누른 순간의 스냅샷입니다. 그 뒤에 명세서를 더 가져오면 건강도와 절약
 * 가능액은 옛 데이터에서 나온 값이 되는데, 화면이 말하지 않으면 알 방법이
 * 없습니다. 여기서 지키는 것은 **달라진 것을 정확히 세고, 모르면 모른다고 할 것**
 * 입니다.
 */
import {
  basisOf,
  driftSince,
  describeWhen,
  type AnalysisBasis,
} from "../src/services/analysisFreshness";

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
  amount: number,
  options: { type?: string; month?: string; createdAt?: string } = {}
): any => ({
  id: `t${serial++}`,
  accountId: "bank",
  date: `${options.month || "2026-08"}-10`,
  time: "12:00",
  type: options.type || "EXPENSE",
  expenseType: options.type === "INCOME" ? "INCOME" : "VARIABLE",
  category: "식비",
  merchant: "가맹점",
  amount,
  paymentMethod: "카드",
  createdAt: options.createdAt,
});

const ANALYSED_AT = "2026-09-10T09:00:00.000Z";
const BEFORE = "2026-09-01T09:00:00.000Z";
const AFTER = "2026-09-15T09:00:00.000Z";

// ---------------------------------------------------------------------------
section("기준 — 무엇을 보고 만든 분석인가");
// ---------------------------------------------------------------------------
{
  const rows = [
    tx(100_000),
    tx(200_000),
    tx(3_000_000, { type: "INCOME" }),
    tx(999_999, { month: "2026-07" }),
  ];

  const basis = basisOf(rows, "2026-08");
  check("그 달만 셉니다", basis.entries === 3, basis);
  check("지출 합계", basis.expense === 300_000, basis);
  check("수입 합계", basis.income === 3_000_000, basis);
  check("달이 기록됩니다", basis.month === "2026-08", basis);
}

// ---------------------------------------------------------------------------
section("분석 이후 들어온 내역");
// ---------------------------------------------------------------------------
{
  const before = [
    tx(100_000, { createdAt: BEFORE }),
    tx(200_000, { createdAt: BEFORE }),
  ];
  const basis = basisOf(before, "2026-08");

  const after = [...before, tx(50_000, { createdAt: AFTER }), tx(70_000, { createdAt: AFTER })];
  const drift = driftSince({
    transactions: after,
    month: "2026-08",
    basis,
    savedAt: ANALYSED_AT,
  });

  check("2건 추가", drift?.added === 2, drift);
  check("삭제는 없음", drift?.removed === 0, drift);
  check("낡았다고 말함", drift?.stale === true, drift);
  check("지출이 늘어난 만큼", drift?.expenseDelta === 120_000, drift);
  check("지금 지출", drift?.expense === 420_000, drift);
  check("문구", drift?.headline === "분석 이후 2건이 추가되었습니다", drift?.headline);

  /*
    `createdAt` 은 DB 에 들어온 시각이지 거래 날짜가 아닙니다. 지난달 명세서를
    오늘 가져오면 날짜는 지난달이어도 분석 이후에 들어온 것이 맞습니다.
  */
  const late = driftSince({
    transactions: [...before, tx(80_000, { month: "2026-08", createdAt: AFTER })],
    month: "2026-08",
    basis,
    savedAt: ANALYSED_AT,
  });
  check("옛날 날짜라도 나중에 들어왔으면 추가", late?.added === 1, late);
}

// ---------------------------------------------------------------------------
section("삭제와 수정은 흔적을 남기지 않습니다");
// ---------------------------------------------------------------------------
{
  const before = [
    tx(100_000, { createdAt: BEFORE }),
    tx(200_000, { createdAt: BEFORE }),
    tx(300_000, { createdAt: BEFORE }),
  ];
  const basis = basisOf(before, "2026-08");

  // 한 건을 지웠습니다 — 그때의 숫자와 견주는 수밖에 없습니다
  const deleted = driftSince({
    transactions: before.slice(0, 2),
    month: "2026-08",
    basis,
    savedAt: ANALYSED_AT,
  });
  check("1건 삭제", deleted?.removed === 1 && deleted?.added === 0, deleted);
  check("삭제 문구", deleted?.headline === "분석 이후 1건이 삭제되었습니다", deleted?.headline);
  check("줄어든 지출", deleted?.expenseDelta === -300_000, deleted);

  /*
    **추가와 삭제가 함께 일어나면 상쇄되면 안 됩니다.** 건수만 견주면 3건이
    들어오고 3건이 빠져도 "변화 없음"이 되는데, 그 달 합계는 전혀 다릅니다.
  */
  const both = driftSince({
    transactions: [
      before[0],
      tx(500_000, { createdAt: AFTER }),
      tx(600_000, { createdAt: AFTER }),
    ],
    month: "2026-08",
    basis,
    savedAt: ANALYSED_AT,
  });
  check("추가 2건", both?.added === 2, both);
  check("삭제 2건", both?.removed === 2, both);
  check(
    "둘 다 말합니다",
    both?.headline === "분석 이후 2건이 추가되고 2건이 삭제되었습니다",
    both?.headline
  );

  // 건수는 그대로인데 금액만 고친 경우
  const edited = driftSince({
    transactions: [before[0], before[1], tx(999_000, { createdAt: BEFORE })],
    month: "2026-08",
    basis,
    savedAt: ANALYSED_AT,
  });
  check("수정으로 잡힘", edited?.edited === true, edited);
  check("수정 문구", edited?.headline === "분석 이후 내역이 수정되었습니다", edited?.headline);
}

// ---------------------------------------------------------------------------
section("바뀐 것이 없으면 조용합니다");
// ---------------------------------------------------------------------------
{
  const rows = [tx(100_000, { createdAt: BEFORE }), tx(200_000, { createdAt: BEFORE })];
  const drift = driftSince({
    transactions: rows,
    month: "2026-08",
    basis: basisOf(rows, "2026-08"),
    savedAt: ANALYSED_AT,
  });
  check("낡지 않음", drift?.stale === false, drift);
  check("차이 0", drift?.expenseDelta === 0 && drift?.incomeDelta === 0, drift);
}

// ---------------------------------------------------------------------------
section("모르면 모른다고 합니다");
// ---------------------------------------------------------------------------
{
  /*
    견줄 근거가 하나도 없으면 `null` 입니다. 모르는 것을 "변화 없음"이라고
    말하면 그것이 곧 거짓말이고, 화면은 아무 말도 하지 않습니다(§17.1).
  */
  const blind = driftSince({ transactions: [tx(100_000)], month: "2026-08" });
  check("근거가 없으면 null", blind === null, blind);

  /*
    옛 분석에는 `basis` 가 없습니다. 그래도 행의 `updated_at` 이 시각을
    대신하므로 **들어온 건은 셀 수 있습니다** — 삭제·수정만 모릅니다.
  */
  const legacy = driftSince({
    transactions: [
      tx(100_000, { createdAt: BEFORE }),
      tx(50_000, { createdAt: AFTER }),
    ],
    month: "2026-08",
    savedAt: ANALYSED_AT,
  });
  check("시각만 있어도 추가는 셉니다", legacy?.added === 1, legacy);
  check("모르는 삭제는 0", legacy?.removed === 0, legacy);
  check("모르는 금액 차이는 0", legacy?.expenseDelta === 0, legacy);

  /*
    다른 달의 기준은 쓰지 않습니다. 8월 분석에 9월 기준을 들이대면 그 차이가
    모두 "달라진 것"으로 잡힙니다.
  */
  const wrongMonth: AnalysisBasis = { month: "2026-07", entries: 99, income: 0, expense: 0 };
  const mismatched = driftSince({
    transactions: [tx(100_000, { createdAt: BEFORE })],
    month: "2026-08",
    basis: wrongMonth,
    savedAt: ANALYSED_AT,
  });
  check("다른 달 기준은 무시", mismatched?.removed === 0 && !mismatched?.stale, mismatched);

  // createdAt 이 없는 줄(직접 추가 등)은 "나중에 들어온 것"으로 세지 않습니다
  const noStamp = driftSince({
    transactions: [tx(100_000)],
    month: "2026-08",
    savedAt: ANALYSED_AT,
  });
  check("시각 없는 줄은 추가로 세지 않음", noStamp?.added === 0, noStamp);
}

// ---------------------------------------------------------------------------
section("언제 분석했는지 사람 말로");
// ---------------------------------------------------------------------------
{
  const now = new Date("2026-09-18T12:00:00.000Z");
  check("방금", describeWhen("2026-09-18T11:59:40.000Z", now) === "방금");
  check("분", describeWhen("2026-09-18T11:20:00.000Z", now) === "40분 전");
  check("시간", describeWhen("2026-09-18T06:00:00.000Z", now) === "6시간 전");
  check("일", describeWhen("2026-09-16T12:00:00.000Z", now) === "2일 전");
  // 일주일이 넘으면 날짜가 더 쓸모 있습니다
  check("오래되면 날짜", describeWhen("2026-08-30T12:00:00.000Z", now).startsWith("2026. 08."));
  check("없으면 빈 문자열", describeWhen(undefined, now) === "");
  check("깨진 값도 빈 문자열", describeWhen("어제", now) === "");
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
