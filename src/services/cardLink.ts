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
 * Whether an entry could be a card bill being paid.
 *
 * A bill is money leaving a bank account. A line inside a card's own statement
 * never is, however much it reads like one — 우리카드 bills a discount as
 * "차감-[청구할인] 청호나이스 우리카드II …", which names an issuer and so was
 * being filed as 카드대금 and linked to a statement of its own card. Part of a
 * statement cannot stand for the statement.
 */
export function settlesFromBank(
  accountId: string,
  accounts: ConnectedAccount[]
): boolean {
  const account = accounts.find((candidate) => candidate.id === accountId);
  return Boolean(account) && !isCardAccount(account as ConnectedAccount);
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

export interface BillDisplay {
  amount: number;
  headline: string;
  detail: string;
  count: number;
}

/**
 * 그 카드가 지금 무엇을 보여 줘야 하는가.
 *
 * 대금을 이미 냈고 그 뒤로 쓴 것이 없으면 `0원 이번 달 청구예정`이 됩니다 —
 * 쓰지 않은 카드처럼 읽히지, 정산된 카드로 읽히지 않습니다. 그럴 때는 낸
 * 금액과 `결재완료`를 보여 주는 편이 사실에 가깝습니다(§9.4).
 *
 * 낸 뒤에 또 쓴 것이 있으면 그 금액은 아직 낼 돈이므로 `청구예정`이 맞습니다.
 *
 * **화면이 아니라 여기에 둡니다.** 카드·계좌 화면 안에 있던 것을 옮겼습니다 —
 * 홈 화면의 자산 요약이 같은 카드를 두고 **다른 말**을 하고 있었기 때문입니다:
 * 저장된 `balance_or_billed` 를 읽어 `0원 청구예정`이라고 적었는데, 그 값은
 * 카드에 대해서는 아무도 갱신하지 않는 칸입니다(청구액은 계산하는 값입니다).
 */
export function describeBill(bill: PendingBill): BillDisplay {
  const month = (key: string) => `${Number(key.slice(5, 7))}월`;

  if (bill.settledMonth && bill.amount === 0) {
    return {
      amount: bill.settledAmount,
      headline: `${month(bill.settledMonth)} 결재완료`,
      detail: "이후 이용 내역 없음",
      count: 0,
    };
  }

  const detail =
    bill.basis === "AFTER_PAYMENT"
      ? `${month(bill.from)} 결제 이후 이용분`
      : bill.basis === "LATEST_STATEMENT"
        ? `${month(bill.from)} 명세서 기준`
        : `${month(bill.from)} 1일부터 이용분`;

  return {
    amount: bill.amount,
    headline: "이번 달 청구예정",
    detail,
    count: bill.count,
  };
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
  /**
   * The newest statement a withdrawal has actually settled, if any.
   *
   * Without this the screen could only ever promise: a card whose bill was
   * paid and has had no use since showed "0원 이번 달 청구예정", which reads
   * as a dormant card rather than a settled one. What was paid, and for which
   * month, is the more useful thing to say.
   */
  settledMonth: string | null;
  settledAmount: number;
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
    .filter(
      (tx) =>
        tx.category === "카드대금" &&
        tx.linkedAccountId === cardId &&
        // A card cannot settle its own bill; such a link is stale data
        tx.accountId !== cardId
    )
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
      return {
        ...sum(since),
        basis: "AFTER_PAYMENT",
        from: lastSettled,
        settledMonth: lastSettled,
        settledAmount: Math.round(totals.get(lastSettled) ?? 0),
      };
    }
  }

  /*
    결제가 두 달 이상 밀린 경우에도 마지막으로 낸 달은 알려 줍니다 — 아래
    분기가 보여 주는 금액은 아직 낸 돈이 아니지만, 무엇까지 냈는지는 여전히
    사실입니다.
  */
  const paid = lastSettled
    ? { settledMonth: lastSettled, settledAmount: Math.round(totals.get(lastSettled) ?? 0) }
    : { settledMonth: null, settledAmount: 0 };

  // (1) The newest statement on file, which says what it bills
  const billed = entries.filter((tx) => tx.billingMonth);
  if (billed.length > 0) {
    const latest = billed.map((tx) => tx.billingMonth as string).sort().pop() as string;
    return {
      ...sum(entries.filter((tx) => tx.billingMonth === latest)),
      basis: "LATEST_STATEMENT",
      from: latest,
      ...paid,
    };
  }

  // (2) Nothing to go on but the calendar
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  return {
    ...sum(entries.filter((tx) => tx.date >= start)),
    basis: "THIS_MONTH",
    from: start,
    ...paid,
  };
}

/**
 * Every link between a card bill and the withdrawal that pays it, worked out
 * afresh for the cards a change could have affected.
 *
 * The link has two sides and either one can complete it. A statement arriving
 * makes a month's total equal to a withdrawal already sitting in the account
 * the card is paid from; a bank statement arriving brings the withdrawal to a
 * month already on file. Watching only the card side left the second case
 * unlinked for good — the card was never looked at again — which is why a
 * June bill matching its withdrawal to the won stayed unconnected.
 *
 * Run it backwards and it releases: delete the month and the withdrawal
 * matches nothing, so the link it carried is cleared rather than left
 * pointing at a statement that is no longer there.
 *
 * Returns only the entries whose link changed.
 */
export function planCardLinks(
  accounts: ConnectedAccount[],
  transactions: Transaction[],
  touchedAccountIds: string[],
  cardPaymentCategory: string
): Transaction[] {
  const touched = new Set(touchedAccountIds);

  const cards = accounts.filter(
    (account) =>
      isCardAccount(account) &&
      // Either side of the link: the card's own entries, or its payer's
      (touched.has(account.id) ||
        (account.paymentAccountId
          ? touched.has(account.paymentAccountId)
          : // No payer named, so any change could be the other side of it
            touched.size > 0))
  );
  if (cards.length === 0) return [];

  const updates: Transaction[] = [];

  for (const card of cards) {
    const totals = billingTotalsFor(transactions, card.id);

    /*
      Which withdrawals could be paying this card.

      Naming a payment account settles it. Without one there is still an
      answer where the bank writes the issuer and only one card of that issuer
      is registered — the same standard `matchCardAccount` holds to, and the
      amount must still agree to the won. Requiring the payment account
      outright meant a card registered without one could never be linked by
      anything, however exactly its bill matched.
    */
    const payments = transactions
      .filter((tx) => {
        if (tx.category !== cardPaymentCategory) return false;
        // A bill is paid out of a bank account, never out of a card's own lines
        if (!settlesFromBank(tx.accountId, accounts)) return false;
        if (card.paymentAccountId) return tx.accountId === card.paymentAccountId;
        return touched.has(tx.accountId) && matchCardAccount(tx.merchant, accounts) === card.id;
      })
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));

    const claimed = new Set<string>();

    for (const payment of payments) {
      /*
        A withdrawal another card has already claimed is left alone. Two cards
        paid from one account can bill the same amount in the same month, and
        whichever was examined last would otherwise take the link off the card
        that actually sent the bill.
      */
      if (payment.linkedAccountId && payment.linkedAccountId !== card.id) continue;

      const month = matchBillingMonth(
        totals,
        payment.amount,
        payment.date.slice(0, 7),
        claimed
      );

      if (month) {
        claimed.add(month);
        // Which statement, not just which card: the answer is kept rather
        // than worked out again wherever it is shown.
        if (payment.linkedAccountId !== card.id || payment.billingMonth !== month) {
          updates.push({ ...payment, linkedAccountId: card.id, billingMonth: month });
        }
        continue;
      }

      /*
        Nothing this card bills comes to this amount any more — the statement
        that justified the link has been deleted. Only what the card's own
        entries can account for is released: a link made by hand, to a card
        whose statements were never imported, matches no month and is none of
        this function's business.
      */
      if (payment.linkedAccountId === card.id && touched.has(card.id)) {
        updates.push({ ...payment, linkedAccountId: undefined, billingMonth: undefined });
      }
    }
  }

  return updates;
}
