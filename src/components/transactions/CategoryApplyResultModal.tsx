import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import type { CategoryType, RuleSource } from "../../types/finance";
import { withCommas } from "../../utils/format";
import { X, Wand2, Tag, Sparkles, UserCheck, Minus } from "lucide-react";

export interface AppliedRule {
  pattern: string;
  category: CategoryType;
  source: RuleSource;
  /** How many entries this rule actually moved. */
  count: number;
}

export interface CategoryApplyResult {
  /** Entries whose category changed. */
  changed: number;
  /** Entries the rules were held up against. */
  scanned: number;
  rulesUsed: number;
  account: string;
  applied: AppliedRule[];
}

/**
 * What a bulk apply did, rule by rule.
 *
 * A run over hundreds of entries is worth accounting for: which rule earned
 * its keep, which matched nothing, and how much of the account moved.
 */
export const CategoryApplyResultModal: React.FC<{
  result: CategoryApplyResult | null;
  onClose: () => void;
}> = ({ result, onClose }) => {
  useEffect(() => {
    if (!result) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [result, onClose]);

  if (!result) return null;

  const effective = result.applied.filter((rule) => rule.count > 0);
  const idle = result.applied.filter((rule) => rule.count === 0);

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
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Wand2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">카테고리 일괄 적용 완료</h3>
              <p className="text-[10px] text-slate-400 truncate">
                {result.account} · 규칙 {withCommas(result.rulesUsed)}개 · 내역{" "}
                {withCommas(result.scanned)}건 검사
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
          <div className="text-[11px] text-slate-400">카테고리가 바뀐 내역</div>
          <div className="text-2xl font-black tracking-tight mt-0.5">
            {withCommas(result.changed)}
            <span className="text-sm font-bold text-slate-400 ml-1">건</span>
          </div>
        </div>

        {/* Per rule */}
        {effective.length > 0 && (
          <div className="space-y-1.5">
            <div className="px-1 text-[11px] font-bold text-slate-700">
              규칙별 적용 건수
            </div>
            <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {effective.map((rule) => (
                <div
                  key={`${rule.pattern}-${rule.category}`}
                  className="flex items-center justify-between gap-2 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[11px] font-bold text-slate-900 font-mono truncate">
                        {rule.pattern}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 flex items-center gap-0.5 ${
                          rule.source === "USER"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-indigo-100 text-indigo-700"
                        }`}
                      >
                        {rule.source === "USER" ? (
                          <UserCheck className="w-2.5 h-2.5" />
                        ) : (
                          <Sparkles className="w-2.5 h-2.5" />
                        )}
                        {rule.source === "USER" ? "사용자" : "AI"}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                      <Tag className="w-2.5 h-2.5 shrink-0" />
                      <span>{rule.category}</span>
                    </div>
                  </div>
                  <div className="text-sm font-black text-slate-900 shrink-0">
                    {withCommas(rule.count)}
                    <span className="text-[10px] font-bold text-slate-400 ml-0.5">건</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rules that had nothing to do */}
        {idle.length > 0 && (
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <div className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
              <Minus className="w-3 h-3" />
              <span>변경된 내역이 없는 규칙 {idle.length}개</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {idle.map((rule) => (
                <span
                  key={`${rule.pattern}-${rule.category}`}
                  className="text-[10px] font-mono text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5"
                >
                  {rule.pattern}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              일치하는 내역이 없거나, 이미 해당 카테고리로 분류되어 있던 경우입니다.
            </p>
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
