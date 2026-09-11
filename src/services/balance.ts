import type { ConnectedAccount, TransactionType } from "../types/finance";

/**
 * Working out what a set of entries does to an account's recorded balance.
 *
 * A balance is recorded as of a moment. Anything that happened before that
 * moment is already inside the figure, so replaying it would count it twice —
 * only what happened afterwards moves it.
 */

/** An entry, reduced to what the arithmetic actually needs. */
export interface BalanceEntry {
  date: string;
  time?: string;
  type: TransactionType;
  amount: number;
}

/** Milliseconds for an entry's own moment, or NaN when the date is unreadable. */
export function entryMoment(entry: BalanceEntry): number {
  return new Date(`${entry.date}T${entry.time || "12:00"}:00`).getTime();
}

/** True when an entry happened after the balance was last established. */
export function movesBalance(entry: BalanceEntry, balanceAsOf: string): boolean {
  const mark = new Date(balanceAsOf).getTime();
  const when = entryMoment(entry);
  // An unreadable date on either side is no reason to drop the entry
  if (Number.isNaN(mark) || Number.isNaN(when)) return true;
  return when > mark;
}

/**
 * Spending from a bank account lowers its balance and income raises it;
 * spending on a card raises the bill it will send, and a refund lowers it.
 */
export function signedAmount(entry: BalanceEntry, isBank: boolean): number {
  if (isBank) return entry.type === "INCOME" ? entry.amount : -entry.amount;
  return entry.type === "EXPENSE" ? entry.amount : -entry.amount;
}

export interface BalancePlan {
  /** Entries that fall after the balance's own moment. */
  counted: number;
  /** Entries left out because they predate it. */
  ignored: number;
  delta: number;
  current: number;
  next: number;
  /** The moment the adjusted figure is true as of. */
  asOf: string;
}

export function planBalanceAdjustment(
  entries: BalanceEntry[],
  account: Pick<ConnectedAccount, "type" | "balanceOrBilled" | "balanceAsOf">
): BalancePlan {
  const isBank = account.type === "BANK";
  const markMs = new Date(account.balanceAsOf).getTime();

  let delta = 0;
  let counted = 0;
  let latestMs = Number.isNaN(markMs) ? 0 : markMs;

  for (const entry of entries) {
    if (!movesBalance(entry, account.balanceAsOf)) continue;
    counted++;
    delta += signedAmount(entry, isBank);
    const when = entryMoment(entry);
    if (!Number.isNaN(when) && when > latestMs) latestMs = when;
  }

  const current = Number(account.balanceOrBilled || 0);

  return {
    counted,
    ignored: entries.length - counted,
    delta,
    current,
    next: current + delta,
    // Nothing counted means nothing moved, so the old moment still stands
    asOf: counted > 0 ? new Date(latestMs).toISOString() : account.balanceAsOf,
  };
}
