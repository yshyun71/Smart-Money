import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth, type UserSummary } from "../../context/AuthContext";
import { PinPad } from "../auth/PinPad";
import { UserRegistrationSteps } from "../auth/UserRegistrationSteps";
import {
  Users,
  UserPlus,
  Trash2,
  X,
  CheckCircle,
  ShieldAlert,
  ArrowLeft,
} from "lucide-react";

type Mode = "LIST" | "ADD" | "ADDED" | "DELETE";

/**
 * Adding and removing users. Each user owns a separate ledger, so removing one
 * takes their accounts, transactions and budgets with them — which is why it
 * asks for the signed-in user's PIN first.
 */
export const UserManageModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const {
    users,
    currentUserId,
    addUser,
    removeUser,
    isBusy,
    authError,
    clearAuthError,
  } = useAuth();

  const [mode, setMode] = useState<Mode>("LIST");
  const [target, setTarget] = useState<UserSummary | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setMode("LIST");
    setTarget(null);
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

  const headings: Record<Mode, { title: string; sub: string }> = {
    LIST: { title: "사용자 관리", sub: `이 기기에 등록된 사용자 ${users.length}명` },
    ADD: { title: "새 사용자", sub: "정보와 간편 비밀번호를 등록합니다" },
    ADDED: { title: "추가 완료", sub: "새 사용자가 등록되었습니다" },
    DELETE: { title: "사용자 삭제", sub: "내 간편 비밀번호로 확인합니다" },
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
          <div className="flex items-center gap-2 min-w-0">
            {mode !== "LIST" && (
              <button
                type="button"
                onClick={() => {
                  clearAuthError();
                  setTarget(null);
                  setMode("LIST");
                }}
                className="p-1.5 -ml-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
                aria-label="목록으로"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                {headings[mode].title}
              </h3>
              <p className="text-[10px] text-slate-400 truncate">{headings[mode].sub}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-11 h-11 flex items-center justify-center -mr-2 -mt-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition touch-manipulation cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {mode === "LIST" && (
          <>
            <div className="space-y-2">
              {users.map((user) => {
                const isMe = user.id === currentUserId;
                return (
                  <div
                    key={user.id}
                    className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-xs shrink-0">
                        {user.name.substring(0, 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {user.name}
                          </span>
                          {isMe && (
                            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full shrink-0">
                              나
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {user.phone || "-"}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={users.length <= 1}
                      title={
                        users.length <= 1
                          ? "마지막 사용자는 삭제할 수 없습니다"
                          : "이 사용자와 가계부 전체 삭제"
                      }
                      onClick={() => {
                        clearAuthError();
                        setTarget(user);
                        setMode("DELETE");
                      }}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition shrink-0 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                clearAuthError();
                setMode("ADD");
              }}
              className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition active:scale-98 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>새 사용자 추가</span>
            </button>

            <p className="text-[10px] text-slate-400 leading-relaxed px-1">
              사용자마다 계좌·거래·예산이 따로 관리되며 서로의 내역은 보이지 않습니다. 로그인 화면에서
              사용자를 선택해 전환할 수 있습니다.
            </p>
          </>
        )}

        {mode === "ADD" && (
          <UserRegistrationSteps
            titlePrefix="새 사용자"
            isBusy={isBusy}
            error={authError}
            clearError={clearAuthError}
            onCancel={() => setMode("LIST")}
            onSubmit={async (details) => {
              const ok = await addUser(details);
              if (ok) setMode("ADDED");
              return ok;
            }}
          />
        )}

        {mode === "ADDED" && (
          <div className="py-6 flex flex-col items-center gap-2 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
            <div className="text-sm font-bold text-slate-900">
              새 사용자가 등록되었습니다
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              로그아웃 후 로그인 화면에서 선택해 사용할 수 있습니다.
              <br />
              가계부는 사용자별로 따로 시작됩니다.
            </p>
            <button
              type="button"
              onClick={() => setMode("LIST")}
              className="mt-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              사용자 목록으로
            </button>
          </div>
        )}

        {mode === "DELETE" && target && (
          <>
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200/80 text-xs text-rose-800 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <div className="min-w-0">
                <div className="font-bold">
                  {target.name} 님을 삭제하면 되돌릴 수 없습니다
                </div>
                <p className="mt-0.5 leading-relaxed">
                  이 사용자의 <strong>계좌·카드, 거래 내역, 예산, AI 분석이 모두 함께
                  삭제</strong>됩니다. 다른 사용자의 가계부는 그대로 유지됩니다.
                  {target.id === currentUserId && (
                    <>
                      <br />
                      지금 로그인한 계정이므로 삭제 후 로그인 화면으로 이동합니다.
                    </>
                  )}
                </p>
              </div>
            </div>

            <PinPad
              title="내 간편 비밀번호 6자리"
              description="삭제를 확인하기 위해 로그인한 사용자의 비밀번호를 입력합니다."
              error={authError}
              isBusy={isBusy}
              onComplete={async (pin) => {
                const ok = await removeUser(target.id, pin);
                if (!ok) return false;
                setTarget(null);
                setMode("LIST");
              }}
            />
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
