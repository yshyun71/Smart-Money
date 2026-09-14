import type { ConnectedAccount } from "../types/finance";

/**
 * One colour per kind of account, used wherever an account is shown.
 *
 * A bank account is indigo and a card is amber throughout — the buttons that
 * register them, the totals above them, the tile beside each one in the list,
 * and the header of its own ledger. Institutions have brand colours, but
 * mixing them in left the two sections looking unrelated to their own totals.
 */
export function accountTone(type: ConnectedAccount["type"]): {
  /** Tailwind background for the icon tile. */
  bg: string;
  /** A matching hex, for anything that has to be an inline style. */
  hex: string;
} {
  return type === "BANK"
    ? { bg: "bg-indigo-600", hex: "#4F46E5" }
    : { bg: "bg-amber-500", hex: "#F59E0B" };
}
