import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../context/AuthContext";
import {
  ShieldCheck,
  Lock,
  LogOut,
  X,
} from "lucide-react";

export const UserSecurityModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const { user, registeredUser, logout, lockApp } = useAuth();

  // Close on Escape key and lock body scroll while open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
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

  const displayUser = user || (registeredUser ? {
    id: "user_registered",
    name: registeredUser.name,
    email: "",
    phone: registeredUser.phone,
    authProvider: registeredUser.authProvider,
    providerLabel: registeredUser.providerLabel,
    authenticatedAt: "최근 인증 완료",
    isBiometricEnabled: true,
  } : null);

  const handleLogout = () => {
    if (confirm("로그아웃 하시겠습니까? 로그아웃 시 간편인증을 다시 거쳐야 합니다.")) {
      onClose();
      logout();
    }
  };

  const handleLock = () => {
    onClose();
    lockApp();
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
            <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                금융 보안 및 본인인증 정보
              </h3>
              <p className="text-[10px] text-slate-400">
                개인신용정보 보호 및 세션 관리
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

        {/* User Identity Card */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-sm">
                {(displayUser?.name || "회원").substring(0, 1)}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black text-slate-900">
                    {displayUser?.name || "인증 회원"} 님
                  </span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full font-bold">
                    본인인증 완료
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {displayUser?.phone || displayUser?.email || "마이데이터 금융정보 연동 완료"}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/60 text-[11px]">
            <div>
              <span className="text-slate-400 block text-[10px]">인증 수단</span>
              <span className="font-bold text-slate-800">{displayUser?.providerLabel || "전자서명 본인확인"}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">인증 일시</span>
              <span className="font-bold text-slate-800">{displayUser?.authenticatedAt || "방금 전"}</span>
            </div>
          </div>
        </div>

        {/* Security Actions */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-700">보안 관리</h4>

          {/* Quick Lock Button */}
          <button
            type="button"
            onClick={handleLock}
            className="w-full p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left flex items-center justify-between transition touch-manipulation cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-900">즉시 화면 잠금</div>
                <div className="text-[10px] text-slate-400">
                  앱을 나갈 때 즉시 비밀번호/생체인증 잠금 적용
                </div>
              </div>
            </div>
            <span className="text-xs text-amber-700 font-bold">잠금</span>
          </button>
        </div>

        {/* Logout Action */}
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-3 rounded-2xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-bold transition flex items-center justify-center gap-2 touch-manipulation cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>로그아웃 (접근 차단)</span>
          </button>
          <p className="text-[10px] text-slate-400 text-center">
            로그아웃 시 등록된 카드 및 계좌 내역 조회가 완전히 차단되며, 재인증이 필요합니다.
          </p>
        </div>

        {/* Bottom Close Button for Mobile Convenience */}
        <div className="pt-2">
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
