/**
 * 숫자의 뿌리 세 가지 — 카테고리 판정(§6.2·6.4) · 고정비 판정(§10) · 잔액 산식(§8).
 *
 * 셋 다 순수 함수인데 오래도록 회귀 세트가 없었습니다. 일회용 하네스로만
 * 확인했고(§15.2), 그것은 **지금 아무것도 지켜 주지 않는다**는 뜻입니다. 이
 * 셋이 틀리면 화면 어디에도 오류가 뜨지 않은 채 모든 합계가 조용히 틀립니다.
 */
import {
  patternToRegex,
  ruleMatches,
  pickRule,
  userRulesOnly,
  suggestPattern,
  isCardPayment,
  financeCategoryFor,
  builtInCategoryFor,
  resolveCategory,
} from "../src/services/categoryRules";
import {
  normaliseMerchant,
  buildRecurrenceIndex,
  recurrenceFor,
  describeRecurrence,
} from "../src/services/recurrence";
import {
  entryMoment,
  movesBalance,
  signedAmount,
  planBalanceAdjustment,
} from "../src/services/balance";
import { isValidPinFormat, hashPin, checkPin } from "../src/services/pinCrypto";
import {
  formatSignature,
  recallMapping,
  rememberMapping,
  forgetMapping,
} from "../src/services/statementFormats";
import { pendingNotifications } from "../src/services/notify";
import {
  expiredUndoIds,
  normaliseRetention,
  canUndo,
  describeUndo,
  DEFAULT_UNDO_DAYS,
} from "../src/services/undo";

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
const rule = (
  pattern: string,
  category: string,
  source: "USER" | "AI",
  options: { accountId?: string; updatedAt?: string } = {}
): any => ({
  id: `r${serial++}`,
  accountId: options.accountId || "acc-1",
  pattern,
  category,
  source,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: options.updatedAt || "2026-01-01T00:00:00.000Z",
});

const tx = (merchant: string, date: string, amount: number, type = "EXPENSE"): any => ({
  id: `t${serial++}`,
  accountId: "acc-1",
  date,
  time: "12:00",
  type,
  expenseType: type === "INCOME" ? "INCOME" : "VARIABLE",
  category: "기타지출",
  merchant,
  amount,
  paymentMethod: "카드",
});

// ---------------------------------------------------------------------------
section("패턴 — 포함 매칭, `*`, 공백·대소문자 무시");
// ---------------------------------------------------------------------------
{
  check("포함하면 맞음", ruleMatches("스타벅스", "스타벅스 강남점"));
  check("공백을 무시", ruleMatches("스타 벅스", "스타벅스강남점"));
  check("대소문자를 무시", ruleMatches("STARBUCKS", "starbucks gangnam"));
  check("`*`는 임의 문자열", ruleMatches("코웨이렌탈*", "코웨이렌탈08"));
  check("`*`가 가운데에서도", ruleMatches("코웨이*08", "코웨이렌탈08"));
  check("다른 이름은 맞지 않음", !ruleMatches("스타벅스", "투썸플레이스"));
  /*
    정규식 특수문자가 든 이름이 패턴으로 들어올 수 있습니다 — `(주)`, `[청구]`.
    이스케이프하지 않으면 정규식이 깨지거나 엉뚱한 것을 맞힙니다.
  */
  check("괄호가 든 이름", ruleMatches("(주)엔에스", "(주)엔에스쇼핑"));
  check("대괄호가 든 이름", ruleMatches("차감-[청구할인]", "차감-[청구할인] 청호나이스"));
  check("점은 임의 문자가 아님", !ruleMatches("a.c", "abc"));
  check("빈 패턴은 맞지 않음", !ruleMatches("", "무엇이든"));
  check("정규식으로 변환됨", patternToRegex("스타*") instanceof RegExp);
}

// ---------------------------------------------------------------------------
section("규칙 우선순위 — USER > 더 긴 패턴 > 최근 수정 (§6.4)");
// ---------------------------------------------------------------------------
{
  const rules = [
    rule("스타벅스", "카페/간식", "AI"),
    rule("스타", "기타지출", "USER"),
  ];
  /*
    **사람이 확인한 규칙이 AI 규칙을 이깁니다.** 패턴이 더 짧아도 그렇습니다 —
    그 구분을 두는 이유가 그것입니다.
  */
  check("USER 가 AI 를 이김", pickRule(rules, "스타벅스 강남점")?.category === "기타지출");

  const sameSource = [
    rule("스타", "기타지출", "USER"),
    rule("스타벅스", "카페/간식", "USER"),
  ];
  check(
    "같은 등급이면 더 긴 패턴",
    pickRule(sameSource, "스타벅스 강남점")?.category === "카페/간식"
  );

  const sameLength = [
    rule("스타벅스", "카페/간식", "USER", { updatedAt: "2026-01-01T00:00:00.000Z" }),
    rule("스타벅스", "식비", "USER", { updatedAt: "2026-06-01T00:00:00.000Z" }),
  ];
  check("같은 길이면 최근 수정", pickRule(sameLength, "스타벅스")?.category === "식비");

  // 계좌가 주어지면 그 계좌의 규칙만 봅니다
  const perAccount = [rule("스타벅스", "카페/간식", "USER", { accountId: "acc-2" })];
  check("다른 계좌의 규칙은 안 씀", pickRule(perAccount, "스타벅스", "acc-1") === null);
  check("같은 계좌면 씀", pickRule(perAccount, "스타벅스", "acc-2")?.category === "카페/간식");
  check("계좌를 주지 않으면 전부", pickRule(perAccount, "스타벅스")?.category === "카페/간식");

  check("맞는 규칙이 없으면 null", pickRule(rules, "이마트") === null);
  check("USER 만 골라내기", userRulesOnly(rules).length === 1);
}

// ---------------------------------------------------------------------------
section("카드대금 판별 — 카드사 바로 뒤에 `카드` (§6.3)");
// ---------------------------------------------------------------------------
{
  for (const name of [
    "KB카드",
    "우리카드출금",
    "삼성카드결재",
    "롯데카드1234",
    "1234 신한카드",
    "현대카드",
    "비씨카드",
    "NH카드",
  ]) {
    check(`카드대금: ${name}`, isCardPayment(name));
  }

  /*
    **카드사 이름이 없으면 카드대금이 아닙니다.** `체크카드출금` 은 어느 카드의
    대금인지 말하지 않으므로 연결할 근거가 없습니다(§17.2).
  */
  check("체크카드출금은 아님", !isCardPayment("체크카드출금"));
  check("카드포인트는 아님", !isCardPayment("카드포인트몰"));
  check("가맹점 이름은 아님", !isCardPayment("스타벅스 강남점"));
}

// ---------------------------------------------------------------------------
section("금융 카테고리 — 좁은 것이 먼저 (§6.3)");
// ---------------------------------------------------------------------------
{
  check("보험", financeCategoryFor("메트라이프생명보험") === "보험");
  check("대출", financeCategoryFor("주택담보대출이자") === "대출");
  /*
    **`저축`이 `기타 금융`보다 먼저입니다.** 적금·청약은 모아 두는 돈이고
    펀드·증권은 굴리는 돈이라 서로 다른 자리에 섭니다(§6.3).
  */
  check("적금은 저축", financeCategoryFor("정기적금 자동이체") === "저축");
  check("청약은 저축", financeCategoryFor("주택청약저축") === "저축");
  check("펀드는 기타 금융", financeCategoryFor("미래에셋펀드") === "기타 금융");
  check("아무것도 아니면 null", financeCategoryFor("스타벅스") === null);
}

// ---------------------------------------------------------------------------
section("판정 우선순위 — 절대 바꾸지 말 것 (§6.2)");
// ---------------------------------------------------------------------------
{
  const rules = [
    rule("KB카드", "기타지출", "USER"),
    rule("스타벅스", "식비", "AI"),
  ];

  // 1) 사용자 규칙이 앱의 자체 판별을 이깁니다
  check("USER 규칙 > 자체 판별", resolveCategory(rules, "KB카드 출금") === "기타지출");

  // 2) 사용자 규칙이 없으면 자체 판별
  check("자체 판별 > AI 규칙", resolveCategory([rules[1]], "KB카드 출금") === "카드대금");

  // 3) 둘 다 없으면 AI 규칙
  check("마지막이 AI 규칙", resolveCategory(rules, "스타벅스 강남점") === "식비");
  check("아무것도 없으면 null", resolveCategory([], "이름없는가게") === null);

  /*
    **입금 건에는 자체 판별을 적용하지 않습니다.** `예금이자` 는 나가면 대출
    관련이지만 들어오면 수입이고, **방향만이** 그 둘을 가릅니다(§6.2).
  */
  check("입금에는 자체 판별 없음", builtInCategoryFor("예금이자", true) === null);
  check("지출이면 적용", builtInCategoryFor("예금이자", false) !== null);
  check(
    "입금이면 AI 규칙까지 내려감",
    resolveCategory([rule("예금이자", "기타수입", "AI")], "예금이자", undefined, true) ===
      "기타수입"
  );
}

// ---------------------------------------------------------------------------
section("패턴 제안 — 끝자리 숫자를 뗍니다");
// ---------------------------------------------------------------------------
{
  check("끝 숫자 제거", suggestPattern("코웨이렌탈08") === "코웨이렌탈*");
  check("숫자가 없으면 그대로", suggestPattern("스타벅스") === "스타벅스");
  check("빈 값은 빈 값", suggestPattern("") === "");
}

// ---------------------------------------------------------------------------
section("고정비 판정 — 3개월·같은 날짜대 (§10)");
// ---------------------------------------------------------------------------
{
  /*
    명세서가 같은 가맹점을 여러 모양으로 적습니다 — 괄호 속 법인 표기, 지점
    접미사, 승인번호, 공백. 같은 것으로 묶이지 않으면 반복을 볼 수 없습니다.
  */
  check("공백·대소문자", normaliseMerchant("SK  텔레콤") === normaliseMerchant("sk텔레콤"));
  check("괄호는 내용까지", normaliseMerchant("(주)엔에스쇼핑") === normaliseMerchant("엔에스쇼핑"));
  check("지점 접미사", normaliseMerchant("스타벅스 강남지점") === normaliseMerchant("스타벅스강남"));
  /* 세 자리 이상만 승인번호로 봅니다 — `코웨이렌탈08` 의 `08` 은 회차일 수 있습니다 */
  check("승인번호 제거", normaliseMerchant("코웨이렌탈0812") === normaliseMerchant("코웨이렌탈"));
  check("두 자리는 남김", normaliseMerchant("코웨이렌탈08") !== normaliseMerchant("코웨이렌탈"));

  // 서로 다른 세 달, 같은 날짜대 → 고정비
  const fixed = buildRecurrenceIndex([
    tx("넷플릭스", "2026-06-05", 17_000),
    tx("넷플릭스", "2026-07-05", 17_000),
    tx("넷플릭스", "2026-08-06", 17_000),
  ]);
  const info = recurrenceFor(tx("넷플릭스", "2026-09-05", 17_000), fixed);
  check("3개월이면 고정비", info?.isRecurring === true, info);
  check("결제일을 산정", info?.paymentDay === 5, info?.paymentDay);
  check("금액이 안정적", info?.amountStable === true, info);
  check("달 수", info?.monthCount === 3, info);

  // 두 달치만으로는 판정하지 않습니다
  const twoMonths = buildRecurrenceIndex([
    tx("넷플릭스", "2026-07-05", 17_000),
    tx("넷플릭스", "2026-08-05", 17_000),
  ]);
  check(
    "2개월은 고정비가 아님",
    recurrenceFor(tx("넷플릭스", "2026-09-05", 0), twoMonths)?.isRecurring === false
  );

  /*
    날짜가 흩어져 있으면 반복이 아닙니다 — 같은 가게에 자주 가는 것과 매달 같은
    날 빠져나가는 것은 다릅니다.
  */
  const scattered = buildRecurrenceIndex([
    tx("이마트", "2026-06-03", 50_000),
    tx("이마트", "2026-07-19", 30_000),
    tx("이마트", "2026-08-28", 70_000),
  ]);
  check(
    "날짜가 흩어지면 고정비 아님",
    recurrenceFor(tx("이마트", "2026-09-01", 0), scattered)?.isRecurring === false
  );

  /*
    **월말은 같은 날짜대로 봅니다.** 26일 이후의 말일 차이(28·30·31)와 주말·공휴일
    밀림 때문에 하루하루를 견주면 매달 나가는 돈이 변동비로 떨어집니다.
  */
  const monthEnd = buildRecurrenceIndex([
    tx("월세", "2026-06-30", 500_000),
    tx("월세", "2026-07-31", 500_000),
    tx("월세", "2026-08-28", 500_000),
  ]);
  check(
    "월말 차이는 같은 대로",
    recurrenceFor(tx("월세", "2026-09-30", 0), monthEnd)?.isRecurring === true,
    recurrenceFor(tx("월세", "2026-09-30", 0), monthEnd)
  );

  // 공휴일로 며칠 밀린 것도 같은 대입니다 (허용 4일)
  const shifted = buildRecurrenceIndex([
    tx("통신비", "2026-06-15", 55_000),
    tx("통신비", "2026-07-17", 55_000),
    tx("통신비", "2026-08-13", 55_000),
  ]);
  check(
    "±4일 밀림은 허용",
    recurrenceFor(tx("통신비", "2026-09-15", 0), shifted)?.isRecurring === true
  );

  check("이력이 없으면 그렇게 말함", describeRecurrence(undefined) === "이력 없음");
  check(
    "한 달치면 그렇게 말함",
    describeRecurrence(recurrenceFor(tx("A", "2026-08-01", 1), buildRecurrenceIndex([tx("A", "2026-08-01", 1)]))) ===
      "1개월치만 확인됨"
  );
}

// ---------------------------------------------------------------------------
section("잔액 산식 — 기준일시 이전은 움직이지 않습니다 (§8)");
// ---------------------------------------------------------------------------
{
  const asOf = "2026-09-10T09:00:00.000Z";
  const before: any = { date: "2026-09-01", time: "12:00", type: "EXPENSE", amount: 10_000 };
  const after: any = { date: "2026-09-20", time: "12:00", type: "EXPENSE", amount: 10_000 };

  /*
    **기준일시 이전 거래는 이미 그 금액에 반영돼 있습니다.** 다시 더하면 두 번
    빼는 셈이 됩니다 — 잔액에 기준일시가 붙어 있는 이유가 그것입니다.
  */
  check("이전 거래는 제외", !movesBalance(before, asOf));
  check("이후 거래는 반영", movesBalance(after, asOf));
  check("시각이 없으면 정오로", !Number.isNaN(entryMoment({ ...before, time: "" } as any)));

  // 통장: 입금 +, 출금 −
  check("통장 출금은 −", signedAmount(before, true) === -10_000);
  check("통장 입금은 +", signedAmount({ ...before, type: "INCOME" }, true) === 10_000);
  // 카드: 사용 +, 환불 −
  check("카드 사용은 +", signedAmount(before, false) === 10_000);
  check("카드 환불은 −", signedAmount({ ...before, type: "INCOME" }, false) === -10_000);

  const plan = planBalanceAdjustment([before, after, { ...after, type: "INCOME", amount: 5_000 }], {
    type: "BANK",
    balanceOrBilled: 1_000_000,
    balanceAsOf: asOf,
  } as any);
  check("반영된 건수", plan.counted === 2, plan);
  check("빠진 건수", plan.ignored === 1, plan);
  check("차액", plan.delta === -5_000, plan);
  check("다음 잔액", plan.next === 995_000, plan);
  /* 새 기준일시는 반영된 것 중 가장 늦은 거래 시점입니다 */
  check("기준일시가 앞으로 감", plan.asOf > asOf, plan.asOf);

  // 카드는 방향이 반대입니다
  const card = planBalanceAdjustment([after], {
    type: "CARD",
    balanceOrBilled: 100_000,
    balanceAsOf: asOf,
  } as any);
  check("카드는 사용이 늘어남", card.next === 110_000, card);

  // 기준일시가 없거나 깨져 있어도 화면이 죽지 않아야 합니다
  const broken = planBalanceAdjustment([after], {
    type: "BANK",
    balanceOrBilled: 0,
    balanceAsOf: "",
  } as any);
  check("깨진 기준일시에도 답을 냄", Number.isFinite(broken.next), broken);
}

// ---------------------------------------------------------------------------
section("되돌리기 — 보관 기간과 되돌릴 수 있는가 (§4.9)");
// ---------------------------------------------------------------------------
{
  const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const rows = [
    { id: "a", createdAt: ago(0.5) },
    { id: "b", createdAt: ago(6.9) },
    { id: "c", createdAt: ago(7.1) },
    { id: "d", createdAt: ago(40) },
    { id: "broken", createdAt: "어제" },
  ];

  /* 경계를 **지난 것만** 골라냅니다 — 하루를 더 얹는 실수가 반복되는 자리입니다 */
  check("7일이면 7일 넘은 것만", expiredUndoIds(rows, { days: 7 }).join() === "c,d");
  check("1일이면 더 많이", expiredUndoIds(rows, { days: 1 }).join() === "b,c,d");
  check("기간 안은 남김", !expiredUndoIds(rows, { days: 7 }).includes("b"));
  /*
    날짜가 깨진 줄은 지우지 않습니다. 모르는 것을 버리지 않는다는 규칙입니다
    (§17.3) — 되돌릴 수 있었을지도 모르는 것을 판단 불가라는 이유로 없애지
    않습니다.
  */
  check("깨진 날짜는 건드리지 않음", !expiredUndoIds(rows, { days: 1 }).includes("broken"));

  /* 말이 되는 범위로 자릅니다 — 0 이면 되돌리기가 없는 것과 같습니다 */
  check("0 은 1 로", normaliseRetention(0) === 1);
  check("음수도 1 로", normaliseRetention(-5) === 1);
  check("999 는 90 으로", normaliseRetention(999) === 90);
  check("숫자가 아니면 기본값", normaliseRetention("이틀") === DEFAULT_UNDO_DAYS);
  check("기본값은 7일", DEFAULT_UNDO_DAYS === 7);

  /*
    담아 둔 것이 비어 있으면 되돌려도 아무 일이 없습니다 — 버튼을 눌렀는데
    아무 일도 없는 것이 가장 나쁩니다.
  */
  const empty: any = { id: "1", kind: "DELETE_ENTRIES", label: "", payload: {}, createdAt: "" };
  check("빈 기록은 되돌릴 수 없음", !canUndo(empty));
  check(
    "담아 둔 것이 있으면 가능",
    canUndo({ ...empty, payload: { entries: [{ id: "t1" }] } } as any)
  );
  check(
    "모르는 종류는 불가",
    !canUndo({ ...empty, kind: "SOMETHING", payload: { entries: [1] } } as any)
  );

  check(
    "계좌 삭제를 설명",
    describeUndo({
      id: "1",
      kind: "DELETE_ACCOUNT",
      label: "",
      createdAt: "",
      payload: { account: { name: "KB국민카드" } as any, entries: [1, 2, 3] as any },
    }) === "KB국민카드 삭제 (내역 3건)"
  );
  check(
    "예산 변경을 설명",
    describeUndo({
      id: "1",
      kind: "BUDGETS",
      label: "",
      createdAt: "",
      payload: { budgets: { month: "2026-08", categoryBudgets: { 식비: 1, 교통: 2 } } },
    }) === "8월 예산 2개 변경"
  );
}

// ---------------------------------------------------------------------------
section("PIN — 평문을 남기지 않습니다 (§5)");
// ---------------------------------------------------------------------------
{
  check("6자리만 허용", isValidPinFormat("123456"));
  check("5자리 거부", !isValidPinFormat("12345"));
  check("7자리 거부", !isValidPinFormat("1234567"));
  check("숫자가 아니면 거부", !isValidPinFormat("12a456"));
  check("빈 값 거부", !isValidPinFormat(""));

  const stored = await hashPin("123456");
  /*
    **저장되는 것에 PIN 이 없습니다.** 해시·솔트·반복횟수뿐이고, 되읽을 것이
    없습니다. 이 셋 중 하나라도 평문을 담으면 §5의 전제가 무너집니다.
  */
  check("해시가 남음", stored.hash.length > 20, stored.hash.length);
  check("솔트가 남음", stored.salt.length > 10, stored.salt.length);
  check("반복횟수가 함께 남음", stored.iterations === 310_000, stored.iterations);
  check(
    "평문이 어디에도 없음",
    !JSON.stringify(stored).includes("123456"),
    JSON.stringify(stored)
  );

  check("맞는 PIN 통과", await checkPin("123456", stored));
  check("틀린 PIN 거부", !(await checkPin("123457", stored)));

  /*
    **솔트는 기기·사용자마다 다릅니다.** 같은 PIN 이 같은 해시로 저장되면 한
    사람의 해시를 다른 사람에게 그대로 써 볼 수 있습니다.
  */
  const second = await hashPin("123456");
  check("같은 PIN 이라도 솔트가 다름", stored.salt !== second.salt);
  check("따라서 해시도 다름", stored.hash !== second.hash);
  check("그래도 각자 통과", await checkPin("123456", second));

  /*
    반복횟수가 해시와 함께 저장되는 이유: 나중에 올려도 **이미 등록된 PIN 이
    열립니다**. 옛 횟수로 저장된 것을 그 횟수로 검사합니다.
  */
  const legacy = { ...stored, iterations: 1_000 };
  const rehashed = await hashPin("123456");
  check(
    "다른 반복횟수는 다른 결과",
    !(await checkPin("123456", { ...legacy, hash: rehashed.hash, salt: rehashed.salt }))
  );
}

// ---------------------------------------------------------------------------
section("기억된 명세서 형식 — 머리글 서명 (§7.4)");
// ---------------------------------------------------------------------------
{
  /* 서명은 공백·대소문자를 지웁니다 — 같은 파일이 달마다 미세하게 다를 수 있습니다 */
  check(
    "공백·대소문자 무시",
    formatSignature(["이용 일자", "가맹점"]) === formatSignature(["이용일자", "가맹점"])
  );
  check(
    "대문자도 같게",
    formatSignature(["Date", "Amount"]) === formatSignature(["date", "amount"])
  );
  check("열 순서가 다르면 다른 형식", formatSignature(["a", "b"]) !== formatSignature(["b", "a"]));
  check("빈 머리글은 빈 서명", formatSignature([]) === "");

  /*
    localStorage 가 없는 곳(노드·사생활 보호 모드)에서도 **던지지 않아야**
    합니다. 기억을 못 하는 것은 견딜 수 있지만 가져오기가 죽는 것은 아닙니다.
  */
  const headers = ["이용일자", "가맹점", "이용금액"];
  const mapping: any = { date: 0, merchant: 1, expense: 2 };
  let threw = false;
  try {
    rememberMapping(headers, mapping);
    recallMapping(headers);
    forgetMapping(headers);
  } catch {
    threw = true;
  }
  check("저장소가 없어도 죽지 않음", !threw);
}

// ---------------------------------------------------------------------------
section("알림 — 같은 것을 두 번 띄우지 않습니다 (§11.8)");
// ---------------------------------------------------------------------------
{
  const items = [
    { id: "2026-08-식비-EXCEEDED", title: "a", body: "a" },
    { id: "2026-08-쇼핑-WARNING", title: "b", body: "b" },
  ];

  check("처음이면 둘 다", pendingNotifications(items, []).length === 2);
  /*
    예산 상태는 렌더마다 다시 계산됩니다. 걸러내지 않으면 화면을 만질 때마다
    같은 알림이 쏟아집니다.
  */
  check(
    "이미 띄운 것은 제외",
    pendingNotifications(items, ["2026-08-식비-EXCEEDED"]).length === 1
  );
  check("전부 띄웠으면 없음", pendingNotifications(items, items.map((i) => i.id)).length === 0);
  /* 한 번에 같은 id 가 둘 들어와도 하나만 */
  check("한 묶음 안의 중복도 하나로", pendingNotifications([items[0], items[0]], []).length === 1);
  check("id 가 없으면 띄우지 않음", pendingNotifications([{ id: "", title: "x", body: "y" }], []).length === 0);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
