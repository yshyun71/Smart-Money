import type { ConnectedAccount, Transaction } from "../types/finance";
import { CARD_ISSUERS } from "./categoryRules";

/**
 * Tying a card bill on a bank statement to the card it settles.
 *
 * The bank writes only the issuer — "삼성카드출금" — so the link is made by
 * the issuer the line names and the issuer a registered card carries. Where
 * two cards share an issuer the line cannot say which, and the user picks.
 */

function normalise(value: string): string {
  return (value || "").replace(/\s+/g, "").toUpperCase();
}

/** Every issuer name that appears in a piece of text. */
export function issuersIn(text: string): string[] {
  const name = normalise(text);
  if (!name) return [];
  return CARD_ISSUERS.filter((issuer) => name.includes(normalise(issuer)));
}

export function isCardAccount(account: Pick<ConnectedAccount, "type">): boolean {
  return account.type !== "BANK";
}

/**
 * The registered card a description settles, when exactly one fits.
 *
 * Returning nothing on an ambiguous match is deliberate: guessing between two
 * 신한카드s would quietly file a bill against the wrong one.
 */
export function matchCardAccount(
  merchant: string,
  accounts: ConnectedAccount[]
): string | null {
  const wanted = issuersIn(merchant);
  if (wanted.length === 0) return null;

  const hits = accounts
    .filter(isCardAccount)
    .filter((account) =>
      issuersIn(`${account.institution} ${account.name}`).some((issuer) =>
        wanted.includes(issuer)
      )
    );

  return hits.length === 1 ? hits[0].id : null;
}

/** Months as a single number, so two can be compared for nearness. */
function monthIndex(month: string): number {
  const [year, value] = (month || "").split("-").map(Number);
  return (year || 0) * 12 + (value || 0);
}

/**
 * What a card billed in each month, from its own entries.
 *
 * A refund lowers the month it belongs to, which is what makes the total
 * comparable with the single figure the bank withdrew.
 */
export function billingTotalsFor(
  transactions: Transaction[],
  cardId: string
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.accountId !== cardId) continue;
    const month = tx.billingMonth || tx.date.slice(0, 7);
    const signed = tx.type === "INCOME" ? -tx.amount : tx.amount;
    totals.set(month, (totals.get(month) || 0) + signed);
  }

  return totals;
}

/**
 * The billing month a withdrawal settles: the one whose total is exactly the
 * amount withdrawn.
 *
 * The amount is the whole of the evidence, so nothing is matched on a near
 * miss — a bill that does not add up is better left unlinked than tied to the
 * wrong month. A month already claimed by another payment is out of the
 * running, which keeps the mapping one to one.
 */
export function matchBillingMonth(
  totals: Map<string, number>,
  amount: number,
  paidMonth: string,
  claimed: Set<string> = new Set()
): string | null {
  const target = Math.round(amount);

  const candidates = Array.from(totals.entries()).filter(
    ([month, total]) => Math.round(total) === target && !claimed.has(month)
  );
  if (candidates.length === 0) return null;

  // Two months billing the same amount is possible; the nearer one wins
  candidates.sort(
    (a, b) =>
      Math.abs(monthIndex(a[0]) - monthIndex(paidMonth)) -
        Math.abs(monthIndex(b[0]) - monthIndex(paidMonth)) ||
      a[0].localeCompare(b[0])
  );

  return candidates[0][0];
}

/**
 * Which card a withdrawal settles, decided by what it paid for.
 *
 * The issuer written on a bank line narrows the field but does not settle it:
 * two 삼성카드s are two different bills. What tells them apart is the money —
 * exactly one of them billed exactly this amount in one of its months. Only
 * where the amount decides nothing does a lone card of that issuer take it,
 * which is the case where a statement has yet to be imported.
 */
export function matchCardForBill(
  merchant: string,
  amount: number,
  paidMonth: string,
  accounts: ConnectedAccount[],
  transactions: Transaction[],
  claimed: Set<string> = new Set()
): { accountId: string; billingMonth: string | null } | null {
  const cards = accounts.filter(isCardAccount);
  if (cards.length === 0) return null;

  const wanted = issuersIn(merchant);
  const named = cards.filter((card) =>
    issuersIn(`${card.institution} ${card.name}`).some((issuer) => wanted.includes(issuer))
  );

  // A line naming an issuer means one of those cards; otherwise any of them
  const candidates = named.length > 0 ? named : cards;

  const hits = candidates.flatMap((card) => {
    const month = matchBillingMonth(
      billingTotalsFor(transactions, card.id),
      amount,
      paidMonth,
      new Set(
        Array.from(claimed)
          .filter((key) => key.startsWith(`${card.id}|`))
          .map((key) => key.slice(card.id.length + 1))
      )
    );
    return month ? [{ accountId: card.id, billingMonth: month }] : [];
  });

  if (hits.length === 1) return hits[0];

  /*
    Several cards billing the same amount cannot be told apart by it, and
    picking one would file a bill against a card that did not send it. The
    user says which, on the entry itself.
  */
  if (hits.length > 1) return null;

  return named.length === 1 ? { accountId: named[0].id, billingMonth: null } : null;
}

/** The month an entry is billed in, falling back to the one it was used in. */
function billedMonthOf(tx: Transaction): string {
  return tx.billingMonth || tx.date.slice(0, 7);
}

export interface PendingBill {
  /** Entries making up the bill that has not been paid yet. */
  count: number;
  amount: number;
  /**
   * How the period was arrived at:
   * - AFTER_PAYMENT: everything since the last statement the bank settled
   * - LATEST_STATEMENT: the newest statement on file, when payments are behind
   * - THIS_MONTH: usage since the first of this month, with nothing else to go on
   */
  basis: "AFTER_PAYMENT" | "LATEST_STATEMENT" | "THIS_MONTH";
  /** The month or day the period starts at, for saying so on screen. */
  from: string;
}

/**
 * What a card will bill next, read from what has already been settled.
 *
 * The bank statement is the evidence: a withdrawal that matches a month's
 * total says that month is paid, so what is still owed is everything after
 * it. Where the payments have fallen a month or more behind, the last
 * statement on file stands in; where there are no statements either, the
 * month to date is all that can honestly be counted.
 */
export function pendingBill(cardId: string, transactions: Transaction[]): PendingBill {
  const entries = transactions.filter((tx) => tx.accountId === cardId);

  const sum = (rows: Transaction[]) => ({
    count: rows.length,
    amount: rows.reduce(
      (total, tx) => total + (tx.type === "INCOME" ? -tx.amount : tx.amount),
      0
    ),
  });

  // Which statements the bank has paid off
  const totals = billingTotalsFor(transactions, cardId);
  const settled = new Set<string>();
  const payments = transactions
    .filter((tx) => tx.category === "카드대금" && tx.linkedAccountId === cardId)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const payment of payments) {
    const month = matchBillingMonth(
      totals,
      payment.amount,
      payment.date.slice(0, 7),
      settled
    );
    if (month) settled.add(month);
  }

  const lastSettled = Array.from(settled).sort().pop();

  if (lastSettled) {
    const since = entries.filter((tx) => billedMonthOf(tx) > lastSettled);
    const months = new Set(since.map(billedMonthOf));

    // More than one unpaid statement means the payments are behind, and
    // adding them together would not be "이번 달" anything
    if (months.size <= 1) {
      return { ...sum(since), basis: "AFTER_PAYMENT", from: lastSettled };
    }
  }

  // (1) The newest statement on file, which says what it bills
  const billed = entries.filter((tx) => tx.billingMonth);
  if (billed.length > 0) {
    const latest = billed.map((tx) => tx.billingMonth as string).sort().pop() as string;
    return {
      ...sum(entries.filter((tx) => tx.billingMonth === latest)),
      basis: "LATEST_STATEMENT",
      from: latest,
    };
  }

  // (2) Nothing to go on but the calendar
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return {
    ...sum(entries.filter((tx) => tx.date >= start)),
    basis: "THIS_MONTH",
    from: start,
  };
}
