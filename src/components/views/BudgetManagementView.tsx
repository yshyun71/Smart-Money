import React, { useState, useEffect } from "react";
import { useFinance } from "../../context/FinanceContext";
import { formatAmountInput, parseAmountInput, withCommas } from "../../utils/format";
import { BudgetPolicyModal } from "../modals/BudgetPolicyModal";
import { ActualsPickerModal } from "../modals/ActualsPickerModal";
import { spareOf } from "../../services/budgetPolicy";
import {
  Sliders,
  DollarSign,
  Lock,
  PiggyBank,
  Sparkles,
  AlertTriangle,
  Bell,
  CheckCircle2,
  AlertCircle,
  Plus,
  Minus,
  RefreshCw,
  HelpCircle,
  TrendingDown,
  ChevronRight,
  X,
} from "lucide-react";

export const BudgetManagementView: React.FC<{
  onNavigateToSavings?: () => void;
}> = ({ onNavigateToSavings }) => {
  const {
    budgetConfig,
    updateBudgetConfig,
    setCategoryBudget,
    autoAllocateBudgets,
    budgetStatusList,
    budgetAlerts,
    dismissAlert,
    markAllAlertsAsRead,
    totalIncome,
    fixedExpenseTotal,
    savingsActualTotal,
    disposableIncome,
    totalBudgeted,
    selectedMonth,
    budgetPolicy,
    applyBudgetPolicy,
    fixedBaselineList,
    underFixedList,
  } = useFinance();

  /** 0 은 "아직 안 정했다"는 뜻이라 비워 둡니다 — 자리표시자가 보여야 적을 곳임을 압니다. */
  const asInput = (value: number) => (value > 0 ? formatAmountInput(String(value)) : "");

  const [incomeInput, setIncomeInput] = useState(() => asInput(budgetConfig.monthlyIncome));
  const [fixedInput, setFixedInput] = useState(() => asInput(budgetConfig.fixedExpenses));
  const [savingsInput, setSavingsInput] = useState(() => asInput(budgetConfig.savingsTarget));
  const [showNotificationToast, setShowNotificationToast] = useState<string | null>(null);
  /*
    사람이 그 칸을 손으로 고쳤는가. 실적에서 불러온 값과 직접 적은 값은
    신뢰도가 다르므로 저장할 때 그 사실을 함께 남깁니다(8절의 USER/AUTO와
    같은 취지).
  */
  const [incomeTouched, setIncomeTouched] = useState(false);
  const [fixedTouched, setFixedTouched] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  /** 실적 내역을 열어 볼 칸. 무엇이 그 합계를 만들었는지 보고 뺄 수 있습니다. */
  const [picking, setPicking] = useState<"INCOME" | "FIXED" | "SAVINGS" | null>(null);
  const [savingsTouched, setSavingsTouched] = useState(false);
  /*
    지금 고치는 중인 카테고리 한도. 누를 때마다 저장하면 "4"만 눌러도 4원이
    되어 버리므로, 칸을 떠날 때(또는 Enter) 한 번 저장합니다.
  */
  const [editing, setEditing] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  /** 기준에 값이 들어 있는 카테고리 수. 0이면 적용할 것이 없습니다. */
  const policyCount = Object.keys(budgetPolicy.rules || {}).length;

  const baselineOf = (category: string) =>
    fixedBaselineList.find(
      (line: { category: string }) => line.category === category
    );

  /*
    달을 옮기면 그 달의 값을 다시 싣습니다.

    예산은 달마다 따로 저장되고(`budget_configs` PK(user_id, month)) 화면의
    나머지는 선택한 달을 따라가는데, 이 세 칸만 첫 렌더의 값에 머물러 있었습니다
    — useState 초기식은 한 번만 계산되기 때문입니다(14.7). 그래서 월을 바꿔도
    아래가 그대로인 것처럼 보였습니다.

    의존성을 달 하나로 좁혀, 입력 중인 값을 저장 전에 지우지 않게 합니다.
  */
  useEffect(() => {
    setIncomeInput(asInput(budgetConfig.monthlyIncome));
    setFixedInput(asInput(budgetConfig.fixedExpenses));
    setSavingsInput(asInput(budgetConfig.savingsTarget));
    setIncomeTouched(false);
    setFixedTouched(false);
    setSavingsTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  /** 선택한 달을 사람이 읽는 말로. */
  const monthName = `${Number((selectedMonth || "").slice(5, 7)) || ""}월`;
  const isThisMonth = selectedMonth === new Date().toISOString().slice(0, 7);

  /*
    입력칸의 값과 저장된 값이 다른가. 저장 버튼을 누르지 않고 떠나면 사라지므로,
    그 사실이 화면에 보여야 합니다.
  */
  const unsaved =
    parseAmountInput(incomeInput) !== budgetConfig.monthlyIncome ||
    parseAmountInput(fixedInput) !== budgetConfig.fixedExpenses ||
    parseAmountInput(savingsInput) !== budgetConfig.savingsTarget;

  // Apply income/fixed change
  const handleApplyIncomeFixed = () => {
    const inc = parseInt(incomeInput.replace(/[^0-9]/g, "")) || 0;
    const fix = parseInt(fixedInput.replace(/[^0-9]/g, "")) || 0;
    const sav = parseInt(savingsInput.replace(/[^0-9]/g, "")) || 0;

    updateBudgetConfig({
      monthlyIncome: inc,
      fixedExpenses: fix,
      savingsTarget: sav,
      // 손대지 않은 칸은 원래의 출처를 유지합니다
      incomeSource: incomeTouched ? "USER" : budgetConfig.incomeSource,
      fixedSource: fixedTouched ? "USER" : budgetConfig.fixedSource,
      savingsSource: savingsTouched ? "USER" : budgetConfig.savingsSource,
    });
    setIncomeTouched(false);
    setFixedTouched(false);
    setSavingsTouched(false);
    triggerToast("월 수입 및 고정비 설정이 업데이트되었습니다.");
  };

  // Sync with actual current month data
  const handleSyncActuals = () => {
    setIncomeInput(asInput(totalIncome));
    setFixedInput(asInput(fixedExpenseTotal));
    setSavingsInput(asInput(savingsActualTotal));
    updateBudgetConfig({
      monthlyIncome: totalIncome,
      fixedExpenses: fixedExpenseTotal,
      savingsTarget: savingsActualTotal,
      incomeSource: "ACTUALS",
      fixedSource: "ACTUALS",
      savingsSource: "ACTUALS",
    });
    setIncomeTouched(false);
    setFixedTouched(false);
    setSavingsTouched(false);
    triggerToast(
      isThisMonth
        ? `${monthName} 실제 내역을 채웠습니다. 아직 달이 끝나지 않아 실제보다 적을 수 있습니다.`
        : `${monthName} 실제 수입과 고정비를 채웠습니다.`
    );
  };

  /*
    지난 내역대로 배분합니다.

    예전에는 코드에 박힌 여덟 개 비율을 곱하고 "50/30/20 규칙"이라고 말했는데,
    둘 다 사실이 아니었고 사용자가 만든 카테고리는 한 푼도 받지 못했습니다.
  */
  const handleAutoAllocate = () => {
    const inc = parseAmountInput(incomeInput) || budgetConfig.monthlyIncome;
    const fix = parseAmountInput(fixedInput) || budgetConfig.fixedExpenses;
    const sav = parseAmountInput(savingsInput) || budgetConfig.savingsTarget;

    const { changed, months } = autoAllocateBudgets(inc, fix, sav);

    triggerToast(
      months === 0
        ? "배분할 근거가 없습니다. 지난 달 내역을 먼저 가져오거나 [예산 기준 설정]에서 직접 정해주세요."
        : `최근 ${months}개월 내역대로 ${changed}개 카테고리에 배분했습니다.`
    );
  };

  const triggerToast = (msg: string) => {
    setShowNotificationToast(msg);
    setTimeout(() => {
      setShowNotificationToast(null);
    }, 3500);
  };

  // Adjust category budget with +/- buttons
  const adjustCategory = (category: string, delta: number) => {
    const current = budgetConfig.categoryBudgets[category] || 0;
    const nextVal = Math.max(0, current + delta);
    setCategoryBudget(category, nextVal);
  };

  // Send a test browser notification if supported
  const handleTestNotification = async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        new Notification("스마트 머니 예산 알림", {
          body: "[식비] 예산의 85%를 소진했습니다! 오늘 저녁엔 포장 또는 냉파를 추천합니다.",
          icon: "/pwa-192x192.png",
        });
      }
    }
    triggerToast("🔔 테스트 예산 경고 푸시 알림이 발송되었습니다.");
  };

  const availableVariableBudget = spareOf({
    income: budgetConfig.monthlyIncome,
    fixed: budgetConfig.fixedExpenses,
    savings: budgetConfig.savingsTarget,
  });

  const budgetDifference = availableVariableBudget - totalBudgeted;

  return (
    <div className="space-y-4 pt-1">
      {/* Toast Notification */}
      {showNotificationToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{showNotificationToast}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              월간 수입·고정비 & 카테고리 예산 관리
            </h2>
            <p className="text-[11px] text-slate-500">
              수입과 고정비를 입력하면 카테고리별 한도를 설정하고 초과 시 즉시 알림을 받습니다.
            </p>
          </div>
          <div className="w-8 h-8 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Sliders className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* ACTIVE BUDGET ALERTS BANNER (If any alerts exist) */}
      {budgetAlerts.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-3xl p-4 space-y-3 shadow-2xs animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600"></span>
              </span>
              <h3 className="text-xs font-bold text-rose-900">
                예산 초과 및 위험 알림 ({budgetAlerts.length}건)
              </h3>
            </div>
            <button
              onClick={markAllAlertsAsRead}
              className="text-[10px] text-rose-700 hover:text-rose-900 font-bold"
            >
              모두 닫기
            </button>
          </div>

          <div className="space-y-2">
            {budgetAlerts.map((alert) => (
              <div
                key={alert.id}
                className="bg-white rounded-2xl p-3 border border-rose-100 flex items-start justify-between gap-2 text-xs"
              >
                <div className="flex items-start gap-2">
                  {alert.type === "EXCEEDED" ? (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900">{alert.category}</span>
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.2 rounded-full ${
                          alert.type === "EXCEEDED"
                            ? "bg-rose-100 text-rose-700"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {alert.type === "EXCEEDED" ? "예산 초과!" : "소진율 80% 돌파"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                      {alert.message}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-slate-400">
                        {alert.createdAt} 감지됨
                      </span>
                      {onNavigateToSavings && (
                        <button
                          onClick={onNavigateToSavings}
                          className="text-[10px] font-bold text-emerald-600 hover:underline flex items-center gap-0.5"
                        >
                          절약 팁 보기 →
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => dismissAlert(alert.id)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                  title="알림 닫기"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SECTION 1: Income & Fixed Expense Setup */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3.5">
        {/* 버튼이 먼저 자리를 잡고, 설명 문구가 남은 폭에서 접힙니다 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <span className="w-6 h-6 shrink-0 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
              1
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-slate-900">
                {monthName} 수입 &amp; 고정비 입력
              </h3>
              {/* 읽기 전용 카드로 보여 아무도 누르지 않던 칸들입니다 */}
              <p className="text-[10px] text-slate-400 leading-relaxed">
                세 칸은 직접 적는 값입니다. 적은 뒤 [기본 정보 저장]을 누르세요.
              </p>
            </div>
          </div>

          <button
            onClick={handleSyncActuals}
            className="shrink-0 whitespace-nowrap px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center gap-1 transition"
          >
            <RefreshCw className="w-3 h-3 shrink-0" />
            <span>{monthName} 실적 채우기</span>
          </button>
        </div>

        {/*
          "예상"인데 실적을 채우는 버튼이 옆에 있습니다. 달이 끝나기 전에 누르면
          아직 안 들어온 급여가 빠진 금액이 들어오므로, 그때는 지난달을 보라고
          알려 줍니다 — 위쪽 월 이동 화살표를 쓰는 법을 함께 알리는 셈입니다.
        */}
        {isThisMonth && (
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-xl px-2.5 py-2 leading-relaxed">
            {monthName}은 아직 끝나지 않았습니다. [{monthName} 실적 채우기]를
            누르면 지금까지 기록된 금액만 들어옵니다. 한 달치 기준을 잡으려면 위쪽
            <strong> ‹ </strong>로 지난달을 골라 채우는 편이 정확합니다.
          </p>
        )}

        {/*
          세로 한 줄씩 놓습니다. 3열로 나누면 좁은 화면에서 칸이 200px 아래로
          줄어 "7,021,2" 처럼 금액이 잘렸습니다 — 금액은 예산 화면에서 가장
          먼저 읽혀야 하는 값입니다.
        */}
        <div className="space-y-2">
          {([
            {
              key: "income",
              label: "월 예상 총 수입",
              hint: `${monthName}에 들어올 것으로 보는 급여 + 기타 수입`,
              icon: <DollarSign className="w-3.5 h-3.5 text-emerald-600" />,
              value: incomeInput,
              onChange: (next: string) => {
                setIncomeTouched(true);
                setIncomeInput(next);
              },
              placeholder: "3,482,000",
              saved: budgetConfig.monthlyIncome,
              source: budgetConfig.incomeSource,
            },
            {
              key: "fixed",
              label: "월간 고정 지출",
              hint: "월세·관리비·통신비·보험처럼 매달 나가는 돈",
              icon: <Lock className="w-3.5 h-3.5 text-indigo-600" />,
              value: fixedInput,
              onChange: (next: string) => {
                setFixedTouched(true);
                setFixedInput(next);
              },
              placeholder: "995,690",
              saved: budgetConfig.fixedExpenses,
              source: budgetConfig.fixedSource,
            },
            {
              key: "savings",
              label: "목표 저축액",
              hint: "먼저 떼어 둘 금액. 계좌의 [저축] 카테고리 실적에서 채울 수 있습니다",
              icon: <PiggyBank className="w-3.5 h-3.5 text-rose-500" />,
              value: savingsInput,
              onChange: (next: string) => {
                setSavingsTouched(true);
                setSavingsInput(next);
              },
              placeholder: "600,000",
              saved: budgetConfig.savingsTarget,
              /*
                저축도 실적이 있습니다 — 계좌에서 `저축` 카테고리로 나간 돈.
                고정비 합계에서는 빠지므로(적금이 고정비로 판정되더라도) 두 번
                세지 않습니다.
              */
              source: savingsTouched ? ("USER" as const) : budgetConfig.savingsSource,
            },
          ]).map((field) => {
            const dirty = parseAmountInput(field.value) !== field.saved;
            return (
              <div
                key={field.key}
                className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/60 flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-slate-600">
                      {field.icon}
                      {field.label}
                    </span>
                    {/*
                      실적에서 불러온 값과 사람이 적은 값은 신뢰도가 다릅니다.
                      잔액의 USER/AUTO 표시와 같은 취지입니다(8절).
                    */}
                    {/*
                      합계만 보여 주면 무엇이 들어갔는지 알 수 없습니다. 한 번뿐인
                      상여금이나 이사 비용이 섞이면 그 합계로 세운 예산은 처음부터
                      틀리므로, 눌러서 줄 단위로 확인하고 뺄 수 있게 합니다.
                    */}
                    {(
                      <button
                        type="button"
                        onClick={() =>
                          setPicking(
                            field.key === "income"
                              ? "INCOME"
                              : field.key === "fixed"
                                ? "FIXED"
                                : "SAVINGS"
                          )
                        }
                        title={`${monthName} 내역 열어 보기`}
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full transition cursor-pointer hover:brightness-95 ${
                          dirty
                            ? "bg-amber-100 text-amber-700"
                            : field.source === "ACTUALS"
                              ? "bg-indigo-100 text-indigo-700"
                              : "bg-slate-200/80 text-slate-600"
                        }`}
                      >
                        {dirty ? "수정 중" : field.source === "ACTUALS" ? "실적 반영" : "직접 입력"}
                        <ChevronRight className="w-2.5 h-2.5 inline -mt-0.5" />
                      </button>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-0.5 block leading-relaxed">
                    {field.hint}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={field.value}
                    onChange={(e) => field.onChange(formatAmountInput(e.target.value))}
                    placeholder={field.placeholder}
                    className="w-32 text-right rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm font-black text-slate-900 focus:border-emerald-500 focus:outline-hidden"
                  />
                  <span className="text-xs font-bold text-slate-500">원</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Calculation Summary Bar */}
        <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-100 flex items-center justify-between text-xs">
          <div>
            <span className="text-[11px] text-emerald-800 font-semibold block">
              카테고리 배분 가능 가용 변동비 예산
            </span>
            <span className="text-[10px] text-emerald-700">
              (수입 {withCommas(parseAmountInput(incomeInput))}원 - 고정비{" "}
              {withCommas(parseAmountInput(fixedInput))}원 - 저축{" "}
              {withCommas(parseAmountInput(savingsInput))}원)
            </span>
          </div>
          <div className="text-right">
            <span className="text-sm font-black text-emerald-900">
              {availableVariableBudget.toLocaleString()}원
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleApplyIncomeFixed}
            className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition active:scale-98 ${
              unsaved
                ? "bg-amber-500 hover:bg-amber-400 text-white shadow-xs"
                : "bg-slate-900 hover:bg-slate-800 text-white"
            }`}
          >
            {unsaved ? "● 저장되지 않음 — 기본 정보 저장" : "기본 정보 저장"}
          </button>
          <button
            onClick={handleAutoAllocate}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-xs hover:opacity-95 transition active:scale-98 flex items-center justify-center gap-1 shadow-xs"
          >
            {/*
              "AI"도 "50/30/20"도 아니었습니다 — 코드에 박힌 여덟 개 비율이었고,
              이제는 그 사람의 지난 내역입니다. 이름이 하는 일을 말해야 합니다.
            */}
            <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
            <span>지난 내역대로 자동 배분</span>
          </button>
        </div>
      </div>

      {/* SECTION 2: Category Budget Allocations & Live Spending Bars */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <span className="w-6 h-6 shrink-0 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
              2
            </span>
            <h3 className="text-xs font-bold text-slate-900">
              카테고리별 예산 한도 &amp; 소진율
            </h3>
          </div>

          {/* 금액은 접을 곳이 없는 값이라 폭을 먼저 잡습니다 */}
          <div className="text-right shrink-0 whitespace-nowrap">
            <span className="text-[10px] text-slate-400 block">설정 총예산</span>
            <span className="text-xs font-black text-slate-900">
              {withCommas(totalBudgeted)}원
            </span>
          </div>
        </div>

        {/*
          기준을 한 번 정해 두고 달마다 적용합니다 — 열두 칸을 매달 다시 적는
          일은 아무도 계속하지 못하고, 그러면 예산은 몇 달 전 값에 멈춥니다.
        */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setShowPolicy(true)}
            className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition flex items-center justify-center gap-1.5"
          >
            <Sliders className="w-3.5 h-3.5 text-indigo-500" />
            <span>예산 기준 설정</span>
          </button>
          <button
            type="button"
            disabled={policyCount === 0}
            onClick={() => {
              const changed = applyBudgetPolicy();
              triggerToast(
                changed > 0
                  ? `기준대로 ${changed}개 카테고리의 한도를 채웠습니다.`
                  : "기준과 이미 같습니다. 바뀐 한도가 없습니다."
              );
            }}
            className="py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition disabled:opacity-40 disabled:hover:bg-indigo-600 flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>이 기준으로 채우기</span>
          </button>
        </div>

        <p className="text-[10px] text-slate-400 leading-relaxed">
          {policyCount === 0
            ? "아직 기준이 없습니다. [예산 기준 설정]에서 금액 또는 비율로 한 번 정해 두면 매달 [이 기준으로 채우기] 한 번으로 끝납니다."
            : `기준 ${policyCount}개 · ${
                budgetPolicy.mode === "AMOUNT"
                  ? "금액"
                  : budgetPolicy.mode === "INCOME_RATIO"
                    ? "수입 대비 비율"
                    : "가용 변동비 대비 비율"
              } 방식`}
        </p>

        {/*
          가용 변동비와 실제 배분한 합계의 차이. 1번 블록은 가용을, 2번은 배분
          합계를 따로 보여 주기만 해서 얼마가 남았는지 아무도 알 수 없었습니다.
        */}
        {availableVariableBudget > 0 && (
          <div
            className={`p-2.5 rounded-xl border text-[11px] flex items-center justify-between gap-2 ${
              budgetDifference < 0
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-slate-50 border-slate-200/70 text-slate-600"
            }`}
          >
            <span className="font-bold">
              {budgetDifference < 0 ? "가용 변동비를 넘었습니다" : "아직 배분하지 않은 금액"}
            </span>
            <span className="font-black">
              {withCommas(Math.abs(budgetDifference))}원
            </span>
          </div>
        )}

        {/* 고정비보다 낮은 한도 — 달 시작부터 초과인 것들 */}
        {underFixedList.length > 0 && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200/80 text-[10px] text-amber-800 leading-relaxed">
            <Lock className="w-3 h-3 inline -mt-0.5 mr-0.5" />
            <strong>{underFixedList.length}개 카테고리</strong>의 한도가 월평균 고정비보다
            낮습니다 (
            {underFixedList
              .slice(0, 3)
              .map(
                (row: { category: string; average: number }) =>
                  `${row.category} ${withCommas(row.average)}원`
              )
              .join(", ")}
            {underFixedList.length > 3 && " 등"}
            ). 고정비는 줄일 수 없는 돈이라 달이 시작되는 순간 이미 초과입니다.
          </div>
        )}

        <div className="space-y-2.5">
          {budgetStatusList.map((item) => {
            const isExceeded = item.status === "EXCEEDED";
            const isWarning = item.status === "WARNING";
            const isUnset = item.status === "UNSET";
            const baseline = baselineOf(item.category);
            /*
              고정비는 줄일 수 없는 돈이라, 한도가 그 월평균보다 낮으면 달이
              시작되는 순간 이미 초과입니다.
            */
            const underFixed = Boolean(
              baseline && item.budget > 0 && item.budget < baseline.average
            );

            return (
              <div
                key={item.category}
                className={`p-3 rounded-2xl border transition ${
                  isExceeded
                    ? "bg-rose-50/50 border-rose-200"
                    : isWarning
                      ? "bg-amber-50/40 border-amber-200"
                      : isUnset
                        ? "bg-white border-dashed border-slate-300"
                        : "bg-slate-50/70 border-slate-200/70"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-bold text-xs text-slate-900 truncate">
                      {item.category}
                    </span>
                    {/*
                      예산을 정하지 않은 칸은 안전한 것도 초과한 것도 아닙니다.
                      예전에는 지출 46만원짜리 칸이 초록 막대를 가득 채운 채
                      "안전 · 100% 소진"이라고 적혀 있었습니다.
                    */}
                    <span
                      className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full shrink-0 ${
                        isExceeded
                          ? "bg-rose-100 text-rose-700"
                          : isWarning
                            ? "bg-amber-100 text-amber-800"
                            : isUnset
                              ? "bg-slate-200/80 text-slate-600"
                              : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {isExceeded
                        ? "초과 🚨"
                        : isWarning
                          ? `경고 (${Math.round(item.percentage)}%)`
                          : isUnset
                            ? "예산 미설정"
                            : "안전"}
                    </span>
                  </div>

                  {/*
                    1만원 단위 버튼만으로는 45만원을 맞추려면 45번 눌러야 하고
                    1천원 단위는 아예 맞출 수 없었습니다. 숫자를 직접 적을 수
                    있게 하고 버튼은 그대로 둡니다.
                  */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => adjustCategory(item.category, -10000)}
                      className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition"
                      title="1만원 줄이기"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <div className="flex items-center gap-0.5">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={
                          editing === item.category
                            ? editingValue
                            : item.budget > 0
                              ? withCommas(item.budget)
                              : ""
                        }
                        onFocus={() => {
                          setEditing(item.category);
                          setEditingValue(item.budget > 0 ? withCommas(item.budget) : "");
                        }}
                        onChange={(e) => setEditingValue(formatAmountInput(e.target.value))}
                        onBlur={() => {
                          if (editing === item.category) {
                            setCategoryBudget(item.category, parseAmountInput(editingValue));
                          }
                          setEditing(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") {
                            setEditing(null);
                            setEditingValue("");
                          }
                        }}
                        placeholder="0"
                        className="w-24 text-right rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs font-black text-slate-900 focus:border-emerald-500 focus:outline-hidden"
                      />
                      <span className="text-[10px] font-bold text-slate-500">원</span>
                    </div>
                    <button
                      onClick={() => adjustCategory(item.category, 10000)}
                      className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition"
                      title="1만원 늘리기"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isExceeded
                        ? "bg-rose-500"
                        : isWarning
                          ? "bg-amber-500"
                          : isUnset
                            ? "bg-slate-300"
                            : "bg-emerald-500"
                    }`}
                    style={{
                      // 예산이 없으면 소진율이란 것이 없으므로 막대를 채우지 않습니다
                      width: isUnset ? "0%" : `${Math.min(100, item.percentage)}%`,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1 gap-2">
                  <span className="shrink-0">
                    지출:{" "}
                    <strong className="text-slate-800 font-bold">
                      {withCommas(item.spent)}원
                    </strong>
                  </span>
                  <span className="text-right min-w-0">
                    {isUnset ? (
                      <span className="text-slate-400">한도를 정하면 소진율이 표시됩니다</span>
                    ) : isExceeded ? (
                      <span className="text-rose-600 font-bold">
                        {withCommas(Math.abs(item.remaining))}원 초과
                      </span>
                    ) : (
                      <span>
                        잔여: {withCommas(item.remaining)}원 ({Math.round(item.percentage)}% 소진)
                      </span>
                    )}
                  </span>
                </div>

                {baseline && (
                  <p
                    className={`mt-1 text-[10px] leading-relaxed ${
                      underFixed ? "font-bold text-amber-700" : "text-slate-400"
                    }`}
                  >
                    <Lock className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" />
                    고정비 월평균 {withCommas(baseline.average)}원 ({baseline.months}개월)
                    {underFixed && " — 한도가 이보다 낮아 시작부터 초과입니다"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION 3: Notification & Alert Preferences */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
              3
            </span>
            <h3 className="text-xs font-bold text-slate-900">
              예산 초과 알림 수신 설정
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 font-medium">
              {budgetConfig.enablePushAlerts ? "알림 켜짐" : "알림 꺼짐"}
            </span>
            <button
              onClick={() =>
                updateBudgetConfig({
                  enablePushAlerts: !budgetConfig.enablePushAlerts,
                })
              }
              className={`w-10 h-6 rounded-full transition p-0.5 flex items-center ${
                budgetConfig.enablePushAlerts ? "bg-emerald-600 justify-end" : "bg-slate-300 justify-start"
              }`}
            >
              <div className="w-5 h-5 rounded-full bg-white shadow-xs" />
            </button>
          </div>
        </div>

        <div className="p-3 bg-slate-50 rounded-2xl space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">사전 경고 알림 발송 기준:</span>
            <div className="flex items-center gap-1">
              {[70, 80, 90].map((threshold) => (
                <button
                  key={threshold}
                  onClick={() => updateBudgetConfig({ alertThresholdPercent: threshold })}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                    budgetConfig.alertThresholdPercent === threshold
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 border border-slate-200"
                  }`}
                >
                  {threshold}% 도달 시
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
            <span className="text-[11px] text-slate-500">
              안드로이드 모바일 푸시 및 브라우저 알림 테스트
            </span>
            <button
              onClick={handleTestNotification}
              className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-800 text-[11px] font-bold hover:bg-slate-100 transition flex items-center gap-1"
            >
              <Bell className="w-3 h-3 text-emerald-600" />
              <span>테스트 알림 발송</span>
            </button>
          </div>
        </div>
      </div>
      {/* 카테고리별 예산 기준 — 달에 매이지 않는 한도 규칙 */}
      <BudgetPolicyModal isOpen={showPolicy} onClose={() => setShowPolicy(false)} />

      {/* 그 합계를 만든 내역을 열어 보고, 뺄 것을 빼는 화면 */}
      <ActualsPickerModal
        isOpen={picking !== null}
        kind={picking ?? "INCOME"}
        month={selectedMonth}
        onClose={() => setPicking(null)}
        onApply={(total, counted) => {
          if (picking === "INCOME") {
            setIncomeInput(asInput(total));
            setIncomeTouched(false);
            updateBudgetConfig({ monthlyIncome: total, incomeSource: "ACTUALS" });
          } else if (picking === "FIXED") {
            setFixedInput(asInput(total));
            setFixedTouched(false);
            updateBudgetConfig({ fixedExpenses: total, fixedSource: "ACTUALS" });
          } else {
            setSavingsInput(asInput(total));
            setSavingsTouched(false);
            updateBudgetConfig({ savingsTarget: total, savingsSource: "ACTUALS" });
          }
          triggerToast(
            `${counted}건을 더한 ${withCommas(total)}원을 ${
              picking === "INCOME" ? "수입" : picking === "FIXED" ? "고정비" : "저축"
            }에 반영했습니다.`
          );
        }}
      />
    </div>
  );
};
