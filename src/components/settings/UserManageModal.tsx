import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth, type UserSummary } from "../../context/AuthContext";
import { PinPad } from "../auth/PinPad";
import { UserRegistrationSteps } from "../auth/UserRegistrationSteps";
import { PinSetupModal } from "../auth/PinSetupModal";
import { formatPhone } from "../../utils/format";
import {
  Users,
  UserPlus,
  Trash2,
  Pencil,
  KeyRound,
  X,
  CheckCircle,
  ShieldAlert,
  ArrowLeft,
} from "lucide-react";

type Mode = "LIST" | "ADD" | "ADDED" | "EDIT" | "DELETE";

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
    editUser,
    isBusy,
    authError,
    clearAuthError,
  } = useAuth();

  const [mode, setMode] = useState<Mode>("LIST");
  const [target, setTarget] = useState<UserSummary | null>(null);

  /** 수정 화면의 입력값. 비밀번호는 전용 화면에서 따로 바꿉니다. */
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [askPin, setAskPin] = useState(false);
  /** 비밀번호 변경 화면을 띄울 대상. */
  const [pinTarget, setPinTarget] = useState<UserSummary | null>(null);
  /** 이름이 이미 쓰이고 있는지 — PIN을 받기 전에 알려 줍니다. */
  const [formError, setFormError] = useState<string | null>(null);

  // 열릴 때 한 번만 되돌립니다 — 키 리스너와 한 효과에 두면 위 모달이 열고
  // 닫힐 때마다 화면이 처음으로 돌아갑니다(14.5)
  useEffect(() => {
    if (!isOpen) return;

    setMode("LIST");
    setTarget(null);
    setAskPin(false);
    setPinTarget(null);
    setFormError(null);
    clearAuthError();

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Escape 는 가장 위 모달만 닫습니다 — 비밀번호 화면이 떠 있으면 그쪽 몫입니다(14.4)
  useEffect(() => {
    if (!isOpen || pinTarget) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, pinTarget, onClose]);

  if (!isOpen) return null;

  /*
    이름이나 연락처가 실제로 달라졌는가. 비밀번호는 여기 들어가지 않습니다 —
    그쪽은 전용 화면에서 그 자리에서 저장되므로 확인할 것이 남지 않습니다.

    연락처는 숫자만 견줍니다. 화면에 띄울 때 하이픈을 넣어 주므로, 예전에
    하이픈 없이 저장된 값이 열리면 손대지 않아도 글자로는 달라 보입니다.
  */
  const digitsOf = (value: string) => (value || "").replace(/[^0-9]/g, "");
  const phoneChanged =
    target !== null && digitsOf(editPhone) !== digitsOf(target.phone || "");
  const detailsChanged =
    target !== null &&
    (editName.trim() !== (target.name || "").trim() || phoneChanged);

  const headings: Record<Mode, { title: string; sub: string }> = {
    LIST: { title: "사용자 관리", sub: `이 기기에 등록된 사용자 ${users.length}명` },
    ADD: { title: "새 사용자", sub: "정보와 간편 비밀번호를 등록합니다" },
    ADDED: { title: "추가 완료", sub: "새 사용자가 등록되었습니다" },
    EDIT: askPin
      ? { title: "수정 확인", sub: "내 간편 비밀번호로 확인합니다" }
      : { title: "사용자 수정", sub: "이름·연락처·간편 비밀번호를 바꿉니다" },
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
                  /*
                    한 단계씩 돌아갑니다. 확인 단계에서 목록으로 튕기면 이름을
                    다시 입력해야 하고, 무엇을 바꾸던 중이었는지도 사라집니다.
                  */
                  if (mode === "EDIT" && askPin) {
                    setAskPin(false);
                    return;
                  }
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
                          {formatPhone(user.phone || "") || "-"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      title="이름·연락처·비밀번호 수정"
                      onClick={() => {
                        clearAuthError();
                        setTarget(user);
                        setEditName(user.name);
                        setEditPhone(formatPhone(user.phone || ""));
                        setAskPin(false);
                        setFormError(null);
                        setMode("EDIT");
                      }}
                      className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition cursor-pointer"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      title="이 사용자와 가계부 전체 삭제"
                      onClick={() => {
                        clearAuthError();
                        setTarget(user);
                        setMode("DELETE");
                      }}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    </div>
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

        {mode === "EDIT" && target && (
          <>
            {/*
              등록 때 받는 것과 같은 항목입니다. 확인 단계(askPin)에서는 감춥니다 —
              그 자리는 "이대로 저장할까" 하나만 묻는 자리이고, 거기서 비밀번호를
              바꾸러 나가는 길이 보이면 무엇을 확인하는 중인지 흐려집니다.
            */}
            {!askPin && (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">이름</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => {
                    clearAuthError();
                    setFormError(null);
                    setEditName(e.target.value);
                  }}
                  placeholder="홍길동"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">연락처</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={editPhone}
                  onChange={(e) => {
                    clearAuthError();
                    setEditPhone(formatPhone(e.target.value));
                  }}
                  placeholder="010-0000-0000"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
                />
              </div>

              {/*
                비밀번호는 글자로 받지 않습니다. 키패드로 두 번 눌러 확인하는
                전용 화면이 이미 있고, 화면에 남는 입력창보다 안전합니다.
              */}
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  간편 비밀번호
                </label>
                <button
                  type="button"
                  onClick={() => {
                    clearAuthError();
                    setPinTarget(target);
                  }}
                  className="w-full py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                  <span>간편비밀번호 등록·변경</span>
                </button>
                <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">
                  6자리 숫자를 키패드로 입력합니다. 이름·연락처와 <strong>따로
                  저장</strong>되므로, 그 화면에서 바꾸면 여기서 [변경 확인]을 누르지
                  않아도 이미 적용된 것입니다.
                </p>
              </div>
            </div>
            )}

            {(formError || (authError && !askPin)) && (
              <p className="text-[11px] font-bold text-rose-600">{formError || authError}</p>
            )}

            {askPin ? (
              <>
                {/* 무엇을 확인하는 중인지 — 입력 항목을 감췄으니 여기에 적습니다 */}
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 text-[11px] space-y-1">
                  {editName.trim() !== (target.name || "").trim() && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 shrink-0">이름</span>
                      <span className="text-slate-500 truncate">
                        {target.name} <span className="text-slate-300">→</span>{" "}
                        <strong className="text-slate-900">{editName.trim()}</strong>
                      </span>
                    </div>
                  )}
                  {phoneChanged && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 shrink-0">연락처</span>
                      <span className="text-slate-500 truncate font-mono">
                        {formatPhone(target.phone || "") || "-"}{" "}
                        <span className="text-slate-300">→</span>{" "}
                        <strong className="text-slate-900">
                          {formatPhone(editPhone) || "-"}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>

              <PinPad
                title="내 간편 비밀번호 6자리"
                description={`${target.name} 님의 정보를 바꾸기 위해 로그인한 사용자의 비밀번호를 입력합니다.`}
                error={authError}
                isBusy={isBusy}
                onComplete={async (pin) => {
                  const ok = await editUser(
                    target.id,
                    { name: editName, phone: formatPhone(editPhone) },
                    pin
                  );
                  if (!ok) return false;
                  setTarget(null);
                  setAskPin(false);
                  setMode("LIST");
                }}
              />
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    clearAuthError();
                    setTarget(null);
                    setMode("LIST");
                  }}
                  className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={!editName.trim() || !detailsChanged}
                  onClick={() => {
                    clearAuthError();

                    /*
                      이름은 로그인 화면에서 사람을 고르는 이름이라 유일해야
                      합니다. 여기서 먼저 확인합니다 — 비밀번호 6자리를 다
                      누른 뒤에 "이미 쓰는 이름"이라고 하면 헛수고입니다.
                    */
                    const wanted = editName.trim().toLowerCase();
                    const clash = users.some(
                      (other: UserSummary) =>
                        other.id !== target.id &&
                        (other.name || "").trim().toLowerCase() === wanted
                    );
                    if (clash) {
                      setFormError("이미 같은 이름의 사용자가 있습니다.");
                      return;
                    }

                    setFormError(null);
                    setAskPin(true);
                  }}
                  className="py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer disabled:opacity-40"
                >
                  변경 확인
                </button>

                {!detailsChanged && (
                  <p className="col-span-2 text-[10px] text-slate-400 text-center">
                    이름과 연락처가 그대로입니다. 비밀번호만 바꾸려면 위 버튼을 쓰세요.
                  </p>
                )}
              </div>
            )}
          </>
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
                  이 사용자의 <strong>계좌·카드, 거래 내역, 예산, AI 분석, 등록한 AI 키가
                  모두 함께 삭제</strong>됩니다.
                  {users.length > 1 && " 다른 사용자의 가계부는 그대로 유지됩니다."}
                  {/*
                    마지막 한 명을 지우는 것은 기기 초기화와 같습니다. 막지는
                    않되, 무엇이 일어나는지는 분명히 말합니다.
                  */}
                  {users.length <= 1 ? (
                    <>
                      <br />
                      <strong>
                        마지막 사용자입니다. 이 기기의 가계부가 전부 사라지고 첫 사용자
                        등록부터 다시 시작합니다.
                      </strong>
                    </>
                  ) : (
                    target.id === currentUserId && (
                      <>
                        <br />
                        지금 로그인한 계정이므로 삭제 후 로그인 화면으로 이동합니다.
                      </>
                    )
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

      {/*
        위층에 띄웁니다 — 이 모달이 9999이므로 그보다 위여야 하고, PinSetupModal
        자신이 <body>로 포털되므로 여기서는 위치만 정해 주면 됩니다(14.4).
      */}
      <PinSetupModal
        isOpen={pinTarget !== null}
        target={pinTarget}
        onClose={() => {
          setPinTarget(null);
          clearAuthError();
        }}
      />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
