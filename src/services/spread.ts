import type { CategoryType, ExpenseType, Transaction } from "../types/finance";

/**
 * Widening one edit to every entry of the same kind.
 *
 * A card statement repeats the same shop month after month, so a decision made
 * about one line — what it was, what it counts as — is almost always a
 * decision about all of them. Making the person retype it twelve times is the
 * app failing to notice that.
 *
 * Nothing here writes: each function returns the entries that would change,
 * and how many, so the screen can say what is about to happen before it does.
 */

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

// ---------------------------------------------------------------------------
// 분류 — 카테고리와 고정비/변동비
// ---------------------------------------------------------------------------

export interface Classification {
  category: CategoryType;
  expenseType: ExpenseType;
  isFixedRecurring: boolean;
  recurringDay?: number;
}

/**
 * The same classification across every entry of the same shop.
 *
 * Category can be carried by a standing rule, which decides entries yet to
 * arrive; 고정비 cannot — a rule holds only a category — and neither reaches
 * what is already recorded. So both are written here, straight onto the rows,
 * at the moment the person decides.
 *
 * Income is left out of the 고정비 part on purpose. 고정비/변동비 is a
 * distinction between kinds of spending, and copying an expense's answer onto
 * an income row (or the reverse) would say something nobody meant. The entry
 * being edited is excluded too: the form writes that one itself, with
 * everything else the person changed on it.
 */
export function planClassification(
  transactions: Transaction[],
  target: Transaction,
  next: Classification
): { updates: Transaction[]; applied: number } {
  const updates: Transaction[] = [];

  for (const tx of transactions) {
    if (tx.id === target.id) continue;
    if (tx.accountId !== target.accountId) continue;
    if (!sameMerchant(tx.merchant, target.merchant)) continue;
    /*
      **방향이 다르면 아무것도 퍼뜨리지 않습니다.**

      카테고리가 방향마다 갈리므로(§6.1) 지출의 `쇼핑` 을 수입 줄에 복사하면
      그 줄은 어느 수입 카테고리도 아니게 되고 저장 단계에서 거절됩니다(§17.7).
      정기성도 마찬가지입니다 — 같은 이름이 양쪽에 찍히는 일은 흔하고(환불·
      정산), 한쪽의 판단을 다른 쪽에 복사하면 아무도 뜻하지 않은 말이 됩니다.
    */
    if (tx.type !== target.type) continue;

    const changed: Transaction = { ...tx };
    let differs = false;

    if (tx.category !== next.category) {
      changed.category = next.category;
      differs = true;
    }

    if (tx.expenseType !== next.expenseType) {
      changed.expenseType = next.expenseType;
      differs = true;
    }
    if (Boolean(tx.isFixedRecurring) !== next.isFixedRecurring) {
      changed.isFixedRecurring = next.isFixedRecurring;
      differs = true;
    }
    // The day a standing charge lands is the same every month, so it travels
    const day = next.expenseType === "FIXED" ? next.recurringDay : undefined;
    if (tx.recurringDay !== day) {
      changed.recurringDay = day;
      differs = true;
    }

    if (differs) updates.push(changed);
  }

  return { updates, applied: updates.length };
}

/** How many entries share the shop, and how many this classification would change. */
export function classificationReach(
  transactions: Transaction[],
  target: Transaction,
  next: Classification
): { total: number; changing: number } {
  let total = 0;

  for (const tx of transactions) {
    if (tx.id === target.id) {
      total++;
      continue;
    }
    if (tx.accountId !== target.accountId) continue;
    if (!sameMerchant(tx.merchant, target.merchant)) continue;
    total++;
  }

  return { total, changing: planClassification(transactions, target, next).applied };
}
