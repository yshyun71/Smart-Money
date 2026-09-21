import type { Transaction } from "../types/finance";

/**
 * 이 분석이 아직 지금의 가계부를 말하고 있는가.
 *
 * AI 분석은 **그 시점의 스냅샷**입니다. 누른 순간의 수입·지출·내역으로 만들어지고,
 * 그 뒤에 명세서를 더 가져와도 스스로 다시 계산하지 않습니다. 건강도 82점과
 * "월 15만원 절약 가능"이 며칠 전 절반짜리 데이터에서 나온 값일 수 있는데,
 * 화면은 그 사실을 말하지 않았습니다 — 숫자만 남기면 어디서 온 값인지 알 수
 * 없다는, 잔액(§8)·실적(§11.4)에서 이미 두 번 겪은 것과 같은 문제입니다.
 *
 * 그래서 분석할 때 **무엇을 보고 만들었는지**(`AnalysisBasis`)를 함께 저장하고,
 * 지금의 내역과 견주어 달라진 것을 말합니다.
 */

export interface AnalysisBasis {
  /** 어느 달을 분석했는가 (YYYY-MM). */
  month: string;
  /** 그때 그 달에 있던 내역 건수. */
  entries: number;
  income: number;
  expense: number;
}

/** 지금 그 달의 내역으로 기준을 만듭니다. 분석을 저장할 때 함께 담습니다. */
export function basisOf(transactions: Transaction[], month: string): AnalysisBasis {
  const rows = transactions.filter((tx) => tx.date.startsWith(month));
  const sum = (type: string) =>
    rows.filter((tx) => tx.type === type).reduce((total, tx) => total + tx.amount, 0);

  return {
    month,
    entries: rows.length,
    income: sum("INCOME"),
    expense: sum("EXPENSE"),
  };
}

export interface AnalysisDrift {
  /** 분석 이후에 들어온 건수. */
  added: number;
  /** 분석 이후에 사라진 건수. */
  removed: number;
  /** 건수는 그대로인데 금액이 달라졌는가 (고친 내역). */
  edited: boolean;
  incomeDelta: number;
  expenseDelta: number;
  /** 지금 금액 — 화면이 `2,310,000원 → 2,560,000원`으로 보여 줍니다. */
  income: number;
  expense: number;
  /** 무엇이든 달라졌는가. */
  stale: boolean;
  /** 한 줄 요약. */
  headline: string;
}

/**
 * 분석한 뒤로 그 달의 내역이 얼마나 달라졌는가.
 *
 * 견줄 근거가 하나도 없으면 **`null`을 돌려주고 화면은 아무 말도 하지 않습니다**
 * — 모르는 것을 "변화 없음"이라고 말하면 그것이 곧 거짓말입니다(§17.1).
 *
 * 근거는 둘이고 서로를 메웁니다.
 * - `savedAt`(분석 시각)과 각 줄의 `createdAt` → **들어온 건**을 정확히 셉니다.
 *   추가와 삭제가 함께 일어나도 서로 상쇄되지 않습니다.
 * - `basis`(분석 당시의 건수·합계) → **사라진 건과 고친 건**을 알아냅니다.
 *   삭제·수정은 흔적을 남기지 않으므로 그때의 숫자와 견주는 수밖에 없습니다.
 */
export function driftSince(options: {
  transactions: Transaction[];
  month: string;
  basis?: AnalysisBasis | null;
  savedAt?: string | null;
}): AnalysisDrift | null {
  const { transactions, month, savedAt } = options;
  const basis = options.basis && options.basis.month === month ? options.basis : null;

  const canSeeArrivals = Boolean(savedAt);
  if (!basis && !canSeeArrivals) return null;

  const now = basisOf(transactions, month);

  /*
    `createdAt` 은 DB 에 들어온 시각이지 거래 날짜가 아닙니다. 지난달 명세서를
    오늘 가져오면 날짜는 지난달이어도 이 값은 오늘입니다 — 우리가 알고 싶은
    "분석 이후에 들어왔는가"가 바로 그것입니다.
  */
  const added = savedAt
    ? transactions.filter(
        (tx) => tx.date.startsWith(month) && (tx.createdAt || "") > savedAt
      ).length
    : 0;

  /*
    분석 당시에 있던 것 중 지금도 남아 있는 것 = 지금 건수 − 새로 들어온 것.
    그것이 그때 건수보다 적으면 그 차이가 사라진 건수입니다.
  */
  const removed = basis ? Math.max(0, basis.entries - (now.entries - added)) : 0;

  const incomeDelta = basis ? now.income - basis.income : 0;
  const expenseDelta = basis ? now.expense - basis.expense : 0;
  const edited = added === 0 && removed === 0 && (incomeDelta !== 0 || expenseDelta !== 0);
  const stale = added > 0 || removed > 0 || edited;

  return {
    added,
    removed,
    edited,
    incomeDelta,
    expenseDelta,
    income: now.income,
    expense: now.expense,
    stale,
    headline: headlineOf(added, removed, edited),
  };
}

function headlineOf(added: number, removed: number, edited: boolean): string {
  if (added > 0 && removed > 0) {
    return `분석 이후 ${added}건이 추가되고 ${removed}건이 삭제되었습니다`;
  }
  if (added > 0) return `분석 이후 ${added}건이 추가되었습니다`;
  if (removed > 0) return `분석 이후 ${removed}건이 삭제되었습니다`;
  if (edited) return "분석 이후 내역이 수정되었습니다";
  return "분석 이후 바뀐 내역이 없습니다";
}

/**
 * 저장된 ISO 시각을 사람이 읽는 말로.
 *
 * 분석 결과의 `analyzedAt` 은 만들 때의 지역 문자열이라 기기 설정에 따라
 * 모양이 갈리고 견줄 수도 없습니다. 견주는 일은 ISO 가 맡고, 보여 주는 일은
 * 여기가 맡습니다.
 */
export function describeWhen(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;

  return `${at.getFullYear()}. ${String(at.getMonth() + 1).padStart(2, "0")}. ${String(
    at.getDate()
  ).padStart(2, "0")}.`;
}
