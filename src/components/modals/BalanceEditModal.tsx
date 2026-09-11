import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import {
  asOfFromParts,
  asOfLabel,
  asOfParts,
  formatAmountInput,
  parseAmountInput,
  won,
} from "../../utils/format";
import { X, Save, Wallet, UserCheck, Calculator } from "lucide-react";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));

/**
 * A balance is only meaningful together with the moment it was true, so this
 * form always captures both, and marks whether the figure came from the user
 * or was worked out from the entries on the account.
 */
export const BalanceEditModal: React.FC<{
  isOpen: boolean;
  accountId: string;
  onClose: () => void;
}> = ({ isOpen, accountId, onClose }) => {
  const { accounts, setAccountBalance } = useFinance();

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("00");

  const account = accounts.find((a: { id: string }) => a.id === accountId);

  useEffect(() => {
    if (!isOpen || !account) return;
    setAmount(formatAmountInput(String(account.balanceOrBilled ?? 0)));
    const parts = asOfParts(account.balanceAsOf);
    setDate(parts.date);
    setHour(parts.hour);
  }, [isOpen, account?.id, account?.balanceOrBilled, account?.balanceAsOf]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !account) return null;

  const isBank = account.type === "BANK";
  const label = isBank ? "계좌 잔액" : "청구 예정액";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAccountBalance(account.id, parseAmountInput(amount), asOfFromParts(date, hour), "USER");
    onClose();
  };

  const setNow = () => {
    const parts = asOfParts(new Date().toISOString());
    setDate(parts.date);
    setHour(parts.hour);
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Wallet className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">{label} 수정</span>
            </h3>
            <p className="text-[10px] text-slate-400 truncate">
              {account.institution} · {account.name}
            </p>
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

        {/* What is recorded now */}
        <div className="mt-3.5 p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">현재 등록된 {label}</span>
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${
                account.balanceSource === "AUTO"
                  ? "bg-indigo-100 text-indigo-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {account.balanceSource === "AUTO" ? (
                <Calculator className="w-2.5 h-2.5" />
              ) : (
                <UserCheck className="w-2.5 h-2.5" />
              )}
              {account.balanceSource === "AUTO" ? "자동 산출" : "사용자 입력"}
            </span>
          </div>
          <div className="text-sm font-black text-slate-900">
            {won(account.balanceOrBilled)}
          </div>
          <div className="text-[10px] text-slate-400">
            기준 {asOfLabel(account.balanceAsOf)}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-3.5 space-y-3.5">
          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {label} (원)
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(formatAmountInput(e.target.value))}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-base font-bold text-slate-900 focus:border-emerald-500 focus:outline-hidden pr-8"
              />
              <span className="absolute right-3.5 top-3 text-xs font-semibold text-slate-400">
                원
              </span>
            </div>
          </div>

          {/* As-of */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                기준 일시
              </label>
              <button
                type="button"
                onClick={setNow}
                className="text-[10px] font-bold text-emerald-700 hover:text-emerald-800 cursor-pointer"
              >
                지금으로
              </button>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-900 bg-white focus:border-emerald-500 focus:outline-hidden"
              />
              <div className="flex items-center gap-1">
                <select
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
                  className="rounded-xl border border-slate-200 px-2.5 py-2.5 text-xs text-slate-900 bg-white focus:border-emerald-500 focus:outline-hidden"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-semibold text-slate-500">시</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              저장하면 <strong>{asOfLabel(asOfFromParts(date, hour))}</strong> 기준 금액으로
              기록되고, 등록 구분은 <strong>사용자 입력</strong>이 됩니다.
            </p>
          </div>

          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 text-xs shadow-md shadow-emerald-600/20 active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>저장</span>
          </button>
        </form>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
