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
  EMPTY_MAPPING,
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
  activeIndex,
  markQueue,
  queueFrom,
  queueLabel,
  queueReady,
  queueSummary,
  splitDrafts,
  type Decision,
  type DuplicateItem,
  type QueuedFile,
} from "../../services/importQueue";
import {
  X,
  Plus,
  Trash2,
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
  /** 빈 값은 **여러 카드·계좌** — 파일마다 따로 정한다는 뜻입니다(§7.10). */
  const [accountId, setAccountId] = useState(defaultAccountId || "");
  /** 계좌를 정한 채로 열렸는가 — 그러면 이 화면에서 바꾸지 못합니다. */
  const locked = Boolean(defaultAccountId);
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
  /** 저장이 계속 실패했을 때의 현황. 줄 목록이 아니라 숫자와 까닭입니다. */
  const [saveFailure, setSaveFailure] = useState<{
    attempts: number;
    total?: number;
    message?: string;
  } | null>(null);
  /** Once the user sets it themselves, nothing else touches it. */
  const [billingTouched, setBillingTouched] = useState(false);
  /** Where the column mapping came from, which the user is told. */
  const [mappingSource, setMappingSource] = useState<
    "RULES" | "AI" | "REMEMBERED" | "MANUAL"
  >("RULES");
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("ALL");

  /*
    여러 파일을 한 번에 (§7.10).

    은행 하나와 카드 세 장을 쓰면 매달 파일이 네 개입니다. 파일을 고르는 자리만
    한 개짜리였을 뿐, 뒤의 세 단계는 파일마다 그대로 반복해도 되는 것이었습니다.
    그래서 **대기줄**을 두고 한 파일씩 같은 길을 걷습니다 — 한 파일이 끝나면
    다음 파일의 계좌로 갈아 끼우고 처음 단계로 돌아갑니다.

    `queue` 가 비어 있으면 예전과 똑같이 한 파일짜리입니다. 그 길을 바꾸지 않은
    이유는 대부분의 가져오기가 여전히 파일 하나이기 때문입니다.
  */
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [queueFiles, setQueueFiles] = useState<File[]>([]);
  /** 지금 걷고 있는 파일. 한 파일짜리일 때는 `-1`. */
  const [queueAt, setQueueAt] = useState(-1);
  /** 이미 고른 파일을 또 골랐을 때의 한 줄. */
  const [duplicateNote, setDuplicateNote] = useState<string | null>(null);


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
    setSaveFailure(null);
    setQueue([]);
    setQueueFiles([]);
    setQueueAt(-1);
    /* 대기줄을 걷는 동안 파일마다 갈아 끼웠으므로 열렸을 때의 값으로 */
    setAccountId(defaultAccountId || "");
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
    **계좌를 정한 채로 열었으면 그 계좌로 고정입니다.**

    `defaultAccountId` 는 카드·계좌 내역 창(그리고 홈의 자산 요약에서 연 같은 창)이
    넘깁니다. `우리카드` 를 열어 놓고 `엑셀·CSV` 를 누른 사람은 **우리카드 명세서를
    넣겠다는 뜻**이고, 그 자리에서 다른 카드를 고를 수 있게 두면 맥락과 어긋납니다.
    그래서 고르는 상자를 아예 두지 않습니다.

    카드·계좌 탭의 `카드내역 · 통장내역 가져오기` 는 반대로 **아무 계좌의 자리도
    아니라서** 빈 값으로 엽니다 — 예전에는 `첫 계좌` 가 잡혔는데, 그것은 아무 근거
    없는 값이라 삼성카드 명세서가 국민은행으로 들어갈 수 있었습니다(§17.2).

    열리는 순간에만 정합니다 — 열려 있는 동안의 선택은 사용자의 것입니다(§14.7).
  */
  useEffect(() => {
    if (!isOpen) return;

    const known = (id?: string) => (accounts.some((a: any) => a.id === id) ? id : "");
    setAccountId(known(defaultAccountId) || "");
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

  /** 한 파일 몫만 지웁니다 — 대기줄과 고른 계좌는 그대로. */
  const resetFile = () => {
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
    setSaveFailure(null);
  };

  /**
   * 고른 파일을 대기줄에 **더합니다**.
   *
   * 넣을 파일이 한 폴더에 모여 있지 않은 일이 흔합니다 — 카드사마다 내려받는
   * 자리가 다르고, 달마다 폴더를 나눠 두기도 합니다. 파일 선택 창은 한 번에 한
   * 폴더만 보여 주므로, **고른 것 위에 더할 수 있어야** 여러 폴더에서 모을 수
   * 있습니다.
   *
   * 같은 파일을 두 번 더하지 않습니다(이름·크기·수정시각이 같으면 같은 파일).
   * 두 번 들어가면 두 번째는 통째로 중복으로 잡혀 REVIEW 가 쓸모없어집니다.
   */
  const addFiles = (picked: File[]) => {
    if (picked.length === 0) return;

    const seen = new Set(
      queueFiles.map((file) => `${file.name}|${file.size}|${file.lastModified}`)
    );
    const fresh = picked.filter(
      (file) => !seen.has(`${file.name}|${file.size}|${file.lastModified}`)
    );

    setFileError(null);
    setQueueAt(-1);
    setDuplicateNote(
      fresh.length === picked.length
        ? null
        : `이미 고른 파일 ${picked.length - fresh.length}개는 빼고 더했습니다`
    );
    if (fresh.length === 0) return;

    setQueueFiles((prev) => [...prev, ...fresh]);
    setQueue((prev) => [
      ...prev,
      ...queueFrom(
        fresh.map((file) => file.name),
        accounts,
        accountId || undefined
      ),
    ]);
  };

  /** 대기줄에서 한 파일을 뺍니다 — 목록과 파일이 같은 자리를 써야 합니다. */
  const removeFile = (index: number) => {
    setDuplicateNote(null);
    setQueueFiles((prev) => prev.filter((_, at) => at !== index));
    setQueue((prev) => prev.filter((_, at) => at !== index));
  };

  /**
   * 대기줄의 한 파일을 엽니다.
   *
   * 대기줄을 **인자로 받습니다.** 방금 갱신한 상태를 곧바로 읽으면 이전 값이
   * 잡히고, 그러면 끝난 파일을 다시 열게 됩니다.
   */
  const openQueued = (items: QueuedFile[], index: number) => {
    const file = queueFiles[index];
    if (!file) return;

    resetFile();
    setStep("PICK");
    setQueueAt(index);
    setAccountId(items[index].accountId);
    void handleFile(file);
  };

  /** 이 파일을 여기서 끝내고 다음 파일로. 없으면 현황을 보여 줍니다. */
  const finishQueued = (patch: Partial<QueuedFile>) => {
    const next = markQueue(queue, queueAt, patch);
    setQueue(next);

    const following = activeIndex(next);
    if (following >= 0) {
      openQueued(next, following);
      return;
    }

    /*
      마지막 파일의 결과는 지우지 않습니다 — 파일이 하나뿐인 대기줄에서는
      DONE 화면이 그 결과(잔액 조정 포함)를 그대로 보여 줍니다.
    */
    setQueueAt(-1);
    setStep("DONE");
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
      가르는 판정은 `services/importQueue.splitDrafts` 가 합니다(§7.6·§7.8) —
      그 계좌 안에서만 견주기, 회차 없는 할부를 중복으로 보지 않기, 문자로 넣어
      둔 줄을 명세서가 대체하기. 화면은 그 결과를 보여 주기만 합니다.
    */
    const { fresh, duplicates: dup } = splitDrafts({
      drafts,
      existing: allTransactions,
      accountId,
    });

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

    /*
      저장은 **전부 아니면 전무**이고, 실패하면 세 번까지 다시 시도합니다(§4.8).
      그래도 안 되면 **실패한 줄을 쏟아내지 않고 현황을 말합니다** — 사용자가
      할 수 있는 일은 다시 시도하거나 여유를 만드는 것뿐이고, 300줄의 목록은
      그 결정에 도움이 되지 않습니다.
    */
    const outcome = importTransactions(inserts, overwrites);

    if (!outcome.ok) {
      setSaveFailure(outcome);
      return;
    }
    setSaveFailure(null);

    try {
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

      const tally = {
        added: inserts.length,
        replaced: overwrites.length,
        skipped: duplicates.length - overwrites.length,
      };

      setResult({
        ...tally,
        balance: moved
          ? { counted: moved.counted, next: moved.next, asOf: moved.asOf }
          : undefined,
      });

      /* 대기줄이 있으면 다음 파일로 넘어갑니다 — 결과는 항목에 적어 둡니다 */
      if (queueAt >= 0) {
        finishQueued({ state: "DONE", ...tally });
        return;
      }
      setStep("DONE");
    } catch {
      /* 내역은 저장됐고 잔액 조정만 실패한 경우 — 그 사실만 알립니다 */
      if (queueAt >= 0) {
        finishQueued({
          state: "DONE",
          added: inserts.length,
          replaced: overwrites.length,
          skipped: duplicates.length - overwrites.length,
          reason: "내역은 저장했지만 잔액을 조정하지 못했습니다",
        });
        return;
      }
      setStep("DONE");
      setFileError("내역은 저장했지만 잔액을 조정하지 못했습니다.");
    }
  };

  /* 파일마다 같은 네 단계를 걷게 되므로 어디쯤인지가 제목에 있어야 합니다 */
  const where = queueAt >= 0 ? queueLabel(queue, queueAt, accounts) : "";
  const headings: Record<Step, { title: string; sub: string }> = {
    PICK: {
      title: "내역 가져오기",
      sub: where || "은행·카드사에서 받은 엑셀·CSV 파일",
    },
    MAP: {
      title: where ? `항목 확인 · ${where}` : "항목 확인",
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
    REVIEW: {
      title: where ? `중복 확인 · ${where}` : "중복 확인",
      sub: `새 내역 ${fresh.length}건 · 중복 ${duplicates.length}건`,
    },
    DONE: {
      title: "가져오기 완료",
      sub:
        queue.length > 1
          ? `파일 ${queue.length}개를 처리했습니다`
          : "가계부에 반영되었습니다",
    },
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

        {/*
          대기줄을 걷는 동안 어디쯤인지, 그리고 **빠져나갈 길**.

          한 파일이 읽히지 않는다고 나머지 세 파일까지 멈추면 여러 파일을 한 번에
          넣는 뜻이 없어집니다. 건너뛴 파일은 현황에 까닭과 함께 남습니다(§7.9).
        */}
        {queueAt >= 0 && (
          <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-indigo-900 truncate">
                {queueLabel(queue, queueAt, accounts)}
              </div>
              <div className="text-[10px] text-indigo-700/90 truncate">
                {queue[queueAt]?.name}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                finishQueued({
                  state: "FAILED",
                  reason: fileError || "건너뛰었습니다",
                })
              }
              className="px-2.5 py-1.5 rounded-lg bg-white border border-indigo-200 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 transition shrink-0 cursor-pointer whitespace-nowrap"
            >
              이 파일 건너뛰기
            </button>
          </div>
        )}

        {/* ---------------- PICK ---------------- */}
        {step === "PICK" && (
          <>
            <div className={queueAt >= 0 ? "hidden" : ""}>
              <label className="text-[11px] font-bold text-slate-700 block mb-1.5">
                어느 카드·계좌의 내역인가요?
              </label>
              {accounts.length === 0 ? (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-900">
                  등록된 카드·계좌가 없습니다. 먼저 카드나 계좌를 등록해주세요.
                </div>
              ) : locked ? (
                /*
                  그 카드·카드 내역 화면에서 열었습니다. 거기서 다른 카드를
                  고르게 두면 맥락과 어긋나므로 **바꿀 수 없다고 말합니다**.
                  여러 달 명세서를 한 번에 넣는 길은 그대로 열려 있습니다.
                */
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-2">
                  <span className="text-sm shrink-0">
                    {account?.type === "BANK" ? "🏦" : "💳"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {account?.name || "-"}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      이 화면에서는 이 카드·계좌로만 가져옵니다 · 여러 달 파일을 한 번에
                      고를 수 있습니다
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <select
                    value={accountId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setAccountId(next);
                      /* 이미 고른 파일이 있으면 바뀐 기준으로 다시 가릅니다 */
                      if (queueFiles.length > 0) {
                        setQueue(
                          queueFrom(
                            queueFiles.map((file) => file.name),
                            accounts,
                            next || undefined
                          )
                        );
                      }
                    }}
                    className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-200 bg-white focus:border-emerald-400 focus:outline-none"
                  >
                    {/*
                      **아무 계좌의 자리도 아닙니다.** 예전에는 첫 계좌가 잡혀
                      있어 삼성카드 명세서가 국민은행으로 들어갈 수 있었습니다.
                    */}
                    <option value="">🗂️ 여러 카드·계좌 (파일마다 지정)</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.type === "BANK" ? "🏦" : "💳"} {acc.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    {accountId
                      ? "고른 카드·계좌의 여러 달 파일을 한 번에 올릴 수 있습니다. 다른 카드의 파일로 보이면 건너뜁니다."
                      : "여러 파일을 한 번에 올리고 파일마다 카드·계좌를 정합니다."}
                  </p>
                </>
              )}
            </div>

            {/*
              대기줄을 걷는 중에는 파일을 새로 고르는 자리를 감춥니다 — 여기서
              고른 파일은 대기줄 바깥의 것이라 어느 계좌로 갈지 정해지지 않습니다.
            */}
            <label
              className={`${queueAt >= 0 ? "hidden" : "block"} p-6 rounded-2xl border-2 border-dashed text-center transition ${
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
                multiple
                accept=".csv,.txt,.xls,.xlsx,.xlsm,.xlsb,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={accounts.length === 0 || isReading}
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files || []);
                  e.target.value = "";
                  addFiles(picked);
                }}
              />
            </label>

            {fileError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
                {fileError}
              </div>
            )}

            {queue.length > 0 && queueAt < 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold text-slate-700 min-w-0">
                    {accountId
                      ? `파일 ${queue.length}개 · 모두 ${account?.name || ""}(으)로`
                      : `파일 ${queue.length}개 · 각각 어느 카드·계좌인가요?`}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/*
                      넣을 파일이 한 폴더에 모여 있지 않은 일이 흔합니다 —
                      파일 선택 창은 한 번에 한 폴더만 보여 주므로 더할 수 있어야
                      여러 폴더에서 모을 수 있습니다.
                    */}
                    <label className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-[10px] font-bold text-slate-700 hover:bg-slate-50 transition cursor-pointer whitespace-nowrap flex items-center gap-1">
                      <Plus className="w-3 h-3" />
                      파일 추가
                      <input
                        type="file"
                        multiple
                        accept=".csv,.txt,.xls,.xlsx,.xlsm,.xlsb,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        className="hidden"
                        onChange={(e) => {
                          const more = Array.from(e.target.files || []);
                          e.target.value = "";
                          addFiles(more);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setQueue([]);
                        setQueueFiles([]);
                        setDuplicateNote(null);
                      }}
                      className="text-[10px] font-bold text-slate-400 hover:text-slate-700 cursor-pointer whitespace-nowrap"
                    >
                      모두 지우기
                    </button>
                  </div>
                </div>

                {duplicateNote && (
                  <p className="text-[10px] font-bold text-amber-700">{duplicateNote}</p>
                )}

                <div className="space-y-1.5">
                  {queue.map((item, index) => {
                    const dropped = item.state === "SKIPPED";

                    return (
                      <div
                        key={`${item.name}-${index}`}
                        className={`p-2.5 rounded-xl border space-y-1.5 ${
                          dropped
                            ? "border-amber-200 bg-amber-50/60"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileSpreadsheet
                            className={`w-3.5 h-3.5 shrink-0 ${
                              dropped ? "text-amber-600" : "text-emerald-600"
                            }`}
                          />
                          <span
                            className={`text-[11px] font-bold truncate flex-1 ${
                              dropped ? "text-amber-900 line-through" : "text-slate-800"
                            }`}
                          >
                            {item.name}
                          </span>
                          {/* 잘못 고른 파일을 빼는 길 — 전부 다시 고르게 하지 않습니다 */}
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            aria-label={`${item.name} 빼기`}
                            className="w-6 h-6 -mr-1 flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {accountId ? (
                          /*
                            계좌가 정해진 대기줄입니다 — 바꿀 것이 없으므로 어디로
                            가는지만 적습니다. 다른 카드의 것으로 보이는 파일은
                            건너뛰되 **목록에서 지우지는 않습니다**: 왜 안 들어갔는지
                            말하지 않으면 사용자가 알아낼 방법이 없습니다(§17.1).
                          */
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-[10px] ${
                                dropped ? "text-amber-800" : "text-slate-500"
                              }`}
                            >
                              {dropped
                                ? item.reason
                                : `${account?.name || ""}(으)로 가져옵니다`}
                            </span>
                            {dropped && (
                              <button
                                type="button"
                                onClick={() =>
                                  setQueue((prev) =>
                                    markQueue(prev, index, {
                                      state: "PENDING",
                                      reason: undefined,
                                    })
                                  )
                                }
                                className="px-2 py-1 rounded-lg bg-white border border-amber-300 text-[10px] font-bold text-amber-800 hover:bg-amber-100 transition shrink-0 cursor-pointer whitespace-nowrap"
                              >
                                그래도 넣기
                              </button>
                            )}
                          </div>
                        ) : (
                          <select
                            value={item.accountId}
                            onChange={(e) =>
                              setQueue((prev) =>
                                markQueue(prev, index, { accountId: e.target.value })
                              )
                            }
                            className={`w-full px-2.5 py-2 text-xs rounded-xl border bg-white focus:outline-none ${
                              item.accountId
                                ? "border-slate-200 focus:border-emerald-400"
                                : "border-amber-300 bg-amber-50/60 focus:border-amber-400"
                            }`}
                          >
                            {/*
                              이름에서 카드사를 못 읽었거나 그 카드사 카드가 두 장이면
                              비워 둡니다 — 골라 두면 이미 정해진 줄 알고 넘깁니다
                            */}
                            <option value="">고르지 않음</option>
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.type === "BANK" ? "🏦" : "💳"} {acc.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-[10px] text-slate-400 leading-relaxed">
                  {accountId
                    ? "여러 달 명세서를 한 번에 넣을 수 있습니다. 시작하면 한 파일씩 항목 확인과 중복 확인을 거칩니다."
                    : "파일 이름에 카드사가 적혀 있으면 미리 골라 두었습니다. 나머지는 직접 고르세요. 시작하면 한 파일씩 항목 확인과 중복 확인을 거칩니다."}
                </p>

                <button
                  type="button"
                  disabled={!queueReady(queue) || isReading}
                  /* 첫 파일이 건너뛸 것일 수 있으므로 넣을 첫 파일에서 시작합니다 */
                  onClick={() => openQueued(queue, activeIndex(queue))}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs transition cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  {queueReady(queue)
                    ? `${queueSummary(queue).files - queueSummary(queue).skippedFiles}개 파일 가져오기 시작`
                    : accountId
                      ? "넣을 파일이 없습니다"
                      : "계좌를 고르지 않은 파일이 있습니다"}
                  {queueReady(queue) && <ArrowRight className="w-3.5 h-3.5" />}
                </button>
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
            {/*
              저장이 계속 실패했을 때의 **현황**.

              실패한 줄을 나열하지 않습니다 — 저장은 전부 아니면 전무이므로
              "어느 줄이 실패했는가"라는 질문 자체가 성립하지 않고(0건 저장),
              사용자가 할 수 있는 일은 다시 시도하거나 기기 여유를 만드는
              것뿐입니다. 300줄의 목록은 그 결정에 도움이 되지 않습니다.
            */}
            {saveFailure && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-rose-900">
                      저장하지 못했습니다 — <strong>0건 반영</strong>
                    </div>
                    <p className="text-[11px] text-rose-800 mt-0.5 leading-relaxed">
                      {saveFailure.total ?? 0}건을 {saveFailure.attempts}번 시도했지만
                      기기에 쓰지 못했습니다. <strong>절반만 저장된 상태는 없습니다</strong> —
                      다시 눌러도 중복되지 않습니다.
                    </p>
                    {saveFailure.message && (
                      <p className="text-[10px] text-rose-700/80 mt-1 break-words">
                        까닭: {saveFailure.message}
                      </p>
                    )}
                    <p className="text-[10px] text-rose-700/80 mt-1 leading-relaxed">
                      계속 실패하면 기기 저장 공간을 확보하거나, 사생활 보호 모드가
                      아닌 창에서 다시 열어보세요.
                    </p>
                  </div>
                </div>
              </div>
            )}

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

        {/* ---------------- DONE · 여러 파일 ---------------- */}
        {/* 파일이 하나뿐이면 아래의 한 파일짜리 화면이 맡습니다 — 잔액 조정까지 말해 줍니다 */}
        {step === "DONE" && queue.length > 0 && (queue.length > 1 || !result) && (
          <>
            <div className="py-4 flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <div className="text-sm font-bold text-slate-900">
                파일 {queueSummary(queue).files}개 중 {queueSummary(queue).done}개를
                반영했습니다
              </div>
              {queueSummary(queue).failed + queueSummary(queue).skippedFiles > 0 && (
                <div className="text-[11px] font-bold text-amber-700">
                  {queueSummary(queue).failed + queueSummary(queue).skippedFiles}개는
                  건너뛰었습니다
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                <div className="text-[10px] text-emerald-700">추가</div>
                <div className="text-sm font-black text-emerald-800">
                  {queueSummary(queue).added}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100">
                <div className="text-[10px] text-indigo-700">덮어씀</div>
                <div className="text-sm font-black text-indigo-800">
                  {queueSummary(queue).replaced}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-[10px] text-slate-500">건너뜀</div>
                <div className="text-sm font-black text-slate-700">
                  {queueSummary(queue).skipped}
                </div>
              </div>
            </div>

            {/* 파일마다 무엇이 되었는지 — 숫자만으로는 어느 파일이 빠졌는지 모릅니다 */}
            <div className="space-y-1.5">
              {queue.map((item, index) => {
                const where = accounts.find((acc: any) => acc.id === item.accountId);
                const ok = item.state === "DONE";
                return (
                  <div
                    key={`${item.name}-${index}`}
                    className={`p-2.5 rounded-xl border flex items-start gap-2 ${
                      ok
                        ? "bg-white border-slate-200"
                        : "bg-amber-50/70 border-amber-200"
                    }`}
                  >
                    {ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-slate-800 truncate">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {where?.name ? `${where.name} · ` : ""}
                        {ok
                          ? `추가 ${item.added || 0} · 덮어씀 ${item.replaced || 0} · 건너뜀 ${item.skipped || 0}`
                          : item.reason || "건너뛰었습니다"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={reset}
              className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              다른 파일 가져오기
            </button>
          </>
        )}

        {/* ---------------- DONE ---------------- */}
        {step === "DONE" && result && queue.length <= 1 && (
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
