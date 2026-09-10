import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { PinPad } from "./PinPad";
import {
  ShieldCheck,
  Lock,
  ArrowLeft,
  ArrowRight,
  KeyRound,
  UserRound,
  Phone,
  CheckCircle2,
  Info,
} from "lucide-react";

/** 01012345678 → 010-1234-5678, as the user types. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 sm:py-8">
    <div className="w-full max-w-sm space-y-4">
      {/* Brand */}
      <div className="flex flex-col items-center gap-2 text-center">
        <img
          src="/icon.svg"
          alt="스마트 머니"
          className="w-14 h-14 rounded-2xl shadow-lg shadow-emerald-500/20 object-cover"
        />
        <div>
          <h1 className="text-base font-extrabold text-white tracking-tight">
            스마트 머니
          </h1>
          <p className="text-[11px] text-slate-400">카드·계좌 자동 분석 가계부</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-5 shadow-2xl space-y-4">{children}</div>
    </div>
  </div>
);

/** First run: owner details, then a PIN, then the PIN again. */
const RegistrationFlow: React.FC = () => {
  const { registerAccount, isBusy, authError, clearAuthError } = useAuth();

  const [step, setStep] = useState<"PROFILE" | "PIN" | "CONFIRM">("PROFILE");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [mismatchError, setMismatchError] = useState<string | null>(null);

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearAuthError();

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

  if (step === "PROFILE") {
    return (
      <Shell>
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <UserRound className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">처음 사용 설정 (1/3)</h2>
            <p className="text-[10px] text-slate-400">사용자 정보를 입력해주세요</p>
          </div>
        </div>

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

          {(formError || authError) && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
              {formError || authError}
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-500 leading-relaxed flex items-start gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span>
              입력한 정보는 <strong className="text-slate-700">이 기기에만 저장</strong>되며 외부로
              전송되지 않습니다. 본인확인 절차가 아니라 가계부에 표시할 이름과 연락처입니다.
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
      </Shell>
    );
  }

  if (step === "PIN") {
    return (
      <Shell>
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">비밀번호 설정 (2/3)</h2>
              <p className="text-[10px] text-slate-400">{name} 님</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStep("PROFILE")}
            className="p-2 -mr-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="이전 단계"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>

        <PinPad
          title="사용할 6자리 숫자를 입력하세요"
          description="앱을 열 때마다 이 번호로 잠금을 해제합니다."
          error={mismatchError}
          onComplete={(pin) => {
            setFirstPin(pin);
            setMismatchError(null);
            setStep("CONFIRM");
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">비밀번호 확인 (3/3)</h2>
            <p className="text-[10px] text-slate-400">한 번 더 입력해주세요</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setFirstPin("");
            setMismatchError(null);
            setStep("PIN");
          }}
          className="p-2 -mr-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          aria-label="이전 단계"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
      </div>

      <PinPad
        title="같은 번호를 다시 입력하세요"
        description="확인이 끝나면 바로 가계부가 열립니다."
        error={authError}
        isBusy={isBusy}
        onComplete={async (pin) => {
          if (pin !== firstPin) {
            setMismatchError("두 번 입력한 비밀번호가 다릅니다. 처음부터 다시 설정해주세요.");
            setFirstPin("");
            setStep("PIN");
            return false;
          }
          const ok = await registerAccount({ name, phone, pin });
          if (!ok) return false;
        }}
      />
    </Shell>
  );
};

/** Every launch after setup. */
const UnlockScreen: React.FC = () => {
  const { unlockWithPin, isBusy, authError, profile } = useAuth();

  return (
    <Shell>
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
        <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <Lock className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900 truncate">
            {profile?.name ? `${profile.name} 님, 환영합니다` : "잠금 해제"}
          </h2>
          <p className="text-[10px] text-slate-400">간편 비밀번호를 입력해주세요</p>
        </div>
      </div>

      <PinPad
        title="6자리 간편 비밀번호"
        error={authError}
        isBusy={isBusy}
        onComplete={async (pin) => {
          const ok = await unlockWithPin(pin);
          if (!ok) return false;
        }}
      />

      <div className="pt-1 flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
        <ShieldCheck className="w-3 h-3 text-emerald-500" />
        <span>비밀번호는 암호화되어 이 기기에만 저장됩니다</span>
      </div>
    </Shell>
  );
};

export const PinAuthScreen: React.FC = () => {
  const { isRegistered } = useAuth();
  return isRegistered ? <UnlockScreen /> : <RegistrationFlow />;
};
