import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import type { ConnectedAccount } from "../../types/finance";
import { accountTone } from "../../utils/accountTone";
import { X, Save, Building, CreditCard } from "lucide-react";

type Kind = ConnectedAccount["type"];

/**
 * Correcting what was typed in when a card or account was registered.
 *
 * The kind can be changed too: registering a card as an account is easy to do
 * and expensive to undo otherwise, since deleting the account would take its
 * entries with it.
 */
export const AccountEditModal: React.FC<{
  isOpen: boolean;
  accountId: string;
  onClose: () => void;
}> = ({ isOpen, accountId, onClose }) => {
  const { accounts, updateAccountDetails } = useFinance();

  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [kind, setKind] = useState<Kind>("BANK");
  const [payMode, setPayMode] = useState<"REGISTERED" | "MANUAL">("REGISTERED");
  const [payAccountId, setPayAccountId] = useState("");
  const [payLabel, setPayLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a: { id: string }) => a.id === accountId);

  useEffect(() => {
    if (!isOpen || !account) return;
    setName(account.name || "");
    setInstitution(account.institution || "");
    setIdentifier(account.identifier || "");
    setKind(account.type === "BANK" ? "BANK" : "CARD");
    setPayAccountId(account.paymentAccountId || "");
    setPayLabel(account.paymentAccountLabel || "");
    setPayMode(account.paymentAccountLabel && !account.paymentAccountId ? "MANUAL" : "REGISTERED");
    setError(null);
  }, [isOpen, account?.id, account?.name, account?.institution, account?.identifier]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !account) return null;

  const isBank = kind === "BANK";
  const kindChanged = (account.type === "BANK") !== isBank;

  /** A card is paid from an account, never from another card. */
  const bankChoices = accounts.filter(
    (a: { id: string; type: string }) => a.type === "BANK" && a.id !== account.id
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!institution.trim()) {
      setError("금융기관 또는 카드사 이름을 입력해주세요.");
      return;
    }

    try {
      updateAccountDetails(account.id, {
        name: name.trim() || `${institution.trim()} ${isBank ? "계좌" : "카드"}`,
        institution: institution.trim(),
        identifier: identifier.trim() || (isBank ? "xxxx-xx-xxxx" : "xxxx-xxxx"),
        type: kind,
        // A bill belongs to a card; an account does not have one
        paymentAccountId: isBank || payMode === "MANUAL" ? undefined : payAccountId || undefined,
        paymentAccountLabel:
          isBank || payMode === "REGISTERED" ? undefined : payLabel.trim() || undefined,
      });
      onClose();
    } catch {
      setError("수정하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
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
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 ${
                accountTone(kind).bg
              }`}
            >
              {isBank ? <Building className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">
                {isBank ? "계좌 정보 수정" : "카드 정보 수정"}
              </h3>
              <p className="text-[10px] text-slate-400 truncate">
                등록된 내역은 그대로 유지됩니다
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

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          {/* Kind */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">구분</label>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setKind("BANK")}
                className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                  isBank ? "bg-indigo-600 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Building className="w-3.5 h-3.5" />
                <span>통장 계좌</span>
              </button>
              <button
                type="button"
                onClick={() => setKind("CARD")}
                className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                  !isBank ? "bg-amber-500 text-white shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>신용·체크카드</span>
              </button>
            </div>
            {kindChanged && (
              <p className="text-[10px] text-amber-700 mt-1 leading-relaxed">
                구분을 바꾸면 잔액·청구액을 읽는 방식이 달라집니다. 이미 기록된 금액은 그대로
                남으니 필요하면 다시 확인해주세요.
              </p>
            )}
          </div>

          {/* Institution */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {isBank ? "금융기관" : "카드사"}
            </label>
            <input
              type="text"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder={isBank ? "예: KB국민은행" : "예: KB국민카드"}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              표시 이름
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isBank ? "예: KB국민은행 입출금" : "예: KB국민카드 (청춘대로)"}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          {/* Identifier */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {isBank ? "계좌 번호 (식별용)" : "카드 번호 (식별용)"}
            </label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={isBank ? "예: 3333-01-xxxx" : "예: 뒷자리 6097"}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden font-mono"
            />
          </div>


          {/* Where the bill is taken from, which is how a withdrawal finds it */}
          {!isBank && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                결제 계좌
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl mb-2">
                <button
                  type="button"
                  onClick={() => setPayMode("REGISTERED")}
                  className={`py-2 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                    payMode === "REGISTERED"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  등록된 계좌
                </button>
                <button
                  type="button"
                  onClick={() => setPayMode("MANUAL")}
                  className={`py-2 text-[11px] font-bold rounded-lg transition cursor-pointer ${
                    payMode === "MANUAL"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  직접 입력
                </button>
              </div>

              {payMode === "REGISTERED" ? (
                <select
                  value={payAccountId}
                  onChange={(e) => setPayAccountId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden bg-white"
                >
                  <option value="">선택 안 함</option>
                  {bankChoices.map((acc: { id: string; name: string; institution: string }) => (
                    <option key={acc.id} value={acc.id}>
                      [{acc.institution}] {acc.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={payLabel}
                  onChange={(e) => setPayLabel(e.target.value)}
                  placeholder="예: KB국민은행 357210-13-7155"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
                />
              )}

              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                {payMode === "REGISTERED"
                  ? "등록된 계좌를 지정하면, 명세서를 가져올 때 그 계좌의 카드대금 출금과 결제월이 자동으로 연결됩니다."
                  : "등록하지 않은 계좌는 이름만 남습니다. 출금 내역과 자동으로 연결되지는 않습니다."}
              </p>
            </div>
          )}

          {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-2 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 active:scale-98 transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>수정 내용 저장</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
