import React, { createContext, useContext, useState, useEffect } from "react";
import { getDatabase } from "../db/database";
import * as repo from "../db/repository";
import type { UserSummary } from "../db/repository";
import { checkPin, hashPin, isValidPinFormat } from "../services/pinCrypto";

export type { UserSummary };

export interface AuthContextType {
  isLoading: boolean;
  /** Set while a PIN is being stretched, which takes a moment. */
  isBusy: boolean;

  /** Everyone registered on this device, for the sign-in picker. */
  users: UserSummary[];
  /** The signed-in user, or null while at the sign-in screen. */
  currentUser: UserSummary | null;
  currentUserId: string | null;

  signIn: (userId: string, pin: string) => Promise<boolean>;
  /** First-run setup: creates the user and signs them in. */
  registerFirstUser: (details: {
    name: string;
    phone: string;
    pin: string;
  }) => Promise<boolean>;
  /** Adds another user without leaving the current session. */
  addUser: (details: { name: string; phone: string; pin: string }) => Promise<boolean>;
  /** Removes a user and their whole ledger, authorised by the signed-in user's PIN. */
  removeUser: (targetId: string, authorizingPin: string) => Promise<boolean>;
  changePin: (details: { currentPin: string; newPin: string }) => Promise<boolean>;
  saveProfile: (details: { name: string; phone: string }) => boolean;
  logout: () => void;

  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const currentUser = users.find((user) => user.id === currentUserId) ?? null;

  /**
   * The device database is the only source of identity. The session is
   * deliberately not persisted: closing the app returns to the sign-in screen.
   */
  const refreshUsers = () => {
    setUsers(repo.listUsers());
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getDatabase();
        if (!cancelled) refreshUsers();
      } catch (error) {
        console.error("사용자 목록을 불러오지 못했습니다:", error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearAuthError = () => setAuthError(null);

  const describe = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;

  /** Shared validation for creating a user. */
  const validateNewUser = (details: {
    name: string;
    phone: string;
    pin: string;
  }): string | null => {
    if (!details.name.trim()) return "이름을 입력해주세요.";
    if (details.phone.replace(/[^0-9]/g, "").length < 10) {
      return "연락처를 정확히 입력해주세요.";
    }
    if (!isValidPinFormat(details.pin)) {
      return "간편 비밀번호는 숫자 6자리로 설정해주세요.";
    }
    if (repo.isNameTaken(details.name)) {
      return "이미 같은 이름의 사용자가 있습니다. 다른 이름을 사용해주세요.";
    }
    return null;
  };

  const createUser = async (
    details: { name: string; phone: string; pin: string },
    signInAfter: boolean
  ): Promise<boolean> => {
    setAuthError(null);

    const problem = validateNewUser(details);
    if (problem) {
      setAuthError(problem);
      return false;
    }

    setIsBusy(true);
    try {
      const stored = await hashPin(details.pin);
      const id = repo.createUser({
        name: details.name,
        phone: details.phone,
        pin: stored,
      });

      if (signInAfter) {
        repo.setCurrentUserId(id);
        repo.touchLastUnlock(id);
        setCurrentUserId(id);
      }
      refreshUsers();
      return true;
    } catch (error) {
      console.error("사용자 등록에 실패했습니다:", error);
      setAuthError(describe(error, "등록 중 오류가 발생했습니다. 다시 시도해주세요."));
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const registerFirstUser = (details: { name: string; phone: string; pin: string }) =>
    createUser(details, true);

  const addUser = (details: { name: string; phone: string; pin: string }) =>
    createUser(details, false);

  const signIn = async (userId: string, pin: string): Promise<boolean> => {
    setAuthError(null);

    const stored = repo.readStoredPin(userId);
    if (!stored) {
      setAuthError("이 사용자의 간편 비밀번호를 찾을 수 없습니다.");
      return false;
    }

    setIsBusy(true);
    try {
      if (!(await checkPin(pin, stored))) {
        setAuthError("비밀번호가 일치하지 않습니다.");
        return false;
      }

      // Scope every later query to this user before anything reads data
      repo.setCurrentUserId(userId);
      repo.touchLastUnlock(userId);
      setCurrentUserId(userId);
      refreshUsers();
      return true;
    } catch (error) {
      console.error("로그인에 실패했습니다:", error);
      setAuthError(describe(error, "로그인 중 오류가 발생했습니다."));
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const removeUser = async (
    targetId: string,
    authorizingPin: string
  ): Promise<boolean> => {
    setAuthError(null);

    if (users.length <= 1) {
      setAuthError("마지막 사용자는 삭제할 수 없습니다.");
      return false;
    }
    if (!currentUserId) {
      setAuthError("로그인 상태에서만 삭제할 수 있습니다.");
      return false;
    }

    const stored = repo.readStoredPin(currentUserId);
    if (!stored) {
      setAuthError("본인 확인에 필요한 비밀번호를 찾을 수 없습니다.");
      return false;
    }

    setIsBusy(true);
    try {
      if (!(await checkPin(authorizingPin, stored))) {
        setAuthError("내 비밀번호가 일치하지 않습니다.");
        return false;
      }

      repo.deleteUser(targetId);

      // Deleting yourself ends the session
      if (targetId === currentUserId) {
        repo.setCurrentUserId(null);
        setCurrentUserId(null);
      }
      refreshUsers();
      return true;
    } catch (error) {
      console.error("사용자 삭제에 실패했습니다:", error);
      setAuthError(describe(error, "삭제 중 오류가 발생했습니다."));
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const changePin = async (details: {
    currentPin: string;
    newPin: string;
  }): Promise<boolean> => {
    setAuthError(null);

    if (!currentUserId) {
      setAuthError("로그인 상태에서만 변경할 수 있습니다.");
      return false;
    }
    if (!isValidPinFormat(details.newPin)) {
      setAuthError("새 비밀번호는 숫자 6자리로 설정해주세요.");
      return false;
    }

    const stored = repo.readStoredPin(currentUserId);
    if (!stored) {
      setAuthError("등록된 간편 비밀번호가 없습니다.");
      return false;
    }

    setIsBusy(true);
    try {
      if (!(await checkPin(details.currentPin, stored))) {
        setAuthError("현재 비밀번호가 일치하지 않습니다.");
        return false;
      }
      repo.savePinHash(currentUserId, await hashPin(details.newPin));
      return true;
    } catch (error) {
      console.error("비밀번호 변경에 실패했습니다:", error);
      setAuthError(describe(error, "비밀번호 변경 중 오류가 발생했습니다."));
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const saveProfile = (details: { name: string; phone: string }): boolean => {
    setAuthError(null);

    if (!currentUserId) return false;
    if (!details.name.trim()) {
      setAuthError("이름을 입력해주세요.");
      return false;
    }
    if (details.phone.replace(/[^0-9]/g, "").length < 10) {
      setAuthError("연락처를 정확히 입력해주세요.");
      return false;
    }
    if (repo.isNameTaken(details.name, currentUserId)) {
      setAuthError("이미 같은 이름의 사용자가 있습니다.");
      return false;
    }

    try {
      repo.updateProfile(currentUserId, details);
      refreshUsers();
      return true;
    } catch (error) {
      console.error("정보를 저장하지 못했습니다:", error);
      setAuthError(describe(error, "정보를 저장하지 못했습니다."));
      return false;
    }
  };

  const logout = () => {
    repo.setCurrentUserId(null);
    setCurrentUserId(null);
    setAuthError(null);
    refreshUsers();
  };

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        isBusy,
        users,
        currentUser,
        currentUserId,
        signIn,
        registerFirstUser,
        addUser,
        removeUser,
        changePin,
        saveProfile,
        logout,
        authError,
        clearAuthError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
