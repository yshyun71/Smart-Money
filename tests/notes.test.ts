/**
 * 설명(note)을 같은 내역명에 함께 적는 규칙.
 *
 * 사람이 이미 적어 둔 설명을 조용히 덮어쓰지 않는 것이 핵심입니다 —
 * 그 한 줄이 그 건에 대해 알려진 가장 구체적인 사실입니다.
 */
import { planNote, noteReach, sameMerchant } from "../src/services/notes";

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
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
