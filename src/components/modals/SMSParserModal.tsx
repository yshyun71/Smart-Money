import React, { useState } from "react";
import { useFinance } from "../../context/FinanceContext";
import { Transaction } from "../../types/finance";
import { parsePaymentMessages, type ParsedTransaction } from "../../services/aiClient";
import {
  X,
  Sparkles,
  Receipt,
  CheckCircle2,
  AlertCircle,
  Copy,
  Plus,
} from "lucide-react";

const SAMPLE_MESSAGES = [
  {
    label: "카드 승인 (변동비)",
    text: "[신한카드 승인]\n김*호님 09/08 19:40\n배달의민족\n28,500원 일시불\n누적 645,000원",
  },
  {
    label: "정기구독 (고정비)",
    text: "[현대카드 승인]\n김*호님 09/08 09:15\n넷플릭스서비시스코리아\n17,000원 정기결제\n누적 662,000원",
  },
  {
    label: "통장 급여 입금 (수입)",
    text: "[카카오뱅크 입금]\n09/08 18:00\n(주)소프트웨어랩 급여\n3,600,000원\n잔액 6,240,000원",
  },
  {
    label: "카페 지출 (변동비)",
    text: "[KB국민카드 승인]\n김*호님 09/08 13:20\n스타벅스 강남R점\n6,300원 일시불",
  },
];

export const SMSParserModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { addTransactions, accounts } = useFinance();

  const [rawText, setRawText] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedList, setParsedList] = useState<ParsedTransaction[]>([]);
  const [isAddedSuccess, setIsAddedSuccess] = useState(false);

  // The preview card shows the first hit; a message can contain several.
  const parsedResult = parsedList[0] || null;

  if (!isOpen) return null;

  const handleParse = async () => {
    if (!rawText.trim()) return;

    setIsParsing(true);
    setParseError(null);
    setParsedList([]);
    setIsAddedSuccess(false);

    try {
      const results = await parsePaymentMessages(rawText);
      if (results.length === 0) {
        setParseError("문자에서 거래 내역을 찾지 못했습니다. 원문을 그대로 붙여넣어 주세요.");
      } else {
        setParsedList(results);
      }
    } catch (err: any) {
      setParseError(err?.message || "문자 분석 중 오류가 발생했습니다.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleSaveToLedger = () => {
    if (parsedList.length === 0) return;

    const newTxs: Omit<Transaction, "id">[] = parsedList.map((item) => {
      const paymentMethod = item.paymentMethod || "";
      const matchedAccount =
        accounts.find(
          (a) =>
            paymentMethod.includes(a.institution) || paymentMethod.includes(a.name)
        ) || accounts[0];

      return {
        date: item.date || new Date().toISOString().split("T")[0],
        time: item.time || new Date().toTimeString().substring(0, 5),
        type: item.type || "EXPENSE",
        expenseType: item.expenseType || "VARIABLE",
        category: item.category || "기타지출",
        merchant: item.merchant || "기타 가맹점",
        amount: item.amount || 0,
        paymentMethod: paymentMethod || matchedAccount?.name || "카드/계좌",
        accountId: matchedAccount?.id || "",
        memo: item.memo || "문자 자동 인식",
        isFixedRecurring: item.expenseType === "FIXED",
      };
    });

    addTransactions(newTxs);
    setIsAddedSuccess(true);
    setTimeout(() => {
      onClose();
      setRawText("");
      setParsedList([]);
      setIsAddedSuccess(false);
    }, 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                카드·통장 문자/알림 자동 등록
              </h2>
              <p className="text-[10px] text-slate-500">
                복사한 결제 문자를 AI가 자동으로 분류합니다
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sample Chips */}
        <div className="mt-4 space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600">
            샘플 문자 눌러보기:
          </label>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {SAMPLE_MESSAGES.map((sample, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setRawText(sample.text)}
                className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 rounded-xl shrink-0 transition border border-slate-200/60"
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input Textarea */}
        <div className="mt-3">
          <textarea
            rows={4}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="은행 입출금 알림 또는 카드 승인 문자를 그대로 붙여넣으세요...&#10;예: [신한체크승인] 09/08 12:30 15,000원 스타벅스 잔액 1,200,000원"
            className="w-full rounded-2xl border border-slate-200 p-3 text-xs text-slate-900 focus:outline-hidden focus:border-emerald-500 font-mono leading-relaxed"
          />
        </div>

        {/* Parse Button */}
        <button
          onClick={handleParse}
          disabled={!rawText.trim() || isParsing}
          className="mt-2 w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs disabled:opacity-40 transition flex items-center justify-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>{isParsing ? "AI 문자 분석 중..." : "문자 내용 자동 분석하기"}</span>
        </button>

        {/* Error message */}
        {parseError && (
          <div className="mt-3 p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {/* Parsed Result Preview Card */}
        {parsedResult && (
          <div className="mt-4 p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 space-y-2.5 animate-in zoom-in-95">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-800 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                {parsedList.length > 1
                  ? `${parsedList.length}건 인식 (첫 건 미리보기)`
                  : "분석 완료 (가계부 미리보기)"}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  parsedResult.expenseType === "FIXED"
                    ? "bg-indigo-100 text-indigo-700"
                    : parsedResult.type === "INCOME"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {parsedResult.type === "INCOME"
                  ? "수입"
                  : parsedResult.expenseType === "FIXED"
                  ? "고정비"
                  : "변동비"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white p-2 rounded-xl border border-emerald-100">
                <span className="text-[10px] text-slate-400">가맹점/출처</span>
                <div className="font-bold text-slate-900 truncate">
                  {parsedResult.merchant}
                </div>
              </div>
              <div className="bg-white p-2 rounded-xl border border-emerald-100">
                <span className="text-[10px] text-slate-400">금액</span>
                <div className="font-extrabold text-emerald-700">
                  {parsedResult.amount?.toLocaleString()}원
                </div>
              </div>
              <div className="bg-white p-2 rounded-xl border border-emerald-100">
                <span className="text-[10px] text-slate-400">카테고리</span>
                <div className="font-bold text-slate-900">
                  {parsedResult.category}
                </div>
              </div>
              <div className="bg-white p-2 rounded-xl border border-emerald-100">
                <span className="text-[10px] text-slate-400">결제수단</span>
                <div className="font-bold text-slate-900 truncate">
                  {parsedResult.paymentMethod}
                </div>
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveToLedger}
              disabled={isAddedSuccess}
              className={`w-full py-2.5 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-xs ${
                isAddedSuccess
                  ? "bg-emerald-600 text-white"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }`}
            >
              {isAddedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>가계부에 성공적으로 등록되었습니다!</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>이 내역을 가계부에 등록하기</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
