import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { won, withCommas } from "../../utils/format";
import { recurringItems, looksStopped, type RecurringItem } from "../../services/recurrence";
import type { ConnectedAccount } from "../../types/finance";
import { Repeat, X, ChevronRight, TrendingUp, AlertCircle } from "lucide-react";

/**
 * 매달 빠져나가는 것 모아 보기 (§12.10).
 *
 * 고정비 판정(§10)이 이미 반복을 찾아내는데 **모아 볼 자리가 없었습니다** —
 * 고정비 화면의 한 줄 요약뿐이었습니다. 구독이 하나씩 늘어난 것을 알아차리는
 * 일은 개인 가계부에서 값이 가장 큰 점검이고, 계산은 이미 다 되어 있었습니다.
 *
 * 판정은 `services/recurrence.ts` 가 합니다(§17.5). 이 화면은 보여 주고,
 * 누르면 그 가맹점의 내역을 모아 보는 창으로 넘깁니다.
 */
export const RecurringModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** 한 항목을 골랐습니다 — 부모가 `내역 찾기`를 그 가맹점으로 엽니다. */
  onPick: (merchant: string) => void;
}> = ({ isOpen, onClose, onPick }) => {
  const { spendingTransactions, accounts } = useFinance();
  const [showStopped, setShowStopped] = useState(true);

  const items = useMemo(
    () => recurringItems(spendingTransactions),
    [spendingTransactions]
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const stopped = items.filter((item) => looksStopped(item));
  const shown = showStopped ? items : items.filter((item) => !looksStopped(item));
  const monthly = items
    .filter((item) => !looksStopped(item))
    .reduce((sum, item) => sum + item.amount, 0);

  const nameOf = (id: string) =>
    accounts.find((account: ConnectedAccount) => account.id === id)?.name || "";

  const content = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Repeat className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">정기 결제 모아 보기</h3>
              <p className="text-[10px] text-slate-400">
                매달 같은 날 같은 곳에서 빠져나가는 것들
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

        {items.length === 0 ? (
          <div className="py-8 text-center space-y-1.5">
            <Repeat className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs font-bold text-slate-500">아직 찾은 정기 결제가 없습니다</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              <strong>서로 다른 3개월 이상</strong> 같은 날짜대에 반복될 때 정기 결제로
              봅니다(§10). 지난 달들의 명세서를 더 가져오면 찾아냅니다.
            </p>
          </div>
        ) : (
          <>
            <div className="p-3 rounded-2xl bg-indigo-50/70 border border-indigo-100">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-indigo-900">
                  매달 빠져나가는 돈
                </span>
                <span className="text-sm font-black text-indigo-950">{won(monthly)}</span>
              </div>
              <p className="text-[10px] text-indigo-700 mt-0.5">
                {items.length - stopped.length}건 · 연간 약 {withCommas(monthly * 12)}원
              </p>
            </div>

            {stopped.length > 0 && (
              <button
                type="button"
                onClick={() => setShowStopped((prev) => !prev)}
                className="w-full p-2.5 rounded-xl bg-amber-50 border border-amber-200/70 text-left flex items-start gap-2 cursor-pointer hover:bg-amber-100/60 transition"
              >
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-amber-900">
                    두 달 넘게 안 보이는 것 {stopped.length}건
                  </div>
                  {/*
                    끊겼거나, 이름이 바뀌었거나, 명세서를 아직 안 넣은 것입니다 —
                    셋 다 알아야 할 사실이라 목록에서 빼지 않고 표시만 합니다(§17.1).
                  */}
                  <p className="text-[10px] text-amber-800/90 leading-relaxed">
                    해지됐거나, 이름이 바뀌었거나, 명세서를 아직 넣지 않은 것입니다.
                    {showStopped ? " 목록에서 감추기" : " 목록에 보이기"}
                  </p>
                </div>
              </button>
            )}

            <div className="space-y-1.5">
              {shown.map((item: RecurringItem) => {
                const quiet = looksStopped(item);
                const rising = item.amount > item.average;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onPick(item.merchant)}
                    className={`w-full text-left p-2.5 rounded-xl border transition flex items-center gap-2.5 cursor-pointer ${
                      quiet
                        ? "bg-slate-50 border-slate-200/60 opacity-70 hover:opacity-100"
                        : "bg-white border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 flex flex-col items-center justify-center shrink-0 leading-none">
                      <span className="text-[9px]">매월</span>
                      <span className="text-[11px] font-black text-slate-700">
                        {item.paymentDay}일
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {item.merchant}
                        {quiet && (
                          <span className="ml-1 text-[9px] font-bold text-amber-700">
                            · 안 보임
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {item.category} · {item.monthCount}개월
                        {nameOf(item.accountId) ? ` · ${nameOf(item.accountId)}` : ""}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-black text-slate-800 whitespace-nowrap block">
                        {won(item.amount)}
                      </span>
                      {/*
                        최근 금액과 평균이 벌어지면 그 차이가 알아차려야 할
                        사실입니다 — 구독료가 오른 것입니다.
                      */}
                      {item.amount !== item.average && (
                        <span
                          className={`text-[9px] whitespace-nowrap ${
                            rising ? "text-rose-600 font-bold" : "text-slate-400"
                          }`}
                        >
                          {rising && <TrendingUp className="w-2.5 h-2.5 inline -mt-0.5" />}
                          평균 {withCommas(item.average)}
                        </span>
                      )}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                  </button>
                );
              })}
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              누르면 그 가맹점의 내역을 기간·범위를 정해 모아 볼 수 있습니다. 금액이
              평균보다 오른 항목은 <strong>붉게</strong> 표시됩니다.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
        >
          닫기
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
