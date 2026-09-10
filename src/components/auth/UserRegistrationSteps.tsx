import React, { useState } from "react";
import { PinPad } from "./PinPad";
import {
  ArrowLeft,
  ArrowRight,
  UserRound,
  Phone,
  Info,
  KeyRound,
  CheckCircle2,
} from "lucide-react";

/** 01012345678 → 010-1234-5678, as the user types. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

interface Props {
  /** Shown as "<prefix> (1/3)" and so on. */
  titlePrefix: string;
  isBusy?: boolean;
  error?: string | null;
  clearError?: () => void;
  /** Return false to keep the user on the last step. */
  onSubmit: (details: { name: string; phone: string; pin: string }) => Promise<boolean>;
  onCancel?: () => void;
}

/**
 * Name and contact, then a PIN, then the PIN again — shared by first-run setup
 * and by adding another user from the settings menu.
 */
export const UserRegistrationSteps: React.FC<Props> = ({
  titlePrefix,
  isBusy = false,
  error,
  clearError,
  onSubmit,
  onCancel,
}) => {
  const [step, setStep] = useState<"PROFILE" | "PIN" | "CONFIRM">("PROFILE");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [mismatchError, setMismatchError] = useState<string | null>(null);

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearError?.();

    if (!name.trim()) {
      setFormError("이름을 입력해주세요.");
      return;
    }
    if (phone.replace(/[^0-9]/g, "").length < 10) {
      setFormError("연락처를 정확히 입력해주세요. (예: 010-1234-5678)");
      return;
    }
    setStep("PIN");
  };

  const StepHeader: React.FC<{
    index: number;
    icon: React.ReactNode;
    tone: string;
    subtitle: string;
    onBack?: () => void;
  }> = ({ index, icon, tone, subtitle, onBack }) => (
    <div className="flex items-center justify-between pb-3 border-b border-slate-100">
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900 truncate">
            {titlePrefix} ({index}/3)
          </h2>
          <p className="text-[10px] text-slate-400 truncate">{subtitle}</p>
        </div>
      </div>
      {(onBack || onCancel) && (
        <button
          type="button"
          onClick={onBack ?? onCancel}
          className="p-2 -mr-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
          aria-label={onBack ? "이전 단계" : "취소"}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  if (step === "PROFILE") {
    return (
      <>
        <StepHeader
          index={1}
          icon={<UserRound className="w-4 h-4" />}
          tone="bg-emerald-50 text-emerald-600"
          subtitle="사용자 정보를 입력해주세요"
        />

        <form onSubmit={handleProfileSubmit} className="space-y-3">
          <div>
            <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1 mb-1.5">
              <UserRound className="w-3 h-3 text-slate-400" />
              이름
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFormError(null);
              }}
              placeholder="홍길동"
              autoComplete="name"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:border-emerald-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1 mb-1.5">
              <Phone className="w-3 h-3 text-slate-400" />
              연락처
            </label>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => {
                setPhone(formatPhone(e.target.value));
                setFormError(null);
              }}
              placeholder="010-1234-5678"
              autoComplete="tel"
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white focus:border-emerald-400 focus:outline-none font-mono"
            />
          </div>

          {(formError || error) && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
              {formError || error}
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-500 leading-relaxed flex items-start gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>
              입력한 정보는 <strong className="text-slate-700">이 기기에만 저장</strong>되며 외부로
              전송되지 않습니다. 사용자마다 가계부가 따로 관리됩니다.
            </span>
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition active:scale-98 flex items-center justify-center gap-1.5"
          >
            <span>다음 · 간편 비밀번호 설정</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </>
    );
  }

  if (step === "PIN") {
    return (
      <>
        <StepHeader
          index={2}
          icon={<KeyRound className="w-4 h-4" />}
          tone="bg-indigo-50 text-indigo-600"
          subtitle={`${name} 님`}
          onBack={() => setStep("PROFILE")}
        />

        <PinPad
          title="사용할 6자리 숫자를 입력하세요"
          description="앱을 열 때마다 이 번호로 로그인합니다."
          error={mismatchError}
          onComplete={(pin) => {
            setFirstPin(pin);
            setMismatchError(null);
            setStep("CONFIRM");
          }}
        />
      </>
    );
  }

  return (
    <>
      <StepHeader
        index={3}
        icon={<CheckCircle2 className="w-4 h-4" />}
        tone="bg-indigo-50 text-indigo-600"
        subtitle="한 번 더 입력해주세요"
        onBack={() => {
          setFirstPin("");
          setMismatchError(null);
          setStep("PIN");
        }}
      />

      <PinPad
        title="같은 번호를 다시 입력하세요"
        error={error}
        isBusy={isBusy}
        onComplete={async (pin) => {
          if (pin !== firstPin) {
            setMismatchError("두 번 입력한 비밀번호가 다릅니다. 다시 설정해주세요.");
            setFirstPin("");
            setStep("PIN");
            return false;
          }
          const ok = await onSubmit({ name, phone, pin });
          if (!ok) {
            // A rejected name or contact belongs back on the first step
            setStep("PROFILE");
            setFirstPin("");
            return false;
          }
        }}
      />
    </>
  );
};
