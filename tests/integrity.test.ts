/**
 * 쓰기 전 검증(§17.7)과 이미 들어온 것의 점검.
 *
 * 실제 기기에서 `2026-26-08` 같은 **불가능한 날짜 46건**이 나왔습니다. 카드 명세서의
 * 두 자리 연도를 읽지 못했던 때(§7.5) 들어온 줄이고, 파서를 고쳐도 **그 줄은 그대로
 * 남습니다.** 그 46건은 어느 달 합계에도 들어가지 않고 연월 선택 창으로도 닿을 수
 * 없었습니다 — 있는 줄 모르면 영원히 못 찾는 데이터였습니다.
 *
 * 여기서 지키는 것 둘: **그런 값이 다시 들어오지 못할 것**, 그리고 **이미 들어온 것
 * 중 지워도 되는 것만 지울 것**.
 */
import {
  checkTransaction,
  isValidAmount,
  isValidDate,
  isValidMonth,
  isValidTime,
  describeProblems,
  siftTransactions,
} from "../src/services/validate";
import {
  inspect,
  zombies,
  tally,
  guessedMonth,
  FLAW_LABELS,
} from "../src/services/integrity";

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
  merchant: "스타벅스",
  amount: 5_500,
  paymentMethod: "카드",
  ...over,
});

const account = (id: string, type = "CARD"): any => ({
  id,
  name: id,
  type,
  institution: id,
});

// ---------------------------------------------------------------------------
section("날짜 — 실제로 있는 날만");
// ---------------------------------------------------------------------------
{
  check("보통의 날", isValidDate("2026-08-03"));
  check("말일", isValidDate("2026-08-31"));

  /* 46건을 만든 값입니다 — 달 자리에 연도가 들어갔습니다 */
  check("2026-26-08 을 막습니다", isValidDate("2026-26-08") === false);
  check("2026-25-12 도", isValidDate("2026-25-12") === false);

  check("13월", isValidDate("2026-13-01") === false);
  check("0월", isValidDate("2026-00-05") === false);
  check("32일", isValidDate("2026-08-32") === false);
  check("0일", isValidDate("2026-08-00") === false);
  /* 그 달에 없는 날 — `Date` 로 파싱하면 3월 2일로 굴러갑니다 */
  check("2월 30일", isValidDate("2026-02-30") === false);
  check("윤년 아닌 2월 29일", isValidDate("2027-02-29") === false);
  check("윤년 2월 29일은 있음", isValidDate("2028-02-29"));
  check("30일까지인 달의 31일", isValidDate("2026-04-31") === false);

  check("형식이 다르면", isValidDate("2026.08.03") === false);
  check("자릿수가 모자라면", isValidDate("2026-8-3") === false);
  check("빈 값", isValidDate("") === false);
  check("옛 연도", isValidDate("1999-08-03") === false);
  check("먼 미래 연도", isValidDate("2101-08-03") === false);
}

// ---------------------------------------------------------------------------
section("결제월 · 시각 · 금액");
// ---------------------------------------------------------------------------
{
  check("결제월", isValidMonth("2026-09"));
  check("13월 결제월", isValidMonth("2026-13") === false);
  check("일자가 붙으면", isValidMonth("2026-09-01") === false);

  check("시각", isValidTime("09:30"));
  check("비어 있어도 됩니다", isValidTime(""));
  check("24시", isValidTime("24:00") === false);
  check("60분", isValidTime("12:60") === false);
  check("한 자리", isValidTime("9:30") === false);

  check("금액", isValidAmount(5_500));
  check("0원도 있습니다", isValidAmount(0));
  check("음수는 방향으로 적습니다", isValidAmount(-100) === false);
  check("NaN", isValidAmount(Number.NaN) === false);
  check("Infinity", isValidAmount(Number.POSITIVE_INFINITY) === false);
  check("글자", isValidAmount("5500") === false);
}

// ---------------------------------------------------------------------------
section("한 거래 — 어느 칸이 왜 안 되는지 말합니다");
// ---------------------------------------------------------------------------
{
  check("멀쩡한 거래는 문제 없음", checkTransaction(tx()).length === 0, checkTransaction(tx()));

  const bad = checkTransaction(tx({ date: "2026-26-08" }));
  check("날짜를 짚습니다", bad.length === 1 && bad[0].field === "date", bad);
  check("값을 담아 말합니다", bad[0].message.includes("2026-26-08"), bad[0].message);

  check("계좌가 없으면", checkTransaction(tx({ accountId: "" })).some((p) => p.field === "accountId"));
  check("내역명이 없으면", checkTransaction(tx({ merchant: "  " })).some((p) => p.field === "merchant"));
  check("카테고리가 없으면", checkTransaction(tx({ category: "" })).some((p) => p.field === "category"));
  check("방향이 이상하면", checkTransaction(tx({ type: "TRANSFER" })).some((p) => p.field === "type"));

  /* 고정비·변동비는 지출의 구분입니다(§9.6) */
  check(
    "수입에 고정비를 붙이지 않습니다",
    checkTransaction(tx({ type: "INCOME", expenseType: "FIXED" })).some(
      (p) => p.field === "expenseType"
    )
  );
  check(
    "수입에 INCOME 은 맞습니다",
    checkTransaction(tx({ type: "INCOME", expenseType: "INCOME", category: "급여" })).length === 0
  );
  check(
    "지출에 INCOME 은 아닙니다",
    checkTransaction(tx({ expenseType: "INCOME" })).some((p) => p.field === "expenseType")
  );

  /* 여러 문제를 함께 돌려주고, 화면에는 한 줄로 요약합니다 */
  const many = checkTransaction(tx({ date: "", amount: -1, accountId: "" }));
  check("여러 문제를 모두", many.length === 3, many.length);
  check("한 줄 요약", describeProblems(many).includes("그리고 2가지 더"), describeProblems(many));
  check("문제가 없으면 빈 글자", describeProblems([]) === "");
}

// ---------------------------------------------------------------------------
section("여럿 가르기 — 한 줄 때문에 전부 막지 않습니다");
// ---------------------------------------------------------------------------
{
  const rows = [tx(), tx({ date: "2026-26-08" }), tx(), tx({ amount: Number.NaN })];
  const sifted = siftTransactions(rows);

  check("들일 것", sifted.ok.length === 2, sifted.ok.length);
  check("못 들인 것", sifted.rejected.length === 2, sifted.rejected.length);
  check("까닭을 함께", sifted.rejected[0].problems[0].field === "date");
  check("빈 목록", siftTransactions([]).ok.length === 0);
}

// ---------------------------------------------------------------------------
section("이미 들어온 것 점검 — 실제 기기에서 나온 모습");
// ---------------------------------------------------------------------------
{
  /*
    실제로 있었던 일: KB국민카드 명세서를 은행 계좌로 넣었고, 그때 두 자리 연도를
    읽지 못해 날짜가 깨졌습니다. 그 뒤 같은 명세서를 카드 계좌에 제대로 넣었습니다.
    그래서 깨진 줄은 **잘못된 계좌에 있는, 사본이 있는, 닿을 수 없는** 줄입니다.
  */
  const accounts = [account("bank", "BANK"), account("card")];
  const broken = tx({
    id: "broken",
    accountId: "bank",
    date: "2026-26-08",
    merchant: "쿠팡(쿠페이)-쿠팡(쿠페이)",
    amount: 27_200,
  });
  const proper = tx({
    id: "proper",
    accountId: "card",
    date: "2026-08-14",
    merchant: "쿠팡(쿠페이)-쿠팡(쿠페이)",
    amount: 27_200,
  });

  const flaws = inspect({ transactions: [broken, proper], accounts });
  check("깨진 날짜를 찾습니다", flaws.length === 1 && flaws[0].kind === "BAD_DATE", flaws);
  check("사본을 가리킵니다", flaws[0].duplicateOf === "proper", flaws[0]);
  check("지워도 되는 것으로 셉니다", zombies(flaws).length === 1);

  /* 사본이 없으면 그 줄이 유일한 기록입니다 — 지우지 않습니다 */
  const alone = inspect({ transactions: [broken], accounts });
  check("사본이 없으면 근거가 없습니다", alone[0].duplicateOf === undefined);
  check("그래서 지우지 않습니다", zombies(alone).length === 0);

  /* 금액이나 이름이 다르면 같은 지출이 아닙니다 */
  const other = inspect({
    transactions: [broken, tx({ id: "x", accountId: "card", amount: 27_201 })],
    accounts,
  });
  check("금액이 다르면 사본이 아닙니다", zombies(other).length === 0);

  /* 공백만 다른 이름은 같은 지출입니다 */
  const spaced = inspect({
    transactions: [
      broken,
      tx({ id: "y", accountId: "card", merchant: "쿠팡 (쿠페이) - 쿠팡(쿠페이)", amount: 27_200 }),
    ],
    accounts,
  });
  check(
    "공백만 다른 이름은 같은 지출",
    zombies(spaced).length === 1,
    zombies(spaced).length
  );
}

// ---------------------------------------------------------------------------
section("고칠 것과 버릴 것을 가릅니다 (§17.3)");
// ---------------------------------------------------------------------------
{
  const accounts = [account("bank", "BANK"), account("card")];
  const now = new Date(2026, 8, 22);

  /* 고아 — 합계에는 잡히는데 화면에서 열 수 없습니다 */
  const orphan = inspect({ transactions: [tx({ accountId: "gone" })], accounts, today: now });
  check("고아를 찾습니다", orphan.some((f) => f.kind === "ORPHAN"));
  check("고아는 지우지 않습니다", zombies(orphan).length === 0);

  /* 미래 — 앞당겨 적은 거래는 정상입니다 */
  const future = inspect({
    transactions: [tx({ date: "2026-12-25" })],
    accounts,
    today: now,
  });
  check("미래 날짜를 찾습니다", future.some((f) => f.kind === "FUTURE"));
  check("미래는 지우지 않습니다", zombies(future).length === 0);
  check(
    "오늘은 미래가 아닙니다",
    inspect({ transactions: [tx({ date: "2026-09-22" })], accounts, today: now }).length === 0
  );

  /* 카드에 붙은 저축 — 진짜 지출이 담겨 있으니 고칠 것입니다 */
  const saving = inspect({
    transactions: [tx({ accountId: "card", category: "저축" })],
    accounts,
    today: now,
  });
  check("카드에 붙은 저축을 찾습니다", saving.some((f) => f.kind === "CARD_SAVINGS"));
  check("그것도 지우지 않습니다", zombies(saving).length === 0);
  check(
    "계좌의 저축은 정상입니다",
    inspect({
      transactions: [tx({ accountId: "bank", category: "저축" })],
      accounts,
      today: now,
    }).length === 0
  );

  /* 결제월 오류 */
  const billing = inspect({
    transactions: [tx({ billingMonth: "2026-26" })],
    accounts,
    today: now,
  });
  check("결제월 오류를 찾습니다", billing.some((f) => f.kind === "BAD_BILLING"));

  check("멀쩡하면 아무것도", inspect({ transactions: [tx()], accounts, today: now }).length === 0);
}

// ---------------------------------------------------------------------------
section("종류별로 세기");
// ---------------------------------------------------------------------------
{
  const accounts = [account("bank", "BANK"), account("card")];
  const rows = [
    tx({ id: "a", date: "2026-26-08", amount: 1_000 }),
    tx({ id: "b", date: "2026-08-08", amount: 1_000 }),
    tx({ id: "c", date: "2026-26-09", amount: 9_999 }),
    tx({ id: "d", accountId: "gone" }),
  ];
  const rolled = tally(inspect({ transactions: rows, accounts, today: new Date(2026, 8, 22) }));

  const badDate = rolled.find((row) => row.kind === "BAD_DATE");
  check("깨진 날짜 2건", badDate?.count === 2, rolled);
  check("그중 사본이 있는 1건만 지울 수 있음", badDate?.removable === 1, badDate);
  check("고아도 셉니다", rolled.some((row) => row.kind === "ORPHAN" && row.removable === 0));
  check("없는 종류는 빼고", rolled.every((row) => row.count > 0));
  check("모든 종류에 이름이 있습니다", rolled.every((row) => Boolean(FLAW_LABELS[row.kind])));
  check("멀쩡하면 빈 목록", tally([]).length === 0);
}

// ---------------------------------------------------------------------------
section("원래 어느 달이었을지 — 보여 주기만 합니다");
// ---------------------------------------------------------------------------
{
  /*
    `26.08.03` 을 `2026-26-08` 로 적었으니 **달 자리에 연도, 날 자리에 달**이
    들어갔습니다. 달은 되살리고 **날은 잃었습니다** — 그래서 고쳐 쓰지 않습니다.
  */
  check("달을 되살립니다", guessedMonth("2026-26-08") === "2026-08", guessedMonth("2026-26-08"));
  check("다른 해도", guessedMonth("2025-25-12") === "2025-12");

  /* 규칙이 맞아떨어지지 않으면 답하지 않습니다 */
  check("연도가 안 맞으면", guessedMonth("2026-25-08") === "");
  check("날 자리가 달이 아니면", guessedMonth("2026-26-20") === "");
  check("멀쩡한 날짜에는", guessedMonth("2026-08-03") === "");
  check("빈 값", guessedMonth("") === "");
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
