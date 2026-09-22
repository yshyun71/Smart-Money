import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { formatAmountInput, parseAmountInput, won } from "../../utils/format";
import {
  allocate,
  policyCheck,
  rulesFromBaselines,
  spareOf,
  type BudgetPolicy,
  type BudgetPolicyMode,
} from "../../services/budgetPolicy";
import {
  Sliders,
  X,
  Lock,
  TrendingUp,
  TrendingDown,
  Minus as MinusIcon,
  Download,
  AlertTriangle,
  Percent,
  Coins,
} from "lucide-react";

const MODES: { value: BudgetPolicyMode; label: string; hint: string }[] = [
  { value: "AMOUNT", label: "금액으로", hint: "식비 400,000원처럼 금액을 직접 정합니다" },
  { value: "INCOME_RATIO", label: "수입의 %", hint: "수입이 달라지면 한도도 같이 달라집니다" },
  {
    value: "SPARE_RATIO",
    label: "가용 변동비의 %",
    hint: "수입 − 고정비 − 저축을 나눕니다",
  },
];

/**
 * 카테고리별 한도를 한 번 정해 두는 화면.
 *
 * 열두 카테고리를 매달 손으로 다시 적는 일은 아무도 계속하지 못하고, 그러면
 * 예산은 몇 달 전 값에 멈춘 채 아무 뜻이 없어집니다. 여기서 정한 기준은 달에
 * 매이지 않고, 어느 달에서든 [이 기준으로 예산 채우기]로 적용됩니다.
 *
 * 고정비 가이드가 함께 있는 이유: 고정비는 줄일 수 없는 돈이라, 그 카테고리의
 * 한도가 월평균 고정비보다 낮으면 달이 시작되는 순간 이미 초과입니다.
 */
export const BudgetPolicyModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const {
    budgetPolicy,
    saveBudgetPolicy,
    budgetConfig,
    categories,
    fixedBaselineList,
  } = useFinance();

  const [mode, setMode] = useState<BudgetPolicyMode>("AMOUNT");
  const [rules, setRules] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const inputs = {
    income: budgetConfig.monthlyIncome,
    fixed: budgetConfig.fixedExpenses,
    savings: budgetConfig.savingsTarget,
  };

  /** 저장된 기준을 입력칸 문자열로. 0 은 "안 정했다"는 뜻이라 비워 둡니다. */
  const asText = (policy: BudgetPolicy): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [category, value] of Object.entries(policy.rules || {})) {
      if (!value) continue;
      out[category] = policy.mode === "AMOUNT" ? formatAmountInput(String(value)) : String(value);
    }
    return out;
  };

  useEffect(() => {
    if (!isOpen) return;
    setMode(budgetPolicy.mode);
    setRules(asText(budgetPolicy));
    setNotice(null);
     
  }, [isOpen, budgetPolicy]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const numeric = (value: string): number => {
    if (mode === "AMOUNT") return parseAmountInput(value);
    const parsed = parseFloat((value || "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const draft: BudgetPolicy = {
    mode,
    rules: Object.fromEntries(
      Object.entries(rules)
        .map(([category, value]) => [category, numeric(String(value))] as [string, number])
        .filter(([, value]) => value > 0)
    ),
  };

  const report = policyCheck(draft, inputs);
  const allocated = allocate(draft, inputs);
  const spare = spareOf(inputs);

  /*
    모드를 바꾸면 숫자의 뜻이 달라집니다 — 400,000이 400,000원이었다가 400%가
    되면 안 됩니다. 그래서 값을 옮기지 않고 비웁니다.
  */
  const switchMode = (next: BudgetPolicyMode) => {
    if (next === mode) return;
    setMode(next);
    setRules({});
    setNotice("단위가 달라져 값을 비웠습니다. [고정비 불러오기]로 채울 수 있습니다.");
  };

  const pullBaselines = () => {
    const wanted = rulesFromBaselines(fixedBaselineList, mode, inputs);
    if (Object.keys(wanted).length === 0) {
      setNotice(
        "고정비로 판정된 내역이 없습니다. 계좌·카드 내역에서 [AI 자동 분류]를 먼저 돌려보세요."
      );
      return;
    }

    setRules((prev) => {
      const next = { ...prev };
      for (const [category, value] of Object.entries(wanted)) {
        next[category] =
          mode === "AMOUNT" ? formatAmountInput(String(value)) : String(value);
      }
      return next;
    });
    setNotice(
      `고정비 월평균으로 ${Object.keys(wanted).length}개 카테고리를 채웠습니다. 최소선이니 필요한 만큼 올려 잡으세요.`
    );
  };

  const baselineOf = (category: string) =>
    fixedBaselineList.find((line: { category: string }) => line.category === category);

  const content = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3.5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <Sliders className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">카테고리별 예산 기준</h3>
              <p className="text-[10px] text-slate-400">
                한 번 정해 두면 매달 이 기준으로 채웁니다
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

        {/* 기준 방식 */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-3 gap-1.5">
            {MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => switchMode(option.value)}
                className={`rounded-xl px-1.5 py-2 text-[11px] font-bold transition border ${
                  mode === option.value
                    ? "bg-white border-emerald-400 text-emerald-700 shadow-xs"
                    : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            {MODES.find((option) => option.value === mode)?.hint}
          </p>
        </div>

        {/* 이번 달 기준값 — 비율이 무엇에 대한 비율인지 */}
        <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 text-[10px] text-slate-500 space-y-0.5">
          <div className="flex items-center justify-between">
            <span>{budgetConfig.month} 수입</span>
            <span className="font-bold text-slate-700">{won(inputs.income)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>가용 변동비 (수입 − 고정비 − 저축)</span>
            <span className="font-bold text-slate-700">{won(spare)}</span>
          </div>
          {inputs.income === 0 && (
            <p className="text-amber-700 pt-1">
              수입이 0원이라 비율 모드로는 금액이 나오지 않습니다. 1번 블록에서 먼저 입력하세요.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={pullBaselines}
          className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          <span>카테고리별 고정비 불러오기 (최소선)</span>
        </button>

        {notice && (
          <p className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200/70 rounded-xl px-2.5 py-2 leading-relaxed">
            {notice}
          </p>
        )}

        {/* 카테고리 목록 */}
        <div className="space-y-1.5">
          {categories.map((category: string) => {
            const baseline = baselineOf(category);
            const value = rules[category] ?? "";
            const money = allocated[category] ?? 0;
            const short = baseline && money > 0 && money < baseline.average;

            return (
              <div
                key={category}
                className={`p-2.5 rounded-xl border ${
                  short ? "bg-amber-50/70 border-amber-200" : "bg-white border-slate-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-700 flex-1 min-w-0 truncate">
                    {category}
                  </span>

                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setRules((prev) => ({
                          ...prev,
                          [category]:
                            mode === "AMOUNT"
                              ? formatAmountInput(raw)
                              : raw.replace(/[^0-9.]/g, ""),
                        }));
                        setNotice(null);
                      }}
                      placeholder={mode === "AMOUNT" ? "0" : "0"}
                      className="w-24 text-right rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-900 focus:border-emerald-500 focus:outline-hidden"
                    />
                    <span className="text-[10px] font-bold text-slate-400 w-3">
                      {mode === "AMOUNT" ? (
                        <Coins className="w-3 h-3" />
                      ) : (
                        <Percent className="w-3 h-3" />
                      )}
                    </span>
                  </div>
                </div>

                {/* 이 기준이 이번 달에 얼마가 되는지, 그리고 고정비 최소선 */}
                {(money > 0 || baseline) && (
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-slate-400 truncate">
                      {baseline ? (
                        <>
                          <Lock className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5 text-indigo-400" />
                          고정비 월평균 {won(baseline.average)}
                          <span className="ml-1 text-slate-300">
                            ({baseline.months}개월
                            {baseline.trend === "UP" && (
                              <TrendingUp className="w-2.5 h-2.5 inline text-rose-400 ml-0.5" />
                            )}
                            {baseline.trend === "DOWN" && (
                              <TrendingDown className="w-2.5 h-2.5 inline text-emerald-500 ml-0.5" />
                            )}
                            {baseline.trend === "FLAT" && (
                              <MinusIcon className="w-2.5 h-2.5 inline text-slate-300 ml-0.5" />
                            )}
                            )
                          </span>
                        </>
                      ) : (
                        "고정비 기록 없음"
                      )}
                    </span>
                    {mode !== "AMOUNT" && money > 0 && (
                      <span className="font-bold text-slate-600 shrink-0">→ {won(money)}</span>
                    )}
                  </div>
                )}

                {short && (
                  <p className="mt-1 text-[10px] font-bold text-amber-700">
                    고정비보다 적습니다 — 달이 시작되는 순간 이미 초과입니다.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* 합계 — 막지 않고 알려 줍니다 */}
        <div
          className={`p-3 rounded-2xl border text-xs ${
            report.over > 0
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50/70 border-emerald-100"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-600">기준 합계</span>
            <span className="text-sm font-black text-slate-900">{won(report.total)}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500 leading-relaxed">
            가용 변동비 {won(report.spare)}
            {mode !== "AMOUNT" && ` · 비율 합계 ${report.ratioTotal}%`}
            {report.over > 0 && (
              <span className="block text-amber-700 font-bold mt-0.5">
                <AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                {won(report.over)} 넘습니다. 저장은 됩니다 — 이번 달만 그럴 수도 있으니까요.
              </span>
            )}
            {report.over === 0 && report.total > 0 && (
              <span className="block text-emerald-700 mt-0.5">
                남는 금액 {won(report.spare - report.total)}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={() => {
              saveBudgetPolicy(draft);
              onClose();
            }}
            className="py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer"
          >
            기준 저장
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
