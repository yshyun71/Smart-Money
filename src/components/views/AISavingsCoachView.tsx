import React, { useState } from "react";
import { useFinance } from "../../context/FinanceContext";
import { askCoach } from "../../services/aiClient";
import { shortWon } from "../../utils/format";
import {
  AlertCircle,
  Sparkles,
  RefreshCw,
  CheckCircle,
  PiggyBank,
  Check,
  Send,
  MessageSquare,
  Flame,
  ArrowUpRight,
  ShieldCheck,
  Zap,
} from "lucide-react";

export const AISavingsCoachView: React.FC = () => {
  const {
    aiAnalysis,
    runAISpendingAnalysis,
    isAnalyzingAI,
    toggleRecommendation,
    implementedSavingsTotal,
    totalIncome,
    totalExpense,
    fixedExpenseTotal,
    variableExpenseTotal,
    aiError,
    clearAiError,
  } = useFinance();

  // Chat state
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatAnswers, setChatAnswers] = useState<
    { sender: "user" | "coach"; text: string }[]
  >([
    {
      sender: "coach",
      text: "안녕하세요! 회원님의 카드 및 계좌 내역을 분석하여 가장 효율적으로 돈을 모을 수 있는 절약 팁을 준비했습니다. 궁금한 점이 있다면 언제든 물어보세요!",
    },
  ]);
  const [isAskingChat, setIsAskingChat] = useState(false);

  // Checked state for weekly action checklist
  const [checkedItems, setCheckedItems] = useState<{ [idx: number]: boolean }>({});

  // null means "no analysis has been run on this device yet"
  const healthScore = aiAnalysis?.healthScore ?? null;
  const potentialSavings = aiAnalysis?.totalPotentialMonthlySavings ?? null;

  const handleAskCoach = async (promptText?: string) => {
    const q = promptText || chatQuestion;
    if (!q.trim() || isAskingChat) return;

    setChatAnswers((prev) => [...prev, { sender: "user", text: q }]);
    if (!promptText) setChatQuestion("");
    setIsAskingChat(true);

    try {
      const answer = await askCoach(q, {
        totalIncome,
        totalExpense,
        fixedExpenseTotal,
        variableExpenseTotal,
        implementedSavingsTotal,
        recommendations: aiAnalysis?.savingsRecommendations?.map((r) => r.title),
      });
      if (answer) {
        setChatAnswers((prev) => [...prev, { sender: "coach", text: answer }]);
      } else {
        setChatAnswers((prev) => [
          ...prev,
          {
            sender: "coach",
            text: "답변을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
          },
        ]);
      }
    } catch (err: any) {
      setChatAnswers((prev) => [
        ...prev,
        {
          sender: "coach",
          text: err?.message || "답변을 가져오지 못했습니다.",
        },
      ]);
    } finally {
      setIsAskingChat(false);
    }
  };

  const getDifficultyBadge = (diff: string) => {
    switch (diff) {
      case "쉬움":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "보통":
        return "bg-amber-100 text-amber-800 border-amber-200";
      default:
        return "bg-indigo-100 text-indigo-800 border-indigo-200";
    }
  };

  return (
    <div className="space-y-4 pt-1">
      {/* Top Banner with Health Score and Re-analyze */}
      <div className="bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-800 text-white rounded-3xl p-5 shadow-lg relative overflow-hidden">
        <div className="flex items-center justify-between relative z-10 mb-3">
          <div className="flex items-center gap-1.5 bg-white/20 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-xs">
            <Sparkles className="w-3.5 h-3.5 text-emerald-200" />
            <span>AI 지출 절약 코칭</span>
          </div>

          <button
            onClick={runAISpendingAnalysis}
            disabled={isAnalyzingAI}
            className="flex items-center gap-1 bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 px-2.5 py-1 rounded-full text-xs font-semibold transition disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isAnalyzingAI ? "animate-spin" : ""}`}
            />
            <span>{isAnalyzingAI ? "AI 분석 중..." : "새로 분석하기"}</span>
          </button>
        </div>

        {/* Health score & big numbers — blank until an analysis has actually run */}
        <div className="grid grid-cols-2 gap-3 relative z-10">
          <div>
            <span className="text-xs text-emerald-100">가계부 재무 건강도</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-3xl font-black tracking-tight">
                {healthScore ?? "–"}
              </span>
              <span className="text-sm font-semibold text-emerald-200">
                {healthScore === null ? "아직 분석 전" : "/ 100점"}
              </span>
            </div>
            <div className="w-full h-1.5 bg-black/20 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all"
                style={{ width: `${healthScore ?? 0}%` }}
              />
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-xs rounded-2xl p-3 border border-white/15">
            <span className="text-[11px] text-emerald-100">매월 절약 가능액</span>
            <div className="text-lg font-black tracking-tight text-white mt-0.5">
              {potentialSavings === null
                ? "–"
                : `+${potentialSavings.toLocaleString()}원`}
            </div>
            <span className="text-[10px] text-emerald-200">
              {potentialSavings === null
                ? "분석하면 절약 가능액이 계산됩니다"
                : `연간 약 ${shortWon(potentialSavings * 12)} 절감`}
            </span>
          </div>
        </div>

        {/* Implemented Savings counter */}
        {implementedSavingsTotal > 0 && (
          <div className="mt-4 pt-3 border-t border-white/20 flex items-center justify-between text-xs relative z-10">
            <div className="flex items-center gap-1.5 text-emerald-100 font-semibold">
              <PiggyBank className="w-4 h-4 text-emerald-200" />
              <span>내가 실천 완료한 절약:</span>
            </div>
            <span className="font-extrabold text-white text-sm bg-black/20 px-2 py-0.5 rounded-lg">
              +{implementedSavingsTotal.toLocaleString()}원/월
            </span>
          </div>
        )}
      </div>

      {/* Analysis failure (missing key, quota, offline …) */}
      {aiError && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200/80 text-xs text-rose-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
          <div className="min-w-0 flex-1">
            <div className="font-bold">AI 분석을 완료하지 못했습니다</div>
            <p className="mt-0.5 leading-relaxed break-words">{aiError}</p>
            <p className="mt-1 text-[11px] text-rose-700/80">
              상단 톱니바퀴 &gt; <strong>AI 등록</strong>에서 내 API 키를 확인할 수 있습니다.
            </p>
          </div>
          <button
            onClick={clearAiError}
            className="text-rose-400 hover:text-rose-700 text-[11px] font-bold shrink-0 px-1"
          >
            닫기
          </button>
        </div>
      )}

      {/* Nothing analysed on this device yet */}
      {!aiAnalysis && !isAnalyzingAI && !aiError && (
        <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-2xs text-center space-y-2.5">
          <div className="w-10 h-10 mx-auto rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="text-xs font-bold text-slate-900">
            아직 분석한 기록이 없습니다
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            이번 달 거래를 등록한 뒤 위의 <strong>[새로 분석하기]</strong>를 누르면
            <br />
            재무 건강도와 맞춤 절약 항목이 계산됩니다.
          </p>
          <p className="text-[10px] text-slate-400">
            AI 기능에는 상단 톱니바퀴 &gt; <strong>AI 등록</strong>에서 내 API 키가 필요합니다.
          </p>
        </div>
      )}

      {/* Summary comment from AI */}
      {aiAnalysis && (
        <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
            <Zap className="w-4 h-4 text-emerald-600" />
            <span>AI 종합 진단 코멘트</span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">
            {aiAnalysis.summary}
          </p>
          <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-100 text-[11px] text-emerald-900">
            💬 <strong>코치의 응원:</strong> {aiAnalysis.coachEncouragement}
          </div>
        </div>
      )}

      {/* Actionable Savings Recommendation Cards */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-rose-500" />
            <h3 className="text-xs font-bold text-slate-900">
              추천 절약 항목 ({aiAnalysis?.savingsRecommendations?.length || 0}개)
            </h3>
          </div>
          <span className="text-[10px] text-slate-500">
            실천 시 체크하여 절약액을 누적하세요
          </span>
        </div>

        <div className="space-y-3">
          {aiAnalysis?.savingsRecommendations?.map((rec) => {
            const isDone = rec.isImplemented;

            return (
              <div
                key={rec.id}
                className={`p-4 rounded-3xl border transition-all ${
                  isDone
                    ? "bg-slate-50/80 border-slate-200 text-slate-400"
                    : "bg-white border-slate-200/90 shadow-2xs hover:border-emerald-500/50"
                }`}
              >
                {/* Card Top */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {rec.category}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getDifficultyBadge(
                        rec.difficulty
                      )}`}
                    >
                      {rec.difficulty}
                    </span>
                    <span className="text-[10px] font-medium text-slate-500">
                      {rec.type}
                    </span>
                  </div>

                  <span
                    className={`text-sm font-black tracking-tight shrink-0 ${
                      isDone ? "text-slate-400 line-through" : "text-emerald-600"
                    }`}
                  >
                    +{rec.estimatedMonthlySavings.toLocaleString()}원/월
                  </span>
                </div>

                {/* Title */}
                <h4
                  className={`text-xs font-bold ${
                    isDone ? "text-slate-500 line-through" : "text-slate-900"
                  }`}
                >
                  {rec.title}
                </h4>

                {/* Current Issue */}
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                  📌 <strong>원인:</strong> {rec.currentIssue}
                </p>

                {/* Action Plan */}
                <div className="mt-2.5 p-2.5 rounded-2xl bg-slate-50 border border-slate-200/70 text-[11px] text-slate-800 leading-relaxed">
                  💡 <strong>실천 방법:</strong> {rec.actionPlan}
                </div>

                {/* Concrete Example with Before & After Real-world numbers */}
                {rec.concreteExample && (
                  <div className="mt-2 p-2.5 rounded-2xl bg-emerald-50/70 border border-emerald-100/90 text-[11px] text-emerald-950 leading-relaxed">
                    <span className="font-bold text-emerald-800 flex items-center gap-1 mb-0.5">
                      <Sparkles className="w-3 h-3 text-emerald-600 shrink-0" />
                      구체적 실천 예시:
                    </span>
                    <p className="text-emerald-900">{rec.concreteExample}</p>
                  </div>
                )}

                {/* Toggle Completion Button */}
                <button
                  onClick={() => toggleRecommendation(rec.id)}
                  className={`mt-3 w-full py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    isDone
                      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                      : "bg-slate-900 hover:bg-emerald-600 text-white shadow-xs"
                  }`}
                >
                  {isDone ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>실천 완료됨 (+{rec.estimatedMonthlySavings.toLocaleString()}원 절약 중)</span>
                    </>
                  ) : (
                    <span>실천 완료하고 절약 기록하기</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Habit Improvements Section */}
      {aiAnalysis?.habitImprovements && aiAnalysis.habitImprovements.length > 0 && (
        <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-500" />
              <h3 className="text-xs font-bold text-slate-900">
                카드·계좌 소비 습관 개선 방안
              </h3>
            </div>
            <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
              AI 습관 처방전
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            카드 결제 및 계좌 출금 패턴을 바탕으로 도출한 실질적 소비 습관 교정 솔루션입니다.
          </p>

          <div className="space-y-3">
            {aiAnalysis.habitImprovements.map((habit) => (
              <div
                key={habit.id}
                className="p-3.5 rounded-2xl bg-linear-to-r from-amber-50/40 via-white to-slate-50 border border-amber-200/70 space-y-2 shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-100/90 px-2 py-0.5 rounded-full">
                      {habit.badge}
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      {habit.category}
                    </span>
                  </div>

                  <span className="text-xs font-black text-emerald-600">
                    월 약 +{habit.expectedMonthlyBenefit.toLocaleString()}원 방어
                  </span>
                </div>

                <h4 className="text-xs font-bold text-slate-900">
                  {habit.title}
                </h4>

                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {habit.description}
                </p>

                {/* Habit Concrete Example Card */}
                <div className="p-2.5 rounded-xl bg-amber-100/40 border border-amber-200/50 text-[11px] text-amber-950 leading-relaxed">
                  <strong className="text-amber-900 font-bold block mb-0.5">
                    🎯 구체적 실천 예시
                  </strong>
                  <span>{habit.concreteExample}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly Action Checklist */}
      {aiAnalysis?.weeklyActionChecklist && (
        <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-2.5">
          <div className="flex items-center gap-1.5">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-bold text-slate-900">
              이번 주 즉시 실천 체크리스트
            </h3>
          </div>

          <div className="space-y-1.5">
            {aiAnalysis.weeklyActionChecklist.map((task, idx) => {
              const checked = !!checkedItems[idx];
              return (
                <label
                  key={idx}
                  className="flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition select-none"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setCheckedItems((prev) => ({ ...prev, [idx]: !checked }))
                    }
                    className="w-4 h-4 mt-0.5 accent-emerald-600 rounded-md cursor-pointer"
                  />
                  <span
                    className={`text-xs ${
                      checked
                        ? "text-slate-400 line-through font-normal"
                        : "text-slate-800 font-medium"
                    }`}
                  >
                    {task}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Interactive AI Coach Chat Assistant */}
      <div className="bg-white rounded-3xl p-4 border border-slate-200/90 shadow-2xs space-y-3">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-emerald-600" />
          <h3 className="text-xs font-bold text-slate-900">
            AI 가계부 상담 코치에게 물어보기
          </h3>
        </div>

        {/* Suggested Quick Prompt Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {[
            "배달 음식 줄이는 식단 팁",
            "알뜰폰 요금제 비교 방법",
            "내 소득에 알맞은 고정비 비율",
          ].map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleAskCoach(prompt)}
              className="text-[10px] font-semibold bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 px-2.5 py-1 rounded-full shrink-0 transition"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Chat History Box */}
        <div className="max-h-60 overflow-y-auto space-y-2.5 p-2 bg-slate-50 rounded-2xl border border-slate-100">
          {chatAnswers.map((msg, i) => (
            <div
              key={i}
              className={`flex ${
                msg.sender === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-2xl p-2.5 text-xs leading-relaxed ${
                  msg.sender === "user"
                    ? "bg-emerald-600 text-white rounded-br-xs"
                    : "bg-white text-slate-800 border border-slate-200/70 rounded-bl-xs shadow-2xs"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isAskingChat && (
            <div className="flex justify-start">
              <div className="bg-white p-2.5 rounded-2xl border border-slate-200/70 text-xs text-slate-500 animate-pulse flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                <span>AI 코치가 분석하여 답변을 작성하고 있습니다...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={chatQuestion}
            onChange={(e) => setChatQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAskCoach()}
            placeholder="예: 이번 달 외식비를 10만원 줄이려면?"
            className="flex-1 rounded-2xl border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:outline-hidden focus:border-emerald-500"
          />
          <button
            onClick={() => handleAskCoach()}
            disabled={!chatQuestion.trim() || isAskingChat}
            className="p-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 transition active:scale-95 shrink-0 shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
