import type { ConnectedAccount, Transaction } from "../types/finance";
import { normaliseMerchant } from "./recurrence";
import { rangePeriod } from "./trend";

/**
 * 내역 찾기 — 기간·범위·구분·카테고리·검색어를 한 벌로.
 *
 * 화면마다 자기 필터를 갖고 있었습니다. 계좌 내역은 그 계좌만, 내역 목록은
 * **그 달 안에서만** 검색했습니다. 그래서 "작년에 그 병원 얼마 냈지"에 답할
 * 자리가 없었습니다.
 *
 * 조건을 값으로 다루면 세 가지가 한 함수로 해결됩니다 — 전체 기간 검색,
 * **비슷한 항목 모아 보기**(같은 가맹점을 명세서가 여러 모양으로 적습니다),
 * 카테고리별 내역 보기. 그리고 그 결과를 그대로 CSV 로 내려받을 수 있습니다.
 */

export type Direction = "ALL" | "INCOME" | "EXPENSE";
export type Kind = "ALL" | "FIXED" | "VARIABLE";

export interface LedgerQuery {
  /** 연월 (`YYYY-MM`). 비우면 처음부터·끝까지. */
  from?: string;
  to?: string;
  /** 어느 계좌·카드에서. 비우면 전부. */
  accountIds?: string[];
  /** 어느 카테고리. 비우면 전부. */
  categories?: string[];
  direction?: Direction;
  /** 고정비·변동비. 수입에는 뜻이 없으므로 지출에만 걸립니다. */
  kind?: Kind;
  /** 내역명·메모·설명·카테고리에서 찾습니다. */
  text?: string;
  /**
   * 이 이름과 **같은 가맹점**만.
   *
   * 글자 그대로 비교하지 않습니다 — 명세서는 같은 곳을 `(주)`·지점·승인번호를
   * 붙여 여러 모양으로 적습니다(§10의 `normaliseMerchant`). 그래서
   * `스타벅스 강남지점`으로 찾으면 `스타벅스강남`도 함께 나옵니다.
   */
  similarTo?: string;
}

/** 검색어는 공백·대소문자를 무시합니다 — 사람은 띄어쓰기를 기억하지 못합니다. */
function flatten(value: string): string {
  return (value || "").replace(/\s+/g, "").toLowerCase();
}

export function runQuery(transactions: Transaction[], query: LedgerQuery): Transaction[] {
  const { from, to, accountIds, categories, direction = "ALL", kind = "ALL" } = query;

  /* 한쪽만 주면 그쪽만 제한합니다 — 둘 다 없으면 기간 제한이 없습니다 */
  const span = from || to ? rangePeriod(from || to || "", to || from || "") : null;
  const accounts = accountIds && accountIds.length > 0 ? new Set(accountIds) : null;
  const cats = categories && categories.length > 0 ? new Set(categories) : null;
  const needle = flatten(query.text || "");
  const similar = query.similarTo ? normaliseMerchant(query.similarTo) : "";

  return transactions.filter((tx) => {
    if (span && (tx.date < span.start || tx.date > span.end)) return false;
    if (accounts && !accounts.has(tx.accountId)) return false;
    if (cats && !cats.has(tx.category)) return false;

    if (direction !== "ALL" && tx.type !== direction) return false;
    /* 고정비·변동비는 지출의 구분입니다 — 수입 건에는 걸지 않습니다(§9.6) */
    if (kind !== "ALL" && tx.type === "EXPENSE" && tx.expenseType !== kind) return false;
    if (kind !== "ALL" && tx.type === "INCOME") return false;

    if (similar && normaliseMerchant(tx.merchant) !== similar) return false;

    if (needle) {
      const haystack = [tx.merchant, tx.memo, tx.note, tx.category]
        .map((piece) => flatten(piece || ""))
        .join("|");
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}

export interface QueryTotals {
  count: number;
  income: number;
  expense: number;
  /** 수입 − 지출. */
  net: number;
}

export function queryTotals(rows: Transaction[]): QueryTotals {
  const income = rows
    .filter((tx) => tx.type === "INCOME")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const expense = rows
    .filter((tx) => tx.type === "EXPENSE")
    .reduce((sum, tx) => sum + tx.amount, 0);

  return { count: rows.length, income, expense, net: income - expense };
}

/** 한 칸을 CSV 로 — 콤마·따옴표·줄바꿈이 든 값을 감쌉니다. */
function cell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * 조회 결과를 CSV 로.
 *
 * **금액에 콤마를 넣지 않습니다.** 화면에서는 `1,234,000원`이지만 CSV 는 다시
 * 계산에 쓰이는 파일이고, 콤마가 든 숫자는 엑셀에서 문자가 됩니다 — `parseInt`
 * 가 1을 돌려주던 것과 같은 함정입니다(§12.2).
 *
 * 앞에 **BOM 을 붙이는 것은 부르는 쪽**입니다. 엑셀은 BOM 이 없으면 UTF-8 을
 * 한글 깨진 상태로 엽니다 — 가져올 때 euc-kr 을 다루며 배운 것과 같은 문제를
 * 반대 방향에서 만나는 셈입니다(§7.2).
 */
export function toCsv(rows: Transaction[], accounts: ConnectedAccount[] = []): string {
  const nameOf = new Map(accounts.map((account) => [account.id, account.name]));

  const header = [
    "날짜",
    "시각",
    "구분",
    "고정비여부",
    "카테고리",
    "내역명",
    "금액",
    "계좌·카드",
    "결제월",
    "메모",
    "설명",
  ];

  const lines = rows.map((tx) =>
    [
      tx.date,
      tx.time || "",
      tx.type === "INCOME" ? "수입" : "지출",
      tx.type === "INCOME" ? "" : tx.expenseType === "FIXED" ? "고정비" : "변동비",
      tx.category,
      tx.merchant,
      /* 숫자만 — 콤마도 `원`도 넣지 않습니다 */
      tx.amount,
      nameOf.get(tx.accountId) || tx.accountId,
      tx.billingMonth || "",
      tx.memo || "",
      tx.note || "",
    ]
      .map(cell)
      .join(",")
  );

  return [header.join(","), ...lines].join("\r\n");
}

/** 내려받을 파일 이름 — 무엇을 담았는지 이름이 말하게. */
export function csvFileName(query: LedgerQuery, count: number): string {
  const span =
    query.from || query.to
      ? `${query.from || query.to}_${query.to || query.from}`
      : "전체기간";
  const what = query.similarTo
    ? `유사_${query.similarTo.slice(0, 12)}`
    : query.categories && query.categories.length === 1
      ? query.categories[0]
      : "내역";
  return `스마트머니_${what}_${span}_${count}건.csv`;
}
