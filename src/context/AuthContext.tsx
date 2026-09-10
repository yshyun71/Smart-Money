import React, { createContext, useContext, useState, useEffect } from "react";
import { getDatabase } from "../db/database";
import * as repo from "../db/repository";

export type AuthProviderType = "KAKAO" | "TOSS" | "PASS" | "NAVER" | "PIN";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  authProvider: AuthProviderType;
  providerLabel: string;
  authenticatedAt: string;
  isBiometricEnabled: boolean;
}

export interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthenticatedUser | null;
  registeredUser: {
    name: string;
    phone: string;
    authProvider: AuthProviderType;
    providerLabel: string;
  } | null;
  isLocked: boolean;
  hasPin: boolean;
  isLoading: boolean;
  loginWithSimpleAuth: (
    provider: AuthProviderType,
    details: { name: string; phone: string; email?: string }
  ) => Promise<boolean>;
  sendVerificationCode: (
    phone: string,
    provider: AuthProviderType
  ) => Promise<{ success: boolean; code?: string; error?: string }>;
  verifyCodeAndLogin: (details: {
    phone: string;
    code: string;
    name: string;
    provider: AuthProviderType;
    birth?: string;
    telecom?: string;
  }) => Promise<boolean>;
  loginWithPin: (pin: string) => Promise<boolean>;
  setPinCode: (newPin: string) => void;
  logout: () => void;
  lockApp: () => void;
  unlockWithPin: (pin: string) => boolean;
  unlockWithBiometrics: () => Promise<boolean>;
  authError: string | null;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function timestampLabel(): string {
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

function providerLabelFor(provider: AuthProviderType): string {
  switch (provider) {
    case "KAKAO":
      return "카카오톡 간편인증";
    case "TOSS":
      return "토스 간편인증";
    case "PASS":
      return "PASS 간편인증";
    case "NAVER":
      return "네이버 간편인증";
    case "PIN":
      return "간편 비밀번호 인증";
    default:
      return "간편인증";
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [registeredUser, setRegisteredUser] = useState<{
    name: string;
    phone: string;
    authProvider: AuthProviderType;
    providerLabel: string;
  } | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  /**
   * The device database is the only source of identity — there is no server
   * session and nothing is mirrored into localStorage.
   */
  const readUserFromDb = () => {
    const record = repo.getUser();
    if (!record) {
      setRegisteredUser(null);
      setUser(null);
      setIsAuthenticated(false);
      setHasPin(false);
      return;
    }

    setHasPin(record.hasPin);

    if (record.hasRegisteredIdentity) {
      setRegisteredUser({
        name: record.name,
        phone: record.phone,
        authProvider: (record.authProvider as AuthProviderType) || "KAKAO",
        providerLabel: record.providerLabel,
      });
    } else {
      setRegisteredUser(null);
    }

    if (record.isAuthenticated && record.hasRegisteredIdentity) {
      setUser({
        id: record.id,
        name: record.name,
        email: record.email,
        phone: record.phone,
        authProvider: (record.authProvider as AuthProviderType) || "KAKAO",
        providerLabel: record.providerLabel,
        authenticatedAt: record.authenticatedAt || "방금 전",
        isBiometricEnabled: record.isBiometricEnabled,
      });
      setIsAuthenticated(true);
    } else {
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getDatabase();
        if (!cancelled) readUserFromDb();
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

  const applyIdentity = (
    provider: AuthProviderType,
    details: { name: string; phone: string; email?: string }
  ) => {
    const label = providerLabelFor(provider);
    repo.saveIdentity({
      name: details.name.trim(),
      phone: details.phone.trim(),
      email: details.email?.trim() || "",
      provider,
      providerLabel: label,
    });

    setRegisteredUser({
      name: details.name.trim(),
      phone: details.phone.trim(),
      authProvider: provider,
      providerLabel: label,
    });

    setUser({
      id: "user_primary",
      name: details.name.trim(),
      email: details.email?.trim() || "",
      phone: details.phone.trim(),
      authProvider: provider,
      providerLabel: label,
      authenticatedAt: timestampLabel(),
      isBiometricEnabled: true,
    });

    setIsAuthenticated(true);
    setIsLocked(false);
  };

  const sendVerificationCode = async (
    phone: string,
    _provider: AuthProviderType
  ): Promise<{ success: boolean; code?: string; error?: string }> => {
    setAuthError(null);
    if (!phone || !phone.trim()) {
      const message = "휴대폰 번호를 입력해주세요.";
      setAuthError(message);
      return { success: false, error: message };
    }

    // No SMS gateway on the device: the code is shown back to the user.
    const code = repo.issueVerificationCode(phone);
    return { success: true, code };
  };

  const verifyCodeAndLogin = async (details: {
    phone: string;
    code: string;
    name: string;
    provider: AuthProviderType;
    birth?: string;
    telecom?: string;
  }): Promise<boolean> => {
    setAuthError(null);
    try {
      if (!details.name || !details.name.trim()) {
        throw new Error("성명을 입력해주세요.");
      }
      if (!repo.checkVerificationCode(details.phone, details.code)) {
        throw new Error(
          "인증번호 6자리가 일치하지 않거나 만료되었습니다. (테스트용: 발송된 6자리 또는 123456)"
        );
      }

      applyIdentity(details.provider, { name: details.name, phone: details.phone });
      return true;
    } catch (err: any) {
      setAuthError(err.message || "인증 처리 중 오류가 발생했습니다.");
      return false;
    }
  };

  const loginWithSimpleAuth = async (
    provider: AuthProviderType,
    details: { name: string; phone: string; email?: string }
  ): Promise<boolean> => {
    setAuthError(null);
    try {
      if (!details.name || !details.name.trim()) {
        throw new Error("성명을 입력해주세요.");
      }
      applyIdentity(provider, details);
      return true;
    } catch (err: any) {
      setAuthError(err.message || "간편인증 처리 중 오류가 발생했습니다.");
      return false;
    }
  };

  const loginWithPin = async (enteredPin: string): Promise<boolean> => {
    setAuthError(null);

    const result = repo.verifyPin(enteredPin);
    if (!result.success) {
      setAuthError(result.error || "비밀번호가 일치하지 않습니다.");
      return false;
    }

    const record = repo.getUser();
    if (record) {
      setUser({
        id: record.id,
        name: record.name,
        email: record.email,
        phone: record.phone,
        authProvider: (record.authProvider as AuthProviderType) || "KAKAO",
        providerLabel: `${record.providerLabel} (PIN 인증)`,
        authenticatedAt: new Date().toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        isBiometricEnabled: record.isBiometricEnabled,
      });
    }

    setIsAuthenticated(true);
    setIsLocked(false);
    return true;
  };

  const unlockWithPin = (enteredPin: string): boolean => {
    setAuthError(null);
    const result = repo.verifyPin(enteredPin);
    if (result.success) {
      setIsLocked(false);
      return true;
    }
    setAuthError(result.error || "비밀번호가 일치하지 않습니다.");
    return false;
  };

  const unlockWithBiometrics = async (): Promise<boolean> => {
    setAuthError(null);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsLocked(false);
    return true;
  };

  const setPinCode = (newPin: string) => {
    try {
      repo.savePin(newPin);
      setHasPin(Boolean(newPin && newPin.length === 6));
    } catch (error) {
      console.error("간편 비밀번호를 저장하지 못했습니다:", error);
    }
  };

  const logout = () => {
    try {
      repo.markLoggedOut();
    } catch (error) {
      console.error("로그아웃 상태를 저장하지 못했습니다:", error);
    }
    setUser(null);
    setIsAuthenticated(false);
    setIsLocked(true);
    setAuthError(null);
  };

  const lockApp = () => {
    setIsLocked(true);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        user,
        registeredUser,
        isLocked,
        hasPin,
        isLoading,
        loginWithSimpleAuth,
        sendVerificationCode,
        verifyCodeAndLogin,
        loginWithPin,
        setPinCode,
        logout,
        lockApp,
        unlockWithPin,
        unlockWithBiometrics,
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
