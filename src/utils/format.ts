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
