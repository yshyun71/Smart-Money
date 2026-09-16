/** Money formatting, shared so every figure reads the same way. */

/** 1234567 → "1,234,567" */
export function withCommas(value: number): string {
  return Math.round(value || 0).toLocaleString("ko-KR");
}

/** 1234567 → "1,234,567원" */
export function won(value: number): string {
  return `${withCommas(value)}원`;
}

/** Compact for axis labels and chips: 12345678 → "1,235만원" */
export function shortWon(value: number): string {
  const amount = Math.round(value || 0);
  if (Math.abs(amount) >= 100000000) {
    return `${(amount / 100000000).toFixed(1)}억원`;
  }
  if (Math.abs(amount) >= 10000) {
    return `${withCommas(Math.round(amount / 10000))}만원`;
  }
  return won(amount);
}

/** Keeps a text input grouped as the user types: "1234000" → "1,234,000" */
export function formatAmountInput(raw: string): string {
  const digits = (raw || "").replace(/[^0-9]/g, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
}

/** Reads a grouped input back: "1,234,000원" → 1234000 */
export function parseAmountInput(raw: string): number {
  const digits = (raw || "").replace(/[^0-9]/g, "");
  return digits ? Number(digits) : 0;
}

/**
 * "2026-09-11T14:00:00.000Z" → "2026년 09월 11일 14시".
 *
 * A balance means nothing without the moment it was true, so this is shown
 * everywhere a balance is.
 */
export function asOfLabel(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "기준일시 없음";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}년 ${pad(date.getMonth() + 1)}월 ${pad(
    date.getDate()
  )}일 ${pad(date.getHours())}시`;
}

/** Splits a stored timestamp into the date and hour a form edits. */
export function asOfParts(iso: string): { date: string; hour: string } {
  const value = new Date(iso);
  const when = Number.isNaN(value.getTime()) ? new Date() : value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
    hour: pad(when.getHours()),
  };
}

/** The inverse: a date input and an hour become a stored timestamp. */
export function asOfFromParts(date: string, hour: string): string {
  const [year, month, day] = (date || "").split("-").map(Number);
  if (!year || !month || !day) return new Date().toISOString();
  const when = new Date(year, month - 1, day, Number(hour) || 0, 0, 0, 0);
  return when.toISOString();
}

/**
 * 연락처를 보이는 대로 끊어 줍니다 — 숫자만 눌러도 010-1234-5678 로.
 *
 * 입력 중에도 자연스럽게 자라도록 자릿수에 따라 나눕니다. 서울 국번(02)만
 * 앞자리가 둘이고 나머지는 셋입니다. 저장은 이 형태 그대로 하고, 자릿수
 * 검사는 숫자만 세므로(`AuthContext`) 하이픈이 끼어도 영향이 없습니다.
 */
export function formatPhone(raw: string): string {
  const digits = (raw || "").replace(/[^0-9]/g, "");
  if (!digits) return "";

  const seoul = digits.startsWith("02");
  const head = seoul ? 2 : 3;

  // 11자리를 넘는 숫자는 전화번호가 아니므로 더 받지 않습니다
  const capped = digits.slice(0, seoul ? 10 : 11);
  if (capped.length <= head) return capped;

  /*
    가운데 자리는 전체 길이가 정해 줍니다: 짧으면 3자리, 길면 4자리. 뒷자리
    4개는 어느 쪽이든 같습니다.

    010 만 예외로 처음부터 4자리입니다. 휴대전화 번호는 11자리로 정해져 있어,
    다 누르기 전에도 끊을 자리를 알 수 있습니다 — 그래야 0101234 가 010-123-4
    였다가 010-1234 로 되돌아가는 일이 없습니다.
  */
  const full = seoul ? 10 : 11;
  const middle = capped.startsWith("010") || capped.length >= full ? 4 : 3;

  if (capped.length <= head + middle) {
    return `${capped.slice(0, head)}-${capped.slice(head)}`;
  }

  return [
    capped.slice(0, head),
    capped.slice(head, head + middle),
    capped.slice(head + middle),
  ].join("-");
}
