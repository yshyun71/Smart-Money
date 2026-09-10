import React, { useState } from "react";
import { useAuth, type UserSummary } from "../../context/AuthContext";
import { PinPad } from "./PinPad";
import { UserRegistrationSteps } from "./UserRegistrationSteps";
import { ShieldCheck, ChevronRight, Users, ArrowLeft } from "lucide-react";

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

      <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
        <ShieldCheck className="w-3 h-3 text-emerald-500" />
        <span>비밀번호는 암호화되어 이 기기에만 저장됩니다</span>
      </div>
    </div>
  </div>
);

function formatLastLogin(iso: string | null): string {
  if (!iso) return "로그인 기록 없음";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "로그인 기록 없음";
  return `최근 로그인 ${date.toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  })} ${date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Pick a user, then enter their PIN. */
const SignInFlow: React.FC = () => {
  const { users, signIn, isBusy, authError, clearAuthError } = useAuth();
  const [selected, setSelected] = useState<UserSummary | null>(
    users.length === 1 ? users[0] : null
  );

  if (!selected) {
    return (
      <Shell>
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">사용자 선택</h2>
            <p className="text-[10px] text-slate-400">
              등록된 사용자 {users.length}명
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {users.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                clearAuthError();
                setSelected(user);
              }}
              className="w-full p-3 rounded-2xl bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-left flex items-center justify-between gap-2 transition active:scale-98 touch-manipulation cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-sm shrink-0">
                  {user.name.substring(0, 1)}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 truncate">
                    {user.name}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {formatLastLogin(user.lastUnlockedAt)}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
            </button>
          ))}
        </div>

        <p className="text-[10px] text-slate-400 text-center leading-relaxed">
          사용자 추가는 로그인 후 상단 톱니바퀴 &gt; <strong>사용자 추가</strong>에서 할 수 있습니다.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-xs shrink-0">
            {selected.name.substring(0, 1)}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 truncate">
              {selected.name} 님
            </h2>
            <p className="text-[10px] text-slate-400">간편 비밀번호를 입력해주세요</p>
          </div>
        </div>
        {users.length > 1 && (
          <button
            type="button"
            onClick={() => {
              clearAuthError();
              setSelected(null);
            }}
            className="p-2 -mr-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
            aria-label="다른 사용자 선택"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      <PinPad
        title="6자리 간편 비밀번호"
        error={authError}
        isBusy={isBusy}
        onComplete={async (pin) => {
          const ok = await signIn(selected.id, pin);
          if (!ok) return false;
        }}
      />

      {users.length > 1 && (
        <button
          type="button"
          onClick={() => {
            clearAuthError();
            setSelected(null);
          }}
          className="w-full py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold text-[11px] transition cursor-pointer"
        >
          다른 사용자로 로그인
        </button>
      )}
    </Shell>
  );
};

export const PinAuthScreen: React.FC = () => {
  const { users, registerFirstUser, isBusy, authError, clearAuthError } = useAuth();

  // Nobody registered yet: go straight to setup
  if (users.length === 0) {
    return (
      <Shell>
        <UserRegistrationSteps
          titlePrefix="처음 사용 설정"
          isBusy={isBusy}
          error={authError}
          clearError={clearAuthError}
          onSubmit={registerFirstUser}
        />
      </Shell>
    );
  }

  return <SignInFlow />;
};
