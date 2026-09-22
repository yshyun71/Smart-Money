import type { ConnectedAccount, Transaction } from "../types/finance";
import { SAVINGS_CATEGORY } from "../constants/categories";
import { isValidDate, isValidMonth } from "./validate";

/**
 * 이미 들어와 있는 것을 점검하기 — 그리고 **지워도 되는 것만** 가려내기.
 *
 * 앱에는 새 데이터를 지키는 장치가 여럿 있습니다(§4.7 열지 못한 DB · §4.8 저장 실패 ·
 * §7.9 가져오기 실패 · 이제 `validate`). 그런데 **이미 망가진 것을 찾는 장치가
 * 없었습니다.**
 *
 * 실제 기기에서 나온 것: `2026-26-08` 같은 **불가능한 날짜 46건**. 카드 명세서의
 * 두 자리 연도를 읽지 못했던 때(§7.5) 들어온 줄인데, 파서를 고쳐도 **그 줄들은
 * 그대로 남습니다** — 날짜를 고치는 마이그레이션이 없습니다. 그 46건은
 *
 * - 달이 1~12 밖이라 **어느 달 합계에도 들어가지 않고**,
 * - 연월 선택 창은 한 해에 12칸만 보여 주므로 **닿을 수 없고**,
 * - `내역 찾기` 의 전체 기간으로만 보입니다 — **있는 줄 모르면 영원히 못 찾습니다.**
 *
 * 게다가 그 46건은 `KB국민카드` 명세서를 `KB국민은행 입출금` 계좌로 잘못 넣은
 * 한 번의 사고였고, 46건 전부가 카드 계좌에 제대로 다시 들어가 있었습니다.
 */

export type FlawKind =
  /** 달이 1~12 밖이거나 그 달에 없는 날. 어느 달 합계에도 들어가지 않습니다. */
  | "BAD_DATE"
  /** 없는 계좌를 가리킵니다. 합계에는 잡히는데 화면에서 열 수 없습니다. */
  | "ORPHAN"
  /** 결제월이 `YYYY-MM` 이 아닙니다. */
  | "BAD_BILLING"
  /** 오늘보다 뒤. 앞당겨 적은 것일 수도 있어 지우지 않습니다. */
  | "FUTURE"
  /** 카드 내역에 붙은 `저축`. 실적에서 빠지므로 잘못 분류된 것입니다(§11.4). */
  | "CARD_SAVINGS";

export interface Flaw {
  kind: FlawKind;
  id: string;
  /** 사람이 읽을 한 줄 — 날짜·내역명·금액. */
  label: string;
  /** 무엇이 왜 문제인가. */
  detail: string;
  /**
   * **다른 계좌·다른 줄에 같은 것이 있는가.**
   *
   * 이것이 지워도 되는지를 가르는 근거입니다. 같은 지출이 제대로 들어간 사본이
   * 있으면 이 줄은 잃을 것이 없고, 없으면 유일한 기록이라 지울 수 없습니다.
   */
  duplicateOf?: string;
}

export interface InspectInput {
  transactions: Transaction[];
  accounts: ConnectedAccount[];
  /** 오늘 — 미래 날짜 판정에만 씁니다. */
  today?: Date;
}

/** 같은 거래인가 — 계좌는 보지 않습니다. 잘못된 계좌로 들어간 사본을 찾는 중입니다. */
function sameSpend(a: Transaction, b: Transaction): boolean {
  return (
    a.amount === b.amount &&
    a.type === b.type &&
    (a.merchant || "").replace(/\s+/g, "") === (b.merchant || "").replace(/\s+/g, "")
  );
}

function labelOf(tx: Transaction): string {
  return `${tx.date} · ${tx.merchant} · ${tx.amount.toLocaleString()}원`;
}

/**
 * 가계부 전체를 훑어 말이 안 되는 줄을 모읍니다.
 *
 * 한 줄이 여러 문제를 가질 수 있고, **문제마다 한 줄씩** 돌려줍니다 — 화면이
 * 종류별로 세어 보여 주기 때문입니다.
 */
export function inspect(input: InspectInput): Flaw[] {
  const { transactions, accounts } = input;
  const today = input.today || new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(today.getDate()).padStart(2, "0")}`;

  const known = new Set(accounts.map((account) => account.id));
  const isCard = new Map(accounts.map((a) => [a.id, a.type !== "BANK"]));
  const flaws: Flaw[] = [];

  for (const tx of transactions) {
    if (!isValidDate(tx.date)) {
      /* 같은 지출이 제대로 들어간 사본을 찾습니다 — 지워도 되는지의 근거입니다 */
      const twin = transactions.find(
        (other) => other.id !== tx.id && isValidDate(other.date) && sameSpend(other, tx)
      );
      flaws.push({
        kind: "BAD_DATE",
        id: tx.id,
        label: labelOf(tx),
        detail: "있을 수 없는 날짜입니다 — 어느 달 합계에도 들어가지 않습니다",
        duplicateOf: twin?.id,
      });
    } else if (tx.date > todayKey) {
      flaws.push({
        kind: "FUTURE",
        id: tx.id,
        label: labelOf(tx),
        detail: "오늘보다 뒤의 날짜입니다",
      });
    }

    if (!known.has(tx.accountId)) {
      flaws.push({
        kind: "ORPHAN",
        id: tx.id,
        label: labelOf(tx),
        detail: "없는 카드·계좌를 가리킵니다 — 화면에서 열 수 없습니다",
      });
    }

    if (tx.billingMonth && !isValidMonth(tx.billingMonth)) {
      flaws.push({
        kind: "BAD_BILLING",
        id: tx.id,
        label: labelOf(tx),
        detail: `결제월이 올바르지 않습니다: ${tx.billingMonth}`,
      });
    }

    /*
      카드로 저축하지 않습니다. 카드 내역에 `저축` 이 붙어 있으면 잘못 분류된
      것이고, 저축 실적은 계좌에서만 세므로(§11.4) 그 금액은 어느 칸에도 잡히지
      않습니다. 고치는 것은 사람이 할 일이라 표시만 합니다.
    */
    if (
      tx.type === "EXPENSE" &&
      tx.category === SAVINGS_CATEGORY &&
      isCard.get(tx.accountId) === true
    ) {
      flaws.push({
        kind: "CARD_SAVINGS",
        id: tx.id,
        label: labelOf(tx),
        detail: "카드 내역에 붙은 저축입니다 — 저축 실적에 들어가지 않습니다",
      });
    }
  }

  return flaws;
}

/**
 * 지워도 되는 줄.
 *
 * **두 조건을 모두 넘어야 합니다** — 날짜가 있을 수 없고, **같은 지출이 제대로
 * 들어간 사본이 있어야** 합니다. 하나만 맞으면 그 줄은 그 지출의 **유일한 기록**
 * 이므로 지우지 않고 보여 주기만 합니다(§17.3 — 기존 데이터를 조용히 버리지
 * 않습니다).
 *
 * 미래 날짜·카드에 붙은 저축·결제월 오류는 **고칠 것**이지 버릴 것이 아니라 여기
 * 들어오지 않습니다. 앞당겨 적은 거래는 정상이고, 잘못 분류된 저축에는 진짜 지출이
 * 담겨 있습니다.
 *
 * 고아 내역도 지우지 않습니다 — 계좌를 다시 등록하면 되살아날 수 있고, 지금은
 * `deleteAccount` 가 연쇄로 지우므로 새로 생기지도 않습니다(§4.4).
 */
export function zombies(flaws: Flaw[]): Flaw[] {
  return flaws.filter(
    (flaw) => flaw.kind === "BAD_DATE" && Boolean(flaw.duplicateOf)
  );
}

export interface FlawTally {
  kind: FlawKind;
  count: number;
  /** 그 종류에서 지워도 되는 건수. */
  removable: number;
}

/** 종류별로 몇 건인가 — 화면이 목록보다 먼저 이것을 보여 줍니다. */
export function tally(flaws: Flaw[]): FlawTally[] {
  const order: FlawKind[] = [
    "BAD_DATE",
    "ORPHAN",
    "BAD_BILLING",
    "CARD_SAVINGS",
    "FUTURE",
  ];
  const removable = new Set(zombies(flaws).map((flaw) => flaw.id));

  return order
    .map((kind) => {
      const rows = flaws.filter((flaw) => flaw.kind === kind);
      return {
        kind,
        count: rows.length,
        removable: rows.filter((flaw) => removable.has(flaw.id)).length,
      };
    })
    .filter((row) => row.count > 0);
}

export const FLAW_LABELS: Record<FlawKind, string> = {
  BAD_DATE: "있을 수 없는 날짜",
  ORPHAN: "없는 카드·계좌를 가리킴",
  BAD_BILLING: "결제월이 올바르지 않음",
  CARD_SAVINGS: "카드에 붙은 저축",
  FUTURE: "오늘보다 뒤의 날짜",
};

/**
 * 그 줄이 원래 어느 달의 것이었을지.
 *
 * 두 자리 연도 사고의 결과에는 **규칙이 있습니다.** `26.08.03` 을 `2026-26-08` 로
 * 적었으니 **달 자리에 연도가, 날 자리에 달이** 들어갔습니다 — 그래서 달은 되살릴
 * 수 있습니다. **날은 잃었습니다**(위 예의 `03`).
 *
 * 그래서 이 값은 **보여 주기만 합니다. 고쳐 쓰지 않습니다.** 날을 1일로 채우면
 * 앱이 없는 사실을 적는 것이 됩니다(§17.1). 사용자가 그 달임을 알고 직접 고치거나,
 * 사본이 있으면 지우면 됩니다.
 */
export function guessedMonth(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!m) return "";

  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month <= 12) return "";
  /* 달 자리에 든 두 자리 연도가 진짜 연도와 맞고, 날 자리가 달로 읽히는가 */
  if (2000 + month !== Number(m[1])) return "";
  if (day < 1 || day > 12) return "";

  return `${m[1]}-${String(day).padStart(2, "0")}`;
}
