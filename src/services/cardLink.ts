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
