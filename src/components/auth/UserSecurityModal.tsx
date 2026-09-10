import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import {
  ShieldCheck,
  LogOut,
  X,
  UserRound,
  Phone,
  CalendarClock,
  KeyRound,
  Pencil,
  Check,
} from "lucide-react";

/** 01012345678 → 010-1234-5678, as the user types. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const UserSecurityModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { currentUser, users, saveProfile, logout, authError, clearAuthError } = useAuth();

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setIsEditing(false);
    setName(currentUser?.name || "");
    setPhone(currentUser?.phone || "");
    setSavedMsg(null);
    clearAuthError();

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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveProfile({ name, phone })) {
      setIsEditing(false);
      setSavedMsg("정보가 저장되었습니다.");
      setTimeout(() => setSavedMsg(null), 2500);
    }
  };

  const handleLogout = () => {
    onClose();
    logout();
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
            <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">내 정보 및 보안</h3>
              <p className="text-[10px] text-slate-400">
                이 기기에 등록된 정보입니다
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

        {savedMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{savedMsg}</span>
          </div>
        )}

        {/* Registered details */}
        {isEditing ? (
          <form
            onSubmit={handleSave}
            className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-3"
          >
            <div className="text-xs font-bold text-slate-900">등록 정보 수정</div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-1">이름</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-emerald-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] text-slate-500 block mb-1">연락처</label>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="010-1234-5678"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-mono focus:border-emerald-400 focus:outline-none"
              />
            </div>

            {authError && (
              <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold">
                {authError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setName(currentUser?.name || "");
                  setPhone(currentUser?.phone || "");
                  clearAuthError();
                }}
                className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 transition cursor-pointer"
              >
                취소
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition cursor-pointer"
              >
                저장
              </button>
            </div>
          </form>
        ) : (
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-sm shrink-0">
                  {(currentUser?.name || "회").substring(0, 1)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black text-slate-900 truncate">
                      {currentUser?.name || "미등록"} 님
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full font-bold shrink-0">
                      PIN 인증 완료
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                    {currentUser?.phone || "-"}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsEditing(true)}
                title="등록 정보 수정"
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white transition shrink-0 cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/60 text-[11px]">
              <div>
                <span className="text-slate-400 flex items-center gap-1 text-[10px]">
                  <CalendarClock className="w-3 h-3" />
                  등록 일시
                </span>
                <span className="font-bold text-slate-800">
                  {formatDateTime(currentUser?.createdAt || null)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 flex items-center gap-1 text-[10px]">
                  <UserRound className="w-3 h-3" />
                  최근 로그인
                </span>
                <span className="font-bold text-slate-800">
                  {formatDateTime(currentUser?.lastUnlockedAt || null)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Security state */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-700">보안 관리</h4>

          <div className="w-full p-3 rounded-2xl bg-white border border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900">간편 비밀번호</div>
                <div className="text-[10px] text-slate-400">
                  암호화되어 저장 · 원문은 보관하지 않습니다
                </div>
              </div>
            </div>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-2 py-0.5 rounded-full shrink-0">
              설정됨
            </span>
          </div>

          <p className="text-[10px] text-slate-400 px-1 leading-relaxed">
            비밀번호를 바꾸려면 상단 톱니바퀴 &gt; <strong>간편비밀번호 등록/변경</strong>을 이용하세요.
          </p>

          {/* Sign out */}
          <button
            type="button"
            onClick={handleLogout}
            className="w-full p-3 rounded-2xl bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-left flex items-center justify-between transition touch-manipulation cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                <LogOut className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">로그아웃</div>
                <div className="text-[10px] text-slate-400">
                  {users.length > 1
                    ? "로그인 화면에서 다른 사용자로 전환할 수 있습니다"
                    : "다시 열 때 간편 비밀번호가 필요합니다"}
                </div>
              </div>
            </div>
            <span className="text-xs text-rose-700 font-bold">로그아웃</span>
          </button>
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
