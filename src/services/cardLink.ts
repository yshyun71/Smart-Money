import type { ConnectedAccount } from "../types/finance";
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
