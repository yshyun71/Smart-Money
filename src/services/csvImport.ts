import type { CategoryType, ExpenseType, Transaction, TransactionType } from "../types/finance";
import { builtInCategoryFor } from "./categoryRules";
import { HOUSING_KEYWORDS, LIVING_KEYWORDS } from "../constants/categories";

/**
 * Reading a bank or card statement exported as CSV.
 *
 * Korean banks hand these out in a variety of shapes: CP949 rather than UTF-8,
 * a few title rows above the real header, separate 출금/입금 columns or a single
 * signed amount, and dates written half a dozen ways. Everything here is about
 * getting from that to plain transactions, with the guesses shown to the user
 * rather than applied silently.
 */

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Korean statements are usually CP949. UTF-8 is tried first — invalid
 * sequences make it produce replacement characters, which is the signal to
 * fall back.
 */
export function decodeFile(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // UTF-8 BOM settles it
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }

  const asUtf8 = new TextDecoder("utf-8").decode(bytes);
  if (!asUtf8.includes("�")) return asUtf8;

  for (const encoding of ["euc-kr", "windows-949"]) {
    try {
      const decoded = new TextDecoder(encoding).decode(bytes);
      if (!decoded.includes("�")) return decoded;
      return decoded; // better than mojibake even if imperfect
    } catch {
      /* encoding unsupported in this browser */
    }
  }

  return asUtf8;
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export function isSpreadsheetFile(file: File): boolean {
  return (
    /\.(xlsx|xlsm|xlsb|xls)$/i.test(file.name) ||
    file.type.includes("spreadsheet") ||
    file.type.includes("ms-excel")
  );
}

export interface LoadedFile {
  /** Delimited text, whatever the file started as. */
  text: string;
  /** Sheet names, when the file was a workbook. */
  sheetNames: string[];
  usedSheet: string | null;
}

/**
 * Reads a statement, whether it arrived as CSV or as the .xls/.xlsx most banks
 * actually hand out. A workbook is converted to CSV first and then goes through
 * exactly the same path as a CSV upload.
 *
 * The spreadsheet reader is imported on demand — it is a large library, and
 * most sessions never open an Excel file.
 */
export async function loadStatementFile(
  file: File,
  sheetName?: string
): Promise<LoadedFile> {
  const buffer = await file.arrayBuffer();

  if (!isSpreadsheetFile(file)) {
    return { text: decodeFile(buffer), sheetNames: [], usedSheet: null };
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    // Otherwise dates arrive as Excel serial numbers
    cellDates: true,
  });

  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) {
    throw new Error("엑셀 파일에 시트가 없습니다.");
  }

  // The requested sheet, else the first one with any content
  const chosen =
    (sheetName && sheetNames.includes(sheetName) && sheetName) ||
    sheetNames.find((name) => {
      const sheet = workbook.Sheets[name];
      return sheet && Object.keys(sheet).some((cell) => !cell.startsWith("!"));
    }) ||
    sheetNames[0];

  const text = XLSX.utils.sheet_to_csv(workbook.Sheets[chosen], {
    blankrows: false,
    // Use the displayed value, so dates and amounts read as the bank wrote them
    rawNumbers: false,
  });

  return { text, sheetNames, usedSheet: chosen };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /** Index of the row the header was found on, for showing back to the user. */
  headerRowIndex: number;
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const counts: Record<string, number> = {
    ",": (sample.match(/,/g) || []).length,
    "\t": (sample.match(/\t/g) || []).length,
    ";": (sample.match(/;/g) || []).length,
    "|": (sample.match(/\|/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",";
}

/** A CSV reader that understands quoted fields containing the delimiter. */
function splitRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const HEADER_HINTS = [
  "거래일", "거래일시", "거래일자", "이용일", "이용일자", "승인일", "승인일자", "날짜",
  "적요", "내용", "거래내용", "가맹점", "가맹점명", "상호", "비고",
  "출금", "입금", "금액", "이용금액", "승인금액", "거래금액", "잔액",
];

/**
 * Statements often carry a title and an account summary above the real header,
 * so the header is found by looking for the row with the most known labels.
 */
function findHeaderRow(rows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;

  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].map((cell) => cell.replace(/\s/g, ""));
    if (cells.filter((cell) => cell).length < 2) continue;

    const score = cells.reduce(
      (total, cell) => total + (HEADER_HINTS.some((hint) => cell.includes(hint)) ? 1 : 0),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore > 0 ? bestIndex : 0;
}

/**
 * True when a row continues the header rather than starting the data.
 *
 * Card statements group their money columns under a merged title and put the
 * real names on a second line: "이번달 결제금액" over "회차 · 원금 · 수수료".
 * Read as data that row is skipped, and read as the only header the names sit
 * over the wrong columns — 회차 becomes the amount, which is filled in only on
 * the instalment lines.
 */
function looksLikeSubHeader(row: string[] | undefined): boolean {
  if (!row) return false;
  const cells = row.map((cell) => cell.trim()).filter(Boolean);
  if (cells.length < 2) return false;
  if (cells.some((cell) => normaliseDate(cell))) return false;
  return cells.every((cell) => normaliseAmount(cell).value === 0);
}

/** Carries a merged title across the blanks beneath it, as a reader would. */
function mergeHeaderRows(top: string[], sub: string[]): string[] {
  let carried = "";
  const width = Math.max(top.length, sub.length);

  return Array.from({ length: width }, (_, index) => {
    const above = (top[index] || "").trim();
    if (above) carried = above;

    const below = (sub[index] || "").trim();
    if (!below) return carried;
    return carried && carried !== below ? `${carried} ${below}` : below;
  });
}

export function parseDelimited(text: string): ParsedTable {
  const delimiter = detectDelimiter(text);
  const all = splitRows(text, delimiter).filter((row) =>
    row.some((cell) => cell.trim() !== "")
  );

  if (all.length === 0) {
    return { headers: [], rows: [], headerRowIndex: 0 };
  }

  const headerRowIndex = findHeaderRow(all);
  const top = all[headerRowIndex].map((cell) => cell.trim());

  const hasSubHeader = looksLikeSubHeader(all[headerRowIndex + 1]);
  const headers = hasSubHeader
    ? mergeHeaderRows(top, all[headerRowIndex + 1].map((cell) => cell.trim()))
    : top;

  const firstDataRow = headerRowIndex + (hasSubHeader ? 2 : 1);
  const width = headers.length;
  const rows = all
    .slice(firstDataRow)
    .map((row) => {
      const padded = [...row];
      while (padded.length < width) padded.push("");
      return padded.slice(0, width).map((cell) => cell.trim());
    })
    .filter((row) => row.some((cell) => cell !== ""));

  return { headers, rows, headerRowIndex };
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export interface ColumnMapping {
  date: number;
  merchant: number;
  /** Single column holding the amount, positive or signed. */
  amount: number;
  /** Separate columns, the usual bank statement shape. */
  withdrawal: number;
  deposit: number;
  memo: number;
  /** 결제일·청구년월, when the statement carries one per line. */
  billing: number;
}

export const EMPTY_MAPPING: ColumnMapping = {
  date: -1,
  merchant: -1,
  amount: -1,
  withdrawal: -1,
  deposit: -1,
  memo: -1,
  billing: -1,
};

function findColumn(headers: string[], keywords: string[], exclude: string[] = []): number {
  const normalised = headers.map((header) => header.replace(/\s/g, ""));
  for (const keyword of keywords) {
    const index = normalised.findIndex(
      (header) =>
        header.includes(keyword) && !exclude.some((word) => header.includes(word))
    );
    if (index >= 0) return index;
  }
  return -1;
}

/**
 * The counterparty is preferred over 적요, which on a bank statement holds the
 * kind of transfer ("이체", "자동이체") rather than who it was with. When the
 * counterparty column wins, 적요 is kept as the memo — and stands in as the
 * description on rows where the counterparty is blank.
 */
const COUNTERPARTY_KEYWORDS = [
  "가맹점명", "가맹점", "상호", "이용하신곳", "의뢰인", "수취인", "받는분", "보내는분", "거래처",
];
const DESCRIPTION_KEYWORDS = ["적요", "거래내용", "내용", "기재내용"];

/** Columns that hold a number but never the amount of a transaction. */
const NOT_AMOUNT = [
  "잔액", "한도", "누계", "포인트", "마일리지", "번호", "개월", "할부", "회차", "건수",
  "수수료율", "이율",
];

/** How many rows a mapping actually reads a date and an amount out of. */
function usableRows(rows: string[][], mapping: ColumnMapping): number {
  let count = 0;
  for (const row of rows) {
    const cell = (column: number) => (column >= 0 ? row[column] || "" : "");
    if (!normaliseDate(cell(mapping.date))) continue;

    const amount =
      mapping.withdrawal >= 0 || mapping.deposit >= 0
        ? Math.max(
            normaliseAmount(cell(mapping.withdrawal)).value,
            normaliseAmount(cell(mapping.deposit)).value
          )
        : normaliseAmount(cell(mapping.amount)).value;

    if (amount > 0) count++;
  }
  return count;
}

function countIn(rows: string[][], column: number, reads: (value: string) => boolean): number {
  let count = 0;
  for (const row of rows) {
    if (reads(row[column] || "")) count++;
  }
  return count;
}

/**
 * Reads the columns back out of the rows when the header names did not settle
 * it.
 *
 * Card statements are the awkward case: several carry a 결제금액 column that
 * matches on name but is blank on every line, with the real figure under
 * 이용금액. Trusting the header alone reads nothing and drops every row.
 */
function detectFromRows(
  headers: string[],
  rows: string[][],
  guess: ColumnMapping
): ColumnMapping {
  const enough = Math.max(1, Math.floor(rows.length * 0.5));

  const dateColumn =
    countIn(rows, guess.date, (value) => Boolean(normaliseDate(value))) >= enough
      ? guess.date
      : headers.findIndex((_, index) =>
          countIn(rows, index, (value) => Boolean(normaliseDate(value))) >= enough
        );

  if (dateColumn < 0) return guess;

  // Money columns, best name first, then whichever sits furthest left
  const preferred = ["이용금액", "승인금액", "거래금액", "출금", "입금", "결제금액", "금액"];
  const candidates = headers
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header, index }) =>
        index !== dateColumn &&
        !NOT_AMOUNT.some((word) => header.includes(word)) &&
        countIn(rows, index, (value) => normaliseAmount(value).value > 0) >= enough
    )
    .sort((a, b) => {
      const rank = (header: string) => {
        const hit = preferred.findIndex((word) => header.includes(word));
        return hit < 0 ? preferred.length : hit;
      };
      return rank(a.header) - rank(b.header) || a.index - b.index;
    });

  if (candidates.length === 0) return { ...guess, date: dateColumn };

  return {
    ...guess,
    date: dateColumn,
    amount: candidates[0].index,
    withdrawal: -1,
    deposit: -1,
  };
}

export interface MappingScore {
  /** Rows whose date column reads as a date. */
  dated: number;
  /** Of those, how many also yield an amount. */
  usable: number;
  ratio: number;
  /** Whether the mapping is worth proceeding with unaided. */
  ok: boolean;
}

/**
 * How much of a file a mapping actually accounts for.
 *
 * Reading a handful of rows is not the same as reading the statement: a column
 * of instalment numbers looks like money on exactly the lines that have one.
 * A mapping that leaves most of the file behind is the signal to ask for help.
 */
export function scoreMapping(table: ParsedTable, mapping: ColumnMapping): MappingScore {
  const hasAmount =
    mapping.amount >= 0 || mapping.withdrawal >= 0 || mapping.deposit >= 0;

  const dated = table.rows.filter((row) =>
    normaliseDate(row[mapping.date] || "")
  ).length;
  const usable = usableRows(table.rows, mapping);
  const ratio = dated > 0 ? usable / dated : 0;

  return {
    dated,
    usable,
    ratio,
    ok:
      mapping.date >= 0 &&
      hasAmount &&
      mapping.merchant >= 0 &&
      usable > 0 &&
      ratio >= 0.6,
  };
}

/**
 * Names first, and the rows themselves when the names come to nothing.
 * `rows` is optional so the mapping can still be guessed from a header alone.
 */
export function autoDetectMapping(headers: string[], rows: string[][] = []): ColumnMapping {
  /*
    A statement counts things as well as money: instalment numbers, months,
    points. They read as perfectly good numbers and belong to no transaction.
  */
  const notMoney = ["잔액", "회차", "개월", "건수", "포인트", "마일리지", "번호"];

  const withdrawal = findColumn(headers, ["출금", "지출", "차감", "결제금액"], notMoney);
  const deposit = findColumn(headers, ["입금", "수입", "적립"], notMoney);

  const counterparty = findColumn(headers, COUNTERPARTY_KEYWORDS);
  const description = findColumn(headers, DESCRIPTION_KEYWORDS);
  const merchant = counterparty >= 0 ? counterparty : description;

  const memo =
    counterparty >= 0 && description >= 0
      ? description
      : findColumn(
          headers,
          ["구분", "결제구분", "거래구분", "할부", "메모", "비고", "업종", "적요2"],
          ["개월", "회차"]
        );

  const billing = findColumn(headers, [
    "결제년월", "청구년월", "청구월", "결제월", "결제일자", "결제예정일", "결제일",
  ]);

  const guess: ColumnMapping = {
    billing,
    date: findColumn(headers, [
      "거래일시", "거래일자", "거래일", "이용일자", "이용일", "승인일자", "승인일", "날짜", "일자",
    ]),
    merchant,
    amount:
      withdrawal >= 0 || deposit >= 0
        ? -1
        : findColumn(headers, ["이용금액", "승인금액", "거래금액", "금액"], [
            ...notMoney,
            "누계",
            "한도",
          ]),
    withdrawal,
    deposit,
    memo,
  };

  if (rows.length === 0) return guess;

  /*
    Reading a handful of rows is not the same as reading the file. A mapping
    that lands on 회차 finds a number on the instalment lines and nothing on
    the rest, which looked like success and dropped four rows in five.
  */
  const dated = rows.filter((row) => normaliseDate(row[guess.date] || "")).length;
  const usable = usableRows(rows, guess);
  if (usable > 0 && usable >= Math.max(1, Math.round(dated * 0.6))) return guess;

  return detectFromRows(headers, rows, guess);
}

// ---------------------------------------------------------------------------
// Value normalising
// ---------------------------------------------------------------------------

/** Accepts 2026-09-05, 2026.09.05, 20260905, 2026/9/5, with or without a time. */
/** Refuses a combination that is not a real date, so a bad read can be caught. */
function asDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function normaliseDate(raw: string): string | null {
  const value = (raw || "").trim();
  if (!value) return null;

  // 2026-09-05, 2026.9.5, 20260905, optionally with a time after it
  const full = value.match(/(\d{4})[.\-/]?\s?(\d{1,2})[.\-/]?\s?(\d{1,2})/);
  if (full) {
    const settled = asDate(Number(full[1]), Number(full[2]), Number(full[3]));
    if (settled) return settled;
  }

  /*
    26.08.03 — a two-digit year, which card statements use throughout. Read as
    a year-less date it became month 26 of this year, which is how a whole
    statement ended up filed under "2026년 26월".
  */
  const shortYear = value.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (shortYear) {
    const settled = asDate(
      2000 + Number(shortYear[1]),
      Number(shortYear[2]),
      Number(shortYear[3])
    );
    if (settled) return settled;
  }

  // 260803, the same thing without separators
  const compact = value.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (compact) {
    const settled = asDate(
      2000 + Number(compact[1]),
      Number(compact[2]),
      Number(compact[3])
    );
    if (settled) return settled;
  }

  // 09-05, with no year at all: assume the current one. Anchored at both ends
  // so a date that carries a year never falls through to here.
  const monthDay = value.match(/^(\d{1,2})[.\-/](\d{1,2})(?![.\-/]?\d)/);
  if (monthDay) {
    return asDate(
      new Date().getFullYear(),
      Number(monthDay[1]),
      Number(monthDay[2])
    );
  }

  return null;
}

export function normaliseTime(raw: string): string {
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return "12:00";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/** Returns the absolute value; the sign is reported separately. */
export function normaliseAmount(raw: string): { value: number; negative: boolean } {
  const text = (raw || "").replace(/[^0-9.\-]/g, "");
  if (!text) return { value: 0, negative: false };
  const parsed = Number(text);
  if (Number.isNaN(parsed)) return { value: 0, negative: false };
  return { value: Math.abs(Math.round(parsed)), negative: parsed < 0 };
}

// ---------------------------------------------------------------------------
// Category guessing
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: { category: CategoryType; words: string[] }[] = [
  // 통신 before 주거, 의료 before 생활 — the more specific word decides
  ...HOUSING_KEYWORDS,
  ...LIVING_KEYWORDS,
  { category: "카페/간식", words: ["스타벅스", "커피", "카페", "이디야", "메가", "투썸", "빽다방", "공차", "베이커리", "파리바게","뚜레쥬르"] },
  { category: "식비", words: ["배달", "요기요", "배민", "쿠팡이츠", "food", "식당", "김밥", "치킨", "피자", "마트", "이마트", "홈플러스", "롯데마트", "GS25", "CU", "세븐일레븐", "편의점", "냉면", "국밥", "분식"] },
  { category: "교통", words: ["티머니", "카카오T", "택시", "지하철", "버스", "코레일", "SRT", "주유", "충전", "하이패스", "톨게이트", "주차"] },
  { category: "구독/미디어", words: ["넷플릭스", "netflix", "유튜브", "youtube", "왓챠", "웨이브", "티빙", "디즈니", "스포티파이", "멜론", "지니뮤직", "쿠팡와우", "구독"] },
  { category: "쇼핑", words: ["쿠팡", "11번가", "지마켓", "옥션", "무신사", "올리브영", "다이소", "네이버페이", "SSG", "백화점"] },
  { category: "문화/여가", words: ["CGV", "메가박스", "롯데시네마", "영화", "서점", "교보", "yes24", "알라딘", "헬스", "피트니스", "PC방", "노래"] },
  { category: "급여", words: ["급여", "월급", "상여", "성과급"] },
];

export function guessCategory(merchant: string, isIncome: boolean): CategoryType {
  // Card bills and the three financial categories are decided the same way
  // everywhere else in the app, so they are settled before any keyword here
  // gets a look in.
  const builtIn = builtInCategoryFor(merchant, isIncome);
  if (builtIn) return builtIn;

  const text = merchant.toLowerCase();
  for (const { category, words } of CATEGORY_KEYWORDS) {
    if (words.some((word) => text.includes(word.toLowerCase()))) {
      if (isIncome && category !== "급여") continue;
      return category;
    }
  }
  return isIncome ? "기타수입" : "기타지출";
}

const FIXED_KEYWORDS = [
  "월세", "관리비", "보험", "넷플릭스", "유튜브", "쿠팡와우", "통신", "요금", "구독",
  "정기결제", "자동이체", "대출", "이자", "임대료", "적금", "학원",
];

export function guessExpenseType(merchant: string, type: TransactionType): ExpenseType {
  if (type === "INCOME") return "INCOME";
  const text = merchant.toLowerCase();
  return FIXED_KEYWORDS.some((word) => text.includes(word.toLowerCase()))
    ? "FIXED"
    : "VARIABLE";
}

// ---------------------------------------------------------------------------
// Building drafts
// ---------------------------------------------------------------------------

export interface DraftRow {
  /** Row number in the file, for reporting problems back. */
  lineNumber: number;
  date: string;
  time: string;
  merchant: string;
  amount: number;
  type: TransactionType;
  expenseType: ExpenseType;
  category: CategoryType;
  memo: string;
  /** The month this line is billed in, when the statement says. */
  billingMonth?: string;
}

export interface BuildResult {
  drafts: DraftRow[];
  /** Rows that had no usable date or amount. */
  skipped: { lineNumber: number; reason: string }[];
}

export function buildDrafts(table: ParsedTable, mapping: ColumnMapping): BuildResult {
  const drafts: DraftRow[] = [];
  const skipped: { lineNumber: number; reason: string }[] = [];

  table.rows.forEach((row, index) => {
    const lineNumber = table.headerRowIndex + 2 + index;
    const cell = (column: number) => (column >= 0 ? row[column] || "" : "");

    /*
      The date the line is billed on is not the date it was used: an instalment
      is used once and billed for months afterwards. Only the month matters.
    */
    const billed = normaliseDate(cell(mapping.billing));
    const billingMonth = billed ? billed.slice(0, 7) : undefined;

    const date = normaliseDate(cell(mapping.date));
    if (!date) {
      skipped.push({ lineNumber, reason: "날짜를 읽을 수 없음" });
      return;
    }

    let amount = 0;
    let type: TransactionType = "EXPENSE";

    if (mapping.withdrawal >= 0 || mapping.deposit >= 0) {
      const out = normaliseAmount(cell(mapping.withdrawal));
      const inn = normaliseAmount(cell(mapping.deposit));
      if (out.value > 0) {
        amount = out.value;
        type = "EXPENSE";
      } else if (inn.value > 0) {
        amount = inn.value;
        type = "INCOME";
      }
    } else {
      const single = normaliseAmount(cell(mapping.amount));
      amount = single.value;
      // A signed column: a minus normally means money leaving
      type = single.negative ? "EXPENSE" : "EXPENSE";
    }

    if (amount <= 0) {
      skipped.push({ lineNumber, reason: "금액이 0이거나 읽을 수 없음" });
      return;
    }

    // A blank counterparty (a card payment, a fee) falls back to the memo
    const memo = cell(mapping.memo).trim();
    const merchant = cell(mapping.merchant).trim() || memo || "내역 없음";
    const expenseType = guessExpenseType(`${merchant} ${memo}`, type);

    drafts.push({
      lineNumber,
      date,
      time: normaliseTime(cell(mapping.date)),
      merchant,
      amount,
      type,
      expenseType,
      // 적요 often carries the useful word ("급여") when the counterparty is a company name
      category: guessCategory(`${merchant} ${memo}`, type === "INCOME"),
      memo,
      billingMonth,
    });
  });

  return { drafts, skipped };
}

/**
 * What counts as the same entry: same day, same description, same amount.
 * Statements repeat genuinely different purchases at the same shop on the same
 * day, which is why the user is asked rather than told.
 */
/**
 * Which instalment of a purchase a line is, as the statement numbers them.
 *
 * KB writes "8/10" — the eighth of ten — in the 할부 column, which is what
 * tells one month's billing of a purchase from the next.
 */
export function instalmentMarker(text: string): string {
  const value = (text || "").replace(/\s+/g, "");
  const match = value.match(/(\d{1,2})\/(\d{1,2})/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "";
}

/** True when a line is billed over several months rather than at once. */
export function isInstalment(text: string): boolean {
  const value = (text || "").replace(/\s+/g, "");
  if (!value || value.includes("일시불")) return false;
  return value.includes("할부") || /\d{1,2}\/\d{1,2}/.test(value);
}

/**
 * What makes two entries the same charge.
 *
 * An instalment repeats the purchase date, the shop and the amount in every
 * month it is billed, so the instalment number has to be part of the identity
 * — without it, the second month's billing looks like the first one again.
 */
export function duplicateKey(tx: {
  date: string;
  merchant: string;
  amount: number;
  memo?: string;
}): string {
  const marker = instalmentMarker(tx.memo || "");
  const base = `${tx.date}|${tx.merchant.replace(/\s/g, "")}|${Math.round(tx.amount)}`;
  return marker ? `${base}|${marker}` : base;
}

export function draftToTransaction(
  draft: DraftRow,
  accountId: string,
  paymentMethod: string
): Omit<Transaction, "id"> {
  return {
    date: draft.date,
    time: draft.time,
    type: draft.type,
    expenseType: draft.expenseType,
    category: draft.category,
    merchant: draft.merchant,
    amount: draft.amount,
    paymentMethod,
    accountId,
    memo: draft.memo || undefined,
    isFixedRecurring: draft.expenseType === "FIXED",
    billingMonth: draft.billingMonth,
  };
}
