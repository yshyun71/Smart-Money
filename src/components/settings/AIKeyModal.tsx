import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  clearProviderConfig,
  getAiSettings,
  maskApiKey,
  PROVIDER_ORDER,
  PROVIDERS,
  saveProviderConfig,
  setActiveProvider,
  validateProvider,
  type ProviderId,
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
  Check,
} from "lucide-react";

/**
 * "AI 등록" — the user brings their own key, for whichever provider they have.
 * Keys are kept in this browser's localStorage and each is only ever sent to
 * the provider it belongs to.
 */
export const AIKeyModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<ProviderId>("google");
  const [active, setActive] = useState<ProviderId>("google");
  const [stored, setStored] = useState<Record<ProviderId, { apiKey: string; model: string }>>(
    () => getAiSettings().providers
  );

  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const info = PROVIDERS[tab];
  const savedKey = stored[tab].apiKey;

  const loadTab = (id: ProviderId) => {
    const settings = getAiSettings();
    setStored({ ...settings.providers });
    setActive(settings.active);
    setKeyInput(settings.providers[id].apiKey);
    setModelInput(settings.providers[id].model);
    setReveal(false);
    setResult(null);
  };

  useEffect(() => {
    if (!isOpen) return;

    const settings = getAiSettings();
    setTab(settings.active);
    setActive(settings.active);
    setStored({ ...settings.providers });
    setKeyInput(settings.providers[settings.active].apiKey);
    setModelInput(settings.providers[settings.active].model);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim();
    const model = modelInput.trim() || info.defaultModel;

    if (!key) {
      setResult({ ok: false, message: "API 키를 입력해주세요." });
      return;
    }

    setIsChecking(true);
    setResult(null);

    const check = await validateProvider(tab, key, model);
    if (check.ok) {
      saveProviderConfig(tab, { apiKey: key, model });
      loadTab(tab);
      setResult({
        ok: true,
        message: `${info.label} 키가 확인되어 등록되었습니다. 이제 이 공급자를 사용합니다.`,
      });
    } else {
      setResult({ ok: false, message: check.error || "키를 확인하지 못했습니다." });
    }
    setIsChecking(false);
  };

  const handleRemove = () => {
    if (!confirm(`${info.label} 키를 이 기기에서 삭제할까요?`)) return;
    clearProviderConfig(tab);
    loadTab(tab);
    setResult({ ok: true, message: `${info.label} 키가 삭제되었습니다.` });
  };

  const handleUseThis = () => {
    setActiveProvider(tab);
    loadTab(tab);
    setResult({ ok: true, message: `이제 ${info.label}을 사용합니다.` });
  };

  const activeInfo = PROVIDERS[active];
  const activeConfigured = Boolean(stored[active].apiKey);

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
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
                내 API 키로 AI 절약 분석·문자 인식·자동 분류 사용
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

        {/* Which provider is in use */}
        <div
          className={`p-3 rounded-2xl border text-xs flex items-start gap-2 ${
            activeConfigured
              ? "bg-emerald-50 border-emerald-200/80 text-emerald-900"
              : "bg-amber-50 border-amber-200/80 text-amber-900"
          }`}
        >
          {activeConfigured ? (
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="font-bold">
              {activeConfigured ? `사용 중: ${activeInfo.label}` : "등록된 키가 없습니다"}
            </div>
            <div className="text-[11px] mt-0.5 opacity-80 break-all">
              {activeConfigured
                ? `${stored[active].model} · ${maskApiKey(stored[active].apiKey)}`
                : "AI 절약 코치, 문자 자동 인식, AI 자동 분류가 비활성 상태입니다."}
            </div>
          </div>
        </div>

        {/* Provider tabs */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-2xl">
          {PROVIDER_ORDER.map((id) => {
            const configured = Boolean(stored[id].apiKey);
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  loadTab(id);
                }}
                className={`py-2 rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer ${
                  tab === id
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {configured && <Check className="w-3 h-3 text-emerald-600 shrink-0" />}
                <span className="truncate">{PROVIDERS[id].label}</span>
              </button>
            );
          })}
        </div>

        {/* Selected provider */}
        <form onSubmit={handleSave} className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700">
              {info.vendor} API 키
            </span>
            {savedKey && (
              <span className="text-[10px] font-mono text-slate-400">
                {maskApiKey(savedKey)}
              </span>
            )}
          </div>

          <div className="relative">
            <input
              type={reveal ? "text" : "password"}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={info.keyHint}
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

          <div>
            <label className="text-[11px] font-bold text-slate-700 block mb-1">모델</label>
            <input
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              placeholder={info.defaultModel}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-200 bg-white font-mono focus:border-emerald-400 focus:outline-none"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              기본값 <span className="font-mono">{info.defaultModel}</span> · 더 저렴하거나 빠른
              모델로 바꿀 수 있습니다.
            </p>
          </div>

          {result && (
            <div
              className={`p-2.5 rounded-xl text-[11px] font-bold flex items-start gap-1.5 ${
                result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"
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
              <span>{savedKey ? "키 변경하고 확인" : "키 등록하고 확인"}</span>
            )}
          </button>

          {savedKey && active !== tab && (
            <button
              type="button"
              onClick={handleUseThis}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition cursor-pointer"
            >
              {info.label}을 사용하도록 전환
            </button>
          )}

          {savedKey && (
            <button
              type="button"
              onClick={handleRemove}
              className="w-full py-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>이 기기에서 {info.label} 키 삭제</span>
            </button>
          )}
        </form>

        {/* Guidance */}
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <a
              href={info.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[11px] transition flex items-center justify-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>키 발급</span>
            </a>
            <a
              href={info.modelsUrl}
              target="_blank"
              rel="noreferrer"
              className="py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[11px] transition flex items-center justify-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>모델 목록</span>
            </a>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-500 leading-relaxed space-y-1">
            <div>
              키는 <strong className="text-slate-700">이 기기에만 저장</strong>되며, 각 키는 해당
              공급자에게만 전송됩니다. 세 곳을 모두 등록해 두고 필요할 때 전환할 수 있습니다.
            </div>
            <div>
              AI 기능은 인터넷 연결이 필요하고, 사용량만큼 각 공급자에게 요금이 청구됩니다.
            </div>
            <div>
              기기를 다른 사람과 함께 쓴다면 키를 등록하지 마세요. 브라우저 데이터를 지우면 키도
              함께 삭제됩니다.
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
