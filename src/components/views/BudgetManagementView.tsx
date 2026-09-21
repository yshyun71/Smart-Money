import React, { useState, useEffect, useMemo } from "react";
import { useFinance } from "../../context/FinanceContext";
import { formatAmountInput, parseAmountInput, withCommas, won } from "../../utils/format";
import {
  actualRows,
  budgetWording,
  monthPhase,
  sumActuals,
  type ActualKind,
} from "../../services/actuals";
import { BudgetPolicyModal } from "../modals/BudgetPolicyModal";
import { ActualsPickerModal } from "../modals/ActualsPickerModal";
import { CategorySpendingModal } from "../modals/CategorySpendingModal";
import { monthPeriod } from "../../services/trend";
import { AddTransactionModal } from "../transactions/AddTransactionModal";
import { remainingSpare, spareOf } from "../../services/budgetPolicy";
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
    spendingTransactions,
    accounts,
    variableExpenseTotal,
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
  const [picking, setPicking] = useState<
    "INCOME" | "FIXED" | "SAVINGS" | "VARIABLE" | null
  >(null);
  const [savingsTouched, setSavingsTouched] = useState(false);
  /*
    지금 고치는 중인 카테고리 한도. 누를 때마다 저장하면 "4"만 눌러도 4원이
    되어 버리므로, 칸을 떠날 때(또는 Enter) 한 번 저장합니다.
  */
  const [editing, setEditing] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  /*
    `지출: 460,000원` 뒤에 무엇이 있는지 보는 창. 한도를 넘었다는 말만 듣고
    무엇 때문인지 모르면 할 수 있는 일이 없습니다(11.7).
  */
  const [spending, setSpending] = useState<string | null>(null);
  /** 그 목록에서 고른 건 — 거래 수정 화면으로 넘깁니다. */
  const [editingTx, setEditingTx] = useState<any>(null);

  /** 기준에 값이 들어 있는 카테고리 수. 0이면 적용할 것이 없습니다. */
  const policyCount = Object.keys(budgetPolicy.rules || {}).length;

  const baselineOf = (category: string) =>
    fixedBaselineList.find(
      (line: { category: string }) => line.category === category
    );

  /*
    그 달의 값을 다시 싣습니다 — **설정이 도착한 뒤에.**

    예산은 달마다 따로 저장되고(`budget_configs` PK(user_id, month)), 이 세 칸은
    `useState` 로 잡혀 있어 초기식이 한 번만 계산됩니다(14.7). 그래서 처음에는
    `selectedMonth` 를 의존성으로 두어 다시 실었는데, 그것만으로는 부족했습니다.

    `selectedMonth` 가 바뀌는 순간 `budgetConfig` 는 **아직 이전 달의 것**입니다
    — 새 달의 설정은 `refreshDbData` 가 DB 에서 읽어 온 뒤에야 도착합니다. 그
    사이에 효과가 돌아 칸에 **이전 달 값**을 싣고, 그 뒤 설정이 바뀌어도 효과는
    다시 돌지 않아 값이 그대로 남았습니다. 8월을 두 번 봤는데 숫자가 다른 이유가
    이것이고, 세 칸이 모두 `수정 중` 으로 보인 이유도 같습니다.

    그래서 **도착한 설정의 달**(`budgetConfig.month`)을 의존성으로 씁니다. 그
    값은 다른 달의 설정이 실릴 때만 바뀌므로, 같은 달에서 입력 중인 값을 저장
    전에 지우지도 않습니다.
  */
  useEffect(() => {
    setIncomeInput(asInput(budgetConfig.monthlyIncome));
    setFixedInput(asInput(budgetConfig.fixedExpenses));
    setSavingsInput(asInput(budgetConfig.savingsTarget));
    setIncomeTouched(false);
    setFixedTouched(false);
    setSavingsTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetConfig.month]);

  /*
    아직 그 달의 설정이 오지 않은 상태. 이때의 숫자는 이전 달의 것이므로
    보여 주지 않습니다 — 잘못된 값을 잠깐 보여 주는 것이 비워 두는 것보다
    나쁩니다(17.1).
  */
  const settling = budgetConfig.month !== selectedMonth;

  /** 선택한 달을 사람이 읽는 말로. */
  const monthName = `${Number((selectedMonth || "").slice(5, 7)) || ""}월`;

  /*
    지난 달인가, 이번 달인가.

    이것이 **낱말을 결정합니다.** 지난 달의 수입은 예상이 아니라 실적이고, 지난
    달의 저축은 목표가 아니라 실제로 떼어 둔 돈입니다. 같은 이름을 달아 두면
    8월을 보면서 `월 예상 총 수입` 이라고 읽게 됩니다.
  */
  const phase = monthPhase(selectedMonth);
  const isThisMonth = phase === "CURRENT";
  const wording = budgetWording(phase, monthName);

  /*
    지금 이 달의 실적. 저장된 값과 **나란히** 보여 주려고 셈합니다.

    저장된 값은 그때의 스냅샷이라 나중에 명세서를 더 가져오면 실적과 어긋나고,
    실적 목록에서 뺀 항목이 있으면 애초에 다릅니다. 그 사실을 화면이 말하지
    않으면 "이 금액이 어떤 기준인가요"라는 질문이 남습니다.
  */
  const liveActuals = useMemo(() => {
    /*
      **합계가 세는 것과 같은 목록**(`spendingTransactions`)을 봅니다. 거르지
      않은 목록을 쓰면 내 계좌 사이에서 옮긴 돈이 남아(§6.5) 여기서 말하는
      "지금 실적"이 `실적 채우기`가 넣는 금액과 어긋납니다.
    */
    const of = (kind: ActualKind, excluded?: string[]) =>
      sumActuals(
        actualRows(spendingTransactions, { month: selectedMonth, kind, accounts }),
        excluded
      );
    return {
      income: of("INCOME", budgetConfig.incomeExcluded),
      fixed: of("FIXED", budgetConfig.fixedExcluded),
      savings: of("SAVINGS", budgetConfig.savingsExcluded),
      /* 변동비는 저장하지 않으므로 뺀 항목도 없습니다 — 언제나 그 달 전부입니다 */
      variable: of("VARIABLE"),
    };
  }, [
    spendingTransactions,
    accounts,
    selectedMonth,
    budgetConfig.incomeExcluded,
    budgetConfig.fixedExcluded,
    budgetConfig.savingsExcluded,
  ]);

  /*
    입력칸의 값과 저장된 값이 다른가. 저장 버튼을 누르지 않고 떠나면 사라지므로,
    그 사실이 화면에 보여야 합니다.
  */
  const unsaved =
    !settling &&
    (parseAmountInput(incomeInput) !== budgetConfig.monthlyIncome ||
      parseAmountInput(fixedInput) !== budgetConfig.fixedExpenses ||
      parseAmountInput(savingsInput) !== budgetConfig.savingsTarget);

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
      // 전부 채우는 것이므로 빼 두었던 항목도 함께 풉니다
      incomeExcluded: [],
      fixedExcluded: [],
      savingsExcluded: [],
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

  /*
    초록 카드는 **입력칸에 적힌 값**으로 계산합니다.

    괄호 속 내역은 입력칸에서, 합계는 저장된 설정에서 가져오고 있었습니다.
    그래서 "(수입 7,021,213원 - 고정비 2,765,376원)" 옆에 "0원"이 찍혔습니다 —
    한 줄 안에서 두 숫자가 서로 다른 말을 한 것입니다.

    이 칸은 "저장하면 이렇게 된다"를 보여 주는 자리이므로 입력칸을 따릅니다.
    저장된 값으로 셈하는 것은 2번 블록의 `미배분` 쪽입니다.
  */
  const typedInputs = {
    income: parseAmountInput(incomeInput),
    fixed: parseAmountInput(fixedInput),
    savings: parseAmountInput(savingsInput),
  };

  /** 한 달 전체의 몫 — 자동 배분과 비율 모드의 기준입니다. */
  const monthSpare = spareOf(typedInputs);

  /*
    이미 쓴 변동비를 뺀 **남은** 배분 가능액.

    달이 절반 지난 시점에 한 달치 몫만 보여 주면 이미 나간 변동비가 없는 것처럼
    읽힙니다. 지난 달을 보고 있으면 더 심해서, 다 쓴 돈을 "배분 가능"이라고
    말하게 됩니다. 그래서 이 화면이 크게 보여 주는 값은 이쪽입니다.
  */
  const availableVariableBudget = remainingSpare({
    ...typedInputs,
    variableSpent: variableExpenseTotal,
  });

  /** 저장된 값으로 셈한 남은 배분 가능액 — 2번 블록의 배분 비교에 씁니다. */
  const savedVariableBudget = remainingSpare({
    income: budgetConfig.monthlyIncome,
    fixed: budgetConfig.fixedExpenses,
    savings: budgetConfig.savingsTarget,
    variableSpent: variableExpenseTotal,
  });

  /*
    남은 것끼리 견줍니다.

    한도는 한 달 전체의 한도라, 이미 쓴 만큼을 뺀 `남은 가용`과 한도 **합계**를
    바로 견주면 같은 돈을 두 번 빼게 됩니다. 그래서 한도 쪽도 남은 몫
    (`한도 − 지출`, 음수는 0)으로 맞춥니다.
  */
  const remainingBudgeted = (budgetStatusList || []).reduce(
    (sum: number, item: { budget: number; spent: number }) =>
      sum + Math.max(0, (item.budget || 0) - (item.spent || 0)),
    0
  );
  const budgetDifference = savedVariableBudget - remainingBudgeted;

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
                {phase === "PAST"
                  ? `${monthName} 실제 수입 & 고정비`
                  : `${monthName} 수입 & 고정비 입력`}
              </h3>
              {/* 읽기 전용 카드로 보여 아무도 누르지 않던 칸들입니다 */}
              <p className="text-[10px] text-slate-400 leading-relaxed">
                {phase === "PAST"
                  ? `${monthName}은 이미 지난 달입니다. 세 칸은 실제로 들어오고 나간 금액이며, [${monthName} 실적 채우기]로 한 번에 채울 수 있습니다.`
                  : "세 칸은 직접 적는 값입니다. 적은 뒤 [기본 정보 저장]을 누르세요."}
              </p>
            </div>
          </div>

          <button
            onClick={handleSyncActuals}
            /*
              전환 중에는 잠급니다 — 그 순간 `budgetConfig` 는 아직 이전 달의
              것이고, 쓰면 이전 달 행에 이 달 숫자가 들어갑니다.
            */
            disabled={settling}
            className="shrink-0 whitespace-nowrap px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center gap-1 transition disabled:opacity-40"
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
              label: wording.income.label,
              hint: wording.income.hint,
              icon: <DollarSign className="w-3.5 h-3.5 text-emerald-600" />,
              actual: liveActuals.income,
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
              label: wording.fixed.label,
              hint: wording.fixed.hint,
              icon: <Lock className="w-3.5 h-3.5 text-indigo-600" />,
              actual: liveActuals.fixed,
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
              label: wording.savings.label,
              hint: wording.savings.hint,
              icon: <PiggyBank className="w-3.5 h-3.5 text-rose-500" />,
              actual: liveActuals.savings,
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
            /*
              아직 그 달의 설정이 오지 않았다면 칸의 값은 이전 달의 것이고,
              사람이 고친 것이 아닙니다. 그때 `수정 중` 이라고 말하면
              거짓말이 됩니다.
            */
            const dirty = !settling && parseAmountInput(field.value) !== field.saved;

            /*
              저장된 값과 지금 실적의 관계를 한 줄로 밝힙니다.

              칸에 3,052,140원이 적혀 있는데 목록을 열면 8,314,074원이 보이던
              일이 있었습니다 — 예전에 수입 17건 중 급여 2건만 남기고 적용한
              결과였는데, 무엇을 뺐는지 기억하지 않아 설명할 방법이 없었습니다.
              이제 뺀 항목을 저장하므로(v16) 그 사실을 여기서 말합니다.
            */
            const kind: ActualKind =
              field.key === "income" ? "INCOME" : field.key === "fixed" ? "FIXED" : "SAVINGS";
            const actual = field.actual;
            const hasRows = actual.rows > 0;
            const drifted = !settling && !dirty && hasRows && actual.total !== field.saved;

            return (
              <div
                key={field.key}
                className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/60 space-y-2"
              >
                <div className="flex items-center gap-3">
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
                        onClick={() => !settling && setPicking(kind)}
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

                {/* 뺀 항목이 있으면 그 사실이 이 칸의 금액을 설명합니다 */}
                {!settling && actual.excludedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setPicking(kind)}
                    className="w-full text-left text-[10px] text-slate-500 bg-white border border-slate-200/70 rounded-xl px-2.5 py-1.5 hover:bg-slate-50 transition cursor-pointer"
                  >
                    {monthName} 실적 {actual.rows}건 중{" "}
                    <strong className="text-slate-700">{actual.counted}건</strong>만 반영 ·
                    뺀 {actual.excludedCount}건 {won(actual.excludedAmount)}
                    <ChevronRight className="w-2.5 h-2.5 inline -mt-0.5 ml-0.5" />
                  </button>
                )}

                {/*
                  저장된 값은 그때의 스냅샷입니다. 나중에 명세서를 더 가져오면
                  실적이 늘어나는데 칸은 그대로라, 그 차이를 말해 주지 않으면
                  틀린 기준으로 예산을 세우게 됩니다.
                */}
                {drifted && (
                  <button
                    type="button"
                    onClick={() => {
                      field.onChange(asInput(actual.total));
                      updateBudgetConfig(
                        field.key === "income"
                          ? { monthlyIncome: actual.total, incomeSource: "ACTUALS" }
                          : field.key === "fixed"
                            ? { fixedExpenses: actual.total, fixedSource: "ACTUALS" }
                            : { savingsTarget: actual.total, savingsSource: "ACTUALS" }
                      );
                      triggerToast(
                        `${field.label}을(를) ${monthName} 실적 ${withCommas(actual.total)}원으로 맞췄습니다.`
                      );
                    }}
                    className="w-full text-left text-[10px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-xl px-2.5 py-1.5 hover:bg-amber-100 transition cursor-pointer"
                  >
                    지금 {monthName} 실적은 <strong>{won(actual.total)}</strong>입니다 ·
                    이 값으로 맞추기
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/*
          네 번째 줄 — **변동비 실적.**

          위 세 칸과 달리 사람이 적는 값이 아닙니다. 이미 쓴 돈은 정해진 사실이라
          적을 것이 없고, 저장해 두면 그 순간의 스냅샷이 되어 나중에 실적과
          어긋납니다(§11.6의 AI 분석과 같은 문제). 그래서 늘 그 달 내역에서
          바로 셈해 보여 줍니다.
        */}
        <div className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/60 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="flex items-center gap-1 text-[11px] font-bold text-slate-600">
                <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                {monthName} 변동비 지출
              </span>
              <button
                type="button"
                onClick={() => !settling && setPicking("VARIABLE")}
                title={`${monthName} 변동비 내역 열어 보기`}
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 transition cursor-pointer hover:brightness-95"
              >
                실적 {liveActuals.variable.rows}건
                <ChevronRight className="w-2.5 h-2.5 inline -mt-0.5" />
              </button>
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block leading-relaxed">
              {monthName}에 이미 나간 변동비 — 남은 배분 가능액에서 빠집니다
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => !settling && setPicking("VARIABLE")}
              disabled={variableExpenseTotal <= 0}
              className="w-32 text-right rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm font-black text-slate-900 hover:bg-slate-50 transition disabled:text-slate-400 cursor-pointer disabled:cursor-default"
            >
              {withCommas(variableExpenseTotal)}
            </button>
            <span className="text-xs font-bold text-slate-500">원</span>
          </div>
        </div>

        {/* Calculation Summary Bar */}
        <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-100 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[11px] text-emerald-800 font-semibold block">
                카테고리 배분 가능 가용 변동비 예산
              </span>
              <span className="text-[10px] text-emerald-700 leading-relaxed">
                (수입 {withCommas(typedInputs.income)}원 − 고정비{" "}
                {withCommas(typedInputs.fixed)}원 − 저축{" "}
                {withCommas(typedInputs.savings)}원 − 변동비 지출{" "}
                {withCommas(variableExpenseTotal)}원)
              </span>
            </div>
            <span className="text-sm font-black text-emerald-900 shrink-0 whitespace-nowrap">
              {withCommas(availableVariableBudget)}원
            </span>
          </div>

          {/*
            자동 배분과 비율 모드는 **한 달 전체**의 몫을 씁니다 — 남은 금액으로
            한 달치 한도를 만들면 이미 쓴 만큼 한도가 작아져 달 시작부터 초과인
            칸이 쏟아집니다(§11.5). 두 숫자가 다른 이유를 여기서 밝힙니다.
          */}
          {monthSpare !== availableVariableBudget && (
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-emerald-100 text-[10px] text-emerald-700">
              <span>한 달 전체 기준 (자동 배분·비율 계산에 쓰는 값)</span>
              <span className="font-bold shrink-0 whitespace-nowrap">
                {withCommas(monthSpare)}원
              </span>
            </div>
          )}

          {/* 수입보다 많이 나갔으면 0 으로 막고 그 사실을 말합니다 */}
          {typedInputs.income > 0 &&
            typedInputs.income - typedInputs.fixed - typedInputs.savings - variableExpenseTotal <
              0 && (
              <p className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200/70 rounded-xl px-2 py-1.5 leading-relaxed">
                고정비·저축·변동비를 더하면 수입보다{" "}
                <strong>
                  {withCommas(
                    Math.abs(
                      typedInputs.income -
                        typedInputs.fixed -
                        typedInputs.savings -
                        variableExpenseTotal
                    )
                  )}
                  원
                </strong>{" "}
                많습니다. 더 배분할 수 있는 돈이 없습니다.
              </p>
            )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleApplyIncomeFixed}
            // 전환 중에는 잠급니다 — 이전 달 값을 이 달에 저장하게 됩니다
            disabled={settling}
            className={`flex-1 py-2.5 rounded-xl font-bold text-xs transition active:scale-98 disabled:opacity-40 ${
              unsaved
                ? "bg-amber-500 hover:bg-amber-400 text-white shadow-xs"
                : "bg-slate-900 hover:bg-slate-800 text-white"
            }`}
          >
            {settling
              ? `${monthName} 값을 읽는 중...`
              : unsaved
                ? "● 저장되지 않음 — 기본 정보 저장"
                : "기본 정보 저장"}
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
          남은 가용과 **남은 한도**의 차이.

          한도는 한 달 전체의 한도라, 이미 쓴 변동비를 뺀 `남은 가용`과 한도
          합계를 바로 견주면 같은 돈을 두 번 빼게 됩니다. 그래서 한도 쪽도
          `한도 − 지출`(음수는 0)로 맞춰 남은 것끼리 견줍니다.
        */}
        {savedVariableBudget > 0 && (
          <div
            className={`p-2.5 rounded-xl border text-[11px] flex items-center justify-between gap-2 ${
              budgetDifference < 0
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-slate-50 border-slate-200/70 text-slate-600"
            }`}
          >
            <span className="font-bold min-w-0">
              {budgetDifference < 0
                ? "남은 한도가 남은 가용을 넘었습니다"
                : "아직 배분하지 않은 금액"}
              <span className="block font-normal text-[10px] opacity-80">
                남은 가용 {withCommas(savedVariableBudget)}원 · 남은 한도{" "}
                {withCommas(remainingBudgeted)}원
              </span>
            </span>
            <span className="font-black shrink-0 whitespace-nowrap">
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
                  {/*
                    합계 하나만 보여 주면 "무엇을 줄여야 하는가"에 답할 수
                    없습니다. 금액과 [조회] 둘 다 같은 목록을 엽니다 — 금액이
                    눌린다는 것을 모르는 사람이 있으므로 버튼도 함께 둡니다.
                  */}
                  <span className="shrink-0 flex items-center gap-1">
                    지출:{" "}
                    <button
                      type="button"
                      onClick={() => setSpending(item.category)}
                      disabled={item.spent <= 0}
                      className="font-bold text-slate-800 underline decoration-slate-300 underline-offset-2 hover:text-slate-900 hover:decoration-slate-500 transition disabled:no-underline disabled:text-slate-400 cursor-pointer disabled:cursor-default"
                    >
                      {withCommas(item.spent)}원
                    </button>
                    {item.spent > 0 && (
                      <button
                        type="button"
                        onClick={() => setSpending(item.category)}
                        className="px-1.5 py-0.5 rounded-full bg-white border border-slate-200 text-[9px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition whitespace-nowrap cursor-pointer"
                      >
                        조회
                        <ChevronRight className="w-2.5 h-2.5 inline -mt-0.5" />
                      </button>
                    )}
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

      {/* 카테고리 지출의 속 — 누르면 그 자리에서 고칠 수 있습니다 (11.7) */}
      <CategorySpendingModal
        isOpen={spending !== null}
        category={spending}
        period={monthPeriod(selectedMonth)}
        budget={budgetConfig.categoryBudgets?.[spending || ""] || 0}
        /* 위에 수정 화면이 떠 있으면 Escape 를 가로채지 않습니다 (14.4) */
        suspended={editingTx !== null}
        onClose={() => setSpending(null)}
        onPick={(transaction) => setEditingTx(transaction)}
      />

      {/*
        목록은 뒤에 남겨 둡니다 — 고치고 나면 대개 다음 건을 이어서 봅니다.
        카테고리를 바꿨다면 그 건은 목록에서 사라지고 합계도 줄어듭니다.
      */}
      <AddTransactionModal
        isOpen={editingTx !== null}
        editing={editingTx}
        onClose={() => setEditingTx(null)}
      />

      {/* 그 합계를 만든 내역을 열어 보고, 뺄 것을 빼는 화면 */}
      <ActualsPickerModal
        isOpen={picking !== null}
        kind={picking ?? "INCOME"}
        month={selectedMonth}
        /* 지난번에 뺀 항목을 그대로 다시 엽니다 */
        excludedIds={
          picking === "FIXED"
            ? budgetConfig.fixedExcluded
            : picking === "SAVINGS"
              ? budgetConfig.savingsExcluded
              : picking === "VARIABLE"
                ? []
                : budgetConfig.incomeExcluded
        }
        /* 변동비는 저장하지 않는 값이라 고를 수 없습니다 — 보여 주기만 합니다 */
        readOnly={picking === "VARIABLE"}
        onClose={() => setPicking(null)}
        onApply={(total, counted, excludedIds) => {
          // 변동비는 적용할 것이 없습니다(읽기 전용)
          if (picking === "VARIABLE") return;
          if (picking === "INCOME") {
            setIncomeInput(asInput(total));
            setIncomeTouched(false);
            updateBudgetConfig({
              monthlyIncome: total,
              incomeSource: "ACTUALS",
              incomeExcluded: excludedIds,
            });
          } else if (picking === "FIXED") {
            setFixedInput(asInput(total));
            setFixedTouched(false);
            updateBudgetConfig({
              fixedExpenses: total,
              fixedSource: "ACTUALS",
              fixedExcluded: excludedIds,
            });
          } else {
            setSavingsInput(asInput(total));
            setSavingsTouched(false);
            updateBudgetConfig({
              savingsTarget: total,
              savingsSource: "ACTUALS",
              savingsExcluded: excludedIds,
            });
          }
          triggerToast(
            `${counted}건을 더한 ${withCommas(total)}원을 ${
              picking === "INCOME" ? "수입" : picking === "FIXED" ? "고정비" : "저축"
            }에 반영했습니다.${excludedIds.length > 0 ? ` (뺀 ${excludedIds.length}건은 기억해 둡니다)` : ""}`
          );
        }}
      />
    </div>
  );
};
