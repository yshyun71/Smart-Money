import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { won } from "../../utils/format";
import type { Transaction } from "../../types/finance";
import { actualRows, sumActuals, type ActualKind } from "../../services/actuals";
import {
  DollarSign,
  Lock,
  PiggyBank,
  X,
  CheckSquare,
  Square,
  Calendar,
} from "lucide-react";

/**
 * 어떤 내역이 그 금액을 만들었는지 열어 보고, 뺄 것을 빼는 화면.
 *
 * "실적 반영 3,482,000원"은 합계일 뿐이라, 무엇이 들어갔는지 알 수 없습니다.
 * 한 번 들어온 상여금이나 이사 비용처럼 **다음 달에는 없을 돈**이 섞여 있으면
 * 그 합계로 세운 예산은 처음부터 틀립니다. 그래서 줄 단위로 보여 주고 체크로
 * 빼게 합니다.
 *
 * **제외한 항목은 기억합니다.** 예전에는 합계만 남겼는데, 그러면 다시 열 때
 * 전부 선택된 상태로 보여 저장된 값과 목록의 합계가 다른 이유를 알 수 없었습니다
 * — 8월 수입 칸의 3,052,140원(급여 2건)과 목록의 8,314,074원(17건)이 그것입니다.
 * 이제 `budget_configs` 에 제외한 id 를 함께 저장해(v16) 다시 열면 그 상태로
 * 시작합니다. 거래 내역 자체는 여전히 아무것도 바뀌지 않습니다.
 */
export const ActualsPickerModal: React.FC<{
  isOpen: boolean;
  /** 수입·고정비·저축 중 어느 칸을 고르는지. */
  kind: ActualKind;
  /** 어느 달의 내역인지 (YYYY-MM). */
  month: string;
  /** 지난번에 빼 둔 거래의 id — 그 상태로 다시 엽니다. */
  excludedIds?: string[];
  onClose: () => void;
  onApply: (total: number, counted: number, excludedIds: string[]) => void;
}> = ({ isOpen, kind, month, excludedIds, onClose, onApply }) => {
  const { allTransactions, accounts } = useFinance();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  /*
    목록의 정의는 `services/actuals.ts` 하나에서 옵니다. 예전에는 이 화면이
    직접 걸렀는데, 그래서 `저축` 을 고르면 **고정비 목록**이 나왔고(저축 분기가
    없었습니다) 고정비 목록에는 요약에서 빠지는 저축이 섞여 있었습니다.
  */
  const rows: Transaction[] = useMemo(
    () =>
      actualRows(allTransactions, { month, kind, accounts })
        .slice()
        .sort((a: Transaction, b: Transaction) => b.amount - a.amount),
    [allTransactions, accounts, month, kind]
  );

  useEffect(() => {
    if (!isOpen) return;
    setExcluded(new Set(excludedIds || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, month, kind]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const kept = rows.filter((tx) => !excluded.has(tx.id));
  const { total, full, excludedCount } = sumActuals(rows, Array.from(excluded));
  const allChosen = excludedCount === 0;

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const label = kind === "INCOME" ? "수입" : kind === "FIXED" ? "고정비" : "저축";
  const monthName = `${Number(month.slice(5, 7)) || ""}월`;

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
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                kind === "INCOME"
                  ? "bg-emerald-50 text-emerald-600"
                  : kind === "FIXED"
                    ? "bg-indigo-50 text-indigo-600"
                    : "bg-rose-50 text-rose-500"
              }`}
            >
              {kind === "INCOME" ? (
                <DollarSign className="w-4 h-4" />
              ) : kind === "FIXED" ? (
                <Lock className="w-4 h-4" />
              ) : (
                <PiggyBank className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">
                {monthName} {label} 내역 {rows.length}건
              </h3>
              <p className="text-[10px] text-slate-400">
                뺄 항목의 체크를 풀고 [선택한 금액 적용]을 누르세요
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

        {rows.length === 0 ? (
          <div className="py-8 text-center space-y-1.5">
            <Calendar className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs font-bold text-slate-500">
              {monthName}에 기록된 {label} 내역이 없습니다
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {kind === "FIXED"
                ? "고정비 판정은 서로 다른 3개월 이상 반복될 때 붙습니다. 계좌·카드 내역에서 [AI 자동 분류]를 먼저 돌려보세요."
                : kind === "SAVINGS"
                  ? "계좌에서 [저축] 카테고리로 나간 내역만 셉니다. 적금·예금·청약이 다른 카테고리로 되어 있으면 먼저 [저축]으로 바꿔주세요."
                  : "계좌 내역을 먼저 가져오면 이 목록이 채워집니다."}
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                setExcluded(allChosen ? new Set(rows.map((tx) => tx.id)) : new Set())
              }
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70 text-[11px] font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                {allChosen ? (
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-400" />
                )}
                전체 선택
              </span>
              <span className="text-slate-400">
                {kept.length}/{rows.length}건
              </span>
            </button>

            <div className="space-y-1.5">
              {rows.map((tx) => {
                const chosen = !excluded.has(tx.id);
                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => toggle(tx.id)}
                    className={`w-full text-left p-2.5 rounded-xl border transition flex items-center gap-2.5 cursor-pointer ${
                      chosen
                        ? "bg-white border-slate-200"
                        : "bg-slate-50 border-slate-200/60 opacity-60"
                    }`}
                  >
                    {chosen ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-300 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs font-bold truncate ${
                          chosen ? "text-slate-900" : "text-slate-400 line-through"
                        }`}
                      >
                        {tx.merchant}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {tx.date.slice(5).replace("-", "/")} · {tx.category}
                        {tx.note ? ` · ${tx.note}` : ""}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-black shrink-0 ${
                        chosen ? "text-slate-800" : "text-slate-400 line-through"
                      }`}
                    >
                      {won(tx.amount)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-100">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-800">선택한 금액</span>
                <span className="text-sm font-black text-emerald-900">{won(total)}</span>
              </div>
              {excludedCount > 0 && (
                <p className="text-[10px] text-emerald-700 mt-0.5">
                  {excludedCount}건 제외 · 전체는 {won(full)}이었습니다
                </p>
              )}
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              거래 내역 자체는 바뀌지 않습니다. 여기서 정한 금액이 예산 화면의{" "}
              {label} 칸에만 들어갑니다. <strong>뺀 항목은 기억해 두므로</strong> 다시
              열면 이 상태로 시작합니다.
            </p>
          </>
        )}

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
            disabled={rows.length === 0}
            onClick={() => {
              /*
                무엇을 뺐는지 함께 넘깁니다 — 합계만 넘기면 다시 열 때 전부
                선택된 상태가 되어, 저장된 값과 목록이 다른 이유를 알 수 없습니다.
              */
              onApply(total, kept.length, Array.from(excluded));
              onClose();
            }}
            className="py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer disabled:opacity-40"
          >
            선택한 금액 적용
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
