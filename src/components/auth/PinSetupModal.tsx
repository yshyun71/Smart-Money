import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import { KeyRound, X, CheckCircle } from "lucide-react";

export const PinSetupModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { hasPin, setPinCode } = useAuth();

  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Close on Escape key and lock body scroll while open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Reset the form whenever the modal is reopened
  useEffect(() => {
    if (isOpen) {
      setNewPin("");
      setConfirmPin("");
      setSavedMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSavePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      alert("6자리 숫자로만 입력해주세요.");
      return;
    }
    if (newPin !== confirmPin) {
      alert("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setPinCode(newPin);
    setSavedMsg("간편 비밀번호가 성공적으로 변경되었습니다.");
    setNewPin("");
    setConfirmPin("");
    setTimeout(() => {
      setSavedMsg(null);
      onClose();
    }, 1800);
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {hasPin ? "간편 비밀번호 변경" : "간편 비밀번호 등록"}
              </h3>
              <p className="text-[10px] text-slate-400">
                빠른 잠금 해제에 사용할 6자리 숫자 비밀번호
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-11 h-11 flex items-center justify-center -mr-2 -mt-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition touch-manipulation cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success feedback */}
        {savedMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{savedMsg}</span>
          </div>
        )}

        <form onSubmit={handleSavePin} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="text-xs font-bold text-slate-900">새 6자리 PIN 설정</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">
                새 비밀번호 (6자리)
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="••••••"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">
                비밀번호 확인
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="••••••"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-mono"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition cursor-pointer"
          >
            비밀번호 저장
          </button>
        </form>

        {/* Bottom Close Button for Mobile Convenience */}
        <div className="pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition active:scale-98 touch-manipulation cursor-pointer flex items-center justify-center"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
