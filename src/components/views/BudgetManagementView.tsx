import React, { useState, useEffect } from "react";
import { useFinance } from "../../context/FinanceContext";
import { formatAmountInput, parseAmountInput, withCommas } from "../../utils/format";
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
    disposableIncome,
    totalBudgeted,
    selectedMonth,
  } = useFinance();

  /** 0 은 "아직 안 정했다"는 뜻이라 비워 둡니다 — 자리표시자가 보여야 적을 곳임을 압니다. */
  const asInput = (value: number) => (value > 0 ? formatAmountInput(String(value)) : "");

  const [incomeInput, setIncomeInput] = useState(() => asInput(budgetConfig.monthlyIncome));
  const [fixedInput, setFixedInput] = useState(() => asInput(budgetConfig.fixedExpenses));
  const [savingsInput, setSavingsInput] = useState(() => asInput(budgetConfig.savingsTarget));
  const [showNotificationToast, setShowNotificationToast] = useState<string | null>(null);

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
    });
    triggerToast("월 수입 및 고정비 설정이 업데이트되었습니다.");
  };

  // Sync with actual current month data
  const handleSyncActuals = () => {
    setIncomeInput(asInput(totalIncome));
    setFixedInput(asInput(fixedExpenseTotal));
    updateBudgetConfig({
      monthlyIncome: totalIncome,
      fixedExpenses: fixedExpenseTotal,
    });
    triggerToast(
      isThisMonth
        ? `${monthName} 실제 내역을 채웠습니다. 아직 달이 끝나지 않아 실제보다 적을 수 있습니다.`
        : `${monthName} 실제 수입과 고정비를 채웠습니다.`
    );
  };

  // Run AI auto-allocation
  const handleAutoAllocate = () => {
    const inc = parseInt(incomeInput.replace(/[^0-9]/g, "")) || budgetConfig.monthlyIncome;
    const fix = parseInt(fixedInput.replace(/[^0-9]/g, "")) || budgetConfig.fixedExpenses;
    const sav = parseInt(savingsInput.replace(/[^0-9]/g, "")) || budgetConfig.savingsTarget;

    autoAllocateBudgets(inc, fix, sav);
    triggerToast("✨ 50/30/20 규칙 기반으로 카테고리별 최적 예산이 자동 배분되었습니다!");
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

  const availableVariableBudget = Math.max(
    0,
    budgetConfig.monthlyIncome - budgetConfig.fixedExpenses - budgetConfig.savingsTarget
  );

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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
              1
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-slate-900">
                {monthName} 수입 &amp; 고정비 입력
              </h3>
              {/* 읽기 전용 카드로 보여 아무도 누르지 않던 칸들입니다 */}
              <p className="text-[10px] text-slate-400">
                세 칸은 직접 적는 값입니다. 적은 뒤 [기본 정보 저장]을 누르세요.
              </p>
            </div>
          </div>

          <button
            onClick={handleSyncActuals}
            className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center gap-1 transition"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{monthName} 실제 내역으로 채우기</span>
          </button>
        </div>

        {/*
          "예상"인데 실적을 채우는 버튼이 옆에 있습니다. 달이 끝나기 전에 누르면
          아직 안 들어온 급여가 빠진 금액이 들어오므로, 그때는 지난달을 보라고
          알려 줍니다 — 위쪽 월 이동 화살표를 쓰는 법을 함께 알리는 셈입니다.
        */}
        {isThisMonth && (
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200/70 rounded-xl px-2.5 py-2 leading-relaxed">
            {monthName}은 아직 끝나지 않았습니다. [{monthName} 실제 내역으로 채우기]를
            누르면 지금까지 기록된 금액만 들어옵니다. 한 달치 기준을 잡으려면 위쪽
            <strong> ‹ </strong>로 지난달을 골라 채우는 편이 정확합니다.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* Monthly Income Input */}
          <div className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/60">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 mb-1">
              <span className="flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-emerald-600" />
                월 예상 총 수입
              </span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={incomeInput}
                onChange={(e) => setIncomeInput(formatAmountInput(e.target.value))}
                placeholder="예: 3,482,000"
                className="w-full bg-white rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-black text-slate-900 focus:border-emerald-500 focus:outline-hidden"
              />
              <span className="text-xs font-bold text-slate-500 shrink-0">원</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              {monthName}에 들어올 것으로 보는 급여 + 기타 수입
            </span>
          </div>

          {/* Monthly Fixed Expenses Input */}
          <div className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/60">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 mb-1">
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3 text-indigo-600" />
                월간 고정 지출
              </span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={fixedInput}
                onChange={(e) => setFixedInput(formatAmountInput(e.target.value))}
                placeholder="예: 995,690"
                className="w-full bg-white rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-black text-slate-900 focus:border-emerald-500 focus:outline-hidden"
              />
              <span className="text-xs font-bold text-slate-500 shrink-0">원</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              월세·관리비·통신비·보험처럼 매달 나가는 돈
            </span>
          </div>

          {/* Savings Target Input */}
          <div className="p-3 bg-slate-50/80 rounded-2xl border border-slate-200/60">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 mb-1">
              <span className="flex items-center gap-1">
                <PiggyBank className="w-3 h-3 text-rose-500" />
                목표 저축액
              </span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                value={savingsInput}
                onChange={(e) => setSavingsInput(formatAmountInput(e.target.value))}
                placeholder="예: 600,000"
                className="w-full bg-white rounded-xl border border-slate-200 px-2.5 py-2 text-sm font-black text-slate-900 focus:border-emerald-500 focus:outline-hidden"
              />
              <span className="text-xs font-bold text-slate-500 shrink-0">원</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              선저축 목표 금액
            </span>
          </div>
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
            <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
            <span>AI 스마트 예산 자동 분배</span>
          </button>
        </div>
      </div>

      {/* SECTION 2: Category Budget Allocations & Live Spending Bars */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
              2
            </span>
            <h3 className="text-xs font-bold text-slate-900">
              카테고리별 예산 한도 & 소진율
            </h3>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-slate-400 block">설정 총예산</span>
            <span className="text-xs font-black text-slate-900">
              {totalBudgeted.toLocaleString()}원
            </span>
          </div>
        </div>

        <div className="space-y-2.5">
          {budgetStatusList.map((item) => {
            const isExceeded = item.status === "EXCEEDED";
            const isWarning = item.status === "WARNING";

            return (
              <div
                key={item.category}
                className={`p-3 rounded-2xl border transition ${
                  isExceeded
                    ? "bg-rose-50/50 border-rose-200"
                    : isWarning
                    ? "bg-amber-50/40 border-amber-200"
                    : "bg-slate-50/70 border-slate-200/70"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-900">
                      {item.category}
                    </span>
                    <span
                      className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded-full ${
                        isExceeded
                          ? "bg-rose-100 text-rose-700"
                          : isWarning
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {isExceeded
                        ? "초과 🚨"
                        : isWarning
                        ? `경고 (${Math.round(item.percentage)}%)`
                        : "안전"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => adjustCategory(item.category, -10000)}
                      className="w-5 h-5 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition text-[10px]"
                      title="1만원 줄이기"
                    >
                      <Minus className="w-2.5 h-2.5" />
                    </button>
                    <span className="text-xs font-black text-slate-900 min-w-16 text-right">
                      {item.budget.toLocaleString()}원
                    </span>
                    <button
                      onClick={() => adjustCategory(item.category, 10000)}
                      className="w-5 h-5 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition text-[10px]"
                      title="1만원 늘리기"
                    >
                      <Plus className="w-2.5 h-2.5" />
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
                        : "bg-emerald-500"
                    }`}
                    style={{
                      width: `${Math.min(100, item.percentage)}%`,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                  <span>
                    지출:{" "}
                    <strong className="text-slate-800 font-bold">
                      {item.spent.toLocaleString()}원
                    </strong>
                  </span>
                  <span>
                    {isExceeded ? (
                      <span className="text-rose-600 font-bold">
                        {Math.abs(item.remaining).toLocaleString()}원 초과
                      </span>
                    ) : (
                      <span>
                        잔여: {item.remaining.toLocaleString()}원 ({Math.round(item.percentage)}% 소진)
                      </span>
                    )}
                  </span>
                </div>
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
    </div>
  );
};
