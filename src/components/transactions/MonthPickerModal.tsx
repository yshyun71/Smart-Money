import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

const pad = (value: number) => String(value).padStart(2, "0");

function thisMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/**
 * Picking a month outright, for when stepping one at a time is the long way
 * round — a statement from last spring is nine taps away otherwise.
 *
 * Months carry the number of entries recorded in them, so the year shows at a
 * glance where the ledger actually has something.
 */
export const MonthPickerModal: React.FC<{
  isOpen: boolean;
  /** The month on screen, as YYYY-MM. */
  value: string;
  /** How many entries each month holds, keyed the same way. */
  counts: Map<string, number>;
  onSelect: (month: string) => void;
  onClose: () => void;
}> = ({ isOpen, value, counts, onSelect, onClose }) => {
  const [year, setYear] = useState(() => Number(value.slice(0, 4)) || new Date().getFullYear());

  // Open on the year being viewed, however the month was last changed
  useEffect(() => {
    if (!isOpen) return;
    setYear(Number(value.slice(0, 4)) || new Date().getFullYear());
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const current = thisMonthKey();

  /** Years that hold something, so the arrows have somewhere to go. */
  const recorded: string[] = Array.from(counts.keys() as Iterable<string>).sort();
  const oldest = recorded[0]?.slice(0, 4);
  const newest = recorded[recorded.length - 1]?.slice(0, 4);

  const modalContent = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3.5 animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>조회할 연월 선택</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-11 h-11 flex items-center justify-center -mr-2 -mt-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Year */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setYear((prev) => prev - 1)}
            aria-label="이전 해"
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 transition cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <div className="text-sm font-black text-slate-900">{year}년</div>
            {oldest && newest && (
              <div className="text-[9px] text-slate-400">
                기록 {oldest}년 ~ {newest}년
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setYear((prev) => prev + 1)}
            aria-label="다음 해"
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 transition cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Months */}
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 12 }, (_, index) => {
            const key = `${year}-${pad(index + 1)}`;
            const count = counts.get(key) || 0;
            const isSelected = key === value;
            const isCurrent = key === current;

            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onSelect(key);
                  onClose();
                }}
                className={`py-2 rounded-xl border text-center transition cursor-pointer ${
                  isSelected
                    ? "bg-emerald-600 border-emerald-600 text-white"
                    : count > 0
                    ? "bg-white border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40"
                    : "bg-slate-50 border-slate-100 hover:border-slate-300"
                }`}
              >
                <div
                  className={`text-[11px] font-bold ${
                    isSelected
                      ? "text-white"
                      : count > 0
                      ? "text-slate-800"
                      : "text-slate-400"
                  }`}
                >
                  {index + 1}월
                  {isCurrent && !isSelected && (
                    <span className="text-[8px] text-emerald-600 ml-0.5">•</span>
                  )}
                </div>
                <div
                  className={`text-[9px] ${
                    isSelected
                      ? "text-emerald-100"
                      : count > 0
                      ? "text-slate-400"
                      : "text-slate-300"
                  }`}
                >
                  {count}건
                </div>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            onSelect(current);
            onClose();
          }}
          className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition cursor-pointer"
        >
          이번 달로
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
