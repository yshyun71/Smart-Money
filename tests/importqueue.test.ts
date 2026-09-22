/**
 * 여러 파일을 한 번에, 그리고 줄을 새 것과 이미 있는 것으로 가르기.
 *
 * 가르는 판정은 `CsvImportModal` 안에 있었고 **회귀 세트가 닿지 않았습니다** —
 * 회차 없는 할부와 문자 대체는 둘 다 틀렸을 때 같은 결제가 두 줄이 되거나
 * 명세서가 통째로 0건 등록되는 종류의 판정입니다(§7.6·§7.8).
 */
import {
  splitDrafts,
  guessAccountForFile,
  queueFrom,
  activeIndex,
  queueLabel,
  markQueue,
  queueReady,
  queueSummary,
  belongsElsewhere,
  type QueuedFile,
} from "../src/services/importQueue";

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
const draft = (over: Record<string, unknown> = {}): any => ({
  lineNumber: ++serial,
  date: "2026-08-03",
  merchant: "스타벅스강남",
  amount: 5_500,
  type: "EXPENSE",
  expenseType: "VARIABLE",
  category: "카페/간식",
  memo: "",
  ...over,
});

const entry = (over: Record<string, unknown> = {}): any => ({
  id: `e${serial++}`,
  accountId: "card",
  date: "2026-08-03",
  time: "12:00",
  type: "EXPENSE",
  expenseType: "VARIABLE",
  category: "카페/간식",
  merchant: "스타벅스강남",
  amount: 5_500,
  paymentMethod: "카드",
  memo: "",
  ...over,
});

const account = (id: string, name: string, type = "CARD"): any => ({
  id,
  name,
  type,
  institution: name,
});

// ---------------------------------------------------------------------------
section("새 것과 이미 있는 것 가르기");
// ---------------------------------------------------------------------------
{
  const existing = [entry({ id: "old" })];
  const split = splitDrafts({
    drafts: [draft(), draft({ merchant: "다른가게", amount: 1_000 })],
    existing,
    accountId: "card",
  });

  check("같은 줄은 중복", split.duplicates.length === 1);
  check("중복은 기본이 건너뛰기", split.duplicates[0].decision === "SKIP");
  check("나머지는 새 것", split.fresh.length === 1);
  check("어느 줄과 겹치는지 말합니다", split.duplicates[0].existing.id === "old");

  /*
    **그 계좌 안에서만** 견줍니다. 다른 카드의 같은 결제를 중복으로 보아
    명세서 전체가 0건 등록되던 사고가 있었습니다(§7.6).
  */
  const otherCard = splitDrafts({
    drafts: [draft()],
    existing: [entry({ id: "old", accountId: "other" })],
    accountId: "card",
  });
  check("다른 계좌의 같은 결제는 중복이 아닙니다", otherCard.fresh.length === 1);

  check(
    "가계부가 비어 있으면 전부 새 것",
    splitDrafts({ drafts: [draft(), draft()], existing: [], accountId: "card" }).fresh
      .length === 2
  );
}

// ---------------------------------------------------------------------------
section("할부 — 회차가 없으면 중복으로 보지 않습니다 (§7.6)");
// ---------------------------------------------------------------------------
{
  /* 회차가 적혀 있으면 달끼리 구분됩니다 */
  const numbered = splitDrafts({
    drafts: [draft({ memo: "할부 5/10" })],
    existing: [entry({ id: "old", memo: "할부 4/10" })],
    accountId: "card",
  });
  check("다음 달 회차는 새 건", numbered.fresh.length === 1);

  const same = splitDrafts({
    drafts: [draft({ memo: "할부 4/10" })],
    existing: [entry({ id: "old", memo: "할부 4/10" })],
    accountId: "card",
  });
  check("같은 회차는 중복", same.duplicates.length === 1);

  /*
    `할부`라고만 되어 있으면 이 달이 어느 달인지 말해 주는 것이 없습니다 —
    걸러 내면 다음 달 명세서의 할부 건이 사라집니다. 대신 같은 파일을 두 번
    올리면 두 번 들어옵니다. 사라지는 쪽이 더 나쁩니다.
  */
  const unnumbered = splitDrafts({
    drafts: [draft({ memo: "할부" })],
    existing: [entry({ id: "old", memo: "할부" })],
    accountId: "card",
  });
  check("회차 없는 할부는 중복이 아닙니다", unnumbered.fresh.length === 1);
}

// ---------------------------------------------------------------------------
section("문자로 넣어 둔 줄을 명세서가 대체합니다 (§7.8)");
// ---------------------------------------------------------------------------
{
  /* 이름은 다르지만 같은 계좌·같은 날·같은 금액·같은 방향입니다 */
  const sms = entry({ id: "sms", merchant: "스타벅스 강남R점", origin: "SMS" });
  const split = splitDrafts({ drafts: [draft()], existing: [sms], accountId: "card" });

  check("같은 건으로 봅니다", split.duplicates.length === 1);
  check("기본이 덮어쓰기", split.duplicates[0].decision === "OVERWRITE");
  check("덮어쓸 줄을 가리킵니다", split.duplicates[0].existing.id === "sms");

  /* 사람이 넣은 줄이나 다른 명세서 줄은 건드리지 않습니다(§17.2) */
  const manual = entry({ id: "manual", merchant: "스타벅스 강남R점", origin: "MANUAL" });
  check(
    "직접 넣은 줄은 건드리지 않습니다",
    splitDrafts({ drafts: [draft()], existing: [manual], accountId: "card" }).fresh
      .length === 1
  );

  /* 방향이 다르면 다른 사건입니다 — 결제와 승인취소 */
  const refund = entry({
    id: "sms2",
    type: "INCOME",
    merchant: "스타벅스 강남R점",
    origin: "SMS",
  });
  check(
    "방향이 다르면 다른 건",
    splitDrafts({ drafts: [draft()], existing: [refund], accountId: "card" }).fresh
      .length === 1
  );

  /* 한 문자 줄이 두 명세서 줄에 걸쳐 쓰이지 않습니다 */
  const twice = splitDrafts({
    drafts: [draft({ merchant: "스타벅스A" }), draft({ merchant: "스타벅스B" })],
    existing: [sms],
    accountId: "card",
  });
  check("한 줄은 한 번만 대체됩니다", twice.duplicates.length === 1, {
    dup: twice.duplicates.length,
    fresh: twice.fresh.length,
  });
}

// ---------------------------------------------------------------------------
section("파일 이름이 말하는 계좌 — 모르면 비워 둡니다 (§17.2)");
// ---------------------------------------------------------------------------
{
  const accounts = [
    account("s", "삼성카드"),
    account("l", "롯데카드"),
    account("b", "국민은행", "BANK"),
  ];

  check("이름에 카드사가 있으면", guessAccountForFile("삼성카드_20260826.xlsx", accounts) === "s");
  /*
    `CARD_ISSUERS`(§6.3)는 명세서·문자에 적히는 **한글 이름**이고, 그 표를 여기서
    넓히면 카드대금 판별까지 함께 흔들립니다. 로마자로만 적힌 이름은 비워 두고
    사람이 고릅니다 — 틀리게 골라 두는 것보다 낫습니다.
  */
  check(
    "로마자 이름은 비워 둡니다",
    guessAccountForFile("samsungcard_20260826.xlsx", accounts) === ""
  );
  check(
    "한글 카드사 이름",
    guessAccountForFile("이용대금명세서_롯데_2608.xls", accounts) === "l"
  );
  check("은행도 같은 근거로", guessAccountForFile("국민은행_거래내역.xls", accounts) === "b");
  check("카드사가 없으면 비워 둡니다", guessAccountForFile("거래내역조회.xls", accounts) === "");

  /* 그 카드사 카드가 두 장이면 어느 쪽인지 알 방법이 없습니다 */
  const twoSamsung = [account("s1", "삼성카드 생활"), account("s2", "삼성카드 여행")];
  check(
    "한 장으로 좁혀지지 않으면 비워 둡니다",
    guessAccountForFile("삼성카드_2608.xls", twoSamsung) === ""
  );
  check("등록된 계좌가 없으면", guessAccountForFile("삼성카드_2608.xls", []) === "");
}

// ---------------------------------------------------------------------------
section("대기줄");
// ---------------------------------------------------------------------------
{
  const accounts = [account("s", "삼성카드"), account("l", "롯데카드")];
  const queue = queueFrom(["삼성카드_2608.xls", "메모.csv", "롯데카드_2608.xls"], accounts);

  check("고른 순서를 지킵니다", queue.map((item) => item.name)[1] === "메모.csv");
  check("아는 것은 골라 둡니다", queue[0].accountId === "s" && queue[2].accountId === "l");
  check("모르는 것은 비어 있습니다", queue[1].accountId === "");
  check("계좌가 비면 시작하지 않습니다", queueReady(queue) === false);
  check("빈 대기줄도 시작하지 않습니다", queueReady([]) === false);

  const ready = markQueue(queue, 1, { accountId: "l" });
  check("고치면 시작할 수 있습니다", queueReady(ready) === true);
  check("원본을 바꾸지 않습니다", queue[1].accountId === "");

  check("첫 파일부터", activeIndex(ready) === 0);
  const afterFirst = markQueue(ready, 0, { state: "DONE", added: 12 });
  check("끝난 것은 건너뜁니다", activeIndex(afterFirst) === 1);

  check(
    "몇 번째의 무엇인지",
    queueLabel(ready, 1, accounts) === "2 / 3번째 파일 · 롯데카드",
    queueLabel(ready, 1, accounts)
  );
  check("계좌를 모르면 자리만", queueLabel(queue, 1, accounts) === "2 / 3번째 파일");
  check("범위 밖은 빈 글자", queueLabel(ready, 9, accounts) === "");
}

// ---------------------------------------------------------------------------
section("계좌가 정해진 대기줄 — 같은 카드의 여러 달 (§7.10)");
// ---------------------------------------------------------------------------
{
  const accounts = [account("s", "삼성카드"), account("w", "우리카드")];

  /* 우리카드 내역 화면에서 열었습니다 — 여러 달 명세서를 한 번에 */
  const months = queueFrom(
    ["이용대금명세서_2607.xls", "이용대금명세서_2608.xls", "이용대금명세서_2609.xls"],
    accounts,
    "w"
  );
  check("전부 그 계좌로", months.every((item) => item.accountId === "w"));
  check("전부 넣습니다", months.every((item) => item.state === "PENDING"));
  check("시작할 수 있습니다", queueReady(months) === true);

  /*
    이름이 다른 카드사를 대놓고 말하면 건너뜁니다. 우리카드를 열어 놓고
    누른 자리에서 삼성카드 명세서가 조용히 들어가는 것이 가장 나쁜 결과입니다.
  */
  const mixed = queueFrom(
    ["이용대금명세서_2608.xls", "삼성카드_2608.xls"], accounts, "w"
  );
  check("다른 카드의 것은 건너뜀", mixed[1].state === "SKIPPED");
  check("까닭을 남깁니다", Boolean(mixed[1].reason));
  check("나머지는 그대로", mixed[0].state === "PENDING");
  check("건너뛴 것이 있어도 시작합니다", queueReady(mixed) === true);
  check("넣을 첫 파일에서 시작", activeIndex(mixed) === 0);

  /* 이름이 아무 말도 하지 않으면 여기 것으로 봅니다 — 그래야 여러 달이 됩니다 */
  check("모르는 이름은 여기 것", belongsElsewhere("거래내역조회.xls", "w", accounts) === false);
  check("같은 카드는 당연히", belongsElsewhere("우리카드_2608.xls", "w", accounts) === false);
  check("다른 카드만 참", belongsElsewhere("삼성카드_2608.xls", "w", accounts) === true);
  /* 등록되지 않은 카드사는 가려낼 수 없습니다 */
  check(
    "모르는 카드사는 막지 않습니다",
    belongsElsewhere("현대카드_2608.xls", "w", accounts) === false
  );

  /* 전부 다른 카드의 것이면 넣을 것이 없습니다 */
  const none = queueFrom(["삼성카드_2608.xls"], accounts, "w");
  check("전부 건너뛰면 시작하지 않습니다", queueReady(none) === false);
  check("현황에 파일 단위로 남습니다", queueSummary(none).skippedFiles === 1);
  check("건너뛴 것은 성공이 아닙니다", queueSummary(none).done === 0);
}

// ---------------------------------------------------------------------------
section("끝난 뒤의 현황 — 실패해도 나머지는 저장돼 있습니다 (§7.9)");
// ---------------------------------------------------------------------------
{
  const queue: QueuedFile[] = [
    { name: "a.xls", accountId: "s", state: "DONE", added: 30, replaced: 2, skipped: 1 },
    { name: "b.xls", accountId: "l", state: "FAILED", reason: "표를 찾지 못했습니다" },
    { name: "c.xls", accountId: "s", state: "DONE", added: 12, replaced: 0, skipped: 4 },
  ];
  const sum = queueSummary(queue);

  check("파일 수", sum.files === 3);
  check("성공과 실패를 따로", sum.done === 2 && sum.failed === 1);
  check("건수는 더해서", sum.added === 42 && sum.replaced === 2 && sum.skipped === 5);

  const none = queueSummary([]);
  check("빈 대기줄은 0", none.files === 0 && none.added === 0);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
