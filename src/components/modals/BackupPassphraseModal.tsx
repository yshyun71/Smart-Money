import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { passphraseAdvice } from "../../services/backupCrypto";
import { Lock, Unlock, X, Eye, EyeOff, AlertTriangle } from "lucide-react";

/**
 * Asks for the passphrase a backup is locked with, on the way out or in.
 *
 * Nothing is enforced about what it may contain — no length, no mixture, no
 * forbidden patterns. Those rules tend to produce the shortest thing that
 * satisfies them, and this app cannot know what a person will remember. It
 * says what a short one costs an attacker and leaves the choice alone.
 */
export const BackupPassphraseModal: React.FC<{
  isOpen: boolean;
  mode: "LOCK" | "UNLOCK";
  /** Shown while the key is being stretched, which takes a moment. */
  isBusy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (passphrase: string) => void;
}> = ({ isOpen, mode, isBusy = false, error = null, onClose, onSubmit }) => {
  const [value, setValue] = useState("");
  const [again, setAgain] = useState("");
  const [visible, setVisible] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setValue("");
    setAgain("");
    setVisible(false);
    setMismatch(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const locking = mode === "LOCK";
  const advice = passphraseAdvice(value);
  const adviceTone =
    advice.level === "WEAK"
      ? "text-amber-600"
      : advice.level === "STRONG"
        ? "text-emerald-600"
        : "text-slate-400";

  // 잠글 때만 두 번 받습니다 — 오타 하나로 열 수 없는 파일이 만들어집니다
  const ready = locking ? value !== "" && again !== "" : value !== "";

  const submit = () => {
    if (!ready || isBusy) return;
    if (locking && value !== again) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    onSubmit(value);
  };

  const content = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              {locking ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">
                {locking ? "백업 파일 암호 설정" : "백업 파일 암호 입력"}
              </h3>
              <p className="text-[10px] text-slate-400">
                {locking
                  ? "이 암호를 아는 사람만 파일을 열 수 있습니다"
                  : "이 파일을 만들 때 정한 암호를 입력하세요"}
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

        <div className="space-y-2.5">
          <div className="relative">
            <input
              autoFocus
              type={visible ? "text" : "password"}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setMismatch(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !locking) submit();
              }}
              placeholder="원하는 암호를 자유롭게 입력하세요"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 pr-11 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
            />
            <button
              type="button"
              onClick={() => setVisible((prev) => !prev)}
              aria-label={visible ? "암호 가리기" : "암호 보기"}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {locking && (
            <input
              type={visible ? "text" : "password"}
              value={again}
              onChange={(e) => {
                setAgain(e.target.value);
                setMismatch(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="한 번 더 입력"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
            />
          )}

          {locking && (
            <p className={`text-[10px] leading-relaxed ${adviceTone}`}>{advice.text}</p>
          )}

          {mismatch && (
            <p className="text-[11px] font-bold text-rose-600">
              두 번 입력한 암호가 다릅니다.
            </p>
          )}
          {error && <p className="text-[11px] font-bold text-rose-600">{error}</p>}
        </div>

        {locking && (
          /*
            서버가 없으니 잊은 암호를 되찾아 줄 곳이 없습니다. 이 화면에서
            가장 중요한 한 줄입니다.
          */
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <div className="leading-relaxed">
              <strong>암호를 잊으면 이 백업은 누구도 열 수 없습니다.</strong> 이 앱에는
              서버가 없어 되돌려 드릴 방법이 없습니다. 길이·형식에 제한은 없으니
              기억할 수 있는 문장으로 정하고, 따로 적어 두세요.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            disabled={!ready || isBusy}
            onClick={submit}
            className="py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer disabled:opacity-40"
          >
            {isBusy ? "처리 중..." : locking ? "암호화해 내려받기" : "복원하기"}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
