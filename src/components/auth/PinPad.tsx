import React, { useCallback, useEffect, useState } from "react";
import { Delete, Loader2 } from "lucide-react";

const PIN_LENGTH = 6;

interface PinPadProps {
  title: string;
  description?: string;
  /** Message shown under the dots — clears as soon as the user types again. */
  error?: string | null;
  isBusy?: boolean;
  /**
   * Fires once six digits are in. Return false to reject the entry: the dots
   * shake and clear so the user can try again.
   */
  onComplete: (pin: string) => boolean | void | Promise<boolean | void>;
}

/**
 * Six-digit entry with a numeric keypad.
 *
 * Replaces the pair of password fields the PIN used to be typed into: on a
 * phone those brought up the full keyboard, needed two taps to move between
 * them, and gave no indication of progress. Here every digit is one large
 * target, the dots show how far along the entry is, and it submits itself on
 * the sixth digit. A physical keyboard works too, for the desktop preview.
 */
export const PinPad: React.FC<PinPadProps> = ({
  title,
  description,
  error,
  isBusy = false,
  onComplete,
}) => {
  const [digits, setDigits] = useState("");
  const [isRejected, setIsRejected] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const shownError = localError ?? error ?? null;

  const submit = useCallback(
    async (pin: string) => {
      const accepted = await onComplete(pin);
      if (accepted === false) {
        setIsRejected(true);
        setTimeout(() => {
          setDigits("");
          setIsRejected(false);
        }, 320);
      } else {
        setDigits("");
      }
    },
    [onComplete]
  );

  const append = useCallback(
    (digit: string) => {
      if (isBusy || isRejected) return;
      setLocalError(null);
      setDigits((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;
        if (next.length === PIN_LENGTH) void submit(next);
        return next;
      });
    },
    [isBusy, isRejected, submit]
  );

  const backspace = useCallback(() => {
    if (isBusy) return;
    setLocalError(null);
    setDigits((prev) => prev.slice(0, -1));
  }, [isBusy]);

  const clearAll = useCallback(() => {
    if (isBusy) return;
    setLocalError(null);
    setDigits("");
  }, [isBusy]);

  // Physical keyboard, for the desktop preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        append(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (e.key === "Escape") {
        clearAll();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [append, backspace, clearAll]);

  const keyClass =
    "h-14 rounded-2xl bg-slate-50 hover:bg-slate-100 active:bg-slate-200 active:scale-95 text-xl font-black text-slate-800 transition flex items-center justify-center shadow-2xs disabled:opacity-40 touch-manipulation";

  return (
    <div className="space-y-3">
      <div className="text-center space-y-1">
        <div className="text-sm font-bold text-slate-900">{title}</div>
        {description && (
          <p className="text-[11px] text-slate-500 leading-relaxed">{description}</p>
        )}
      </div>

      {/* Progress dots */}
      <div
        className={`flex justify-center items-center gap-3.5 py-3 ${
          isRejected ? "animate-shake" : ""
        }`}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, index) => {
          const isFilled = digits.length > index;
          return (
            <div
              key={index}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                isRejected
                  ? "bg-rose-500"
                  : isFilled
                  ? "bg-slate-900 scale-110"
                  : "border-2 border-slate-300 bg-transparent"
              }`}
            />
          );
        })}
      </div>

      {/* Status line — reserves its own space so the keypad never jumps */}
      <div className="min-h-[34px]">
        {isBusy ? (
          <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>확인 중...</span>
          </div>
        ) : shownError ? (
          <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold text-center">
            {shownError}
          </div>
        ) : null}
      </div>

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto w-full">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
          <button
            type="button"
            key={num}
            onClick={() => append(num)}
            disabled={isBusy}
            className={keyClass}
          >
            {num}
          </button>
        ))}

        <button
          type="button"
          onClick={clearAll}
          disabled={isBusy || digits.length === 0}
          className="h-14 rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-95 text-[11px] font-bold text-slate-500 transition flex items-center justify-center shadow-2xs disabled:opacity-40 touch-manipulation"
        >
          전체 삭제
        </button>

        <button
          type="button"
          onClick={() => append("0")}
          disabled={isBusy}
          className={keyClass}
        >
          0
        </button>

        <button
          type="button"
          onClick={backspace}
          disabled={isBusy || digits.length === 0}
          aria-label="한 자리 지우기"
          className="h-14 rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-95 text-slate-600 transition flex items-center justify-center shadow-2xs disabled:opacity-40 touch-manipulation"
        >
          <Delete className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
