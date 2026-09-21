import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { MonthPickerModal } from "../transactions/MonthPickerModal";
import type { Transaction } from "../../types/finance";
import {
  autoDetectMapping,
  buildDrafts,
  chooseMapping,
  draftToTransaction,
  duplicateKey,
  findSimilarEntry,
  EMPTY_MAPPING,
  instalmentMarker,
  isInstalment,
  loadStatementFile,
  guessBillingMonth,
  parseDelimited,
  scoreMapping,
  type ColumnMapping,
  type DraftRow,
  type ParsedTable,
} from "../../services/csvImport";
import { asOfLabel } from "../../utils/format";
import { recallMapping, rememberMapping } from "../../services/statementFormats";
import { detectStatementColumns } from "../../services/aiClient";
import { hasApiKey } from "../../services/ai";
import { planBalanceAdjustment } from "../../services/balance";
import {
  X,
  Upload,
  FileSpreadsheet,
  Loader2,
  Table2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  CopyCheck,
  SkipForward,
  Replace,
  CheckSquare,
  Square,
  Wand2,
  CalendarDays,
} from "lucide-react";

type Step = "PICK" | "MAP" | "REVIEW" | "DONE";
type ReviewFilter = "ALL" | "NEW" | "DUP";

const REVIEW_FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: "ALL", label: "전체" },
  { value: "NEW", label: "추가" },
  { value: "DUP", label: "중복" },
];
type Decision = "SKIP" | "OVERWRITE";

interface DuplicateItem {
  draft: DraftRow;
  existing: Transaction;
  decision: Decision;
}

const won = (value: number) => `${value.toLocaleString()}원`;

export const CsvImportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Pre-selects the account whose ledger the import was started from. */
  defaultAccountId?: string;
}> = ({ isOpen, onClose, defaultAccountId }) => {
  const {
    accounts,
    allTransactions,
    importTransactions,
    categoryForMerchant,
    setAccountBalance,
  } = useFinance();

  const [step, setStep] = useState<Step>("PICK");
  const [accountId, setAccountId] = useState(defaultAccountId || accounts[0]?.id || "");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [usedSheet, setUsedSheet] = useState<string | null>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [duplicates, setDuplicates] = useState<DuplicateItem[]>([]);
  const [fresh, setFresh] = useState<DraftRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<{ lineNumber: number; reason: string }[]>([]);
  const [result, setResult] = useState<{
    added: number;
    replaced: number;
    skipped: number;
    balance?: { counted: number; next: number; asOf: string };
  } | null>(null);
  /** Whether this import should also move the account's recorded balance. */
  const [adjustBalance, setAdjustBalance] = useState(false);
  /** The month a card statement bills, when its lines do not each say. */
  const [billingMonth, setBillingMonth] = useState("");
  const [showBillingPicker, setShowBillingPicker] = useState(false);
  /** Once the user sets it themselves, nothing else touches it. */
  const [billingTouched, setBillingTouched] = useState(false);
  /** Where the column mapping came from, which the user is told. */
  const [mappingSource, setMappingSource] = useState<
    "RULES" | "AI" | "REMEMBERED" | "MANUAL"
  >("RULES");
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("ALL");

  const account = accounts.find((a) => a.id === accountId);

  /*
    이 카드에 **이미 등록된 결제월**의 건수.

    달마다 몇 건이 들어와 있는지 보이면 "지난달 명세서를 넣었던가"를 그 자리에서
    알 수 있습니다. 날짜가 아니라 `billingMonth` 로 세는 것이 요점입니다 —
    고르는 값이 그것이니까요.
  */
  const billingCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of allTransactions as Transaction[]) {
      if (tx.accountId !== accountId) continue;
      const key = tx.billingMonth;
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [allTransactions, accountId]);

  const reset = () => {
    setStep("PICK");
    setFileName("");
    setFileError(null);
    setIsReading(false);
    setSourceFile(null);
    setSheetNames([]);
    setUsedSheet(null);
    setTable(null);
    setMapping(EMPTY_MAPPING);
    setDuplicates([]);
    setFresh([]);
    setSkippedRows([]);
    setResult(null);
    setAdjustBalance(false);
    setBillingMonth("");
    setBillingTouched(false);
    setMappingSource("RULES");
    setIsDetecting(false);
    setDetectNote(null);
    setReviewFilter("ALL");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const preview = useMemo(() => {
    if (!table) return { drafts: [] as DraftRow[], skipped: [] as { lineNumber: number; reason: string }[] };
    const built = buildDrafts(table, mapping, {
      fallbackDate: billingMonth ? `${billingMonth}-01` : undefined,
    });
    // A standing rule decides the category here too, so the preview shows
    // exactly what will be saved rather than the guess it started from.
    return {
      ...built,
      drafts: built.drafts.map((draft) => {
        const ruled = accountId
          ? categoryForMerchant(draft.merchant, accountId, draft.type === "INCOME")
          : null;
        // One statement, one billing month — unless its lines each carry one
        const billed = draft.billingMonth || billingMonth || undefined;
        return { ...draft, category: ruled || draft.category, billingMonth: billed };
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, mapping, accountId, categoryForMerchant, billingMonth]);

  /**
   * What this import would do to the recorded balance, given the choices made
   * on this screen. Only entries after the balance's own 기준일시 count.
   */
  const balancePlan = useMemo(() => {
    if (!account) return null;

    const paymentMethod = account.name || "가져온 내역";
    const saving = [
      ...fresh.map((draft) => draftToTransaction(draft, accountId, paymentMethod)),
      ...duplicates
        .filter((item) => item.decision === "OVERWRITE")
        .map((item) => draftToTransaction(item.draft, accountId, paymentMethod)),
    ];

    return planBalanceAdjustment(saving, account);
  }, [account, accountId, fresh, duplicates]);

  /*
    The month a statement bills, taken from its name where it says so and from
    the usage dates otherwise — a card bills the month after it was used in.
    The user corrects it on the mapping step.
  */
  /*
    The ledger already knows which card is being added to, so the picker starts
    there rather than on whichever account happens to be first.

    accountId is initialised once, when the modal first mounts — long before
    any ledger has been opened — and reset() deliberately leaves it alone so a
    person importing several files in a row does not have to choose the account
    each time. Neither of those gives the opening account a chance to be
    applied, which is why an import begun from a card's own screen still
    offered the first bank account.

    It runs on opening only: while the modal is open the person's own choice is
    theirs to keep.
  */
  useEffect(() => {
    if (!isOpen) return;

    const known = (id?: string) => (accounts.some((a: any) => a.id === id) ? id : "");
    const wanted = known(defaultAccountId) || known(accountId) || accounts[0]?.id || "";

    if (wanted !== accountId) setAccountId(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultAccountId]);

  useEffect(() => {
    if (!table || !account || account.type === "BANK" || billingTouched) return;

    /*
      Worked out again whenever the file or what was read from it changes, not
      only while the field is empty: the first pass can run before the name or
      the rows have settled, and a month guessed then would otherwise stand.
    */
    const guess = guessBillingMonth(
      fileName,
      preview.drafts.map((draft) => ({ date: draft.date, memo: draft.memo }))
    );
    if (guess && guess !== billingMonth) setBillingMonth(guess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, account, billingTouched, fileName, preview.drafts.length]);

  /**
   * Every line the file yielded, new and already-registered together.
   *
   * Showing only the duplicates left the other half of the summary with
   * nothing behind it: a count of what would be added, and no way to see what
   * that was. File order keeps a line findable in the file itself.
   */
  const reviewRows = useMemo(() => {
    const rows = [
      ...fresh.map((draft) => ({ draft, duplicate: null as DuplicateItem | null })),
      ...duplicates.map((item) => ({ draft: item.draft, duplicate: item })),
    ];
    return rows.sort((a, b) => a.draft.lineNumber - b.draft.lineNumber);
  }, [fresh, duplicates]);

  const visibleReviewRows = useMemo(
    () =>
      reviewRows.filter(({ duplicate }) =>
        reviewFilter === "ALL"
          ? true
          : reviewFilter === "NEW"
          ? !duplicate
          : Boolean(duplicate)
      ),
    [reviewRows, reviewFilter]
  );

  const mappingReady =
    mapping.date >= 0 &&
    (mapping.amount >= 0 || mapping.withdrawal >= 0 || mapping.deposit >= 0);

  if (!isOpen) return null;

  /** Reads a CSV or an Excel workbook; a workbook becomes CSV on the way in. */
  const handleFile = async (file: File, sheet?: string) => {
    setFileError(null);
    setFileName(file.name);
    setSourceFile(file);
    setIsReading(true);

    try {
      const loaded = await loadStatementFile(file, sheet);
      const parsed = parseDelimited(loaded.text);

      setSheetNames(loaded.sheetNames);
      setUsedSheet(loaded.usedSheet);

      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setFileError(
          loaded.sheetNames.length > 1
            ? "이 시트에서 표를 찾지 못했습니다. 다른 시트를 선택해보세요."
            : "파일에서 표를 찾지 못했습니다. 거래내역이 담긴 파일인지 확인해주세요."
        );
        setTable(null);
        setStep(loaded.sheetNames.length > 1 ? "MAP" : "PICK");
        return;
      }

      setTable(parsed);
      setStep("MAP");

      /*
        A format confirmed once is applied without another thought — unless it
        reads this file worse than the rules now would, which is what happens
        to a mapping saved before those rules were fixed.
      */
      const guess = autoDetectMapping(parsed.headers, parsed.rows);
      const remembered = recallMapping(parsed.headers);
      const { mapping: chosen, source } = chooseMapping(parsed, remembered, guess);

      setMapping(chosen);
      setMappingSource(source);

      if (source === "RULES" && remembered) {
        setDetectNote("이전에 저장해 둔 열 지정이 이 파일과 맞지 않아 다시 인식했습니다");
      }

      if (source === "REMEMBERED") return;
      if (scoreMapping(parsed, chosen).ok || !hasApiKey()) return;

      setIsDetecting(true);
      try {
        const detected = await detectStatementColumns(
          parsed.headers,
          parsed.rows.slice(0, 5)
        );
        const asMapping: ColumnMapping = {
          date: detected.date,
          merchant: detected.merchant,
          amount: detected.amount,
          withdrawal: detected.withdrawal,
          deposit: detected.deposit,
          memo: detected.memo,
          billing: detected.billing,
          fee: detected.fee,
          instalment: detected.instalment,
        };

        // Only if it actually reads the file better than the rules did
        const before = scoreMapping(parsed, guess);
        const after = scoreMapping(parsed, asMapping);
        if (after.ok || after.usable > before.usable) {
          setMapping(asMapping);
          setMappingSource("AI");
          setDetectNote(detected.reason || null);
        } else {
          setMappingSource("RULES");
        }
      } catch (error) {
        console.error("열 구조를 인식하지 못했습니다:", error);
      } finally {
        setIsDetecting(false);
      }
    } catch (error) {
      console.error(error);
      setFileError(
        error instanceof Error && error.message
          ? error.message
          : "파일을 읽지 못했습니다."
      );
      setTable(null);
    } finally {
      setIsReading(false);
    }
  };

  /** Asks the model again, for when the rules or a remembered format are wrong. */
  const redetectWithAi = async () => {
    if (!table || !hasApiKey() || isDetecting) return;

    setIsDetecting(true);
    setDetectNote(null);
    try {
      const detected = await detectStatementColumns(table.headers, table.rows.slice(0, 5));
      setMapping({
        date: detected.date,
        merchant: detected.merchant,
        amount: detected.amount,
        withdrawal: detected.withdrawal,
        deposit: detected.deposit,
        memo: detected.memo,
        billing: detected.billing,
        fee: detected.fee,
        instalment: detected.instalment,
      });
      setMappingSource("AI");
      setDetectNote(detected.reason || null);
    } catch (error) {
      setFileError(
        error instanceof Error && error.message
          ? error.message
          : "열 구조를 인식하지 못했습니다."
      );
    } finally {
      setIsDetecting(false);
    }
  };

  /** Splits the parsed rows into new entries and ones already recorded. */
  const goToReview = () => {
    const { drafts, skipped } = preview;

    // The columns have now been seen by a person, so this format is settled
    if (table) rememberMapping(table.headers, mapping);

    /*
      Only this account's own entries count as duplicates. The same shop, the
      same day and the same amount on a different card is a different payment,
      and treating it as already registered silently dropped whole statements.
    */
    const existingByKey = new Map<string, Transaction>();
    for (const tx of allTransactions) {
      if (tx.accountId !== accountId) continue;
      const key = duplicateKey(tx);
      if (!existingByKey.has(key)) existingByKey.set(key, tx);
    }

    const dup: DuplicateItem[] = [];
    const fresh: DraftRow[] = [];

    for (const draft of drafts) {
      /*
        An instalment is billed again every month, repeating the purchase date,
        the shop and the amount. Where the statement numbers them ("8/10") the
        number is part of the key and the months tell themselves apart; where
        it only says 할부 there is nothing to tell which month this is, so it
        is never counted as already registered.
      */
      const unnumbered =
        isInstalment(draft.memo) && instalmentMarker(draft.memo) === "";
      const exact = unnumbered ? undefined : existingByKey.get(duplicateKey(draft));

      if (exact) {
        dup.push({ draft, existing: exact, decision: "SKIP" });
        continue;
      }

      /*
        문자로 넣어 둔 임시 줄을 명세서가 대체합니다.

        `duplicateKey` 는 내역명이 같아야 중복으로 보는데, 문자와 명세서 사이
        에서는 이름이 거의 언제나 다릅니다 — 문자 `스타벅스 강남R점` / 명세서
        `스타벅스강남알`. 그대로 두면 같은 결제가 두 줄이 되어 그 달 합계가
        두 배로 잡히고, 카드대금 자동 연결(9.2)까지 어긋납니다.

        그래서 **같은 계좌·같은 날짜·같은 금액**이면서 그 줄이 문자에서 온
        것일 때만 같은 건으로 보고, 기본값을 **덮어쓰기**로 둡니다. 명세서가
        더 정확한 기록이기 때문입니다. 사람이 넣은 줄이나 다른 명세서 줄은
        건드리지 않습니다 — 같은 날 같은 금액을 다른 곳에서 쓴 것일 수 있고,
        근거 없이 합치지 않습니다(17.2).
      */
      const claimed = new Set(dup.map((item) => item.existing.id));
      const similar = findSimilarEntry(
        allTransactions,
        {
          date: draft.date,
          merchant: draft.merchant,
          amount: draft.amount,
          type: draft.type,
          accountId,
        },
        { ignoreIds: claimed }
      );

      if (similar?.origin === "SMS") {
        const existing = allTransactions.find((tx: Transaction) => tx.id === similar.id);
        if (existing) {
          dup.push({ draft, existing, decision: "OVERWRITE" });
          continue;
        }
      }

      fresh.push(draft);
    }

    setDuplicates(dup);
    setFresh(fresh);
    setSkippedRows(skipped);
    setStep("REVIEW");
  };

  const setAllDecisions = (decision: Decision) => {
    setDuplicates((prev) => prev.map((item) => ({ ...item, decision })));
  };

  const setDecision = (lineNumber: number, decision: Decision) => {
    setDuplicates((prev) =>
      prev.map((item) =>
        item.draft.lineNumber === lineNumber ? { ...item, decision } : item
      )
    );
  };

  const handleApply = () => {
    const paymentMethod = account?.name || "가져온 내역";

    const inserts = fresh.map((draft) =>
      draftToTransaction(draft, accountId, paymentMethod)
    );

    /*
      Overwriting replaces what the statement says, not what the person said
      about it. A note typed on an entry — and the card a bill was linked to —
      is theirs and survives the same statement arriving again; the statement
      has nothing to say about either, so taking the draft wholesale would
      silently erase both.
    */
    const overwrites = duplicates
      .filter((item) => item.decision === "OVERWRITE")
      .map((item) => {
        const replacement = draftToTransaction(item.draft, accountId, paymentMethod);
        return {
          ...replacement,
          id: item.existing.id,
          note: item.existing.note,
          linkedAccountId: replacement.linkedAccountId ?? item.existing.linkedAccountId,
          billingMonth: replacement.billingMonth ?? item.existing.billingMonth,
        };
      });

    try {
      importTransactions(inserts, overwrites);

      // Worked out from the entries, so the figure is tagged as such
      const moved =
        adjustBalance &&
        account?.type === "BANK" &&
        balancePlan &&
        balancePlan.counted > 0
          ? balancePlan
          : null;
      if (moved) {
        setAccountBalance(accountId, moved.next, moved.asOf, "AUTO");
      }

      setResult({
        added: inserts.length,
        replaced: overwrites.length,
        skipped: duplicates.length - overwrites.length,
        balance: moved
          ? { counted: moved.counted, next: moved.next, asOf: moved.asOf }
          : undefined,
      });
      setStep("DONE");
    } catch {
      setFileError("가져온 내역을 저장하지 못했습니다.");
    }
  };

  const headings: Record<Step, { title: string; sub: string }> = {
    PICK: { title: "내역 가져오기", sub: "은행·카드사에서 받은 엑셀·CSV 파일" },
    MAP: {
      title: "항목 확인",
      /*
        Which sheet the rows came from, and 전체 when they came from all of
        them — a statement split across sheets is read whole, and without
        saying so the count looks like one sheet's worth.
      */
      sub: `${fileName}${
        usedSheet
          ? ` · [${usedSheet}]`
          : sheetNames.length > 1
            ? ` · [전체 시트 ${sheetNames.length}개]`
            : ""
      } · ${table?.rows.length ?? 0}줄`,
    },
    REVIEW: { title: "중복 확인", sub: `새 내역 ${fresh.length}건 · 중복 ${duplicates.length}건` },
    DONE: { title: "가져오기 완료", sub: "가계부에 반영되었습니다" },
  };

  const columnSelect = (
    label: string,
    field: keyof ColumnMapping,
    hint: string,
    required = false
  ) => (
    <div>
      <label className="text-[10px] font-bold text-slate-600 flex items-center gap-1 mb-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
        <span className="font-normal text-slate-400">· {hint}</span>
      </label>
      <select
        value={mapping[field]}
        onChange={(e) => {
          setMappingSource("MANUAL");
          setDetectNote(null);
          setMapping((prev) => ({ ...prev, [field]: Number(e.target.value) }));
        }}
        className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-emerald-400 focus:outline-none"
      >
        <option value={-1}>사용 안 함</option>
        {table?.headers.map((header, index) => (
          <option key={index} value={index}>
            {header || `(${index + 1}번째 열)`}
          </option>
        ))}
      </select>
    </div>
  );

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                {headings[step].title}
              </h3>
              <p className="text-[10px] text-slate-400 truncate">{headings[step].sub}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="닫기"
            className="w-11 h-11 flex items-center justify-center -mr-2 -mt-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ---------------- PICK ---------------- */}
        {step === "PICK" && (
          <>
            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1.5">
                어느 카드·계좌의 내역인가요?
              </label>
              {accounts.length === 0 ? (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-900">
                  등록된 카드·계좌가 없습니다. 먼저 카드나 계좌를 등록해주세요.
                </div>
              ) : (
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-200 bg-white focus:border-emerald-400 focus:outline-none"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.type === "BANK" ? "🏦" : "💳"} {acc.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <label
              className={`block p-6 rounded-2xl border-2 border-dashed text-center transition ${
                accounts.length === 0
                  ? "border-slate-200 opacity-50"
                  : "border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/40 cursor-pointer"
              }`}
            >
              {isReading ? (
                <Loader2 className="w-7 h-7 mx-auto text-slate-400 mb-2 animate-spin" />
              ) : (
                <Upload className="w-7 h-7 mx-auto text-slate-400 mb-2" />
              )}
              <div className="text-xs font-bold text-slate-800">
                {isReading ? "파일 읽는 중..." : "엑셀 · CSV 파일 선택"}
              </div>
              <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                은행·카드사 홈페이지에서 내려받은
                <br />
                <strong className="text-slate-500">.xls · .xlsx · .csv</strong> 파일을 그대로
                올리세요
              </div>
              <input
                type="file"
                accept=".csv,.txt,.xls,.xlsx,.xlsm,.xlsb,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={accounts.length === 0 || isReading}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleFile(file);
                }}
              />
            </label>

            {fileError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
                {fileError}
              </div>
            )}

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-[10px] text-slate-500 leading-relaxed space-y-1">
              <div>
                엑셀(.xls·.xlsx)은 <strong>앱이 내부에서 CSV로 변환</strong>해 처리합니다. 따로
                저장할 필요가 없습니다.
              </div>
              <div>
                한글이 깨지는 파일(EUC-KR)도 자동으로 인식합니다.
              </div>
              <div>
                가져온 내역은 <strong>계좌 잔액을 바꾸지 않습니다</strong> — 이미 지난 기록이기 때문입니다.
              </div>
            </div>
          </>
        )}

        {/* ---------------- MAP ---------------- */}
        {step === "MAP" && sheetNames.length > 1 && (
          <div>
            <label className="text-[10px] font-bold text-slate-600 flex items-center gap-1 mb-1">
              <Table2 className="w-3 h-3 text-slate-400" />
              시트 선택
              <span className="font-normal text-slate-400">
                · 통합문서에 {sheetNames.length}개
              </span>
              {!usedSheet && (
                <span className="ml-auto px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[9px] font-extrabold">
                  전체 시트
                </span>
              )}
            </label>
            <select
              value={usedSheet ?? ""}
              disabled={isReading}
              onChange={(e) => {
                if (sourceFile) void handleFile(sourceFile, e.target.value);
              }}
              className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-emerald-400 focus:outline-none disabled:opacity-50"
            >
              <option value="">전체 — 시트 {sheetNames.length}개 합쳐서 읽기</option>
              {sheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {/* 삼성처럼 한 명세서가 시트 둘로 나뉜 경우가 있어, 무엇을 읽었는지 밝힙니다 */}
            <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">
              {usedSheet
                ? `[${usedSheet}] 시트만 읽었습니다. 명세서가 여러 시트로 나뉘어 있으면 전체를 고르세요.`
                : `시트 ${sheetNames.length}개를 합쳐서 읽었습니다. 한 시트만 보려면 위에서 고르세요.`}
            </p>
          </div>
        )}

        {step === "MAP" && fileError && (
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
            {fileError}
          </div>
        )}

        {step === "MAP" && !table && (
          <button
            type="button"
            onClick={() => setStep("PICK")}
            className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
          >
            다른 파일 선택
          </button>
        )}

        {step === "MAP" && table && (
          <>
            {/* Where the column mapping came from, and what to do about it */}
            <div
              className={`p-2.5 rounded-xl border text-[10px] leading-relaxed flex items-start gap-1.5 ${
                isDetecting
                  ? "bg-slate-50 border-slate-200 text-slate-500"
                  : mappingSource === "AI"
                  ? "bg-emerald-50 border-emerald-200/80 text-emerald-800"
                  : mappingSource === "REMEMBERED"
                  ? "bg-indigo-50 border-indigo-200/80 text-indigo-800"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              }`}
            >
              {isDetecting ? (
                <Loader2 className="w-3.5 h-3.5 shrink-0 mt-px animate-spin" />
              ) : (
                <Wand2 className="w-3.5 h-3.5 shrink-0 mt-px" />
              )}
              <div className="min-w-0 flex-1">
                {isDetecting ? (
                  <span>AI가 열 구조를 확인하고 있습니다...</span>
                ) : mappingSource === "REMEMBERED" ? (
                  <span>
                    이전에 확인한 형식이라 열을 그대로 적용했습니다. 맞지 않으면 아래에서
                    바꾸면 됩니다.
                  </span>
                ) : mappingSource === "AI" ? (
                  <span>
                    AI가 열 구조를 인식했습니다{detectNote ? ` — ${detectNote}` : ""}. 아래
                    미리보기로 확인해주세요.
                  </span>
                ) : (
                  <span>
                    {detectNote ? `${detectNote}. ` : ""}파일의 열 제목과 값으로 자동
                    지정했습니다. 아래 미리보기가 비어 있거나 금액이 이상하면 열을 직접
                    바꿔주세요.
                  </span>
                )}

                {!isDetecting && table && !scoreMapping(table, mapping).ok && (
                  <button
                    type="button"
                    onClick={() => void redetectWithAi()}
                    disabled={!hasApiKey()}
                    className="mt-1 font-bold underline underline-offset-2 disabled:opacity-50 cursor-pointer"
                  >
                    {hasApiKey()
                      ? "AI로 다시 인식하기"
                      : "AI로 인식하려면 설정에서 키를 등록하세요"}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {columnSelect("날짜", "date", "거래일자", true)}
              {columnSelect("내용", "merchant", "가맹점·적요")}
              {columnSelect("출금", "withdrawal", "지출액")}
              {columnSelect("입금", "deposit", "수입액")}
              {columnSelect("금액", "amount", "출금·입금이 한 열일 때")}
              {columnSelect("메모", "memo", "비고·업종")}
              {account && account.type !== "BANK" &&
                columnSelect("결제월", "billing", "청구년월·결제일")}
              {account && account.type !== "BANK" &&
                columnSelect("수수료", "fee", "원금이 없는 줄의 금액")}
              {account && account.type !== "BANK" &&
                columnSelect("할부 회차", "instalment", "몇 번째 청구인지")}
            </div>

            {/* One statement bills one month, which its lines may not each say */}
            {account && account.type !== "BANK" && mapping.billing < 0 && (
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700 block">
                  이 명세서의 결제(청구) 년월
                </label>
                {/*
                  연월을 고르는 자리는 모두 같은 창을 씁니다(§12.6). 예전에는
                  `type="month"` 였는데, 기기마다 다른 모양이 뜨고 이미 등록된
                  결제월이 어디인지 알 수 없었습니다.
                */}
                <button
                  type="button"
                  onClick={() => setShowBillingPicker(true)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white hover:border-emerald-400 transition flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span className="font-bold text-slate-800">
                    {billingMonth
                      ? `${billingMonth.slice(0, 4)}년 ${Number(billingMonth.slice(5, 7))}월`
                      : "결제월 선택"}
                  </span>
                  <CalendarDays className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  파일 이름에 적힌 연월, 없으면 <strong>이용일자의 다음 달</strong>로 채워두었습니다.
                  명세서에 적힌 결제월과 다르면 바꿔주세요. 할부처럼 이용한 달과 청구되는 달이
                  다른 항목을 결제월 기준으로 조회하는 데 쓰입니다.
                </p>
              </div>
            )}

            {!mappingReady && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold">
                날짜와 금액(또는 출금/입금) 열을 지정해야 합니다.
              </div>
            )}

            {/* Preview */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                <span>미리보기</span>
                <span className="font-normal text-slate-400">
                  인식 {preview.drafts.length}건
                  {preview.skipped.length > 0 && ` · 건너뜀 ${preview.skipped.length}건`}
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {preview.drafts.slice(0, 4).map((draft) => (
                  <div
                    key={draft.lineNumber}
                    className="px-3 py-2 flex items-center justify-between gap-2 text-[11px]"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">
                        {draft.merchant}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {draft.date} · {draft.category}
                      </div>
                    </div>
                    <span
                      className={`font-black shrink-0 ${
                        draft.type === "INCOME" ? "text-emerald-600" : "text-slate-800"
                      }`}
                    >
                      {draft.type === "INCOME" ? "+" : "-"}
                      {won(draft.amount)}
                    </span>
                  </div>
                ))}
                {preview.drafts.length === 0 && (
                  <div className="px-3 py-4 text-[11px] text-slate-400 text-center">
                    인식된 내역이 없습니다. 열 지정을 확인해주세요.
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("PICK")}
                className="py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>이전</span>
              </button>
              <button
                type="button"
                disabled={!mappingReady || preview.drafts.length === 0}
                onClick={goToReview}
                className="flex-1 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
              >
                <span>다음 · 중복 확인</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        )}

        {/* ---------------- REVIEW ---------------- */}
        {step === "REVIEW" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200/70 text-center">
                <div className="text-[10px] text-emerald-700">새로 추가</div>
                <div className="text-lg font-black text-emerald-800">{fresh.length}건</div>
              </div>
              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200/70 text-center">
                <div className="text-[10px] text-amber-700">이미 등록됨</div>
                <div className="text-lg font-black text-amber-800">{duplicates.length}건</div>
              </div>
            </div>

            {skippedRows.length > 0 && (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[10px] text-slate-500">
                날짜·금액을 읽지 못한 {skippedRows.length}줄은 제외됩니다.
              </div>
            )}

            {fresh.length === 0 && duplicates.length > 0 && (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[10px] text-slate-500 leading-relaxed">
                새로 추가할 내역이 없습니다. 이 계좌에 이미 같은 날짜·내용·금액으로 등록된
                내역들입니다. 다시 등록하려면 아래에서 <strong>덮어쓰기</strong>를 선택하세요.
              </div>
            )}

            {duplicates.length > 0 ? (
              <>
                <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>
                    같은 날짜·내용·금액이 이미 등록되어 있습니다. 같은 가게에서 같은 금액을 두 번 쓴
                    경우일 수도 있으니 확인 후 선택해주세요.
                  </span>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAllDecisions("SKIP")}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>모두 건너뛰기</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllDecisions("OVERWRITE")}
                    className="flex-1 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Replace className="w-3.5 h-3.5" />
                    <span>모두 덮어쓰기</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200/70 text-[11px] text-emerald-800 flex items-center gap-2">
                <CopyCheck className="w-4 h-4 shrink-0" />
                <span>중복된 내역이 없습니다. 그대로 추가하면 됩니다.</span>
              </div>
            )}

            {/* Every line the file holds, each saying which of the two it is */}
            {reviewRows.length > 0 && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                  {REVIEW_FILTERS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setReviewFilter(value)}
                      className={`py-1.5 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                        reviewFilter === value
                          ? "bg-white text-slate-900 shadow-xs"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {label}{" "}
                      {value === "ALL"
                        ? reviewRows.length
                        : value === "NEW"
                        ? fresh.length
                        : duplicates.length}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
                  {visibleReviewRows.map(({ draft, duplicate }) => {
                    const skipped = duplicate?.decision === "SKIP";
                    return (
                      <div
                        key={draft.lineNumber}
                        className={`p-2.5 rounded-xl border ${
                          duplicate
                            ? skipped
                              ? "border-slate-200 bg-slate-50"
                              : "border-indigo-200 bg-indigo-50/50"
                            : "border-emerald-200 bg-emerald-50/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                                  duplicate
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-emerald-100 text-emerald-700"
                                }`}
                              >
                                {duplicate ? "중복" : "추가"}
                              </span>
                              <span
                                className={`text-[11px] font-bold truncate ${
                                  skipped ? "text-slate-400" : "text-slate-900"
                                }`}
                              >
                                {draft.merchant}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {draft.date} · {draft.category}
                              {draft.memo ? ` · ${draft.memo}` : ""}
                            </div>
                          </div>

                          <span
                            className={`text-xs font-black shrink-0 ${
                              skipped
                                ? "text-slate-300 line-through"
                                : draft.type === "INCOME"
                                ? "text-emerald-600"
                                : "text-slate-800"
                            }`}
                          >
                            {draft.type === "INCOME" ? "+" : "-"}
                            {won(draft.amount)}
                          </span>
                        </div>

                        {duplicate && (
                          <>
                            <div className="flex gap-1 mt-1.5">
                              <button
                                type="button"
                                onClick={() => setDecision(draft.lineNumber, "SKIP")}
                                className={`flex-1 px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                                  duplicate.decision === "SKIP"
                                    ? "bg-slate-800 text-white"
                                    : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-100"
                                }`}
                              >
                                건너뛰기
                              </button>
                              <button
                                type="button"
                                onClick={() => setDecision(draft.lineNumber, "OVERWRITE")}
                                className={`flex-1 px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                                  duplicate.decision === "OVERWRITE"
                                    ? "bg-indigo-600 text-white"
                                    : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-100"
                                }`}
                              >
                                덮어쓰기
                              </button>
                            </div>
                            {duplicate.decision === "OVERWRITE" &&
                              duplicate.existing.category !== draft.category && (
                                <div className="mt-1 text-[10px] text-indigo-600">
                                  분류 {duplicate.existing.category} → {draft.category} 로
                                  바뀝니다
                                </div>
                              )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {visibleReviewRows.length === 0 && (
                    <div className="p-4 text-center text-[11px] text-slate-400">
                      해당하는 내역이 없습니다.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Move the recorded balance along with the entries */}
            {account && account.type === "BANK" && balancePlan && (
              <div
                className={`rounded-2xl border p-3 space-y-2 transition ${
                  adjustBalance && balancePlan.counted > 0
                    ? "border-emerald-300 bg-emerald-50/60"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setAdjustBalance((prev) => !prev)}
                  disabled={balancePlan.counted === 0}
                  className="flex items-start gap-1.5 text-left w-full disabled:opacity-60 cursor-pointer"
                >
                  {adjustBalance && balancePlan.counted > 0 ? (
                    <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-px" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400 shrink-0 mt-px" />
                  )}
                  <span className="text-[11px] font-bold text-slate-700 min-w-0">
                    현재 잔액 수정
                  </span>
                </button>

                <div className="text-[10px] text-slate-500 leading-relaxed">
                  등록된 기준일시 <strong>{asOfLabel(account.balanceAsOf)}</strong> 이후의
                  내역만 반영합니다.
                </div>

                {balancePlan.counted === 0 ? (
                  <div className="text-[10px] font-bold text-slate-400">
                    기준일시 이후에 해당하는 내역이 없어 조정할 금액이 없습니다.
                  </div>
                ) : (
                  <div className="rounded-xl bg-white border border-slate-200 p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>반영 대상</span>
                      <span className="font-bold text-slate-700">
                        {balancePlan.counted}건
                        {balancePlan.ignored > 0 && (
                          <span className="font-normal text-slate-400">
                            {" "}
                            (기준일시 이전 {balancePlan.ignored}건 제외)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-400 line-through shrink-0">
                        {won(balancePlan.current)}
                      </span>
                      <ArrowRight className="w-3 h-3 text-slate-300 shrink-0" />
                      <span className="font-black text-slate-900 truncate">
                        {won(balancePlan.next)}
                      </span>
                      <span
                        className={`text-[10px] font-bold shrink-0 ${
                          balancePlan.delta >= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {balancePlan.delta >= 0 ? "+" : "-"}
                        {won(Math.abs(balancePlan.delta))}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      기준 {asOfLabel(balancePlan.asOf)} · 자동 산출로 기록됩니다
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("MAP")}
                className="py-3 px-4 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>이전</span>
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {fresh.length +
                    duplicates.filter((d) => d.decision === "OVERWRITE").length}
                  건 가계부에 반영
                </span>
              </button>
            </div>
          </>
        )}

        {/* ---------------- DONE ---------------- */}
        {step === "DONE" && result && (
          <>
            <div className="py-4 flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <div className="text-sm font-bold text-slate-900">
                {account?.name} 내역을 반영했습니다
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                <div className="text-[10px] text-emerald-700">추가</div>
                <div className="text-sm font-black text-emerald-800">{result.added}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100">
                <div className="text-[10px] text-indigo-700">덮어씀</div>
                <div className="text-sm font-black text-indigo-800">{result.replaced}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-500">건너뜀</div>
                <div className="text-sm font-black text-slate-700">{result.skipped}</div>
              </div>
            </div>

            {result.balance && (
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200/70 text-[11px] text-emerald-900 space-y-0.5">
                <div className="font-bold">
                  잔액을 {won(result.balance.next)}으로 수정했습니다
                </div>
                <div className="text-[10px] text-emerald-700">
                  {result.balance.counted}건 반영 · 기준 {asOfLabel(result.balance.asOf)} ·
                  자동 산출
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={reset}
              className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              다른 파일 가져오기
            </button>
          </>
        )}

        {/* Bottom Close Button for Mobile Convenience */}
        <div className="pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition active:scale-98 touch-manipulation cursor-pointer flex items-center justify-center"
          >
            닫기
          </button>
        </div>
      </div>

      {/* 결제월 직접 선택 — 연월을 고르는 자리는 모두 같은 창입니다 (12.6) */}
      <MonthPickerModal
        isOpen={showBillingPicker}
        value={billingMonth}
        counts={billingCounts}
        title="결제(청구) 년월 선택"
        onSelect={(month) => {
          setBillingTouched(true);
          setBillingMonth(month);
        }}
        onClose={() => setShowBillingPicker(false)}
      />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
