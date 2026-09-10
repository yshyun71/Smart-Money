import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AI_KEY_ISSUE_URL,
  AI_MODEL_NAME,
  clearApiKey,
  getApiKey,
  maskApiKey,
  saveApiKey,
  validateApiKey,
} from "../../services/aiClient";
import {
  Sparkles,
  X,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
} from "lucide-react";

/**
 * "AI 등록" — the user brings their own Gemini API key. It is kept in this
 * browser's localStorage and used directly from the device, so no server ever
 * sees it.
 */
export const AIKeyModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [keyInput, setKeyInput] = useState("");
  const [storedKey, setStoredKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const existing = getApiKey();
    setStoredKey(existing);
    setKeyInput(existing);
    setReveal(false);
    setResult(null);
    setIsChecking(false);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setResult({ ok: false, message: "API 키를 입력해주세요." });
      return;
    }

    setIsChecking(true);
    setResult(null);

    const check = await validateApiKey(trimmed);
    if (check.ok) {
      saveApiKey(trimmed);
      setStoredKey(trimmed);
      setResult({ ok: true, message: "AI 키가 확인되어 이 기기에 등록되었습니다." });
      setTimeout(onClose, 1400);
    } else {
      setResult({ ok: false, message: check.error || "키를 확인하지 못했습니다." });
    }
    setIsChecking(false);
  };

  const handleRemove = () => {
    if (!confirm("등록된 AI 키를 이 기기에서 삭제할까요? AI 기능을 사용할 수 없게 됩니다.")) {
      return;
    }
    clearApiKey();
    setStoredKey("");
    setKeyInput("");
    setResult({ ok: true, message: "AI 키가 삭제되었습니다." });
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">AI 등록</h3>
              <p className="text-[10px] text-slate-400">
                내 API 키로 AI 절약 분석·문자 인식 사용하기
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

        {/* Current status */}
        <div
          className={`p-3 rounded-2xl border text-xs flex items-start gap-2 ${
            storedKey
              ? "bg-emerald-50 border-emerald-200/80 text-emerald-900"
              : "bg-amber-50 border-amber-200/80 text-amber-900"
          }`}
        >
          {storedKey ? (
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="font-bold">
              {storedKey ? "등록된 키가 있습니다" : "등록된 키가 없습니다"}
            </div>
            <div className="text-[11px] mt-0.5 font-mono break-all opacity-80">
              {storedKey ? maskApiKey(storedKey) : "AI 절약 코치와 문자 자동 인식이 비활성 상태입니다."}
            </div>
          </div>
        </div>

        {/* Key form */}
        <form onSubmit={handleSave} className="space-y-2.5">
          <label className="text-[11px] font-bold text-slate-700 block">
            Google Gemini API 키
          </label>
          <div className="relative">
            <input
              type={reveal ? "text" : "password"}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="AIza..."
              autoComplete="off"
              spellCheck={false}
              className="w-full pl-3 pr-10 py-2.5 text-xs rounded-xl border border-slate-200 bg-white font-mono focus:border-emerald-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? "키 숨기기" : "키 보기"}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 rounded-lg"
            >
              {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {result && (
            <div
              className={`p-2.5 rounded-xl text-[11px] font-bold flex items-start gap-1.5 ${
                result.ok
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-rose-50 text-rose-700"
              }`}
            >
              {result.ok ? (
                <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              )}
              <span className="min-w-0 break-words">{result.message}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isChecking}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {isChecking ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>키 확인 중...</span>
              </>
            ) : (
              <span>{storedKey ? "키 변경하고 확인" : "키 등록하고 확인"}</span>
            )}
          </button>

          {storedKey && (
            <button
              type="button"
              onClick={handleRemove}
              className="w-full py-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>이 기기에서 키 삭제</span>
            </button>
          )}
        </form>

        {/* Guidance */}
        <div className="space-y-2 pt-1">
          <a
            href={AI_KEY_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
            className="w-full py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs transition flex items-center justify-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Google AI Studio에서 무료 키 발급받기</span>
          </a>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-500 leading-relaxed space-y-1">
            <div>
              키는 <strong className="text-slate-700">이 기기에만 저장</strong>되며 서버로 전송되지
              않습니다. AI 요청은 기기에서 Google API로 직접 전송됩니다.
            </div>
            <div>
              사용 모델: <span className="font-mono text-slate-700">{AI_MODEL_NAME}</span> · AI 기능은
              인터넷 연결이 필요합니다.
            </div>
            <div>
              기기를 다른 사람과 함께 쓴다면 키를 등록하지 마세요. 브라우저 데이터를 지우면 키도 함께
              삭제됩니다.
            </div>
          </div>
        </div>

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
