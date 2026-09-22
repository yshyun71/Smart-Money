import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";

/**
 * 되돌리기 어려운 일을 묻는 창.
 *
 * 예전에는 `window.confirm` 을 썼습니다. 세 가지가 걸립니다 — 앱의 모달과 전혀
 * 다른 OS 대화창이 뜨고, 설치된 PWA 에서는 **주소(origin)까지 노출**되며,
 * 무엇이 함께 사라지는지 줄 바꿈 없이 한 문장으로만 말할 수 있습니다.
 *
 * 그래서 이 창은 **무엇이 사라지는지 항목으로** 보여 줍니다. 사용자 삭제(§5)가
 * 이미 그렇게 하고 있었고, 나머지 자리도 같은 규칙을 씁니다.
 */
export const ConfirmModal: React.FC<{
  isOpen: boolean;
  title: string;
  /** 한 줄 설명. 무엇을 하려는지. */
  message?: string;
  /** 함께 사라지는 것들 — 건수로 말합니다. */
  details?: string[];
  /** 돌이킬 수 없을 때만 켭니다. 색과 문구가 달라집니다. */
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 되돌릴 수 있다면 그 사실을 알려 줍니다 — 결정의 무게가 달라집니다(§4.9). */
  undoable?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}> = ({
  isOpen,
  title,
  message,
  details,
  danger = false,
  confirmLabel = "삭제",
  cancelLabel = "취소",
  undoable = false,
  onConfirm,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      /*
        가장 위입니다. 이 창은 다른 창 위에서 뜨고(계좌 내역·규칙 관리·가져오기),
        그 아래 창들의 Escape 는 §14.4 규칙대로 막혀 있어야 합니다.
      */
      className="fixed inset-0 z-[10002] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3 animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                danger ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-600"
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 leading-snug min-w-0">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-9 h-9 flex items-center justify-center -mr-2 -mt-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {message && (
          <p className="text-[11px] text-slate-600 leading-relaxed">{message}</p>
        )}

        {/* 무엇이 함께 사라지는가 — 한 문장에 밀어 넣지 않습니다 */}
        {details && details.length > 0 && (
          <ul
            className={`rounded-2xl border p-3 space-y-1 text-[11px] ${
              danger
                ? "bg-rose-50/70 border-rose-200/80 text-rose-900"
                : "bg-slate-50 border-slate-200/80 text-slate-700"
            }`}
          >
            {details.map((line) => (
              <li key={line} className="flex items-start gap-1.5">
                <span className="shrink-0">·</span>
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[10px] text-slate-400 leading-relaxed">
          {undoable
            ? "설정 → 기타 설정에서 되돌릴 수 있습니다."
            : "이 작업은 되돌릴 수 없습니다."}
        </p>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`py-3 rounded-2xl font-bold text-xs text-white transition cursor-pointer ${
              danger ? "bg-rose-600 hover:bg-rose-500" : "bg-slate-900 hover:bg-slate-800"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
