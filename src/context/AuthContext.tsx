import React, { createContext, useContext, useState, useEffect } from "react";
import { getDatabase } from "../db/database";
import * as repo from "../db/repository";
import { checkPin, hashPin, isValidPinFormat } from "../services/pinCrypto";

export interface OwnerProfile {
  id: string;
  name: string;
  phone: string;
  registeredAt: string;
  lastUnlockedAt: string | null;
}

export interface AuthContextType {
  isLoading: boolean;
  /** A name and a PIN both exist on this device. */
  isRegistered: boolean;
  /** The correct PIN has been entered in this session. */
  isUnlocked: boolean;
  /** Set while a PIN is being stretched, which takes a moment. */
  isBusy: boolean;
  profile: OwnerProfile | null;

  registerAccount: (details: {
    name: string;
    phone: string;
    pin: string;
  }) => Promise<boolean>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  changePin: (details: { currentPin: string; newPin: string }) => Promise<boolean>;
  saveProfile: (details: { name: string; phone: string }) => boolean;
  lock: () => void;

  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [profile, setProfile] = useState<OwnerProfile | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  /**
   * The device database is the only source of identity. Unlock state is
   * deliberately not persisted: closing the app locks it again.
   */
  const readProfile = () => {
    const record = repo.getProfile();
    if (!record) {
      setProfile(null);
      setIsRegistered(false);
      return;
    }

    setIsRegistered(record.isRegistered);
    setProfile({
      id: record.id,
      name: record.name,
      phone: record.phone,
      registeredAt: record.registeredAt,
      lastUnlockedAt: record.lastUnlockedAt,
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getDatabase();
        if (!cancelled) readProfile();
      } catch (error) {
        console.error("사용자 정보를 불러오지 못했습니다:", error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearAuthError = () => setAuthError(null);

  const registerAccount = async (details: {
    name: string;
    phone: string;
    pin: string;
  }): Promise<boolean> => {
    setAuthError(null);

    if (!details.name.trim()) {
      setAuthError("이름을 입력해주세요.");
      return false;
    }
    if (details.phone.replace(/[^0-9]/g, "").length < 10) {
      setAuthError("연락처를 정확히 입력해주세요.");
      return false;
    }
    if (!isValidPinFormat(details.pin)) {
      setAuthError("간편 비밀번호는 숫자 6자리로 설정해주세요.");
      return false;
    }

    setIsBusy(true);
    try {
      const stored = await hashPin(details.pin);
      repo.registerAccount({
        name: details.name,
        phone: details.phone,
        pin: stored,
      });
      repo.touchLastUnlock();
      readProfile();
      setIsUnlocked(true);
      return true;
    } catch (error) {
      console.error("등록에 실패했습니다:", error);
      setAuthError("등록 중 오류가 발생했습니다. 다시 시도해주세요.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const unlockWithPin = async (pin: string): Promise<boolean> => {
    setAuthError(null);

    const stored = repo.readStoredPin();
    if (!stored) {
      setAuthError("등록된 간편 비밀번호가 없습니다. 처음 설정을 다시 진행해주세요.");
      return false;
    }

    setIsBusy(true);
    try {
      const matches = await checkPin(pin, stored);
      if (!matches) {
        setAuthError("비밀번호가 일치하지 않습니다.");
        return false;
      }
      repo.touchLastUnlock();
      readProfile();
      setIsUnlocked(true);
      return true;
    } finally {
      setIsBusy(false);
    }
  };

  const changePin = async (details: {
    currentPin: string;
    newPin: string;
  }): Promise<boolean> => {
    setAuthError(null);

    if (!isValidPinFormat(details.newPin)) {
      setAuthError("새 비밀번호는 숫자 6자리로 설정해주세요.");
      return false;
    }

    const stored = repo.readStoredPin();
    if (!stored) {
      setAuthError("등록된 간편 비밀번호가 없습니다.");
      return false;
    }

    setIsBusy(true);
    try {
      const matches = await checkPin(details.currentPin, stored);
      if (!matches) {
        setAuthError("현재 비밀번호가 일치하지 않습니다.");
        return false;
      }
      repo.savePinHash(await hashPin(details.newPin));
      readProfile();
      return true;
    } catch (error) {
      console.error("비밀번호 변경에 실패했습니다:", error);
      setAuthError("비밀번호 변경 중 오류가 발생했습니다.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const saveProfile = (details: { name: string; phone: string }): boolean => {
    setAuthError(null);

    if (!details.name.trim()) {
      setAuthError("이름을 입력해주세요.");
      return false;
    }
    if (details.phone.replace(/[^0-9]/g, "").length < 10) {
      setAuthError("연락처를 정확히 입력해주세요.");
      return false;
    }

    try {
      repo.updateProfile(details);
      readProfile();
      return true;
    } catch (error) {
      console.error("정보를 저장하지 못했습니다:", error);
      setAuthError("정보를 저장하지 못했습니다.");
      return false;
    }
  };

  const lock = () => {
    setIsUnlocked(false);
    setAuthError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        isRegistered,
        isUnlocked,
        isBusy,
        profile,
        registerAccount,
        unlockWithPin,
        changePin,
        saveProfile,
        lock,
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
