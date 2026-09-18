import { CARD_ISSUERS } from "./categoryRules";

/**
 * 카드·은행 결제 알림 문자를 거래 한 건으로 읽기.
 *
 * **규칙으로 읽습니다. AI 를 쓰지 않습니다.** 붙여넣은 문자에는 가맹점·금액·
 * 잔액이 담겨 있고, 그것을 외부 서버로 보낼 이유가 없습니다. 한국 카드사
 * 문자는 형식이 거의 고정돼 있어 규칙으로 충분히 읽히고, 그러면 AI 키가
 * 없어도 동작하며 즉시 끝납니다 — 명세서 파싱이 규칙을 먼저 쓰는 것과 같은
 * 이유입니다(7.4).
 *
 * 읽지 못한 칸은 **비워 둡니다.** 지어내는 대신 사용자가 목록에서 고칠 수
 * 있게 하는 것이 이 앱의 규칙입니다(17.1).
 */

export interface ParsedSms {
  /** YYYY-MM-DD. 문자에 연도가 없으면 붙여넣은 시점의 연도로 봅니다. */
  date: string;
  /** HH:mm. 없으면 비웁니다 — 12:00 을 넣으면 있었던 것처럼 보입니다. */
  time: string;
  type: "EXPENSE" | "INCOME";
  amount: number;
  /** 가맹점 또는 입금처. 못 읽으면 빈 문자열. */
  merchant: string;
  /** 문자가 말한 카드사·은행 이름. 어느 계좌로 넣을지 고르는 실마리입니다. */
  issuer: string;
  /** 일시불·정기결제·할부 등, 문자에 적힌 결제 구분. */
  method: string;
  /** 문자가 말한 잔액 또는 누적액. 참고용이며 잔액을 고치지는 않습니다. */
  balance: number | null;
  /** 몇 칸이나 읽혔는지 — 목록에서 손봐야 할 건을 앞세우는 데 씁니다. */
  confidence: "HIGH" | "LOW";
}

const ISSUER_PATTERN = new RegExp(
  `(${CARD_ISSUERS.join("|")})\\s*(?:카드|은행|뱅크|페이)?`,
  "i"
);

/** 금액이 아닌 숫자 앞에 붙는 말 — 이런 것 뒤의 금액은 거래액이 아닙니다. */
const NOT_AMOUNT = ["누적", "잔액", "한도", "포인트", "적립", "잔여", "합계", "총"];

const INCOME_WORDS = ["입금", "이체입금", "급여", "환불", "취소", "반환", "지급"];
const EXPENSE_WORDS = ["승인", "결제", "출금", "이체", "지출", "납부", "인출"];

/**
 * 가맹점 자리에 남지만 가맹점이 아닌 말들.
 *
 * 카드사는 문자 머리에 `이용안내`·`확인된 발신번호` 같은 상투구를 답니다.
 * 이것을 남겨 두면 진짜 가맹점보다 길어서 그쪽이 이름으로 뽑힙니다 — 실제
 * 우리카드 문자에서 `이용안내`가 가맹점으로 잡혔습니다.
 *
 * 조각 전체가 이 말과 같을 때만 버립니다. 부분 일치로 지우면 `안내상회`처럼
 * 이 말을 품은 진짜 이름이 깎입니다.
 */
const BOILERPLATE = [
  "안내",
  "이용안내",
  "확인된발신번호",
  "발신번호",
  "승인내역",
  "이용내역",
  "결제내역",
  "사용내역",
  "알림",
  "님",
];

/**
 * 거래가 아니라 **알림**인 문자.
 *
 * 금액이 없는 문자는 이미 걸러지지만, 금액이 적힌 알림이 있습니다 — 청구금액
 * 통지, 자동이체 예정, 할인 광고. 그것을 거래로 넣으면 그 달 합계가 엉뚱하게
 * 불어나고, 특히 청구금액 통지는 한 달치 금액이라 피해가 큽니다.
 *
 * `안내`라는 말만으로는 가릴 수 없습니다 — 실제 우리카드 승인 문자에도
 * `이용안내`가 들어 있습니다. 그래서 **광고 표시**, **예정/예상**, **청구
 * 통지**라는 세 가지 분명한 신호만 봅니다.
 */
export function looksLikeNotice(text: string): boolean {
  const flat = (text || "").replace(/\s+/g, "");

  // 광고는 법으로 표시가 붙습니다
  if (/\(광고\)|\[광고\]|광고|무료수신거부|수신거부/.test(flat)) return true;

  // 아직 일어나지 않은 돈 — 출금예정·결제예정·이체예정
  if (/(출금|결제|이체|납부|인출|승인)(예정|예상)/.test(flat)) return true;

  // 한 달치 청구 통지. 거래 한 건이 아닙니다
  if (/청구금액|청구예정금액|이용대금|대금명세서|명세서발행/.test(flat)) return true;

  // 인증번호는 금액이 없어 대개 걸러지지만, 있어도 거래가 아닙니다
  if (/인증번호|인증코드|OTP/.test(flat)) return true;

  return false;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** 문자에서 말이 아닌 껍데기를 벗깁니다. */
function clean(text: string): string {
  return (text || "")
    .replace(/\[Web발신\]|\[국외발신\]|\[국제발신\]/g, " ")
    .replace(/\r/g, "")
    .trim();
}

/**
 * 날짜. `09/08` · `09.08` · `2026-09-08` · `09월 08일` 을 읽습니다.
 *
 * 연도가 없는 문자가 대부분입니다. 붙여넣은 시점의 연도를 쓰되, 그 날짜가
 * 미래가 되면 지난해로 봅니다 — 1월에 12월 문자를 넣는 경우입니다.
 */
export function parseSmsDate(text: string, now: Date = new Date()): string {
  const full = text.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (full) {
    return `${full[1]}-${pad(Number(full[2]))}-${pad(Number(full[3]))}`;
  }

  const spelled = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const slashed = text.match(/(?:^|[^\d:])(\d{1,2})[/.](\d{1,2})(?![\d/.])/);
  const found = spelled || slashed;
  if (!found) return "";

  const month = Number(found[1]);
  const day = Number(found[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";

  const year =
    new Date(now.getFullYear(), month - 1, day) >
    new Date(now.getFullYear(), now.getMonth(), now.getDate())
      ? now.getFullYear() - 1
      : now.getFullYear();

  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseSmsTime(text: string): string {
  const found = text.match(/(\d{1,2}):(\d{2})/);
  if (!found) return "";
  const hour = Number(found[1]);
  const minute = Number(found[2]);
  if (hour > 23 || minute > 59) return "";
  return `${pad(hour)}:${pad(minute)}`;
}

/**
 * 거래 금액과, 문자가 말한 잔액.
 *
 * 문자에는 금액이 둘 이상 있습니다 — 쓴 돈과 `누적 645,000원`·`잔액
 * 6,240,000원`. 앞에 붙은 말로 가릅니다. 그 말이 없으면 **처음 나온** 금액이
 * 거래액입니다: 카드사 문자는 쓴 돈을 먼저 적습니다.
 */
export function parseSmsAmounts(text: string): { amount: number; balance: number | null } {
  let amount = 0;
  let balance: number | null = null;

  for (const match of text.matchAll(/([\d,]{2,})\s*원/g)) {
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;

    const before = text.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0);
    const tagged = NOT_AMOUNT.some((word) => before.includes(word));

    if (tagged) {
      if (balance === null) balance = value;
    } else if (amount === 0) {
      amount = value;
    }
  }

  return { amount, balance };
}

export function parseSmsType(text: string): "EXPENSE" | "INCOME" {
  /*
    취소·환불이 승인보다 셉니다. "승인취소"에는 두 말이 함께 있고, 그 건은
    돈이 돌아온 것입니다.
  */
  if (/취소|환불|반환/.test(text)) return "INCOME";
  if (INCOME_WORDS.some((word) => text.includes(word))) return "INCOME";
  if (EXPENSE_WORDS.some((word) => text.includes(word))) return "EXPENSE";
  return "EXPENSE";
}

/** 문자에 적힌 결제 구분 — 일시불·할부·정기결제 등. */
export function parseSmsMethod(text: string): string {
  const found = text.match(/(일시불|정기결제|할부\s*\d{0,2}개?월?|체크|현금서비스|리볼빙)/);
  return found ? found[1].replace(/\s+/g, "") : "";
}

/**
 * 가맹점 이름.
 *
 * 가장 어려운 칸입니다. 카드사마다 자리가 다르고 이름에 공백이 섞여 있어,
 * 아는 것을 모두 지우고 남는 말을 씁니다 — 날짜·시각·금액·카드사·사람 이름
 * (`김*호님`)·결제 구분·잔액 안내를 지웁니다.
 *
 * 남은 것이 없으면 **빈 문자열**입니다. 지어내지 않고, 목록에서 사용자가 적게
 * 합니다.
 */
export function parseSmsMerchant(text: string): string {
  const stripped = clean(text)
    // 괄호로 묶인 머리말: [신한카드 승인]
    .replace(/\[[^\]]*\]/g, " ")
    // 김*호님, 홍길동님
    .replace(/[가-힣*]{2,4}\s*님/g, " ")
    .replace(/(20\d{2})[-./]\d{1,2}[-./]\d{1,2}/g, " ")
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ")
    .replace(/\d{1,2}[/.]\d{1,2}/g, " ")
    .replace(/\d{1,2}:\d{2}/g, " ")
    // 금액과 그 앞의 안내말을 함께
    .replace(
      new RegExp(`(?:${NOT_AMOUNT.join("|")})\\s*[\\d,]{2,}\\s*원`, "g"),
      " "
    )
    .replace(/[\d,]{2,}\s*원/g, " ")
    .replace(/(일시불|정기결제|할부\s*\d{0,2}개?월?|체크|현금서비스|리볼빙)/g, " ")
    .replace(
      new RegExp(`(?:${CARD_ISSUERS.join("|")})\\s*(?:카드|은행|뱅크|페이)?`, "g"),
      " "
    )
    .replace(
      new RegExp(`(?:${[...INCOME_WORDS, ...EXPENSE_WORDS].join("|")})`, "g"),
      " "
    );

  /*
    남은 조각 중 가장 긴 것을 씁니다. 줄바꿈으로 가맹점을 따로 적는 카드사가
    있고, 그런 경우 그 줄이 가장 긴 조각입니다.
  */
  /*
    카드사는 줄머리에 ● ✅ ※ ▶ 같은 기호를 답니다. 가맹점 이름의 끝이 그런
    기호일 수는 없으므로 앞뒤에서 떼어 냅니다 — 떼지 않으면 `✅확인된 발신번호`
    가 상투구 목록과 글자로 달라 그대로 가맹점이 됩니다.
  */
  const trimSymbols = (piece: string) =>
    piece.replace(/^[^가-힣A-Za-z0-9(]+/, "").replace(/[^가-힣A-Za-z0-9)]+$/, "");

  const pieces = stripped
    .split(/[\n\t]+|\s{2,}/)
    .map((piece) => trimSymbols(piece.replace(/\s+/g, " ").trim()))
    .filter((piece) => piece.length >= 2 && /[가-힣A-Za-z]/.test(piece))
    // 상투구는 조각 전체가 그 말일 때만 버립니다
    .filter((piece) => !BOILERPLATE.includes(piece.replace(/\s+/g, "")));

  if (pieces.length === 0) return "";

  return pieces.sort((a, b) => b.length - a.length)[0].slice(0, 60);
}

export function parseSmsIssuer(text: string): string {
  const found = clean(text).match(ISSUER_PATTERN);
  return found ? found[0].replace(/\s+/g, "") : "";
}

/**
 * 문자 한 건을 거래 한 건으로.
 *
 * 금액을 못 읽으면 거래로 보지 않습니다 — 광고나 안내 문자가 목록에 섞이는
 * 것을 막는 유일한 기준입니다.
 */
export function parseSms(raw: string, now: Date = new Date()): ParsedSms | null {
  const text = clean(raw);
  if (!text) return null;

  // 광고·청구 통지·예정 안내는 거래가 아닙니다
  if (looksLikeNotice(text)) return null;

  const { amount, balance } = parseSmsAmounts(text);
  if (amount <= 0) return null;

  const date = parseSmsDate(text, now);
  const merchant = parseSmsMerchant(text);

  return {
    date: date || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: parseSmsTime(text),
    type: parseSmsType(text),
    amount,
    merchant,
    issuer: parseSmsIssuer(text),
    method: parseSmsMethod(text),
    balance,
    // 날짜와 가맹점이 다 읽혔을 때만 손댈 것이 없다고 봅니다
    confidence: date && merchant ? "HIGH" : "LOW",
  };
}

/**
 * 한 번에 공유·붙여넣은 글에서 여러 건을 읽습니다.
 *
 * 문자 앱에서 여러 건을 골라 공유하면 한 덩어리로 옵니다. 빈 줄이나 다음
 * 문자의 머리말(`[…]`)에서 끊습니다.
 */
export function parseSmsBatch(raw: string, now: Date = new Date()): ParsedSms[] {
  const text = clean(raw);
  if (!text) return [];

  /*
    한 덩어리로 읽어 한 건만 나오는 경우가 가장 흔하므로 먼저 시도합니다.
    쪼개기부터 하면 줄바꿈으로 가맹점을 적는 문자가 조각조각 납니다.
  */
  const blocks = text
    .split(/\n\s*\n+|(?=\[(?!Web발신|국외발신|국제발신)[^\]]*\])/)
    .map((block) => block.trim())
    .filter(Boolean);

  const found = blocks
    .map((block) => parseSms(block, now))
    .filter((row): row is ParsedSms => row !== null);

  if (found.length > 0) return found;

  const single = parseSms(text, now);
  return single ? [single] : [];
}
