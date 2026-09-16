import type { Transaction } from "../types/finance";

/**
 * Writing one note across every entry of the same kind.
 *
 * A statement says 삼성전자(주) and nothing else, so what a charge actually was
 * only the person knows — and once they have said it, saying it again on every
 * other line from the same shop is work a machine should do.
 *
 * What the machine must not do is overwrite an answer already given. A note
 * someone typed on one entry is the most specific thing known about it, so
 * entries that carry a different note are counted, shown, and left alone
 * unless the person says otherwise.
 */

/** Same shop by the name as written, give or take spacing and case. */
export function sameMerchant(a: string, b: string): boolean {
  const plain = (value: string) => (value || "").replace(/\s+/g, "").toLowerCase();
  const left = plain(a);
  return left !== "" && left === plain(b);
}

export type NoteScope = "ONE" | "SAME_MERCHANT";

export interface NotePlan {
  /** The entries to write, the note already applied. */
  updates: Transaction[];
  /** Entries that would be written, including the one being edited. */
  applied: number;
  /** Entries left as they are because they carry a note of their own. */
  kept: number;
  /** Entries whose note this would replace, had overwrite been asked for. */
  conflicts: Transaction[];
}

/**
 * Which entries a note should be written to.
 *
 * `target` is the entry being edited and is always written — the person is
 * looking straight at it. The rest are the same shop in the same account:
 * a card and a bank account record different payments even where the name on
 * them matches, and the ledger the note was typed in is the one it is about.
 */
export function planNote(
  transactions: Transaction[],
  target: Transaction,
  note: string,
  scope: NoteScope,
  overwrite: boolean
): NotePlan {
  const wanted = note.trim();
  const write = (tx: Transaction): Transaction => ({ ...tx, note: wanted || undefined });

  if (scope === "ONE") {
    const changed = (target.note || "") !== wanted;
    return {
      updates: changed ? [write(target)] : [],
      applied: changed ? 1 : 0,
      kept: 0,
      conflicts: [],
    };
  }

  const updates: Transaction[] = [];
  const conflicts: Transaction[] = [];
  let kept = 0;

  for (const tx of transactions) {
    if (tx.id !== target.id) {
      if (tx.accountId !== target.accountId) continue;
      if (!sameMerchant(tx.merchant, target.merchant)) continue;
    }

    const current = (tx.note || "").trim();
    if (current === wanted) continue;

    // An entry the person has already described says more than this note does
    if (current !== "" && tx.id !== target.id) {
      conflicts.push(tx);
      if (!overwrite) {
        kept++;
        continue;
      }
    }

    updates.push(write(tx));
  }

  return { updates, applied: updates.length, kept, conflicts };
}

/**
 * What the screen shows before anything is written: how many entries share the
 * shop, and how many of them already say something else.
 */
export function noteReach(
  transactions: Transaction[],
  target: Transaction
): { total: number; described: number } {
  let total = 0;
  let described = 0;

  for (const tx of transactions) {
    if (tx.id !== target.id) {
      if (tx.accountId !== target.accountId) continue;
      if (!sameMerchant(tx.merchant, target.merchant)) continue;
    }

    total++;
    if (tx.id !== target.id && (tx.note || "").trim() !== "") described++;
  }

  return { total, described };
}
