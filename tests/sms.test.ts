/**
 * 결제 알림 문자 파싱.
 *
 * AI 를 쓰지 않는 것이 이 모듈의 요점입니다 — 문자에는 가맹점·금액·잔액이
 * 담겨 있고, 그것을 외부로 보낼 이유가 없습니다. 대신 카드사마다 다른 형식을
 * 규칙으로 감당해야 하므로, 실제 문자 모양을 여기에 모아 둡니다.
 *
 * 새 카드사 문자가 안 읽히면 그 원문을 이 파일에 케이스로 추가하세요.
 */
import {
  parseSms,
  parseSmsBatch,
  parseSmsDate,
  parseSmsAmounts,
  parseSmsType,
  parseSmsMerchant,
  looksLikeNotice,
} from "../src/services/smsParse";
import { findSimilarEntry, duplicateKey } from "../src/services/csvImport";

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

/** 문자에 연도가 없으므로 "지금"을 고정해 두어야 결과가 일정합니다. */
const NOW = new Date(2026, 8, 18); // 2026-09-18

// ---------------------------------------------------------------------------
section("카드 승인 문자");
// ---------------------------------------------------------------------------
{
  const shinhan = parseSms(
    "[신한카드 승인]\n김*호님 09/08 19:40\n배달의민족\n28,500원 일시불\n누적 645,000원",
    NOW
  );
  check("날짜", shinhan?.date === "2026-09-08", shinhan);
  check("시각", shinhan?.time === "19:40", shinhan);
  check("금액", shinhan?.amount === 28_500, shinhan);
  check("누적액을 금액으로 읽지 않음", shinhan?.balance === 645_000, shinhan);
  check("지출", shinhan?.type === "EXPENSE", shinhan);
  check("가맹점", shinhan?.merchant === "배달의민족", shinhan);
  check("카드사", shinhan?.issuer === "신한카드", shinhan);
  check("결제 구분", shinhan?.method === "일시불", shinhan);
  check("읽을 것을 다 읽음", shinhan?.confidence === "HIGH", shinhan);

  const kb = parseSms(
    "[KB국민카드 승인]\n김*호님 09/08 13:20\n스타벅스 강남R점\n6,300원 일시불",
    NOW
  );
  check("공백이 든 가맹점", kb?.merchant === "스타벅스 강남R점", kb);
  check("잔액 안내가 없으면 null", kb?.balance === null, kb);

  const hyundai = parseSms(
    "[현대카드 승인]\n김*호님 09/08 09:15\n넷플릭스서비시스코리아\n17,000원 정기결제\n누적 662,000원",
    NOW
  );
  check("정기결제", hyundai?.method === "정기결제", hyundai);
  check("긴 가맹점명", hyundai?.merchant === "넷플릭스서비시스코리아", hyundai);

  // 한 줄로 오는 형식
  const oneLine = parseSms(
    "[Web발신] [우리카드] 홍길동님 09/18 12:00 5,000원 승인 GS25역삼점",
    NOW
  );
  check("Web발신 머리말 제거", oneLine?.amount === 5_000, oneLine);
  check("한 줄 형식의 가맹점", oneLine?.merchant === "GS25역삼점", oneLine);
  check("사람 이름은 가맹점이 아님", !/홍길동/.test(oneLine?.merchant || ""), oneLine);

  // 할부
  const instalment = parseSms(
    "[롯데카드 승인] 김*호님 09/10 15:00 하이마트 480,000원 할부 6개월",
    NOW
  );
  check("할부 구분", instalment?.method === "할부6개월", instalment);
  check("할부 금액", instalment?.amount === 480_000, instalment);
}

// ---------------------------------------------------------------------------
section("통장 입출금 문자");
// ---------------------------------------------------------------------------
{
  const income = parseSms(
    "[카카오뱅크 입금]\n09/08 18:00\n(주)소프트웨어랩 급여\n3,600,000원\n잔액 6,240,000원",
    NOW
  );
  check("입금은 수입", income?.type === "INCOME", income);
  check("입금액", income?.amount === 3_600_000, income);
  check("잔액", income?.balance === 6_240_000, income);
  /*
    `급여`는 방향을 알려주는 말이라 가맹점에서 빠집니다 — 이미 수입 판정에
    썼고, 회사 이름만 남는 편이 내역명으로 낫습니다. 대신 카테고리를 추정할
    때는 가맹점이 아니라 **문자 원문**을 봐야 `급여`가 살아 있습니다.
  */
  check("입금처는 회사 이름", income?.merchant === "(주)소프트웨어랩", income);

  const withdraw = parseSms(
    "[국민은행] 09/18 14:23 출금 30,000원 잔액 1,200,000원 CD공동",
    NOW
  );
  check("출금은 지출", withdraw?.type === "EXPENSE", withdraw);
  check("출금액", withdraw?.amount === 30_000, withdraw);
}

// ---------------------------------------------------------------------------
section("취소·환불은 돈이 돌아온 것");
// ---------------------------------------------------------------------------
{
  const cancelled = parseSms(
    "[신한카드 승인취소] 김*호님 09/12 11:00 배달의민족 28,500원",
    NOW
  );
  check("승인취소는 수입 쪽", cancelled?.type === "INCOME", cancelled);
  check("금액은 그대로", cancelled?.amount === 28_500, cancelled);
  check("'승인'보다 '취소'가 셈", parseSmsType("승인 취소") === "INCOME");
}

// ---------------------------------------------------------------------------
section("거래가 아닌 문자는 들이지 않습니다");
// ---------------------------------------------------------------------------
{
  check("금액이 없으면 버림", parseSms("[신한카드] 명세서가 발행되었습니다", NOW) === null);
  check("빈 글", parseSms("   ", NOW) === null);
  check("광고 문자", parseSms("[광고] 카드 발급 이벤트 안내 자세히 보기", NOW) === null);
  // 금액만 있으면 거래로 봅니다 — 지어내지 않고 사용자가 고칩니다
  const bare = parseSms("12,000원", NOW);
  check("금액만 있으면 통과", bare?.amount === 12_000, bare);
  check("못 읽은 칸은 비워 둠", bare?.merchant === "" && bare?.time === "", bare);
  check("손볼 것이 있다고 표시", bare?.confidence === "LOW", bare);
}

// ---------------------------------------------------------------------------
section("날짜 — 연도가 없는 문자");
// ---------------------------------------------------------------------------
{
  check("올해로 봄", parseSmsDate("09/08", NOW) === "2026-09-08");
  check("점 구분", parseSmsDate("09.08", NOW) === "2026-09-08");
  check("월일 표기", parseSmsDate("9월 8일", NOW) === "2026-09-08");
  check("연도가 있으면 그대로", parseSmsDate("2025-12-31", NOW) === "2025-12-31");

  /*
    1월에 12월 문자를 넣는 경우. 올해로 읽으면 열한 달 뒤의 미래가 되므로
    지난해로 봅니다.
  */
  const january = new Date(2027, 0, 5);
  check("미래가 되면 지난해로", parseSmsDate("12/28", january) === "2026-12-28");

  check("시각을 날짜로 읽지 않음", parseSmsDate("19:40", NOW) === "");
  check("13월은 날짜가 아님", parseSmsDate("13/40", NOW) === "");
}

// ---------------------------------------------------------------------------
section("금액 — 무엇이 거래액인가");
// ---------------------------------------------------------------------------
{
  const acc = parseSmsAmounts("28,500원 일시불 누적 645,000원");
  check("먼저 나온 것이 거래액", acc.amount === 28_500, acc);
  check("누적은 잔액 쪽", acc.balance === 645_000, acc);

  // 잔액이 먼저 오는 문자도 있습니다
  const reversed = parseSmsAmounts("잔액 1,200,000원 출금 30,000원");
  check("안내말이 붙은 쪽은 거래액이 아님", reversed.amount === 30_000, reversed);
  check("그 값은 잔액", reversed.balance === 1_200_000, reversed);

  check("한도는 거래액이 아님", parseSmsAmounts("한도 5,000,000원").amount === 0);
  check("포인트도 아님", parseSmsAmounts("적립 300원").amount === 0);
  check("금액이 없으면 0", parseSmsAmounts("승인되었습니다").amount === 0);
}

// ---------------------------------------------------------------------------
section("여러 건을 한 번에");
// ---------------------------------------------------------------------------
{
  const many = parseSmsBatch(
    [
      "[신한카드 승인] 김*호님 09/08 19:40 배달의민족 28,500원 일시불",
      "[KB국민카드 승인] 김*호님 09/09 13:20 스타벅스 6,300원 일시불",
      "[카카오뱅크 입금] 09/10 18:00 급여 3,600,000원 잔액 6,240,000원",
    ].join("\n\n"),
    NOW
  );
  check("세 건", many.length === 3, many.map((r) => r.merchant));
  check("각각의 금액", many.map((r) => r.amount).join() === "28500,6300,3600000", many);
  check("각각의 방향", many.map((r) => r.type).join() === "EXPENSE,EXPENSE,INCOME", many);

  // 빈 줄 없이 머리말만으로 이어진 경우
  const glued = parseSmsBatch(
    "[신한카드 승인] 09/08 19:40 배달의민족 28,500원[KB국민카드 승인] 09/09 13:20 스타벅스 6,300원",
    NOW
  );
  check("머리말에서 끊음", glued.length === 2, glued.map((r) => r.amount));

  /*
    줄바꿈으로 가맹점을 적는 문자는 쪼개면 조각조각 납니다. 한 덩어리로
    읽히면 한 건으로 둡니다.
  */
  const multiline = parseSmsBatch(
    "[신한카드 승인]\n김*호님 09/08 19:40\n배달의민족\n28,500원 일시불",
    NOW
  );
  check("줄바꿈 문자는 한 건", multiline.length === 1, multiline);
  check("가맹점이 조각나지 않음", multiline[0]?.merchant === "배달의민족", multiline[0]);

  check("빈 글은 빈 목록", parseSmsBatch("", NOW).length === 0);
}

// ---------------------------------------------------------------------------
section("가맹점 — 아는 것을 지우고 남는 말");
// ---------------------------------------------------------------------------
{
  check(
    "머리말·이름·날짜·금액·구분을 모두 지움",
    parseSmsMerchant("[신한카드 승인] 김*호님 09/08 19:40 배달의민족 28,500원 일시불") ===
      "배달의민족"
  );
  check("남는 것이 없으면 빈 문자열", parseSmsMerchant("[신한카드] 28,500원") === "");
  check("영문 가맹점", parseSmsMerchant("[우리카드] 09/18 5,000원 GS25") === "GS25");
}

// ---------------------------------------------------------------------------
section("문자와 명세서가 같은 거래를 가리킬 때");
// ---------------------------------------------------------------------------
{
  /*
    이 기능의 핵심입니다. 문자로 넣은 건은 임시이고, 같은 거래가 나중에
    명세서로 들어옵니다. 그때 두 줄이 되면 그 달 합계가 두 배로 잡히고 카드대금
    자동 연결까지 어긋납니다.

    이름이 같을 수 없다는 것이 문제의 전부입니다 —
    문자 `스타벅스 강남R점` / 명세서 `스타벅스강남알`.
  */
  const row = (extra: any) => ({
    id: extra.id,
    date: "2026-09-08",
    merchant: "스타벅스 강남R점",
    amount: 6_300,
    type: "EXPENSE" as const,
    accountId: "card",
    ...extra,
  });

  const fromSms = row({ id: "s1", origin: "SMS" });
  const probe = {
    date: "2026-09-08",
    merchant: "스타벅스강남알",
    amount: 6_300,
    type: "EXPENSE" as const,
    accountId: "card",
  };

  // duplicateKey 로는 못 잡습니다 — 이름이 다르기 때문입니다
  check(
    "이름이 달라 duplicateKey 는 다른 건으로 봄",
    duplicateKey(fromSms) !== duplicateKey(probe),
    [duplicateKey(fromSms), duplicateKey(probe)]
  );

  const similar = findSimilarEntry([fromSms], probe);
  check("날짜·금액으로는 찾아냄", similar?.id === "s1", similar);
  check("이름이 달라 LIKELY", similar?.kind === "LIKELY", similar);
  check("그 줄이 문자에서 왔음을 알려 줌", similar?.origin === "SMS", similar);

  // 이름까지 같으면 확실합니다
  const exact = findSimilarEntry([fromSms], { ...probe, merchant: "스타벅스 강남R점" });
  check("이름까지 같으면 EXACT", exact?.kind === "EXACT", exact);
  check("공백·대소문자는 무시", findSimilarEntry([fromSms], { ...probe, merchant: "스타벅스강남R점" })?.kind === "EXACT");

  // 다른 계좌·다른 날짜·다른 금액은 남입니다
  check("다른 계좌", findSimilarEntry([fromSms], { ...probe, accountId: "bank" }) === null);
  check("다른 날짜", findSimilarEntry([fromSms], { ...probe, date: "2026-09-09" }) === null);
  check("다른 금액", findSimilarEntry([fromSms], { ...probe, amount: 6_400 }) === null);

  /*
    같은 날 같은 금액이라도 방향이 다르면 다른 사건입니다 — 28,500원 결제와
    28,500원 승인취소.
  */
  check("방향이 다르면 다른 건", findSimilarEntry([fromSms], { ...probe, type: "INCOME" }) === null);

  // 문자 줄과 명세서 줄이 둘 다 있으면 문자 줄을 먼저 집습니다
  const both = [row({ id: "t1", origin: "STATEMENT" }), row({ id: "s2", origin: "SMS" })];
  const preferred = findSimilarEntry(both, probe);
  check("대체할 대상은 문자 줄", preferred?.id === "s2", preferred);

  // 이미 다른 초안이 가져간 줄은 다시 집지 않습니다 (한 줄에 두 건이 붙지 않도록)
  const taken = findSimilarEntry(both, probe, { ignoreIds: new Set(["s2"]) });
  check("가져간 줄은 건너뜀", taken?.id === "t1", taken);

  // 사람이 손으로 넣은 줄은 문자가 아니므로, 명세서가 함부로 덮지 않습니다
  const byHand = findSimilarEntry([row({ id: "m1", origin: "MANUAL" })], probe);
  check("수동 입력 줄도 찾아는 냄", byHand?.id === "m1", byHand);
  check("다만 출처가 SMS 가 아님", byHand?.origin === "MANUAL", byHand);

  check("후보가 없으면 null", findSimilarEntry([], probe) === null);
}

// ---------------------------------------------------------------------------
section("알림 문자는 금액이 적혀 있어도 거래가 아닙니다");
// ---------------------------------------------------------------------------
{
  /*
    금액이 없는 문자는 이미 걸러집니다. 문제는 **금액이 적힌 알림**입니다 —
    청구금액 통지는 한 달치 금액이라 거래로 들어오면 그 달 합계가 통째로
    비틀립니다.
  */
  const notices = [
    "[Web발신] [신한카드] 9월 청구금액 814,623원 09/25 출금예정",
    "[광고] 스타벅스 아메리카노 5,000원 할인쿠폰 도착 무료수신거부 080-123",
    "[카카오뱅크] 자동이체 30,000원 09/25 출금예정",
    "[국민카드] 이용대금 명세서가 발행되었습니다 814,623원",
    "[신한] 인증번호 [123456] 5,000원 이벤트",
  ];
  for (const text of notices) {
    check(`배제: ${text.slice(0, 26)}`, parseSms(text, NOW) === null, parseSms(text, NOW));
  }

  check("광고 표시", looksLikeNotice("[광고] 혜택 안내"));
  check("수신거부 문구", looksLikeNotice("무료수신거부 080-1234"));
  check("출금예정은 아직 일어나지 않은 돈", looksLikeNotice("09/25 출금예정"));
  check("청구금액 통지", looksLikeNotice("9월 청구금액 814,623원"));

  /*
    `안내`만으로 가릴 수는 없습니다 — 실제 우리카드 승인 문자에 `이용안내`가
    들어 있습니다. 이것을 알림으로 보면 진짜 거래가 사라집니다.
  */
  check("이용안내는 알림이 아님", !looksLikeNotice("우리카드 이용안내 승인 49,000원"));
  check("승인 문자는 통과", parseSms("[신한카드 승인] 09/08 배달의민족 28,500원", NOW) !== null);
}

// ---------------------------------------------------------------------------
section("실제 우리카드 문자 — 상투구와 기호 사이에서 가맹점 찾기");
// ---------------------------------------------------------------------------
{
  const woori = [
    "[Web발신]",
    "✅확인된 발신번호",
    "안내",
    "● 우리카드 이용안내",
    "우리(0097)승인",
    "양*현님",
    "49,000원 일시불",
    "09/16",
    "청가술상회",
    "누적2,345,000원",
  ].join("\n");

  const row = parseSms(woori, NOW);
  check("금액", row?.amount === 49_000, row);
  check("누적을 금액으로 읽지 않음", row?.balance === 2_345_000, row);
  check("날짜", row?.date === "2026-09-16", row);
  check("결제 구분", row?.method === "일시불", row);
  check("카드사", row?.issuer === "우리카드", row);

  /*
    `이용안내`·`확인된 발신번호`·`안내` 는 카드사가 머리에 다는 상투구입니다.
    남겨 두면 진짜 가맹점보다 길어서 그쪽이 이름으로 뽑힙니다 — 실제로
    `✅확인된 발신번호`가 가맹점으로 잡혔고, ✅ 때문에 상투구 목록과 글자가
    달라 걸러지지도 않았습니다.
  */
  check("가맹점", row?.merchant === "청가술상회", row);
  check("상투구가 이름이 되지 않음", !/안내|발신번호/.test(row?.merchant || ""), row);

  check("앞뒤 기호를 뗌", parseSmsMerchant("● 홈플러스 ▶ 10,000원") === "홈플러스");
  // 이름 안의 기호는 그대로 둡니다
  check("이름 속 기호는 유지", parseSmsMerchant("(주)엔에스쇼핑 10,000원") === "(주)엔에스쇼핑");
}

// ---------------------------------------------------------------------------
section("여러 건 중 요건에 맞지 않는 것만 빠집니다");
// ---------------------------------------------------------------------------
{
  const mixed = [
    "[신한카드 승인] 김*호님 09/08 19:40 배달의민족 28,500원 일시불",
    "[광고] 카드 발급 이벤트 5,000원 혜택 무료수신거부",
    "[Web발신] [신한카드] 9월 청구금액 814,623원 09/25 출금예정",
    "[KB국민카드 승인] 김*호님 09/09 13:20 스타벅스 6,300원 일시불",
    "[신한] 인증번호 [998877]",
  ].join("\n\n");

  const found = parseSmsBatch(mixed, NOW);
  check("다섯 건 중 두 건만", found.length === 2, found.map((r) => r.merchant));
  check(
    "남은 것은 실제 승인 건",
    found.map((r) => r.amount).join() === "28500,6300",
    found
  );
  check(
    "청구금액 한 달치가 섞이지 않음",
    !found.some((r) => r.amount === 814_623),
    found
  );
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
