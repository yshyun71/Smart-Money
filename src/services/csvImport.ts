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
/**
 * Whether the bytes really are a workbook, rather than a file merely named one.
 *
 * `.xls` is handed out by Korean banks for three quite different things: a real
 * BIFF workbook, an HTML table, and plain CSV or TSV text. Only the first is a
 * workbook, and giving the other two to the spreadsheet reader mangles them —
 * text read as a workbook comes back as mojibake, because the bytes are taken
 * for a legacy codepage instead of UTF-8 or euc-kr.
 */
function looksLikeWorkbook(bytes: Uint8Array): boolean {
  // OLE2 compound file: .xls
  if (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    return true;
  }

  // ZIP container: .xlsx / .xlsm / .xlsb
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 2048).toLowerCase();
  return (
    head.includes("<html") || head.includes("<table") || head.includes("<!doctype html")
  );
}

/**
 * How much a sheet looks like the statement's transactions.
 *
 * A row count alone is not enough: a cover sheet can hold one stray line with a
 * date and a number in it, and would then tie with a real table that happens to
 * carry a single purchase — and win, for being first. So a sheet whose heading
 * reads like a transaction table is preferred outright.
 */
function scoreSheetText(text: string): { qualified: number; usable: number; hint: number } {
  const table = parseDelimited(text);
  if (table.headers.length === 0) return { qualified: 0, usable: 0, hint: 0 };

  const hint = hintScoreOf(table.headers.map((header) => header.trim()));
  const usable = scoreMapping(table, autoDetectMapping(table.headers, table.rows)).usable;

  return { qualified: hint >= 2 && usable > 0 ? 1 : 0, usable, hint };
}

export async function loadStatementFile(
  file: File,
  sheetName?: string
): Promise<LoadedFile> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (!isSpreadsheetFile(file)) {
    return { text: decodeFile(buffer), sheetNames: [], usedSheet: null };
  }

  const XLSX = await import("xlsx");

  /*
    A file named .xls that is not one is decoded here, where the encoding is
    understood, and only then handed over — as text for HTML, whose structure
    the reader still parses correctly, or straight through for CSV and TSV.

    HTML is where the sheet count comes from: the reader makes a sheet of every
    <table> in the document, and a statement writes each of its sections as one.
    A file the user sees as a single sheet can arrive here as eleven.
  */
  let workbook;
  if (looksLikeWorkbook(bytes)) {
    workbook = XLSX.read(bytes, {
      type: "array",
      // Otherwise dates arrive as Excel serial numbers
      cellDates: true,
    });
  } else {
    const text = decodeFile(buffer);
    if (!looksLikeHtml(text)) {
      return { text, sheetNames: [], usedSheet: null };
    }
    workbook = XLSX.read(text, { type: "string", cellDates: true });
  }

  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0) {
    throw new Error("엑셀 파일에 시트가 없습니다.");
  }

  const toCsv = (name: string) =>
    XLSX.utils.sheet_to_csv(workbook.Sheets[name], {
      blankrows: false,
      // Use the displayed value, so dates and amounts read as the bank wrote them
      rawNumbers: false,
    });

  /** Every sheet end to end, for a statement split across several of them. */
  const everySheet = () =>
    sheetNames
      .map(toCsv)
      .filter((text) => text.trim() !== "")
      .join("\n\n");

  // An empty name is the user asking for the whole document rather than a sheet
  if (sheetName === "") {
    return { text: everySheet(), sheetNames, usedSheet: null };
  }
  if (sheetName && sheetNames.includes(sheetName)) {
    return { text: toCsv(sheetName), sheetNames, usedSheet: sheetName };
  }

  /*
    The transactions are not always on the first sheet — a statement often
    opens with a cover or a summary — so the sheet whose rows actually read as
    transactions is the one used.
  */
  let chosen = "";
  let best = { qualified: -1, usable: -1, hint: -1 };

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet || !Object.keys(sheet).some((cell) => !cell.startsWith("!"))) continue;

    const score = scoreSheetText(toCsv(name));
    const better =
      score.qualified > best.qualified ||
      (score.qualified === best.qualified && score.usable > best.usable) ||
      (score.qualified === best.qualified &&
        score.usable === best.usable &&
        score.hint > best.hint);

    if (!chosen || better) {
      chosen = name;
      best = score;
    }
  }

  /*
    Where no single sheet holds a table of transactions, the document is read
    whole: a section's heading and its rows can land in separate tables, and
    together they still read as the statement they are.
  */
  if (sheetNames.length > 1) {
    const combinedText = everySheet();
    const combined = scoreSheetText(combinedText);
    const better =
      combined.qualified > best.qualified ||
      (combined.qualified === best.qualified && combined.usable > best.usable);

    if (better) {
      return { text: combinedText, sheetNames, usedSheet: null };
    }
  }

  const used = chosen || sheetNames[0];
  return { text: toCsv(used), sheetNames, usedSheet: used };
}

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

/** Squares the rows under a header off to the same width. */
function shapeRows(all: string[][], from: number, width: number): string[][] {
  return all
    .slice(from)
    .map((row) => {
      const padded = [...row];
      while (padded.length < width) padded.push("");
      return padded.slice(0, width).map((cell) => cell.trim());
    })
    .filter((row) => row.some((cell) => cell !== ""));
}

interface TableStart {
  headerRowIndex: number;
  hasSubHeader: boolean;
  headers: string[];
  /** Where this block's rows start and stop, so two blocks can be told apart. */
  from: number;
  until: number;
  rows: string[][];
  /** Rows under this header that read as a dated transaction with an amount. */
  usable: number;
  hintScore: number;
}

function hintScoreOf(cells: string[]): number {
  return cells.reduce(
    (total, cell) =>
      total + (HEADER_HINTS.some((hint) => cell.replace(/\s/g, "").includes(hint)) ? 1 : 0),
    0
  );
}

function evaluateHeaderRow(all: string[][], index: number): TableStart | null {
  const top = all[index].map((cell) => cell.trim());
  if (top.filter(Boolean).length < 2) return null;

  const hintScore = hintScoreOf(top);
  if (hintScore === 0) return null;

  const hasSubHeader = looksLikeSubHeader(all[index + 1]);
  const headers = hasSubHeader
    ? mergeHeaderRows(top, all[index + 1].map((cell) => cell.trim()))
    : top;

  const from = index + (hasSubHeader ? 2 : 1);

  /*
    The block ends where the next section starts. A 신한 statement carries
    several tables in a row — 카드사용내역, 취소매출, 할인혜택 — and running one
    into the next leaves every later heading and its "내역이 없습니다" line to be
    reported as rows that could not be read.
  */
  let until = all.length;
  for (let next = from; next < all.length; next++) {
    const cells = all[next].map((cell) => cell.trim());
    const filled = cells.filter(Boolean);
    if (filled.length === 0) continue;

    // "4.장기카드대출 이용내역" — a numbered heading standing on its own
    const numbered = filled.length <= 2 && /^\d+\s*[.．]/.test(filled[0]);

    const heading =
      filled.length >= 2 &&
      hintScoreOf(cells) >= 2 &&
      // and not a transaction that happens to sit under one
      usableRows(shapeRows([all[next]], 0, headers.length), autoDetectMapping(headers, shapeRows([all[next]], 0, headers.length))) === 0;

    if (!numbered && !heading) continue;

    until = next;
    break;
  }

  const rows = shapeRows(all.slice(0, until), from, headers.length);
  const mapping = autoDetectMapping(headers, rows);

  return {
    headerRowIndex: index,
    hasSubHeader,
    headers,
    from,
    until,
    rows,
    usable: usableRows(rows, mapping),
    hintScore,
  };
}

/**
 * Finds the table of transactions, which is not always the first table.
 *
 * A 신한 statement opens with the payment account, a summary of what is owed,
 * a points balance and a list of discounts — each laid out as its own little
 * table with headings that look every bit as much like a transaction table as
 * the real one, which begins over halfway down under "3. 카드사용내역".
 *
 * So every candidate header is tried and the one whose rows actually read as
 * dated transactions wins. Where none of them do — a statement with nothing on
 * it — the most transaction-like heading is offered for the user to correct.
 */
/**
 * Whether two blocks are the same table written twice.
 *
 * 삼성 splits a statement across sheets — 할부 on one, 리볼빙 일시불 on the
 * next — with the same columns on each, though the shorter one stops before
 * 적립금액 and 입금후잔액. Comparing only as far as the shorter one goes is
 * what lets those two count as one table.
 */
function sameShape(a: string[], b: string[]): boolean {
  const width = Math.min(a.length, b.length);
  if (width < 3) return false;

  for (let index = 0; index < width; index++) {
    if ((a[index] || "").trim() !== (b[index] || "").trim()) return false;
  }
  return true;
}

function findTable(all: string[][]): TableStart | null {
  const candidates: TableStart[] = [];

  for (let index = 0; index < all.length; index++) {
    const candidate = evaluateHeaderRow(all, index);
    if (candidate) candidates.push(candidate);
  }

  let best: TableStart | null = null;
  for (const candidate of candidates) {
    if (
      !best ||
      candidate.usable > best.usable ||
      (candidate.usable === best.usable && candidate.hintScore > best.hintScore)
    ) {
      best = candidate;
    }
  }

  if (!best) return null;

  /*
    One statement, several tables of the same shape: 삼성 puts 할부 on one sheet
    and 리볼빙 일시불 on the next, and reading the document whole used to yield
    whichever block was longer — the other had to be imported all over again as
    a second file. Blocks that repeat the chosen table's columns are its
    continuation and are taken with it, in the order the document has them.

    Only whole blocks that sit outside the ones already taken are joined, so a
    sub-header or a summary that happens to share a column name cannot pull the
    same rows in twice.
  */
  const chosen: TableStart[] = [best];

  for (const candidate of candidates) {
    if (candidate === best) continue;
    if (candidate.usable === 0) continue;
    if (!sameShape(candidate.headers, best.headers)) continue;

    const overlaps = chosen.some(
      (taken) => candidate.headerRowIndex < taken.until && candidate.until > taken.headerRowIndex
    );
    if (overlaps) continue;

    chosen.push(candidate);
  }

  if (chosen.length === 1) return best;

  chosen.sort((a, b) => a.headerRowIndex - b.headerRowIndex);

  return {
    ...best,
    rows: chosen.flatMap((block) => shapeRows(block.rows, 0, best.headers.length)),
    usable: chosen.reduce((total, block) => total + block.usable, 0),
  };
}

export function parseDelimited(text: string): ParsedTable {
  const delimiter = detectDelimiter(text);
  const all = splitRows(text, delimiter).filter((row) =>
    row.some((cell) => cell.trim() !== "")
  );

  if (all.length === 0) {
    return { headers: [], rows: [], headerRowIndex: 0 };
  }

  const table = findTable(all);
  if (!table) {
    const headers = all[0].map((cell) => cell.trim());
    return { headers, rows: shapeRows(all, 1, headers.length), headerRowIndex: 0 };
  }

  return {
    headers: table.headers,
    rows: table.rows,
    headerRowIndex: table.headerRowIndex,
  };
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
  /**
   * 수수료·이자, charged beside the principal.
   *
   * Some lines are nothing but a fee — an insurance premium, an SMS charge —
   * and carry no principal at all, so this stands in as the amount when the
   * principal column is empty.
   */
  fee: number;
  /**
   * 회차 — which instalment of a purchase a line is.
   *
   * The same purchase is billed again every month with the same date, shop and
   * amount; only this number tells one month's billing from the next.
   */
  instalment: number;
}

export const EMPTY_MAPPING: ColumnMapping = {
  date: -1,
  merchant: -1,
  amount: -1,
  withdrawal: -1,
  deposit: -1,
  memo: -1,
  billing: -1,
  fee: -1,
  instalment: -1,
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

    const fee = mapping.fee >= 0 ? normaliseAmount(cell(mapping.fee)).value : 0;

    if (amount > 0 || fee > 0) count++;
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

export type MappingSource = "REMEMBERED" | "RULES";

/**
 * Whether to trust a format remembered from before, or read the file afresh.
 *
 * A remembered mapping is a fine shortcut until the rules that read these
 * files improve: a mapping saved while 입금하실 금액 was being read as income
 * would go on reading it that way forever, quietly overriding the fix. So it
 * is held up against the file it claims to describe, and set aside where
 * fresh detection accounts for more of it.
 */
export function chooseMapping(
  table: ParsedTable,
  remembered: ColumnMapping | null,
  guess: ColumnMapping
): { mapping: ColumnMapping; source: MappingSource } {
  if (!remembered) return { mapping: guess, source: "RULES" };

  const settled = withNewColumns(remembered, guess);

  const kept = scoreMapping(table, settled);
  const fresh = scoreMapping(table, guess);

  if (kept.ok || kept.usable >= fresh.usable) {
    return { mapping: settled, source: "REMEMBERED" };
  }

  return { mapping: guess, source: "RULES" };
}

/**
 * A remembered format can only speak about the columns that existed when it
 * was saved.
 *
 * 회차 and 수수료 were both added long after the first formats were stored, and
 * a mapping saved before them has no such field at all — not -1, which would
 * mean "this file has no such column", but nothing. Left as it was, the stored
 * format went on reading the file the way last year's code did: the 회차 never
 * reached the memo, so one month's instalment and the next shared a duplicate
 * key and the second was filed as already registered. Fresh detection answers
 * for anything the memory has no opinion on; every column it does name is left
 * exactly as the person confirmed it.
 */
function withNewColumns(remembered: ColumnMapping, guess: ColumnMapping): ColumnMapping {
  const filled = { ...remembered };

  for (const key of Object.keys(guess) as (keyof ColumnMapping)[]) {
    if (typeof filled[key] !== "number") filled[key] = guess[key];
  }

  return filled;
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
  const notMoney = [
    "잔액", "회차", "개월", "건수", "포인트", "마일리지", "번호", "적립", "혜택",
  ];

  const withdrawal = findColumn(
    headers,
    /*
      원금 is last so the issuers that head the column properly — 이번달
      결제금액 원금, 이번 달 입금하실 금액 원금 — keep matching on the fuller
      name. 삼성 heads it 원금 and nothing else, beside an 이용금액 holding the
      whole purchase; taken as the amount that one bills 160,550원 for a
      16,000원 instalment.
    */
    ["출금", "지출", "차감", "결제금액", "납부금액", "청구금액", "입금하실", "원금"],
    notMoney
  );

  /*
    "이번 달 입금하실 금액" is what the card is asking for, not money arriving —
    read as a deposit it turns a month of spending into income.
  */
  const deposit = findColumn(headers, ["입금", "수입"], [...notMoney, "입금하실"]);

  const counterparty = findColumn(headers, COUNTERPARTY_KEYWORDS);
  const description = findColumn(headers, DESCRIPTION_KEYWORDS);
  const merchant = counterparty >= 0 ? counterparty : description;

  const memo =
    counterparty >= 0 && description >= 0
      ? description
      : findColumn(
          headers,
          /*
            매출구분 first: 우리카드 heads two columns 구분 — 카드구분 holds
            신용/본인, while 매출구분 holds 국내할부·일시불·차감·카드소계, which
            is what says how a line was paid and whether it is a total at all.
          */
          ["매출구분", "구분", "결제구분", "거래구분", "할부", "메모", "비고", "업종", "적요2"],
          ["개월", "회차"]
        );

  const billing = findColumn(headers, [
    "결제년월", "청구년월", "청구월", "결제월", "결제일자", "결제예정일", "결제일",
  ]);

  const guess: ColumnMapping = {
    billing,
    fee: findColumn(headers, ["수수료", "이자"], [...notMoney, "율"]),
    // 결제 후 잔액 회차 is what is left to pay, not which instalment this is
    instalment: findColumn(headers, ["회차"], ["잔액", "남은", "잔여"]),
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

export interface BuildOptions {
  /**
   * Stands in for a missing date, where the statement supplies one for the
   * whole file rather than per line — an annual fee is charged in a billing
   * month without being used on any particular day.
   */
  fallbackDate?: string;
}

/**
 * Whether a description is a total rather than something that was bought.
 *
 * Most statements leave the shop column empty on their totals, and a line with
 * no shop was already kept out. 삼성 writes the total in that very column, so
 * with a billing month to date it by, a 185,200원 "purchase" went straight into
 * the ledger alongside the four instalments it was the sum of.
 *
 * The label is the section's own name with 합계 or 소계 worked into it, and
 * where it sits varies by issuer: 삼성 puts it last (일부결제금액이월약정(리볼빙)
 * 일시불합계), 우리 puts it first or mid-string (소계(양승현),
 * 청구합계-국민은행 357******155).
 *
 * What holds across all of them is that the word ends there — the next
 * character is a bracket, a dash, a digit, or nothing. A shop can carry the
 * same syllables inside a longer Korean word (종합계좌이체 is a real payment,
 * not a total), and that is exactly the case a following 한글 letter rules
 * out. Matching on mere containment would drop such a payment in silence.
 */
export function isTotalLabel(text: string): boolean {
  const value = (text || "").replace(/\s+/g, "");
  if (!value) return false;
  return /(합계|소계|총계|누계)(?![가-힣])/.test(value);
}

export function buildDrafts(
  table: ParsedTable,
  mapping: ColumnMapping,
  options: BuildOptions = {}
): BuildResult {
  const drafts: DraftRow[] = [];
  const skipped: { lineNumber: number; reason: string }[] = [];

  /** Which row the last draft came from, so an adjustment knows what it adjusts. */
  let lastDraftRow = -1;

  table.rows.forEach((row, index) => {
    const lineNumber = table.headerRowIndex + 2 + index;
    const cell = (column: number) => (column >= 0 ? row[column] || "" : "");

    /*
      The date the line is billed on is not the date it was used: an instalment
      is used once and billed for months afterwards. Only the month matters.
    */
    const billed = normaliseDate(cell(mapping.billing));
    const billingMonth = billed ? billed.slice(0, 7) : undefined;

    /*
      A line with no date but a shop and an amount is a charge the statement
      dates as a whole: an annual fee, an interest charge. It is taken at the
      billing month the import was given, and only then — a total or a footer
      has no shop against it and stays out.
    */
    const named = cell(mapping.merchant).trim();

    /*
      A total, wherever the statement writes it. 삼성 and 우리 put it in the
      shop column; 우리 also names it in 매출구분 (카드소계, 청구결제번호소계),
      which is the plainer statement of the two.
    */
    if (isTotalLabel(named) || isTotalLabel(cell(mapping.memo))) {
      skipped.push({ lineNumber, reason: "합계 줄" });
      return;
    }

    const dated = normaliseDate(cell(mapping.date));
    const charged =
      mapping.fee >= 0 ? normaliseAmount(cell(mapping.fee)) : { value: 0, negative: false };

    /*
      무이자혜택금액 — a line of its own, directly under the purchase, handing
      back the interest charged on it. KB bills an instalment as 원금 25,947 +
      수수료 838 and then waives the 838 this way, so the line above is only
      settled once this one is read; a purchase whose interest is not waived
      (원금 17,321 + 수수료 46) has no such line and keeps its fee.

      It belongs to the line immediately above it and nothing else, which is
      what the adjacency check holds to.
    */
    if (!dated && charged.negative && charged.value > 0 && lastDraftRow === index - 1) {
      const previous = drafts[drafts.length - 1];
      if (previous) {
        previous.amount = Math.max(0, previous.amount - charged.value);
        return;
      }
    }

    const date = dated || (named ? options.fallbackDate || null : null);

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
        /*
          A minus in the charge column is money coming off the bill, not onto
          it: 우리카드 bills 차감-[청구할인] as 원금 −10,000. Read as a charge it
          adds 10,000 to the month instead of taking it away, and the month's
          total then matches no withdrawal — which is what ties a bill to the
          payment that settles it (9.2).
        */
        amount = out.value;
        type = out.negative ? "INCOME" : "EXPENSE";
      } else if (inn.value > 0) {
        amount = inn.value;
        type = inn.negative ? "EXPENSE" : "INCOME";
      }
    } else {
      const single = normaliseAmount(cell(mapping.amount));
      amount = single.value;
      // A signed column: a minus normally means money leaving
      type = single.negative ? "EXPENSE" : "EXPENSE";
    }

    /*
      수수료 is billed alongside the principal, not instead of it, so what is
      charged for the line is the two together. A line carrying only a fee —
      크레딧케어, an SMS charge, interest billed on its own — is a charge in its
      own right and the fee stands as the amount.

      Interest that is waived comes back on its own line and is taken off
      above, which is why adding it here does not overcount: 원금 25,947 +
      수수료 838 − 혜택 838 leaves 25,947, while 원금 17,321 + 수수료 46 stays
      17,367. Netting the fee against the principal instead would lose that 46.
    */
    if (charged.value > 0 && !charged.negative && type === "EXPENSE") {
      amount += charged.value;
    }

    if (amount <= 0) {
      skipped.push({ lineNumber, reason: "금액이 0이거나 읽을 수 없음" });
      return;
    }

    /*
      The instalment number belongs with the description, which is where the
      duplicate check reads identity from. Statements keep it in a column of
      its own — 회차 — beside a 할부 column holding only how many months the
      purchase runs for, which is the same every month and settles nothing.
    */
    const described = cell(mapping.memo).trim();
    const round = cell(mapping.instalment).trim();
    const months = /^\d{1,3}$/.test(described) ? described : "";

    const marker = round
      ? months
        ? `${Number(round)}/${Number(months)}`
        : `${Number(round)}회차`
      : "";

    const memo = [months ? "" : described, marker].filter(Boolean).join(" ").trim();
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

    lastDraftRow = index;
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
const pad2 = (value: number) => String(value).padStart(2, "0");

/** A plausible 연월, or nothing. */
function asMonth(year: number, month: number): string | null {
  if (year < 2000 || year > 2099) return null;
  if (month < 1 || month > 12) return null;
  return `${year}-${pad2(month)}`;
}

/**
 * The billing month written into a file's name.
 *
 * Statements are downloaded named for the month they bill —
 * "2026년3월 이용대금명세서(신한카드).xls", "신한카드_202603_명세서.csv",
 * "202607_usage.csv" — which is a better answer than anything the rows can
 * give, since the rows hold usage dates rather than the billing month.
 */
export function billingMonthFromName(fileName: string): string | null {
  const name = (fileName || "").replace(/\.[A-Za-z0-9]+$/, "");

  // 2026년 3월 — said outright
  const spelled = name.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  if (spelled) {
    const settled = asMonth(Number(spelled[1]), Number(spelled[2]));
    if (settled) return settled;
  }

  /*
    202603 · 2026-03 · 2026_03 · 2026.03, standing on its own. A longer run of
    digits is something else entirely and is left to the rules below.
  */
  for (const match of name.matchAll(/(\d{4})[-_. ]?(\d{2})/g)) {
    const index = match.index ?? 0;
    const before = index > 0 ? name[index - 1] : "";
    const after = name[index + match[0].length] || "";
    if (/\d/.test(before) || /\d/.test(after)) continue;

    const settled = asMonth(Number(match[1]), Number(match[2]));
    if (settled) return settled;
  }

  /*
    2608 — a two-digit year, the way 롯데 names a file:
    "이용대금명세서_2608(신용.체크)_20260915091506.xls". Only a run of exactly
    four digits can be one, which keeps the download timestamp out of it, and
    only 20xx–39xx, so a plain year like 2026 is not read as month 26.
  */
  const runs = name.match(/\d+/g) || [];

  for (const run of runs) {
    if (run.length !== 4) continue;
    const century = Number(run.slice(0, 2));
    if (century < 20 || century > 39) continue;

    const settled = asMonth(2000 + century, Number(run.slice(2)));
    if (settled) return settled;
  }

  /*
    20260903 — KB국민카드 names the file for the day it sends the statement,
    "이용대금명세서_20260903.xlsx", and it sends September's statement in
    September, so the leading 연월 is the billing month.

    This is the weakest of the rules and goes last: 2608 and 202608 are
    deliberate labels of the billing month, while a send date only agrees with
    it by the issuer's habit. Where a name carries both, the label wins. Again
    the length is the guard — exactly eight digits, so 20260915091506 (a
    download time, which agrees with nothing) is not read as one.
  */
  for (const run of runs) {
    if (run.length !== 8) continue;

    const day = Number(run.slice(6));
    if (day < 1 || day > 31) continue;

    const settled = asMonth(Number(run.slice(0, 4)), Number(run.slice(4, 6)));
    if (settled) return settled;
  }

  return null;
}

/**
 * Which month a card statement bills.
 *
 * The file name settles it where it says so — a statement is downloaded named
 * for the month it bills, and that name is the month itself, not a month to
 * count from.
 *
 * Otherwise it is read from the usage dates, where a purchase is billed the
 * month after it was made. Instalments are left out of that reckoning: they
 * carry the date of a purchase made months ago and would date the statement to
 * whenever that was.
 */
export function guessBillingMonth(
  fileName: string,
  entries: { date: string; memo?: string }[]
): string | null {
  const named = billingMonthFromName(fileName);
  if (named) return named;

  const monthsOf = (rows: { date: string }[]) =>
    rows
      .map((row) => (row.date || "").slice(0, 7))
      .filter(Boolean)
      .sort();

  const oneOff = entries.filter((entry) => !isInstalment(entry.memo || ""));
  const months = monthsOf(oneOff.length > 0 ? oneOff : entries);

  const newest = months[months.length - 1];
  if (!newest) return null;

  const [year, month] = newest.split("-").map(Number);
  const moved = new Date(year, month, 1);
  return `${moved.getFullYear()}-${pad2(moved.getMonth() + 1)}`;
}

export function instalmentMarker(text: string): string {
  const value = (text || "").replace(/\s+/g, "");

  const pair = value.match(/(\d{1,2})\/(\d{1,2})/);
  if (pair) return `${Number(pair[1])}/${Number(pair[2])}`;

  // Some statements number the instalments without saying how many there are
  const single = value.match(/(\d{1,3})회차/);
  return single ? `${Number(single[1])}회차` : "";
}

/** True when a line is billed over several months rather than at once. */
export function isInstalment(text: string): boolean {
  const value = (text || "").replace(/\s+/g, "");
  if (!value || value.includes("일시불")) return false;
  return value.includes("할부") || /\d{1,2}\/\d{1,2}/.test(value) || /\d{1,3}회차/.test(value);
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
