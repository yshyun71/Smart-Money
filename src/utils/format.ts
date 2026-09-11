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
