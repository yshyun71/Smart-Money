import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth, type UserSummary } from "../../context/AuthContext";
import { PinPad } from "./PinPad";
import { KeyRound, X, CheckCircle } from "lucide-react";

type Step = "CURRENT" | "NEW" | "CONFIRM" | "DONE";

/**
 * Setting a PIN, for the signed-in user or for someone else on the device.
 *
 * Either way the signed-in user's PIN is asked for first — the stored hash
 * cannot be read back, so it has to be re-derived and checked, and when the
 * target is another user that check is what authorises the change. They are
 * not here to agree to it, exactly as with deleting them.
 */
export const PinSetupModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Whose PIN to set. Omitted means the signed-in user's own. */
  target?: UserSummary | null;
}> = ({ isOpen, onClose, target = null }) => {
  const { resetPin, currentUserId, isBusy, authError, clearAuthError } = useAuth();

  const targetId = target?.id ?? currentUserId;
  const isSelf = !target || target.id === currentUserId;

  const [step, setStep] = useState<Step>("CURRENT");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [mismatchError, setMismatchError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setStep("CURRENT");
    setCurrentPin("");
    setNewPin("");
    setMismatchError(null);
    clearAuthError();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape is used by the pad to clear its entry, so only close on it
      // once nothing is being typed.
      if (e.key === "Escape") onClose();
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const who = isSelf ? "" : `${target?.name} 님의 `;

  const headings: Record<Step, { title: string; sub: string }> = {
    CURRENT: isSelf
      ? { title: "현재 비밀번호 확인", sub: "본인 확인을 위해 먼저 입력해주세요" }
      : { title: "내 비밀번호 확인", sub: `${target?.name} 님의 비밀번호를 바꾸려면 필요합니다` },
    NEW: { title: `${who}새 비밀번호 설정`, sub: "사용할 6자리 숫자를 입력하세요" },
    CONFIRM: { title: "새 비밀번호 확인", sub: "한 번 더 입력해주세요" },
    DONE: { title: "변경 완료", sub: "새 비밀번호가 저장되었습니다" },
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
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
                {headings[step].title}
              </h3>
              <p className="text-[10px] text-slate-400">{headings[step].sub}</p>
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

        {step === "DONE" ? (
          <div className="py-6 flex flex-col items-center gap-2 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
            <div className="text-sm font-bold text-slate-900">
              {who}간편 비밀번호가 변경되었습니다
            </div>
            <p className="text-[11px] text-slate-500">
              {isSelf
                ? "다음 잠금 해제부터 새 비밀번호를 사용하세요."
                : `${target?.name} 님은 다음 로그인부터 새 비밀번호를 사용합니다.`}
            </p>
          </div>
        ) : (
          <>
            {/* Step indicator */}
            <div className="flex items-center justify-center gap-1.5">
              {(["CURRENT", "NEW", "CONFIRM"] as Step[]).map((s, index) => (
                <span
                  key={s}
                  className={`h-1 rounded-full transition-all ${
                    step === s
                      ? "w-6 bg-indigo-500"
                      : index < ["CURRENT", "NEW", "CONFIRM"].indexOf(step)
                      ? "w-3 bg-indigo-300"
                      : "w-3 bg-slate-200"
                  }`}
                />
              ))}
            </div>

            {step === "CURRENT" && (
              <PinPad
                title={isSelf ? "현재 6자리 비밀번호" : "내 6자리 비밀번호"}
                error={authError}
                isBusy={isBusy}
                onComplete={(pin) => {
                  // Verified together with the new PIN in the final step, so a
                  // wrong current PIN surfaces there rather than costing an
                  // extra key derivation here.
                  setCurrentPin(pin);
                  clearAuthError();
                  setStep("NEW");
                }}
              />
            )}

            {step === "NEW" && (
              <PinPad
                title="새 6자리 비밀번호"
                description={isSelf ? "현재 비밀번호와 달라야 합니다." : undefined}
                error={mismatchError}
                onComplete={(pin) => {
                  // 남의 비밀번호를 정할 때 내 비밀번호와 같은지는 따질 일이 아닙니다
                  if (isSelf && pin === currentPin) {
                    setMismatchError("현재 사용 중인 비밀번호와 같습니다.");
                    return false;
                  }
                  setNewPin(pin);
                  setMismatchError(null);
                  setStep("CONFIRM");
                }}
              />
            )}

            {step === "CONFIRM" && (
              <PinPad
                title="새 비밀번호를 다시 입력"
                error={authError}
                isBusy={isBusy}
                onComplete={async (pin) => {
                  if (pin !== newPin) {
                    setMismatchError("새 비밀번호가 일치하지 않습니다. 다시 설정해주세요.");
                    setNewPin("");
                    setStep("NEW");
                    return false;
                  }
                  const ok = targetId
                    ? await resetPin(targetId, pin, currentPin)
                    : false;
                  if (!ok) {
                    // A wrong authorising PIN lands here — start over.
                    setCurrentPin("");
                    setNewPin("");
                    setStep("CURRENT");
                    return false;
                  }
                  setStep("DONE");
                  setTimeout(onClose, 1600);
                }}
              />
            )}
          </>
        )}

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
