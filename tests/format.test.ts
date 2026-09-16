/**
 * 화면에 값을 내보이는 규칙.
 *
 * 금액과 연락처는 사람이 눈으로 읽는 형태와 저장하는 형태가 달라, 둘 사이를
 * 오가는 자리에서 조용히 틀리기 쉽습니다 — parseInt("1,234,000")이 1인 것처럼.
 */
import { formatPhone, formatAmountInput, parseAmountInput, won } from "../src/utils/format";

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

// ---------------------------------------------------------------------------
section("연락처 — 숫자만 눌러도 끊어 보입니다");
// ---------------------------------------------------------------------------
{
  const cases: [string, string][] = [
    // 휴대전화 11자리
    ["01012345678", "010-1234-5678"],
    ["010-1234-5678", "010-1234-5678"],
    ["010 1234 5678", "010-1234-5678"],
    // 입력 중에도 자연스럽게 자랍니다
    ["0", "0"],
    ["010", "010"],
    ["0101", "010-1"],
    ["010123", "010-123"],
    ["0101234", "010-1234"],
    ["01012345", "010-1234-5"],
    ["010123456", "010-1234-56"],
    // 지역번호 10자리
    ["0311234567", "031-123-4567"],
    // 서울은 앞자리가 둘
    ["0212345678", "02-1234-5678"],
    ["021234567", "02-123-4567"],
    ["02", "02"],
    ["021", "02-1"],
    // 그 밖
    ["", ""],
    ["abc", ""],
    ["010123456789999", "010-1234-5678"], // 11자리를 넘으면 더 받지 않습니다
  ];

  for (const [raw, want] of cases) {
    const got = formatPhone(raw);
    check(`${JSON.stringify(raw)} → ${want}`, got === want, got);
  }

  // 다시 넣어도 같은 값이어야 합니다 — 입력칸이 자기 값을 되읽습니다
  for (const [raw] of cases) {
    const once = formatPhone(raw);
    check(`멱등: ${JSON.stringify(raw)}`, formatPhone(once) === once, [once, formatPhone(once)]);
  }

  // 자릿수 검사는 숫자만 세므로 하이픈이 끼어도 통과해야 합니다
  const digits = (value: string) => value.replace(/[^0-9]/g, "").length;
  check("11자리 유지", digits(formatPhone("01012345678")) === 11);
  check("10자리 유지", digits(formatPhone("0212345678")) === 10);
}

// ---------------------------------------------------------------------------
section("금액 — 콤마를 넣고 빼기");
// ---------------------------------------------------------------------------
{
  check("콤마 넣기", formatAmountInput("1234000") === "1,234,000", formatAmountInput("1234000"));
  check("이미 콤마가 있어도", formatAmountInput("1,234,000") === "1,234,000");
  check("빈 값", formatAmountInput("") === "");

  // parseInt("1,234,000") 은 1 입니다 — 직접 파싱하지 말라는 이유
  check("콤마를 떼고 읽기", parseAmountInput("1,234,000") === 1_234_000, parseAmountInput("1,234,000"));
  check("숫자가 아니면 0", parseAmountInput("원") === 0);
  check("왕복", parseAmountInput(formatAmountInput("98765")) === 98_765);

  check("원 표기", won(1_234_000) === "1,234,000원", won(1_234_000));
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
