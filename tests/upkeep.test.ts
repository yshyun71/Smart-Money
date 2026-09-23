/**
 * 앱이 먼저 말해 주는 것들 (§12.12).
 *
 * 이 판정이 틀리면 증상이 둘 다 나쁩니다 — 말해야 할 때 조용하면 사용자가
 * 명세서를 빠뜨리거나 백업 없이 기기를 잃고, 말하지 않아도 될 때 떠들면 그
 * 목록은 곧 아무도 읽지 않는 자리가 됩니다. 그래서 **말하지 않는 경우**를
 * 말하는 경우만큼 확인합니다.
 */
import {
  missingStatements,
  upcomingCharges,
  amountJumps,
  backupDue,
  normaliseBackupDays,
  upkeepNotices,
  DEFAULT_BACKUP_DAYS,
  UPCOMING_LIMIT,
} from "../src/services/upkeep";
import { recurringItems } from "../src/services/recurrence";

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

const card = (over: Record<string, unknown> = {}): any => ({
  id: "card",
  name: "우리카드",
  type: "CARD",
  institution: "우리",
  identifier: "****-1234",
  balanceOrBilled: 0,
  balanceAsOf: "",
  balanceSource: "USER",
  color: "amber",
  isAutoSyncEnabled: false,
  lastSyncedAt: "",
  ...over,
});

const item = (over: Record<string, unknown> = {}): any => ({
  key: "넷플릭스",
  merchant: "넷플릭스",
  amount: 17_000,
  average: 17_000,
  previous: 17_000,
  paymentDay: 25,
  monthCount: 6,
  lastSeen: "2026-08-25",
  category: "구독/미디어",
  accountId: "card",
  amountStable: true,
  ...over,
});

/* 2026-09-23 — 이 보고서를 쓴 날. 모든 판정에 같은 '오늘'을 넘깁니다 */
const TODAY = new Date(2026, 8, 23);

// ---------------------------------------------------------------------------
section("이번 달 명세서가 아직 없는 카드");
// ---------------------------------------------------------------------------
{
  const accounts = [card()];
  const lastMonthOnly = [tx({ billingMonth: "2026-08" })];

  const notices = missingStatements(accounts, lastMonthOnly, TODAY);
  check("지난달은 있고 이번 달은 없으면 말합니다", notices.length === 1, notices);
  check("어느 카드인지 밝힙니다", notices[0]?.accountId === "card");
  check("무슨 달인지 밝힙니다", (notices[0]?.title || "").includes("9월"));

  check(
    "이번 달이 들어와 있으면 조용합니다",
    missingStatements(accounts, [...lastMonthOnly, tx({ billingMonth: "2026-09" })], TODAY)
      .length === 0
  );

  /*
    지난달이 없는 카드는 '지금도 쓰는 카드'라는 근거가 없습니다. 해지했거나
    오래 안 쓴 카드를 매달 올리면 이 목록은 잡음이 됩니다.
  */
  check(
    "지난달이 없으면 말하지 않습니다",
    missingStatements(accounts, [tx({ billingMonth: "2026-03" })], TODAY).length === 0
  );
  check(
    "명세서를 한 번도 안 넣은 카드는 말하지 않습니다",
    missingStatements(accounts, [], TODAY).length === 0
  );

  /* 명세서는 결제월 초에 나옵니다 — 1일부터 없다고 말하면 알림이 아니라 잡음 */
  check(
    "달이 시작하자마자 묻지 않습니다",
    missingStatements(accounts, lastMonthOnly, new Date(2026, 8, 5)).length === 0
  );
  check(
    "10일부터 묻습니다",
    missingStatements(accounts, lastMonthOnly, new Date(2026, 8, 10)).length === 1
  );

  /* 통장에는 결제월이라는 것이 없습니다 */
  check(
    "은행 계좌는 세지 않습니다",
    missingStatements(
      [card({ id: "bank", type: "BANK", name: "국민은행" })],
      [tx({ accountId: "bank", billingMonth: "2026-08" })],
      TODAY
    ).length === 0
  );

  /* 해가 바뀌는 자리 */
  check(
    "1월에는 지난해 12월을 봅니다",
    missingStatements(accounts, [tx({ billingMonth: "2025-12" })], new Date(2026, 0, 15))
      .length === 1
  );
}

// ---------------------------------------------------------------------------
section("며칠 안에 빠져나갈 정기 결제");
// ---------------------------------------------------------------------------
{
  const soon = upcomingCharges([item({ paymentDay: 25 })], TODAY, 7);
  check("2일 뒤면 말합니다", soon.length === 1, soon);
  check("며칠 뒤인지 적습니다", (soon[0]?.title || "").includes("2일 뒤"), soon[0]?.title);
  check("금액을 적습니다", (soon[0]?.title || "").includes("17,000"));

  check(
    "먼 것은 말하지 않습니다",
    upcomingCharges([item({ paymentDay: 15, lastSeen: "2026-08-15" })], TODAY, 7).length === 0
  );

  /* 오늘이 결제일이면 '오늘' 이라고 말합니다 — '0일 뒤'는 사람의 말이 아닙니다 */
  const today = upcomingCharges([item({ paymentDay: 23 })], TODAY, 7);
  check("오늘이면 오늘이라고 합니다", (today[0]?.title || "").includes("오늘"), today[0]?.title);

  /*
    이미 나간 결제를 예고하면 같은 돈이 두 번 나가는 것처럼 읽힙니다.
  */
  check(
    "이번 달에 이미 나갔으면 말하지 않습니다",
    upcomingCharges([item({ paymentDay: 25, lastSeen: "2026-09-25" })], TODAY, 7).length === 0
  );

  /* 두 달 넘게 안 보이는 것은 끊겼을 수 있습니다 — 예고하는 것은 지어내는 일 */
  check(
    "끊긴 것으로 보이면 말하지 않습니다",
    upcomingCharges([item({ paymentDay: 25, lastSeen: "2026-06-25" })], TODAY, 7).length === 0
  );

  /* 이달 결제일이 지났으면 다음 달 것을 봅니다 */
  const wrapped = upcomingCharges(
    [item({ paymentDay: 1, lastSeen: "2026-08-01" })],
    new Date(2026, 8, 28),
    7
  );
  check("이달 결제일이 지났으면 다음 달", wrapped.length === 1, wrapped);
  check("다음 달 1일까지 3일", (wrapped[0]?.title || "").includes("3일 뒤"), wrapped[0]?.title);

  /* 31일 결제는 30일인 달에 말일로 당깁니다 */
  const clamped = upcomingCharges(
    [item({ paymentDay: 31, lastSeen: "2026-08-31" })],
    new Date(2026, 8, 28),
    7
  );
  check("없는 날은 말일로", (clamped[0]?.title || "").includes("2일 뒤"), clamped[0]?.title);
}

// ---------------------------------------------------------------------------
section("지난번보다 오른 정기 결제");
// ---------------------------------------------------------------------------
{
  const up = amountJumps(
    [item({ previous: 17_000, amount: 22_000, lastSeen: "2026-09-10" })],
    TODAY
  );
  check("오른 금액을 말합니다", up.length === 1, up);
  check("얼마 올랐는지", (up[0]?.title || "").includes("5,000"), up[0]?.title);
  check("얼마에서 얼마로", (up[0]?.detail || "").includes("17,000"), up[0]?.detail);

  check(
    "내린 것은 말하지 않습니다",
    amountJumps([item({ previous: 22_000, amount: 17_000, lastSeen: "2026-09-10" })], TODAY)
      .length === 0
  );

  /* 문턱이 둘인 이유 — 하나만 보면 잡음이 됩니다 */
  check(
    "비율은 넘어도 금액이 작으면 말하지 않습니다",
    amountJumps([item({ previous: 900, amount: 1_800, lastSeen: "2026-09-10" })], TODAY)
      .length === 0
  );
  check(
    "1,000원 미만은 말하지 않습니다",
    amountJumps([item({ previous: 17_000, amount: 17_500, lastSeen: "2026-09-10" })], TODAY)
      .length === 0
  );
  check(
    "금액은 넘어도 비율이 작으면 말하지 않습니다",
    amountJumps([item({ previous: 500_000, amount: 510_000, lastSeen: "2026-09-10" })], TODAY)
      .length === 0
  );

  check(
    "한 번밖에 없으면 견줄 것이 없습니다",
    amountJumps([item({ previous: null, amount: 30_000, lastSeen: "2026-09-10" })], TODAY)
      .length === 0
  );

  /* 오래된 인상은 소식이 아닙니다 */
  check(
    "반년 전에 오른 것은 말하지 않습니다",
    amountJumps([item({ previous: 17_000, amount: 22_000, lastSeen: "2026-03-10" })], TODAY)
      .length === 0
  );

  const many = amountJumps(
    [
      item({ key: "a", merchant: "가", previous: 10_000, amount: 12_000, lastSeen: "2026-09-10" }),
      item({ key: "b", merchant: "나", previous: 10_000, amount: 40_000, lastSeen: "2026-09-10" }),
    ],
    TODAY
  );
  check("많이 오른 것이 먼저", many[0]?.amount === 30_000, many);

  /*
    카드대금은 한 달 치 소비의 합이라 매달 달라지는 것이 정상입니다. 실제
    자료에서 522,347원 → 814,623원으로 잡혔는데, 그 숫자는 카드·계좌 화면이
    이미 더 정확히 말합니다(§9.4). 매달 뜨는 알림은 곧 읽히지 않습니다.
  */
  check(
    "카드대금은 올라도 말하지 않습니다",
    amountJumps(
      [
        item({
          category: "카드대금",
          merchant: "우리카드결제",
          previous: 522_347,
          amount: 814_623,
          lastSeen: "2026-09-01",
        }),
      ],
      TODAY
    ).length === 0
  );
}

// ---------------------------------------------------------------------------
section("백업 리마인더");
// ---------------------------------------------------------------------------
{
  check(
    "간격이 지났으면 말합니다",
    backupDue({
      lastBackupAt: "2026-08-01T00:00:00.000Z",
      days: 30,
      entryCount: 100,
      today: TODAY,
    }) !== null
  );
  check(
    "아직 안 지났으면 조용합니다",
    backupDue({
      lastBackupAt: "2026-09-20T00:00:00.000Z",
      days: 30,
      entryCount: 100,
      today: TODAY,
    }) === null
  );

  /* '며칠 지났다'고 적을 수 없는 상태와 오래된 상태는 다른 사실입니다 */
  const never = backupDue({ lastBackupAt: null, days: 30, entryCount: 100, today: TODAY });
  check("한 번도 안 했으면 그렇게 말합니다", (never?.title || "").includes("백업한 적이 없"), never);
  check("몇 건이 위험한지 말합니다", (never?.detail || "").includes("100"));

  /* 지킬 것이 없는데 권하는 것은 잡음입니다 */
  check(
    "내역이 없으면 말하지 않습니다",
    backupDue({ lastBackupAt: null, days: 30, entryCount: 0, today: TODAY }) === null
  );
  /* 끄는 것은 사용자의 결정입니다 */
  check(
    "0일이면 알리지 않습니다",
    backupDue({ lastBackupAt: null, days: 0, entryCount: 100, today: TODAY }) === null
  );
  check(
    "읽을 수 없는 시각은 지어내지 않습니다",
    backupDue({ lastBackupAt: "그런날", days: 30, entryCount: 100, today: TODAY }) === null
  );

  check("기본은 30일", DEFAULT_BACKUP_DAYS === 30);
  check("음수는 끔으로", normaliseBackupDays(-3) === 0);
  check("글자는 끔으로", normaliseBackupDays("hello") === 0);
  check("소수는 버립니다", normaliseBackupDays(7.9) === 7);
  check("너무 긴 값은 자릅니다", normaliseBackupDays(9999) === 365);
}

// ---------------------------------------------------------------------------
section("홈에 내놓는 순서 — 되돌릴 수 없는 것이 먼저");
// ---------------------------------------------------------------------------
{
  const notices = upkeepNotices({
    accounts: [card()],
    transactions: [tx({ billingMonth: "2026-08" })],
    recurring: [
      item({ paymentDay: 25 }),
      item({ key: "통신", merchant: "통신비", previous: 30_000, amount: 42_000, lastSeen: "2026-09-10" }),
    ],
    lastBackupAt: null,
    backupDays: 30,
    today: TODAY,
  });

  check(
    "네 가지가 모두 나옵니다",
    notices.length === 4,
    notices.map((notice) => notice.kind)
  );
  check(
    "백업 → 명세서 → 오른 금액 → 예고",
    JSON.stringify(notices.map((notice) => notice.kind)) ===
      JSON.stringify(["BACKUP", "STATEMENT", "AMOUNT_UP", "UPCOMING"]),
    notices.map((notice) => notice.kind)
  );

  /*
    예고가 넷이면 놓치면 되돌릴 수 없는 것들이 스크롤 밖으로 밀립니다. 전부 보는
    자리는 이미 있습니다(§12.10).
  */
  const crowded = upkeepNotices({
    accounts: [],
    transactions: [tx()],
    recurring: [
      item({ key: "a", merchant: "가", paymentDay: 24 }),
      item({ key: "b", merchant: "나", paymentDay: 25 }),
      item({ key: "c", merchant: "다", paymentDay: 26 }),
      item({ key: "d", merchant: "라", paymentDay: 27 }),
    ],
    lastBackupAt: "2026-09-22T00:00:00.000Z",
    backupDays: 30,
    today: TODAY,
  });
  check("예고는 셋까지", crowded.length === UPCOMING_LIMIT, crowded.length);
  check("가까운 것부터", (crowded[0]?.title || "").includes("1일 뒤"), crowded[0]?.title);

  /* 근거가 없으면 한 줄도 내지 않습니다 */
  check(
    "빈 가계부에는 할 말이 없습니다",
    upkeepNotices({
      accounts: [],
      transactions: [],
      recurring: [],
      lastBackupAt: null,
      backupDays: 30,
      today: TODAY,
    }).length === 0
  );
}

// ---------------------------------------------------------------------------
section("반복 판정이 바로 앞 금액을 함께 내줍니다");
// ---------------------------------------------------------------------------
{
  const rows = [
    tx({ merchant: "넷플릭스", date: "2026-06-25", amount: 17_000, category: "구독/미디어" }),
    tx({ merchant: "넷플릭스", date: "2026-07-25", amount: 17_000, category: "구독/미디어" }),
    tx({ merchant: "넷플릭스", date: "2026-08-25", amount: 22_000, category: "구독/미디어" }),
  ];
  const items = recurringItems(rows);
  check("반복으로 잡힙니다", items.length === 1, items);
  check("최근 금액", items[0]?.amount === 22_000);
  check("바로 앞 금액", items[0]?.previous === 17_000, items[0]?.previous);

  const once = recurringItems([tx({ merchant: "한번만", date: "2026-08-01" })]);
  check("반복이 아니면 목록에 없습니다", once.length === 0);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
