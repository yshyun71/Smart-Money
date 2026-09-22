import type { ConnectedAccount, Transaction, CategoryRule } from "../types/finance";

/**
 * 되돌리기 — 바꾸기 **전**의 상태를 담아 두는 일.
 *
 * 삭제·일괄 적용·자동 배분은 한 번에 수백 건을 바꿉니다. 그런데 되돌릴 방법이
 * 없어서, 잘못 눌렀다는 것을 알아차린 순간 할 수 있는 일이 아무것도 없었습니다.
 *
 * **설계의 요점은 "역연산을 만들지 않는다"** 는 것입니다. `카테고리 일괄 적용`의
 * 역연산을 계산하려 들면 규칙·우선순위를 거꾸로 풀어야 하고, 그 계산이 틀리면
 * 되돌리기가 **새 손상**이 됩니다. 대신 바뀌기 전의 행을 그대로 적어 두고,
 * 되돌릴 때는 그것을 다시 씁니다 — 계산이 없으므로 틀릴 것도 없습니다.
 *
 * 보관 기간이 지난 것은 지웁니다(기본 7일, 설정에서 바꿀 수 있음 — §5).
 */

export type UndoKind =
  /** 거래 여러 건 삭제 — 지운 행을 그대로 담습니다. */
  | "DELETE_ENTRIES"
  /** 계좌·카드 삭제 — 계좌와 그에 매인 것 전부. */
  | "DELETE_ACCOUNT"
  /** 분류를 한꺼번에 바꿈(규칙 일괄 적용·같은 내역명 모두). */
  | "RECLASSIFY"
  /** 카테고리 예산을 한꺼번에 채움(자동 배분·기준 적용). */
  | "BUDGETS";

/** 되돌릴 때 그대로 다시 쓸 행들. 계산이 아니라 사본입니다. */
export interface UndoPayload {
  /** 다시 넣을 거래(삭제를 되돌릴 때). */
  entries?: Transaction[];
  /** 다시 넣을 계좌(계좌 삭제를 되돌릴 때). */
  account?: ConnectedAccount;
  /** 다시 넣을 카테고리 규칙. */
  rules?: CategoryRule[];
  /** 바꾸기 전 모습으로 되돌릴 거래(분류 변경). */
  before?: Transaction[];
  /** 바꾸기 전의 그 달 카테고리 예산. */
  budgets?: { month: string; categoryBudgets: Record<string, number> };
}

export interface UndoEntry {
  id: string;
  kind: UndoKind;
  /** 사람이 읽는 한 줄 — `식비 12건 삭제`. */
  label: string;
  payload: UndoPayload;
  createdAt: string;
}

/** 기본 보관 기간. 일주일이면 "어제 뭘 잘못했더라"를 대개 덮습니다. */
export const DEFAULT_UNDO_DAYS = 7;

/**
 * 며칠까지 보관할지 — 사용자가 정한 값을 받되 **말이 되는 범위로** 자릅니다.
 *
 * 0 이면 되돌리기가 없는 것과 같고, 지나치게 길면 임시 저장소가 백업 파일을
 * 부풀립니다. 1~90일로 둡니다.
 */
export function normaliseRetention(days: unknown): number {
  const value = Math.round(Number(days));
  if (!Number.isFinite(value)) return DEFAULT_UNDO_DAYS;
  return Math.min(90, Math.max(1, value));
}

/**
 * 보관 기간이 지난 것.
 *
 * 경계를 **지난 것만** 골라냅니다 — 정확히 기간에 걸친 것은 남깁니다. 지우는
 * 쪽에서 하루를 더 얹는 실수가 반복되는 자리라 함수로 떼어 검증합니다.
 */
export function expiredUndoIds(
  entries: { id: string; createdAt: string }[],
  options: { days: number; now?: Date }
): string[] {
  const days = normaliseRetention(options.days);
  const now = (options.now || new Date()).getTime();
  const limit = days * 24 * 60 * 60 * 1000;

  return entries
    .filter((entry) => {
      const at = new Date(entry.createdAt).getTime();
      /* 날짜가 깨진 줄은 지우지 않습니다 — 모르는 것을 버리지 않습니다(§17.3) */
      if (Number.isNaN(at)) return false;
      return now - at > limit;
    })
    .map((entry) => entry.id);
}

/**
 * 되돌릴 수 있는가.
 *
 * 담아 둔 것이 비어 있으면 되돌려도 아무 일이 없습니다 — 버튼을 눌렀는데
 * 아무 일도 없는 것이 가장 나쁩니다.
 */
export function canUndo(entry: UndoEntry): boolean {
  const { kind, payload } = entry;
  if (kind === "DELETE_ENTRIES") return (payload.entries?.length || 0) > 0;
  if (kind === "DELETE_ACCOUNT") return Boolean(payload.account);
  if (kind === "RECLASSIFY") return (payload.before?.length || 0) > 0;
  if (kind === "BUDGETS") return Boolean(payload.budgets);
  return false;
}

/** 무엇을 되돌리는지 한 줄로 — 목록과 토스트가 같은 말을 쓰게. */
export function describeUndo(entry: UndoEntry): string {
  const { kind, payload } = entry;

  if (kind === "DELETE_ENTRIES") {
    return `내역 ${payload.entries?.length || 0}건 삭제`;
  }
  if (kind === "DELETE_ACCOUNT") {
    const entries = payload.entries?.length || 0;
    return `${payload.account?.name || "계좌"} 삭제${entries > 0 ? ` (내역 ${entries}건)` : ""}`;
  }
  if (kind === "RECLASSIFY") {
    return `분류 ${payload.before?.length || 0}건 변경`;
  }
  if (kind === "BUDGETS") {
    const month = payload.budgets?.month || "";
    const count = Object.keys(payload.budgets?.categoryBudgets || {}).length;
    return `${Number(month.slice(5, 7)) || ""}월 예산 ${count}개 변경`;
  }
  return entry.label;
}
