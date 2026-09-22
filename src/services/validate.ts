import type { Transaction } from "../types/finance";

/**
 * 가계부에 들어가도 되는 값인가 — **쓰기 직전의 마지막 관문**.
 *
 * 실제로 막지 못한 일이 있었습니다. 카드 명세서의 `26.08.03` 을 읽을 줄 몰라
 * `2026년 26월` 로 들어간 줄이 **46건** 남았고(§7.5), 그 줄들은 달이 1~12 밖이라
 * **어느 달 합계에도 들어가지 않고 연월 선택 창으로도 닿을 수 없었습니다.** 파서는
 * 고쳤지만, 고친 곳은 가져오기 한 경로뿐입니다 — 직접 입력·문자 등록·일괄 수정·
 * 되돌리기 복원은 그 규칙을 지나지 않습니다.
 *
 * 그래서 규칙을 **한 곳**에 두고 모든 쓰기가 지나가게 합니다. 파서가 또 틀리든,
 * 새 경로가 생기든, 말이 안 되는 값은 DB 에 닿지 못합니다.
 *
 * **막고 나서 말합니다.** 조용히 버리면 있어야 할 건이 없을 때 사용자가 알아차릴
 * 방법이 없습니다(§17.1) — 어느 칸이 왜 안 되는지 돌려줍니다.
 */

export interface Problem {
  /** 어느 칸인가 — 화면이 그 칸을 짚어 줍니다. */
  field: string;
  message: string;
}

/** 연도의 범위. 가계부에 1900년이나 2200년이 들어올 일은 없습니다. */
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

/** 그 달에 그 날이 있는가 — 2월 30일을 받지 않습니다. */
function daysIn(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * `YYYY-MM-DD` 이고 실제로 있는 날인가.
 *
 * **`Date` 로 파싱해서 판정하지 않습니다.** `new Date("2026-26-08")` 은 브라우저마다
 * 다르게 동작하고, 어떤 곳에서는 조용히 다른 날로 굴러갑니다. 글자를 그대로 봅니다.
 */
export function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!m) return false;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  if (year < YEAR_MIN || year > YEAR_MAX) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysIn(year, month);
}

/** `YYYY-MM`. 결제월(§7.7)과 예산 달의 형식입니다. */
export function isValidMonth(value: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(value || "");
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= YEAR_MIN && year <= YEAR_MAX && month >= 1 && month <= 12;
}

/** `HH:mm`. 비어 있어도 됩니다 — 시각을 적지 않는 명세서가 많습니다. */
export function isValidTime(value: string): boolean {
  if (!value) return true;
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/** 돈으로 셀 수 있는 수인가. `NaN`·`Infinity`·음수를 받지 않습니다. */
export function isValidAmount(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * 한 거래가 들어가도 되는가. 문제가 없으면 빈 배열입니다.
 *
 * **방향과 금액의 부호를 섞지 않습니다.** 나간 돈과 들어온 돈은 `type` 이 가르고
 * 금액은 언제나 0 이상입니다 — 음수를 허용하면 같은 사실을 두 가지로 적을 수 있게
 * 되어 모든 합계가 둘 중 어느 쪽인지에 달리게 됩니다(§7.5의 차감 처리가 그래서
 * 음수를 `INCOME` 으로 바꿉니다).
 */
export function checkTransaction(tx: Partial<Transaction>): Problem[] {
  const problems: Problem[] = [];

  if (!isValidDate(tx.date || "")) {
    problems.push({
      field: "date",
      message: `날짜가 올바르지 않습니다: ${tx.date || "(없음)"}`,
    });
  }
  if (!isValidTime(tx.time || "")) {
    problems.push({ field: "time", message: `시각이 올바르지 않습니다: ${tx.time}` });
  }
  if (tx.billingMonth && !isValidMonth(tx.billingMonth)) {
    problems.push({
      field: "billingMonth",
      message: `결제월이 올바르지 않습니다: ${tx.billingMonth}`,
    });
  }
  if (!isValidAmount(tx.amount)) {
    problems.push({ field: "amount", message: "금액은 0 이상의 숫자여야 합니다" });
  }
  if (!tx.accountId) {
    problems.push({ field: "accountId", message: "어느 카드·계좌인지 정해야 합니다" });
  }
  if (tx.type !== "INCOME" && tx.type !== "EXPENSE") {
    problems.push({ field: "type", message: "수입·지출 중 하나여야 합니다" });
  }
  if (!(tx.merchant || "").trim()) {
    problems.push({ field: "merchant", message: "내역명을 적어야 합니다" });
  }
  if (!(tx.category || "").trim()) {
    problems.push({ field: "category", message: "카테고리를 정해야 합니다" });
  }
  /*
    고정비·변동비는 **지출의 구분**입니다(§9.6). 수입 건에 그 값이 붙으면 고정비
    합계가 수입을 세게 되므로, 방향과 어긋나는 조합을 막습니다.
  */
  if (tx.type === "INCOME" && tx.expenseType && tx.expenseType !== "INCOME") {
    problems.push({
      field: "expenseType",
      message: "수입 건에는 고정비·변동비를 붙이지 않습니다",
    });
  }
  if (tx.type === "EXPENSE" && tx.expenseType === "INCOME") {
    problems.push({ field: "expenseType", message: "지출 건의 구분이 수입입니다" });
  }

  return problems;
}

/** 한 줄로 요약 — 사용자에게 보여 주는 말입니다. */
export function describeProblems(problems: Problem[]): string {
  if (problems.length === 0) return "";
  if (problems.length === 1) return problems[0].message;
  return `${problems[0].message} (그리고 ${problems.length - 1}가지 더)`;
}

export interface Sifted<T> {
  ok: T[];
  /** 들이지 않은 것과 그 까닭 — 세어 보여 주기 위한 것입니다. */
  rejected: { row: T; problems: Problem[] }[];
}

/**
 * 여럿을 가릅니다 — 들일 것과 들이지 않을 것.
 *
 * **한 줄이 틀렸다고 전부 막지 않습니다.** 명세서 300줄 중 한 줄의 날짜가 이상해서
 * 299줄이 들어오지 못하면, 사용자가 할 수 있는 일은 그 파일을 버리는 것뿐입니다.
 * 들일 수 있는 것은 들이고 **못 들인 것을 숫자와 까닭으로** 말합니다(§7.9와 같은
 * 태도입니다).
 */
export function siftTransactions<T extends Partial<Transaction>>(rows: T[]): Sifted<T> {
  const ok: T[] = [];
  const rejected: { row: T; problems: Problem[] }[] = [];

  for (const row of rows) {
    const problems = checkTransaction(row);
    if (problems.length === 0) ok.push(row);
    else rejected.push({ row, problems });
  }

  return { ok, rejected };
}
