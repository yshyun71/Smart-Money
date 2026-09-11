import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { withCommas } from "../../utils/format";
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Pin,
  ShoppingBag,
  Tag,
  CalendarClock,
  Minus,
  Sparkles,
  UserCheck,
} from "lucide-react";

export interface ClassifyChange {
  merchant: string;
  date: string;
  amount: number;
  /** "변동비 · 기타지출" before the run. */
  before: string;
  after: string;
}

export interface ClassifySummary {
  requested: number;
  classified: number;
  toFixed: number;
  toVariable: number;
  categoryCorrected: number;
  paymentDaySet: number;
  unchanged: number;
  /** Entries a rule the user confirmed decided, overriding the classifier. */
  ruleApplied: number;
  /** Rules newly recorded from what the classifier decided. */
  rulesLearned: number;
  failed: number;
  error?: string;
  provider: string | null;
  changes: ClassifyChange[];
}

const Row: React.FC<{
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: number;
  hint?: string;
}> = ({ icon, tone, label, value, hint }) => (
  <div className="flex items-center justify-between gap-2 px-3 py-2.5">
    <div className="flex items-center gap-2 min-w-0">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-slate-900 truncate">{label}</div>
        {hint && <div className="text-[10px] text-slate-400 truncate">{hint}</div>}
      </div>
    </div>
    <div className="text-sm font-black text-slate-900 shrink-0">
      {withCommas(value)}
      <span className="text-[10px] font-bold text-slate-400 ml-0.5">건</span>
    </div>
  </div>
);

/**
 * What the classifier actually changed, shown once it finishes.
 *
 * The run can take minutes over a few hundred rows, so the outcome has to be
 * waiting when the user comes back rather than only visible while it works.
 */
export const ClassifyResultModal: React.FC<{
  summary: ClassifySummary | null;
  onClose: () => void;
}> = ({ summary, onClose }) => {
  useEffect(() => {
    if (!summary) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [summary, onClose]);

  if (!summary) return null;

  const changedTotal =
    summary.toFixed + summary.toVariable + summary.categoryCorrected + summary.paymentDaySet;

  const modalContent = (
    <div
      className="fixed inset-0 z-[10001] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3.5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                summary.failed > 0
                  ? "bg-amber-50 text-amber-600"
                  : "bg-emerald-50 text-emerald-600"
              }`}
            >
              {summary.failed > 0 ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">
                {summary.classified === 0
                  ? "AI 자동 분류 실패"
                  : summary.failed > 0
                  ? "AI 자동 분류 일부 완료"
                  : "AI 자동 분류 완료"}
              </h3>
              <p className="text-[10px] text-slate-400 truncate">
                {summary.provider ? `${summary.provider} · ` : ""}
                선택 {withCommas(summary.requested)}건 중 {withCommas(summary.classified)}건 처리
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-11 h-11 flex items-center justify-center -mr-2 -mt-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Headline */}
        <div className="p-4 rounded-2xl bg-slate-900 text-white text-center">
          <div className="text-[11px] text-slate-400">변경된 항목</div>
          <div className="text-2xl font-black tracking-tight mt-0.5">
            {withCommas(changedTotal)}
            <span className="text-sm font-bold text-slate-400 ml-1">건</span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          <Row
            icon={<Pin className="w-3.5 h-3.5 rotate-45" />}
            tone="bg-indigo-50 text-indigo-600"
            label="고정비로 변경"
            value={summary.toFixed}
            hint="반복 결제로 판단된 항목"
          />
          <Row
            icon={<ShoppingBag className="w-3.5 h-3.5" />}
            tone="bg-amber-50 text-amber-600"
            label="변동비로 변경"
            value={summary.toVariable}
            hint="반복 조건을 만족하지 않는 항목"
          />
          <Row
            icon={<Tag className="w-3.5 h-3.5" />}
            tone="bg-emerald-50 text-emerald-600"
            label="카테고리 정정"
            value={summary.categoryCorrected}
          />
          <Row
            icon={<CalendarClock className="w-3.5 h-3.5" />}
            tone="bg-sky-50 text-sky-600"
            label="매월 결제일 기입"
            value={summary.paymentDaySet}
            hint="거래 일자에서 자동 산정"
          />
          <Row
            icon={<Minus className="w-3.5 h-3.5" />}
            tone="bg-slate-100 text-slate-500"
            label="변경 없음"
            value={summary.unchanged}
            hint="기존 분류가 이미 정확함"
          />
          {summary.ruleApplied > 0 && (
            <Row
              icon={<UserCheck className="w-3.5 h-3.5" />}
              tone="bg-emerald-50 text-emerald-700"
              label="사용자 규칙 우선 적용"
              value={summary.ruleApplied}
              hint="카테고리 관리에 등록한 규칙"
            />
          )}
          {summary.rulesLearned > 0 && (
            <Row
              icon={<Sparkles className="w-3.5 h-3.5" />}
              tone="bg-indigo-50 text-indigo-600"
              label="AI 분류 규칙 등록"
              value={summary.rulesLearned}
              hint="카테고리 관리에서 확인·확정할 수 있습니다"
            />
          )}
        </div>

        {/* Partial failure */}
        {summary.failed > 0 && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <div className="min-w-0">
              <div className="font-bold">{withCommas(summary.failed)}건은 처리하지 못했습니다</div>
              <p className="mt-0.5 leading-relaxed">{summary.error || "일시적인 오류"}</p>
              <p className="mt-1 leading-relaxed">
                해당 항목은 <strong>선택 상태로 남아 있습니다.</strong> 잠시 후 [AI 자동 분류]를 다시
                누르면 남은 것만 처리됩니다.
                {/(한도|요청 한도)/.test(summary.error || "") && (
                  <>
                    <br />
                    한 번에 40건씩 나눠 호출하므로, 무료 한도에서는{" "}
                    <strong>100건 이하로 선택해 여러 번 나눠 실행</strong>하는 편이 안정적입니다.
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        {/* What changed */}
        {summary.changes.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-bold text-slate-700 px-1">
              변경 내역 {summary.changes.length > 20 ? "(최근 20건)" : ""}
            </div>
            <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden max-h-56 overflow-y-auto">
              {summary.changes.slice(0, 20).map((change, index) => (
                <div key={index} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-900 truncate">
                      {change.merchant}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {change.date.slice(5).replace("-", "/")}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                    {change.before} <span className="text-slate-300">→</span>{" "}
                    <strong className="text-emerald-700">{change.after}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {changedTotal === 0 && summary.failed === 0 && (
          <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200/70 text-[11px] text-emerald-800 flex items-center gap-2">
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>기존 분류가 이미 정확했습니다. 바꿀 것이 없었습니다.</span>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition active:scale-98 touch-manipulation cursor-pointer"
        >
          확인
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
