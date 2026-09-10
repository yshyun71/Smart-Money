import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import type { Transaction } from "../../types/finance";
import {
  autoDetectMapping,
  buildDrafts,
  decodeFile,
  draftToTransaction,
  duplicateKey,
  EMPTY_MAPPING,
  parseDelimited,
  type ColumnMapping,
  type DraftRow,
  type ParsedTable,
} from "../../services/csvImport";
import {
  X,
  Upload,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  CopyCheck,
  SkipForward,
  Replace,
} from "lucide-react";

type Step = "PICK" | "MAP" | "REVIEW" | "DONE";
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
  const { accounts, allTransactions, importTransactions } = useFinance();

  const [step, setStep] = useState<Step>("PICK");
  const [accountId, setAccountId] = useState(defaultAccountId || accounts[0]?.id || "");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [duplicates, setDuplicates] = useState<DuplicateItem[]>([]);
  const [fresh, setFresh] = useState<DraftRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<{ lineNumber: number; reason: string }[]>([]);
  const [result, setResult] = useState<{ added: number; replaced: number; skipped: number } | null>(
    null
  );

  const account = accounts.find((a) => a.id === accountId);

  const reset = () => {
    setStep("PICK");
    setFileName("");
    setFileError(null);
    setTable(null);
    setMapping(EMPTY_MAPPING);
    setDuplicates([]);
    setFresh([]);
    setSkippedRows([]);
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const preview = useMemo(() => {
    if (!table) return { drafts: [] as DraftRow[], skipped: [] as { lineNumber: number; reason: string }[] };
    return buildDrafts(table, mapping);
  }, [table, mapping]);

  const mappingReady =
    mapping.date >= 0 &&
    (mapping.amount >= 0 || mapping.withdrawal >= 0 || mapping.deposit >= 0);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    setFileError(null);
    setFileName(file.name);

    try {
      const text = decodeFile(await file.arrayBuffer());
      const parsed = parseDelimited(text);

      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setFileError("파일에서 표를 찾지 못했습니다. CSV로 저장한 파일인지 확인해주세요.");
        setTable(null);
        return;
      }

      setTable(parsed);
      setMapping(autoDetectMapping(parsed.headers));
      setStep("MAP");
    } catch (error) {
      console.error(error);
      setFileError("파일을 읽지 못했습니다.");
      setTable(null);
    }
  };

  /** Splits the parsed rows into new entries and ones already recorded. */
  const goToReview = () => {
    const { drafts, skipped } = preview;

    const existingByKey = new Map<string, Transaction>();
    for (const tx of allTransactions) {
      const key = duplicateKey(tx);
      if (!existingByKey.has(key)) existingByKey.set(key, tx);
    }

    const dup: DuplicateItem[] = [];
    const fresh: DraftRow[] = [];

    for (const draft of drafts) {
      const match = existingByKey.get(duplicateKey(draft));
      if (match) {
        dup.push({ draft, existing: match, decision: "SKIP" });
      } else {
        fresh.push(draft);
      }
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

    const overwrites = duplicates
      .filter((item) => item.decision === "OVERWRITE")
      .map((item) => ({
        ...draftToTransaction(item.draft, accountId, paymentMethod),
        id: item.existing.id,
      }));

    try {
      importTransactions(inserts, overwrites);
      setResult({
        added: inserts.length,
        replaced: overwrites.length,
        skipped: duplicates.length - overwrites.length,
      });
      setStep("DONE");
    } catch {
      setFileError("가져온 내역을 저장하지 못했습니다.");
    }
  };

  const headings: Record<Step, { title: string; sub: string }> = {
    PICK: { title: "내역 가져오기", sub: "은행·카드사에서 받은 CSV 파일" },
    MAP: { title: "항목 확인", sub: `${fileName} · ${table?.rows.length ?? 0}줄` },
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
        onChange={(e) =>
          setMapping((prev) => ({ ...prev, [field]: Number(e.target.value) }))
        }
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
              <Upload className="w-7 h-7 mx-auto text-slate-400 mb-2" />
              <div className="text-xs font-bold text-slate-800">CSV 파일 선택</div>
              <div className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                은행·카드사 홈페이지에서 내려받은
                <br />
                거래내역 파일을 그대로 올리세요
              </div>
              <input
                type="file"
                accept=".csv,.txt,text/csv"
                disabled={accounts.length === 0}
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
                엑셀(.xlsx) 파일은 <strong>다른 이름으로 저장 → CSV</strong>로 변환한 뒤 올려주세요.
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
        {step === "MAP" && table && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              {columnSelect("날짜", "date", "거래일자", true)}
              {columnSelect("내용", "merchant", "가맹점·적요")}
              {columnSelect("출금", "withdrawal", "지출액")}
              {columnSelect("입금", "deposit", "수입액")}
              {columnSelect("금액", "amount", "출금·입금이 한 열일 때")}
              {columnSelect("메모", "memo", "비고·업종")}
            </div>

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

                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                  {duplicates.map((item) => (
                    <div
                      key={item.draft.lineNumber}
                      className="p-2.5 rounded-xl border border-slate-200 bg-white"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-slate-900 truncate">
                            {item.draft.merchant}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {item.draft.date} · {won(item.draft.amount)}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setDecision(item.draft.lineNumber, "SKIP")}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                              item.decision === "SKIP"
                                ? "bg-slate-800 text-white"
                                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                            }`}
                          >
                            건너뛰기
                          </button>
                          <button
                            type="button"
                            onClick={() => setDecision(item.draft.lineNumber, "OVERWRITE")}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                              item.decision === "OVERWRITE"
                                ? "bg-indigo-600 text-white"
                                : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                            }`}
                          >
                            덮어쓰기
                          </button>
                        </div>
                      </div>
                      {item.decision === "OVERWRITE" &&
                        item.existing.category !== item.draft.category && (
                          <div className="mt-1 text-[10px] text-indigo-600">
                            분류 {item.existing.category} → {item.draft.category} 로 바뀝니다
                          </div>
                        )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200/70 text-[11px] text-emerald-800 flex items-center gap-2">
                <CopyCheck className="w-4 h-4 shrink-0" />
                <span>중복된 내역이 없습니다. 그대로 추가하면 됩니다.</span>
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
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
