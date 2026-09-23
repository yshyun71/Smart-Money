import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import {
  buildReportCard,
  savingsRate,
  changeRatio,
  type ReportScope,
} from "../../services/reportCard";
import { won } from "../../utils/format";
import { X, Printer, CalendarRange, CalendarDays, RotateCcw } from "lucide-react";

/**
 * 한 장으로 보는 결산 — 달과 해 (§12.14).
 *
 * 숫자는 이미 화면 여섯 곳에 흩어져 있었습니다. 이 창은 **새로 계산하지 않고**
 * `services/reportCard.ts` 가 만든 한 벌을 늘어놓기만 합니다(§17.5).
 *
 * **달과 해가 같은 틀입니다.** 달을 보다가 `이 해`를 누르면 같은 자리에 같은
 * 항목이 한 해치로 바뀝니다 — 두 화면을 만들면 같은 산식이 두 벌이 되고, 그때
 * 사용자는 어느 숫자가 맞는지 알 수 없습니다.
 */
export const ReportCardModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** 열 때 볼 달(`YYYY-MM`). 범위 토글은 여기서 해를 뽑아 씁니다. */
  month: string;
  /** 열 때의 범위. 소비분석의 모드를 그대로 이어받습니다. */
  scope?: ReportScope;
}> = ({ isOpen, onClose, month, scope = "MONTH" }) => {
  const { spendingTransactions, accounts } = useFinance();
  const [view, setView] = useState<ReportScope>(scope);

  /*
    **연 것은 `prop` 이 바뀔 때만 따릅니다**(§14.7). 열려 있는 동안 사용자가 고른
    범위를 부모의 모드가 빼앗으면, 눌러도 되돌아가는 버튼이 됩니다.
  */
  useEffect(() => {
    if (!isOpen) return;
    setView(scope);
  }, [isOpen, scope]);

  const key = view === "YEAR" ? month.slice(0, 4) : month;

  const card = useMemo(
    () => buildReportCard({ transactions: spendingTransactions, accounts, key }),
    [spendingTransactions, accounts, key]
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
  if (typeof document === "undefined") return null;

  /*
    인쇄 — 브라우저 대화상자의 `PDF 로 저장`이 곧 이미지·PDF 저장입니다.
    끝나면 반드시 표시를 떼야 합니다. 남으면 다음 인쇄에서 엉뚱한 것이 감춰집니다.
  */
  const print = () => {
    document.body.classList.add("printing-report");
    const done = () => {
      document.body.classList.remove("printing-report");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    window.print();
    /* `afterprint` 를 주지 않는 브라우저가 있어 한 번 더 치웁니다 */
    setTimeout(done, 1000);
  };

  const rate = savingsRate(card.now);
  const expenseRatio = card.before ? changeRatio(card.now.expense, card.before.expense) : null;

  /* 막대의 기준 — 고정·변동·저축이 총지출을 나눠 갖습니다 */
  const wedge = (value: number) =>
    card.now.expense > 0 ? `${(value / card.now.expense) * 100}%` : "0%";

  const peakExpense = card.months.reduce((worst, item) => Math.max(worst, item.expense), 0);

  const content = (
    <div
      id="report-print"
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="report-sheet w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 제목 */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-xs px-5 pt-5 pb-3 border-b border-slate-100 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-black text-slate-900">{card.label} 결산</h3>
            <p className="text-[10px] text-slate-400">
              내역 {card.now.count.toLocaleString()}건 · 내 계좌 사이 이체는 세지 않았습니다
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0 no-print">
            <button
              type="button"
              onClick={print}
              aria-label="인쇄하거나 PDF 로 저장"
              className="w-10 h-10 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="w-10 h-10 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* 범위 */}
          <div className="flex items-center gap-1.5 no-print">
            {(
              [
                { value: "MONTH" as ReportScope, label: "이 달", Icon: CalendarDays },
                { value: "YEAR" as ReportScope, label: "이 해", Icon: CalendarRange },
              ]
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold transition cursor-pointer ${
                  view === value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>

          {/* 큰 수 셋 */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "수입", value: card.now.income, tone: "text-emerald-600" },
              { label: "지출", value: card.now.expense, tone: "text-rose-600" },
              {
                label: "남은 돈",
                value: card.now.left,
                tone: card.now.left >= 0 ? "text-slate-900" : "text-rose-600",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/60 min-w-0"
              >
                <span className="text-[10px] font-bold text-slate-400 block">{item.label}</span>
                <span className={`text-sm font-black ${item.tone} block truncate`}>
                  {won(item.value)}
                </span>
              </div>
            ))}
          </div>

          {/*
            앞 기간과의 차이. **없으면 적지 않습니다** — 견줄 것이 없는데 `0원`
            이라고 쓰면 "같았다"는 거짓이 됩니다(§17.1).
          */}
          {card.before && card.change && (
            <div className="p-3 rounded-2xl bg-white border border-slate-200 space-y-1.5">
              <span className="text-[11px] font-bold text-slate-700">
                {card.before.label}과 견주면
              </span>
              {[
                { label: "지출", value: card.change.expense, ratio: expenseRatio },
                { label: "수입", value: card.change.income, ratio: null },
                { label: "고정비", value: card.change.fixed, ratio: null },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">{row.label}</span>
                  <span
                    className={`text-[11px] font-bold ${
                      row.value === 0
                        ? "text-slate-400"
                        : row.value > 0
                          ? "text-rose-600"
                          : "text-emerald-600"
                    }`}
                  >
                    {row.value > 0 ? "+" : ""}
                    {won(row.value)}
                    {row.ratio === null
                      ? ""
                      : ` (${row.ratio > 0 ? "+" : ""}${row.ratio.toFixed(1)}%)`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 지출이 어떻게 갈렸나 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-700">지출의 모양</span>
              <span className="text-[10px] text-slate-400">
                고정 + 변동 + 저축 = {won(card.now.expense)}
              </span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex">
              <div className="bg-indigo-500" style={{ width: wedge(card.now.fixed) }} />
              <div className="bg-amber-400" style={{ width: wedge(card.now.variable) }} />
              <div className="bg-emerald-500" style={{ width: wedge(card.now.savings) }} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "고정비", value: card.now.fixed, dot: "bg-indigo-500" },
                { label: "변동비", value: card.now.variable, dot: "bg-amber-400" },
                { label: "저축", value: card.now.savings, dot: "bg-emerald-500" },
              ].map((item) => (
                <div key={item.label} className="min-w-0">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
                    {item.label}
                  </span>
                  <span className="text-[11px] font-bold text-slate-800 block truncate">
                    {won(item.value)}
                  </span>
                </div>
              ))}
            </div>
            {/* 수입이 0이면 비율을 지어내지 않습니다(§17.1) */}
            <p className="text-[10px] text-slate-400">
              {rate === null
                ? "수입이 없어 남긴 비율은 셈할 수 없습니다."
                : `수입의 ${rate.toFixed(1)}%가 남았습니다. 고정수입 ${won(card.now.incomeFixed)}.`}
            </p>
          </div>

          {/* 무엇에 썼나 */}
          {card.categories.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-slate-700">가장 많이 쓴 곳</span>
              {card.categories.map((item) => (
                <div key={item.category} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-600 truncate">{item.category}</span>
                    <span className="text-[11px] font-bold text-slate-800 shrink-0 whitespace-nowrap">
                      {won(item.amount)}{" "}
                      <span className="text-slate-400 font-medium">
                        {item.percentage.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-slate-400"
                      style={{ width: `${Math.min(100, item.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 한 해를 볼 때의 달별 흐름 */}
          {card.scope === "YEAR" && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-700">달마다 얼마를 썼나</span>
                {card.peak && (
                  <span className="text-[10px] text-slate-400">
                    가장 많은 달 {card.peak.label.slice(6)} {won(card.peak.expense)}
                  </span>
                )}
              </div>
              <div className="flex items-end gap-1 h-24">
                {card.months.map((item) => (
                  <div key={item.key} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={`w-full rounded-t ${
                          item.key === card.peak?.key ? "bg-rose-400" : "bg-slate-300"
                        }`}
                        style={{
                          height:
                            peakExpense > 0 ? `${(item.expense / peakExpense) * 100}%` : "0%",
                        }}
                      />
                    </div>
                    <span className="text-[8px] text-slate-400">{Number(item.key.slice(5))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/*
            환불·취소 (§12.13) — 두 줄이 따로 남아 그 달 지출이 커 보이던 것을
            짝지어 보여 줍니다. **지우거나 합치지 않습니다**(§17.3).
          */}
          {card.refunds.count > 0 && (
            <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200/60 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="text-[11px] font-bold text-emerald-900">
                  되돌아온 돈 {card.refunds.count}건 {won(card.refunds.amount)}
                </span>
              </div>
              {card.refunds.pairs.slice(0, 5).map((pair) => (
                <div
                  key={pair.refund.id}
                  className="flex items-center justify-between gap-2 text-[10px] text-emerald-800"
                >
                  <span className="truncate">
                    {pair.charge.merchant} · {pair.charge.date.slice(5)} 결제
                  </span>
                  <span className="shrink-0 whitespace-nowrap">
                    {pair.days}일 뒤 {won(pair.refund.amount)}
                  </span>
                </div>
              ))}
              <p className="text-[10px] text-emerald-700/80 leading-relaxed">
                이 금액은 위의 지출 합계에서 이미 빠져 있습니다. 두 줄 다 명세서에 있는
                줄이라 지우지 않습니다.
              </p>
            </div>
          )}

          <p className="text-[10px] text-slate-400 leading-relaxed">
            이 장의 기준 — 그 기간에 적힌 모든 내역, 내 계좌 사이 이체 제외(§6.5).
            저축은 계좌에서 나간 것만, 고정비에서는 저축을 뺐습니다(예산 화면과 같은 정의).
          </p>

          <button
            type="button"
            onClick={print}
            className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 no-print"
          >
            <Printer className="w-4 h-4" />
            인쇄 · PDF로 저장
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};
