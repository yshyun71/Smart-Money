/*
 * Every statement format the importer is known to read.
 *
 * Run it with `npm test` before committing anything under services/csvImport
 * or the loader: each issuer lays a statement out differently, and a change
 * made for one of them is exactly how the others break. Add a case here the
 * moment a new format is supported, with the values it should produce — not
 * just how many rows, since a count survives reading the wrong column.
 */
import * as XLSX from "xlsx";
import {
  autoDetectMapping,
  billingMonthFromName,
  buildDrafts,
  chooseMapping,
  duplicateKey,
  guessBillingMonth,
  loadStatementFile,
  normaliseDate,
  parseDelimited,
  type BuildOptions,
  type DraftRow,
} from "../src/services/csvImport";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  checks++;
  if (ok) return;
  failures++;
  console.log(`  ✗ ${label}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

function section(name: string) {
  console.log(`\n${name}`);
}

/** Reads a delimited statement the way the import screen does. */
function read(csv: string, options: BuildOptions = {}) {
  const table = parseDelimited(csv);
  const mapping = autoDetectMapping(table.headers, table.rows);
  return { table, mapping, ...buildDrafts(table, mapping, options) };
}

/** Compares the parts of a draft that matter, ignoring the rest. */
function like(draft: DraftRow | undefined, expected: Partial<DraftRow>): boolean {
  if (!draft) return false;
  return Object.entries(expected).every(
    ([key, value]) => draft[key as keyof DraftRow] === value
  );
}

function fileOf(name: string, bytes: Uint8Array): File {
  return {
    name,
    type: "",
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

// ---------------------------------------------------------------------------
section("통장 거래내역 — 출금과 입금이 별도 열");
// ---------------------------------------------------------------------------
{
  const r = read(
    [
      "○○은행 거래내역조회",
      "조회기간 2026-08-01 ~ 2026-08-31",
      "거래일시,적요,의뢰인/수취인,출금액,입금액,잔액",
      "2026-08-01 09:30,급여,(주)테크솔루션,,4500000,5000000",
      "2026-08-02 12:15,체크카드,본가한식당,12000,,4988000",
      "2026-08-14 10:00,자동이체,KB카드출금,1162344,,3825656",
    ].join("\n")
  );

  check("제목 줄을 건너뛰고 머리글을 찾음", r.mapping.date === 0, r.table.headers);
  check("3건", r.drafts.length === 3, r.drafts.length);
  check(
    "입금은 수입",
    like(r.drafts[0], { date: "2026-08-01", merchant: "(주)테크솔루션", amount: 4_500_000, type: "INCOME" }),
    r.drafts[0]
  );
  check(
    "출금은 지출",
    like(r.drafts[1], { date: "2026-08-02", merchant: "본가한식당", amount: 12_000, type: "EXPENSE" }),
    r.drafts[1]
  );
  check("카드대금으로 분류", r.drafts[2]?.category === "카드대금", r.drafts[2]);
  check("잔액은 금액이 아님", r.mapping.amount === -1, r.mapping);
  check("시각도 읽음", r.drafts[0]?.time === "09:30", r.drafts[0]?.time);
}

// ---------------------------------------------------------------------------
section("KB국민카드 — 두 줄 머리글, 이번달 결제금액 원금");
// ---------------------------------------------------------------------------
{
  const r = read(
    [
      "이용일자,이용카드,구분,이용하신 가맹점,,이용금액,할부개월,이번달 결제금액,,,결제 후 잔액,,적립예정 포인트",
      "이용일자,이용카드,구분,이용하신 가맹점,,이용금액,할부개월,회차,원금,수수료(이자),회차,원금,적립예정 포인트",
      '25.10.19,JCB097,할부,롯데백화점-방송이산마1, ,"279,000",10,9,"25,947",838,1,"25,947", ',
      " , , ,무이자할부금액, , , , , ,-838, , , ",
      '26.06.01,JCB097,리볼빙-일시,(주)다올이앤에스-에넥스몰, ,"59,810", , ,"59,810", , , , ',
      '26.06.24,JCB097,리볼빙-일시,KB아파트관리비-26년05월분, ,"238,580", , ,"238,580", , , , ',
      '본인회원  소계 41 건 ,,,,,, , ,"964,708",46, ,"218,169", ',
      '합 계 45 건 ,,,,,, , ,"1,035,170",46, ,"278,169", ',
    ].join("\n")
  );

  check("두 줄 머리글 병합", r.table.headers[8] === "이번달 결제금액 원금", r.table.headers[8]);
  check("회차는 금액이 아님", r.mapping.withdrawal === 8, r.mapping);
  check("적립 포인트는 입금이 아님", r.mapping.deposit === -1, r.mapping);
  check("구분이 메모로", r.mapping.memo === 2, r.mapping);
  check("3건", r.drafts.length === 3, r.drafts.map((d) => d.merchant));
  check(
    "할부는 이번달 원금",
    like(r.drafts[0], { date: "2025-10-19", amount: 25_947, type: "EXPENSE" }),
    r.drafts[0]
  );
  check("회차가 메모에 실림", r.drafts[0]?.memo === "할부 9회차", r.drafts[0]?.memo);
  check("일시불은 회차 없음", r.drafts[1]?.memo === "리볼빙-일시", r.drafts[1]?.memo);
  check("일시불", like(r.drafts[1], { date: "2026-06-01", amount: 59_810 }), r.drafts[1]);
  check("관리비는 주거", r.drafts[2]?.category === "주거", r.drafts[2]);
  check(
    "소계·합계·환급 줄은 제외",
    !r.drafts.some((d) => /소계|합 계|무이자할부금액/.test(d.merchant)),
    r.drafts.map((d) => d.merchant)
  );
}

// ---------------------------------------------------------------------------
section("신한카드 — 파일 중간의 표, 이번달 납부금액, 여러 섹션");
// ---------------------------------------------------------------------------
{
  const csv = [
    "2026년9월 이용대금명세서(신용카드),,,,,,,,,,",
    "카드부분,결제일,결제순번,결제계좌,,명세서 받는 방법,,,,,",
    "신용카드,2026.09.14,0001,신한은행 / 11048*****23,,모바일,,,,,",
    "1-2. 이용금액현황 조회,,,,,,,,,,",
    "월구분,사용 분류,이용 금액,,,,,,,,",
    '이번달,연회비,"5,000",,,,,,,,',
    "2-2. 마이신한포인트,,,,,,,,,,",
    "포인트 이름,잔여,10월 소멸예정,,,,,,,,",
    "마이신한포인트,408,0,,,,,,,,",
    "3. 카드사용내역,,,,,,,,,,",
    "이용일,이용카드,이용가맹점,이용금액,할부기간,회차,이번달 납부금액,,신용 구분,결제 후 잔액,포인트적립율",
    ",,,,,,원금,수수료(이자),,,",
    '2026.08.03,본인724,스타벅스 강남점,"5,500",,,"5,500",0,일시불,0,0',
    ',본인724,기본연회비,"5,000",,,"5,000",0,,0,0',
    '총합계,,,,,,"10,500",0,,0,',
    "5.취소매출 상세내역,,,,,,,,,,",
    "이용일,이용카드,상품구분,이용가맹점,원거래금액,취소금액,취소일,처리일,처리결과,,",
    "취소매출 내역이 없습니다.,,,,,,,,,,",
  ].join("\n");

  const r = read(csv);
  check("요약 블록이 아닌 카드사용내역을 고름", r.table.headers[2] === "이용가맹점", r.table.headers);
  check("납부금액 원금이 지출 열", r.mapping.withdrawal === 6, r.mapping);
  check("뒤 섹션은 표 밖", r.table.rows.length <= 3, r.table.rows.length);
  check("날짜 있는 1건", r.drafts.length === 1, r.drafts.map((d) => d.merchant));
  check("금액", like(r.drafts[0], { date: "2026-08-03", amount: 5_500, memo: "일시불" }), r.drafts[0]);

  // 연회비처럼 이용일이 없는 줄은 결제월을 줬을 때만 들어온다
  const withMonth = read(csv, { fallbackDate: "2026-09-01" });
  check("결제월을 주면 연회비까지 2건", withMonth.drafts.length === 2, withMonth.drafts.map((d) => d.merchant));
  const fee = withMonth.drafts.find((d) => d.merchant === "기본연회비");
  check("연회비는 결제월 1일", like(fee, { date: "2026-09-01", amount: 5_000 }), fee);
  check(
    "합계 줄은 결제월을 줘도 제외",
    !withMonth.drafts.some((d) => d.merchant.includes("합계")),
    withMonth.drafts.map((d) => d.merchant)
  );
}

// ---------------------------------------------------------------------------
section("롯데카드 — 입금하실 금액, 수수료만 있는 줄");
// ---------------------------------------------------------------------------
{
  const r = read(
    [
      "■ 요약내역,,,,,,,,,,,,",
      "이용내역,금액,,,,,,,,,,,",
      '할부,"13,600",,,,,,,,,,,',
      "■ 상세내역,,,,,,,,,,,,",
      "이용일,이용카드,이용가맹점,이용총액,회차,할부,이번 달 입금하실 금액,,적립예정,적립예정,이용혜택,혜택금액,결제 후 잔액",
      ",,,,,,원금,수수료,,,,,",
      '2026.04.11,본인LOCA LIKIT 1.2,에스케이스토아,"136,800원",5,10,"13,600",,,,무이자할부,"1,322","68,000"',
      "2026.08.11,본인LOCA LIKIT 1.2,07월 크레딧케어,,,,,990,,,,,",
    ].join("\n")
  );

  check("입금하실 금액은 지출", r.mapping.withdrawal === 6, r.mapping);
  check("입금 열 없음", r.mapping.deposit === -1, r.mapping);
  check("수수료 열 인식", r.mapping.fee === 7, r.mapping);
  check("2건", r.drafts.length === 2, r.drafts.map((d) => d.amount));
  check("원금", like(r.drafts[0], { date: "2026-04-11", amount: 13_600, type: "EXPENSE" }), r.drafts[0]);
  check(
    "수수료만 있는 줄",
    like(r.drafts[1], { date: "2026-08-11", merchant: "07월 크레딧케어", amount: 990, type: "EXPENSE" }),
    r.drafts[1]
  );
  check("합계가 명세서와 같음", r.drafts.reduce((sum, d) => sum + d.amount, 0) === 14_590);
  check("회차 열 인식", r.mapping.instalment === 4, r.mapping);
  check("회차와 할부개월이 메모로", r.drafts[0]?.memo === "5/10", r.drafts[0]?.memo);

  /*
    같은 할부가 다음 달에 다시 청구된다. 이용일·가맹점·금액이 모두 같고 회차만
    다르므로, 회차를 읽지 못하면 두 번째 달이 중복으로 걸러진다 — 실제로 9건 중
    8건만 등록되던 원인이다.
  */
  const next = read(
    [
      "이용일,이용카드,이용가맹점,이용총액,회차,할부,이번 달 입금하실 금액,,적립예정",
      ",,,,,,원금,수수료,",
      '2026.04.11,본인LOCA,에스케이스토아,"136,800원",6,10,"13,600",,',
    ].join("\n")
  );
  check("다음 달은 회차가 다름", next.drafts[0]?.memo === "6/10", next.drafts[0]?.memo);
  check(
    "그래서 중복이 아님",
    duplicateKey(r.drafts[0]) !== duplicateKey(next.drafts[0]),
    [duplicateKey(r.drafts[0]), duplicateKey(next.drafts[0])]
  );
  check(
    "같은 회차는 여전히 중복",
    duplicateKey(r.drafts[0]) === duplicateKey({ ...r.drafts[0] }),
    duplicateKey(r.drafts[0])
  );
}

// ---------------------------------------------------------------------------
section("결제금액 열이 비어 있는 명세서 — 데이터로 다시 찾기");
// ---------------------------------------------------------------------------
{
  const r = read(
    [
      "이용일자,가맹점명,이용금액,결제금액,할부개월",
      "2026-08-03,스타벅스 강남점,5500,,0",
      "2026-08-04,쿠팡,48500,,0",
      "2026-08-05,GS25 역삼점,3200,,0",
    ].join("\n")
  );
  check("3건 모두", r.drafts.length === 3, { got: r.drafts.length, mapping: r.mapping });
  check("이용금액을 씀", r.drafts[0]?.amount === 5_500, r.drafts[0]);
}

// ---------------------------------------------------------------------------
section("날짜 형식");
// ---------------------------------------------------------------------------
{
  const thisYear = new Date().getFullYear();
  const cases: [string, string | null][] = [
    ["2026-09-05", "2026-09-05"],
    ["2026.9.5", "2026-09-05"],
    ["20260905", "2026-09-05"],
    ["2026-09-05 14:23", "2026-09-05"],
    ["26.08.03", "2026-08-03"],
    ["26/8/3", "2026-08-03"],
    ["260803", "2026-08-03"],
    ["09-05", `${thisYear}-09-05`],
    ["2026-13-05", null],
    ["26.13.03", null],
    ["합계", null],
    ["", null],
  ];
  for (const [input, want] of cases) {
    check(`날짜 ${JSON.stringify(input)}`, normaliseDate(input) === want, normaliseDate(input));
  }
}

// ---------------------------------------------------------------------------
section("롯데카드 — 같은 표를 .xls(HTML)로 받았을 때");
// ---------------------------------------------------------------------------
{
  /* 합쳐진 머리글 칸을 HTML이 쓰는 방식 그대로: 금액 두 칸은 colspan,
     나머지는 rowspan. */
  const html = `<html><head><meta charset="utf-8"></head><body>
<table>
 <tr><th>이용내역</th><th>금액</th></tr>
 <tr><td>할부</td><td>13,600</td></tr>
 <tr><td>합계</td><td>14,590</td></tr>
</table>
<table>
 <tr>
  <th rowspan="2">이용일</th><th rowspan="2">이용카드</th><th rowspan="2">이용가맹점</th>
  <th rowspan="2">이용총액</th><th rowspan="2">회차</th><th rowspan="2">할부</th>
  <th colspan="2">이번 달 입금하실 금액</th>
  <th rowspan="2">적립예정</th><th rowspan="2">이용혜택</th><th rowspan="2">혜택금액</th>
 </tr>
 <tr><th>원금</th><th>수수료</th></tr>
 <tr><td>2026.04.11</td><td>본인LOCA LIKIT 1.2</td><td>에스케이스토아</td><td>136,800원</td><td>5</td><td>10</td><td>13,600</td><td></td><td></td><td>무이자할부</td><td>1,322</td></tr>
 <tr><td>2026.08.11</td><td>본인LOCA LIKIT 1.2</td><td>07월 크레딧케어</td><td></td><td></td><td></td><td></td><td>990</td><td></td><td></td><td></td></tr>
</table>
</body></html>`;

  const loaded = await loadStatementFile(
    fileOf("이용대금명세서.xls", new TextEncoder().encode(html))
  );
  const r = read(loaded.text);

  check("요약표가 아닌 상세내역을 고름", r.table.headers[2] === "이용가맹점", r.table.headers);
  check("colspan 머리글 병합", r.table.headers[6] === "이번 달 입금하실 금액 원금", r.table.headers[6]);
  check("xls에서도 2건", r.drafts.length === 2, r.drafts.map((d) => `${d.merchant} ${d.amount}`));
  check("xls: 원금", like(r.drafts[0], { amount: 13_600, type: "EXPENSE" }), r.drafts[0]);
  check("xls: 수수료만 있는 줄", like(r.drafts[1], { amount: 990, type: "EXPENSE" }), r.drafts[1]);
}

// ---------------------------------------------------------------------------
section("기억된 형식 — 규칙이 나아지면 물러설 것");
// ---------------------------------------------------------------------------
{
  const lotte = [
    "이용일,이용카드,이용가맹점,이용총액,회차,할부,이번 달 입금하실 금액,,적립예정,이용혜택",
    ",,,,,,원금,수수료,,",
    '2026.04.11,본인LOCA,에스케이스토아,"136,800원",5,10,"13,600",,,무이자할부',
    "2026.08.11,본인LOCA,07월 크레딧케어,,,,,990,,",
  ].join("\n");

  const table = parseDelimited(lotte);
  const guess = autoDetectMapping(table.headers, table.rows);

  // 수수료 열을 읽기 전에 저장된 지정: 원금을 입금으로 본다
  const stale = { ...guess, withdrawal: -1, deposit: 6, fee: -1 };

  const superseded = chooseMapping(table, stale, guess);
  check("낡은 기억은 물러섬", superseded.source === "RULES", superseded.source);
  check("새 인식이 쓰임", superseded.mapping.withdrawal === 6 && superseded.mapping.fee === 7, superseded.mapping);

  const stillGood = chooseMapping(table, guess, guess);
  check("맞는 기억은 그대로", stillGood.source === "REMEMBERED", stillGood.source);

  // 사용자가 일부러 고른 지정(파일을 온전히 읽는다면)은 존중한다
  const deliberate = { ...guess, merchant: 1 };
  const kept = chooseMapping(table, deliberate, guess);
  check("사용자가 고른 지정 존중", kept.source === "REMEMBERED" && kept.mapping.merchant === 1, kept.mapping);

  check("기억이 없으면 규칙", chooseMapping(table, null, guess).source === "RULES");

  // 그리고 실제로 읽히는 결과가 달라진다
  const withStale = buildDrafts(table, stale);
  const withFresh = buildDrafts(table, superseded.mapping);
  check("낡은 기억으로는 1건", withStale.drafts.length === 1, withStale.drafts.length);
  check("다시 인식하면 2건", withFresh.drafts.length === 2, withFresh.drafts.map((d) => d.amount));
  check("방향도 바로잡힘", withFresh.drafts[0]?.type === "EXPENSE", withFresh.drafts[0]?.type);
}

// ---------------------------------------------------------------------------
section("결제월 추정 — 파일 이름, 없으면 이용월의 다음 달");
// ---------------------------------------------------------------------------
{
  const named: [string, string | null][] = [
    ["2026년3월 이용대금명세서(신한카드).xls", "2026-03"],
    ["2026년 12월 이용대금명세서.xls", "2026-12"],
    ["신한카드_202603_명세서.csv", "2026-03"],
    ["202607_usage.csv", "2026-07"],
    ["2026-03 카드내역.xlsx", "2026-03"],
    ["카드내역 2026.09.csv", "2026-09"],
    ["카드내역_20260803.xls", null], // 8자리는 날짜, 결제월이 아니다
    ["이용대금명세서.xls", null],
    ["2026년13월.xls", null],
    ["", null],
    // 롯데 — 네 자리 2608이 결제월, 뒤의 14자리는 내려받은 일시일 뿐이다
    ["이용대금명세서_2608(신용.체크)_20260915091506.xls", "2026-08"],
    ["이용대금명세서_2512(신용)_20251215.xls", "2025-12"],
    ["명세서_20260915091506.xls", null], // 생성일시만 있으면 이름은 아무 말도 안 한 것
    ["명세서_20260915.xls", null],
    ["명세서_2026.xls", null], // 연도일 뿐, 26월은 없다
    ["명세서_2613.xls", null], // 13월도 없다
    ["명세서_1908.xls", null], // 19년은 카드 명세서의 연도로 보지 않는다
  ];
  for (const [name, want] of named) {
    check(`이름 ${JSON.stringify(name)}`, billingMonthFromName(name) === want, billingMonthFromName(name));
  }

  const used = (date: string, memo?: string) => ({ date, memo });

  check(
    "이름에 있으면 그 연월이 곧 결제월",
    guessBillingMonth("2026년3월 명세서.xls", [used("2026-01-05"), used("2026-01-20")]) === "2026-03"
  );
  check(
    "없으면 이용월의 다음 달",
    guessBillingMonth("명세서.xls", [used("2026-08-03"), used("2026-08-31")]) === "2026-09"
  );
  check("연말은 다음 해로", guessBillingMonth("명세서.xls", [used("2026-12-30")]) === "2027-01");
  check(
    "이름이 생성일시뿐이면 이용일자로 내려간다",
    guessBillingMonth("명세서_20260915091506.xls", [used("2026-07-02"), used("2026-07-28")]) ===
      "2026-08"
  );
  check(
    "네 자리 결제월은 이용일자보다 앞선다 — 8월 청구서를 9월에 내려받아도 8월",
    guessBillingMonth("이용대금명세서_2608(신용.체크)_20260915091506.xls", [
      used("2026-07-31"),
      used("2026-08-11"),
    ]) === "2026-08"
  );
  check(
    "가장 늦은 이용월 기준",
    guessBillingMonth("x.xls", [used("2026-06-01"), used("2026-08-11")]) === "2026-09"
  );
  check(
    "할부는 추측에서 제외 — 몇 달 전 구매일을 갖고 있다",
    guessBillingMonth("x.xls", [
      used("2025-10-19", "할부 9/10"),
      used("2026-08-03", "일시불"),
    ]) === "2026-09"
  );
  check(
    "할부가 더 최근이어도 일시불 기준",
    guessBillingMonth("x.xls", [
      used("2026-08-03", "일시불"),
      used("2026-09-20", "할부 2/6"),
    ]) === "2026-09"
  );
  check(
    "할부뿐이면 그것으로라도",
    guessBillingMonth("x.xls", [used("2026-08-03", "할부 3/6")]) === "2026-09"
  );
  check("이용 내역이 없으면 비움", guessBillingMonth("x.xls", []) === null);
}

// ---------------------------------------------------------------------------
section("중복 판정 — 할부 회차");
// ---------------------------------------------------------------------------
{
  const base = { date: "2026-03-15", merchant: "가전마트", amount: 100_000 };
  check("회차가 다르면 다른 건", duplicateKey({ ...base, memo: "할부 8/10" }) !== duplicateKey({ ...base, memo: "할부 9/10" }));
  check("같은 회차면 같은 건", duplicateKey({ ...base, memo: "8/10" }) === duplicateKey({ ...base, memo: "할부 8/10" }));
  check("일시불은 회차가 붙지 않음", duplicateKey({ ...base, memo: "일시불" }) === duplicateKey(base));
  check(
    "개월 수를 모르는 회차도 구분됨",
    duplicateKey({ ...base, memo: "할부 4회차" }) !== duplicateKey({ ...base, memo: "할부 5회차" })
  );
}

// ---------------------------------------------------------------------------
section("파일 형태 — .xls라는 이름이 붙은 것들");
// ---------------------------------------------------------------------------
{
  const rows = ["이용일,이용가맹점,이용금액", "2026.08.03,스타벅스 강남점,5500", "2026.08.04,쿠팡,48500"];

  // (1) 텍스트를 .xls로 저장한 경우 — 한글이 깨지면 안 된다
  {
    const loaded = await loadStatementFile(
      fileOf("명세서.xls", new TextEncoder().encode(rows.join("\n")))
    );
    const r = read(loaded.text);
    check("CSV를 .xls로: 2건", r.drafts.length === 2, r.drafts.length);
    check("CSV를 .xls로: 한글 유지", r.drafts[0]?.merchant === "스타벅스 강남점", r.drafts[0]?.merchant);
  }

  // (2) HTML을 .xls로 — 표마다 시트가 하나씩 생긴다
  {
    const table = (cells: string[][]) =>
      `<table>${cells.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
    const html = `<html><head><meta charset="utf-8"></head><body>
${table([["2026년3월 이용대금명세서"]])}
${table([["월구분", "사용 분류", "이용 금액"], ["이번달", "일시불", "41,940"]])}
${table([
  ["이용일", "이용카드", "이용가맹점", "이용금액", "할부기간", "회차", "이번달 납부금액", "", "적용 구분"],
  ["", "", "", "", "", "", "원금", "수수료(이자)", ""],
  ["2026.03.04", "본인724", "홈플러스방학점", "41,940", "", "", "41,940", "0", "일시불"],
])}
</body></html>`;

    const loaded = await loadStatementFile(fileOf("명세서.xls", new TextEncoder().encode(html)));
    check("HTML: 표마다 시트", loaded.sheetNames.length >= 3, loaded.sheetNames.length);

    const r = read(loaded.text);
    check("HTML: 내역 표를 고름", r.table.headers[2] === "이용가맹점", r.table.headers);
    check("HTML: 1건", like(r.drafts[0], { merchant: "홈플러스방학점", amount: 41_940 }), r.drafts[0]);

    // 사용자가 시트를 고르면 그 시트를 쓴다
    const picked = await loadStatementFile(fileOf("명세서.xls", new TextEncoder().encode(html)), loaded.sheetNames[0]);
    check("HTML: 시트 선택이 반영됨", picked.usedSheet === loaded.sheetNames[0], picked.usedSheet);

    const whole = await loadStatementFile(fileOf("명세서.xls", new TextEncoder().encode(html)), "");
    check("HTML: 전체 합쳐 읽기", whole.usedSheet === null, whole.usedSheet);
  }

  // (3) 진짜 워크북 — 표지 시트가 아니라 내역 시트를 골라야 한다
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["2026년3월 이용대금명세서"], [null, "2026.03.26", 1]]),
      "표지"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["이용일", "이용가맹점", "이용금액"],
        ["2026.03.04", "홈플러스방학점", 41940],
      ]),
      "카드사용내역"
    );
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "biff8" }));

    const loaded = await loadStatementFile(fileOf("명세서.xls", bytes));
    check("워크북: 내역 시트를 고름", loaded.usedSheet === "카드사용내역", loaded.usedSheet);
    const r = read(loaded.text);
    check("워크북: 1건", like(r.drafts[0], { merchant: "홈플러스방학점", amount: 41_940 }), r.drafts[0]);

    const picked = await loadStatementFile(fileOf("명세서.xls", bytes), "표지");
    check("워크북: 시트 선택이 반영됨", picked.usedSheet === "표지", picked.usedSheet);
  }
}

// ---------------------------------------------------------------------------
console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`} — ${checks}개 확인`
);
if (failures > 0) process.exitCode = 1;
