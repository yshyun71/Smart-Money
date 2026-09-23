/**
 * 설명(note)을 같은 내역명에 함께 적는 규칙.
 *
 * 사람이 이미 적어 둔 설명을 조용히 덮어쓰지 않는 것이 핵심입니다 —
 * 그 한 줄이 그 건에 대해 알려진 가장 구체적인 사실입니다.
 */
import {
  planNote,
  noteReach,
  sameMerchant,
  planClassification,
  classificationReach,
} from "../src/services/spread";

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
const tx = (merchant: string, extra: any = {}): any => ({
  id: `t${serial++}`,
  accountId: "card",
  date: "2026-08-01",
  time: "12:00",
  type: "EXPENSE",
  expenseType: "VARIABLE",
  category: "쇼핑",
  amount: 1000,
  paymentMethod: "카드결제",
  merchant,
  ...extra,
});

// ---------------------------------------------------------------------------
section("같은 가맹점 판정");
// ---------------------------------------------------------------------------
{
  check("공백 무시", sameMerchant("삼성전자 (주)", "삼성전자(주)"));
  check("대소문자 무시", sameMerchant("GS SHOP", "gsshop"));
  check("다른 가게", !sameMerchant("삼성전자(주)", "삼성전자서비스(주)"));
  check("빈 이름은 무엇과도 같지 않음", !sameMerchant("", ""));
}

// ---------------------------------------------------------------------------
section("이 건만");
// ---------------------------------------------------------------------------
{
  const target = tx("삼성전자(주)");
  const rows = [target, tx("삼성전자(주)"), tx("삼성전자(주)")];

  const plan = planNote(rows, target, "노트북 구입", "ONE", false);
  check("1건만 바뀜", plan.updates.length === 1, plan.updates);
  check("그 건이 대상", plan.updates[0]?.id === target.id, plan.updates[0]);
  check("설명이 실림", plan.updates[0]?.note === "노트북 구입", plan.updates[0]);

  // 이미 같은 값이면 쓸 것이 없다 (§14.3 멱등)
  const again = planNote([{ ...target, note: "노트북 구입" }], { ...target, note: "노트북 구입" }, "노트북 구입", "ONE", false);
  check("같은 값이면 쓰지 않음", again.updates.length === 0, again);

  // 비우면 지운다
  const cleared = planNote([{ ...target, note: "노트북 구입" }], { ...target, note: "노트북 구입" }, "  ", "ONE", false);
  check("공백만 넣으면 설명을 지움", cleared.updates[0]?.note === undefined, cleared.updates[0]);
}

// ---------------------------------------------------------------------------
section("같은 내역명 모두 — 이미 적어 둔 설명은 건너뛴다");
// ---------------------------------------------------------------------------
{
  const target = tx("삼성전자(주)");
  const rows = [
    target,
    tx("삼성전자 (주)"), // 공백만 다르다
    tx("삼성전자(주)", { note: "작년 수리비" }), // 사람이 이미 적었다
    tx("주식회사 지마켓"), // 다른 가게
    tx("삼성전자(주)", { accountId: "bank" }), // 다른 계좌
  ];

  const skip = planNote(rows, target, "회사 경비", "SAME_MERCHANT", false);
  check("빈 것만 채움 — 2건", skip.applied === 2, skip.updates.map((t) => t.merchant));
  check("이미 적힌 1건은 남김", skip.kept === 1, skip);
  check("무엇이 걸렸는지 알려줌", skip.conflicts.length === 1, skip.conflicts);
  check(
    "그 건의 설명은 그대로",
    !skip.updates.some((t) => t.note === "회사 경비" && t.id === rows[2].id),
    skip.updates
  );
  check("다른 가게는 제외", !skip.updates.some((t) => t.merchant.includes("지마켓")), skip.updates);
  check(
    "다른 계좌는 제외",
    !skip.updates.some((t) => t.accountId === "bank"),
    skip.updates
  );

  const force = planNote(rows, target, "회사 경비", "SAME_MERCHANT", true);
  check("덮어쓰기를 고르면 3건", force.applied === 3, force.updates.map((t) => t.note));
  check("덮어쓰기에서는 남기는 것이 없음", force.kept === 0, force);
  check(
    "이미 적힌 건도 새 설명으로",
    force.updates.some((t) => t.id === rows[2].id && t.note === "회사 경비"),
    force.updates
  );
}

// ---------------------------------------------------------------------------
section("적용 범위 미리보기");
// ---------------------------------------------------------------------------
{
  const target = tx("스타벅스");
  const rows = [
    target,
    tx("스타벅스"),
    tx("스타벅스", { note: "팀 회의" }),
    tx("스타벅스", { note: "팀 회의" }),
    tx("투썸플레이스"),
  ];

  const reach = noteReach(rows, target);
  check("같은 내역명 4건", reach.total === 4, reach);
  check("그중 2건은 이미 설명이 있음", reach.described === 2, reach);

  // 대상 자신이 설명을 갖고 있어도 충돌로 세지 않는다 — 지금 고치는 중이다
  const edited = { ...target, note: "예전 설명" };
  const own = noteReach([edited, ...rows.slice(1)], edited);
  check("대상 자신은 충돌이 아님", own.described === 2, own);
}

// ---------------------------------------------------------------------------
section("분류 — 카테고리와 고정비를 같은 내역명 전체에");
// ---------------------------------------------------------------------------
{
  const target = tx("코웨이렌탈09", { category: "기타지출", expenseType: "VARIABLE" });
  const rows = [
    target,
    tx("코웨이렌탈09", { category: "기타지출", expenseType: "VARIABLE" }),
    tx("코웨이렌탈09", { category: "생활", expenseType: "FIXED", isFixedRecurring: true, recurringDay: 9 }),
    tx("스타벅스", { category: "카페/간식" }),
    tx("코웨이렌탈09", { accountId: "bank", category: "기타지출" }),
  ];

  const next = {
    category: "생활" as any,
    expenseType: "FIXED" as any,
    isFixedRecurring: true,
    recurringDay: 9,
  };

  const plan = planClassification(rows, target, next);
  check("대상 자신은 제외 — 폼이 직접 저장한다", !plan.updates.some((t) => t.id === target.id), plan.updates);
  check("같은 내역명 1건만 바뀜", plan.applied === 1, plan.updates);
  check("카테고리가 옮겨감", plan.updates[0]?.category === "생활", plan.updates[0]);
  check("고정비도 함께", plan.updates[0]?.expenseType === "FIXED", plan.updates[0]);
  check("결제일도 함께", plan.updates[0]?.recurringDay === 9, plan.updates[0]);
  check("다른 가맹점은 제외", !plan.updates.some((t) => t.merchant === "스타벅스"), plan.updates);
  check("다른 계좌는 제외", !plan.updates.some((t) => t.accountId === "bank"), plan.updates);

  // 이미 그 분류인 건은 다시 쓰지 않는다 (§14.3 멱등)
  const settled = planClassification(rows.map((t) => ({ ...t, ...next })), target, next);
  check("바뀔 것이 없으면 빈 목록", settled.applied === 0, settled);

  const reach = classificationReach(rows, target, next);
  check("같은 내역명 3건", reach.total === 3, reach);
  check("그중 1건이 바뀜", reach.changing === 1, reach);

  // 변동비로 되돌리면 결제일이 떨어진다
  const back = planClassification(rows, target, {
    ...next,
    expenseType: "VARIABLE" as any,
    isFixedRecurring: false,
  });
  const moved = back.updates.find((t) => t.id === rows[2].id);
  check("고정비 해제 시 결제일 제거", moved && moved.recurringDay === undefined, moved);
}

// ---------------------------------------------------------------------------
section("분류 — 방향이 다르면 퍼뜨리지 않는다 (§6.1 · §6.6)");
// ---------------------------------------------------------------------------
{
  /*
    **방향이 다르면 아무것도 퍼뜨리지 않습니다** (§6.1 · §6.6).

    카테고리가 방향마다 갈리므로 지출의 `쇼핑` 을 수입 줄에 복사하면 그 줄은
    어느 수입 카테고리도 아니게 되고, 저장 단계에서 거절됩니다(§17.7). 같은
    이름이 양쪽에 찍히는 일은 흔합니다 — 당근마켓에서 사고 팔면 그렇습니다.
  */
  const target = tx("당근마켓", { category: "기타지출", expenseType: "VARIABLE" });
  const income = tx("당근마켓", {
    type: "INCOME",
    expenseType: "VARIABLE",
    category: "기타수입",
  });
  const rows = [target, income];

  const plan = planClassification(rows, target, {
    category: "쇼핑" as any,
    expenseType: "FIXED" as any,
    isFixedRecurring: true,
    recurringDay: 3,
  });

  check("수입 건은 건드리지 않습니다", plan.updates.length === 0, plan.updates);

  const fromIncome = planClassification([income, target], income, {
    category: "급여" as any,
    expenseType: "FIXED" as any,
    isFixedRecurring: true,
    recurringDay: 25,
  });
  check("반대 방향도 마찬가지", fromIncome.updates.length === 0, fromIncome.updates);

  /*
    같은 방향이면 정기성이 그대로 따라갑니다 — **수입도 그렇습니다**(§6.6).
    급여가 고정수입이 되면 같은 이름의 지난 급여도 함께 고정수입이 됩니다.
  */
  const pay1 = tx("(주)테크솔루션", {
    type: "INCOME",
    expenseType: "VARIABLE",
    category: "기타수입",
  });
  const pay2 = tx("(주)테크솔루션", {
    type: "INCOME",
    expenseType: "VARIABLE",
    category: "기타수입",
  });
  const paid = planClassification([pay1, pay2], pay1, {
    category: "급여" as any,
    expenseType: "FIXED" as any,
    isFixedRecurring: true,
    recurringDay: 25,
  });
  const other = paid.updates.find((t) => t.id === pay2.id);
  check("수입도 카테고리가 따라감", other?.category === "급여", other);
  check("수입도 고정이 따라감", other?.expenseType === "FIXED", other);
  check("수입에도 결제일이 붙음", other?.recurringDay === 25, other);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
