import React, { createContext, useContext, useState, useEffect } from "react";

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
  registeredUser: { name: string; phone: string; authProvider: AuthProviderType; providerLabel: string } | null;
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

const STORAGE_USER_KEY = "smartmoney_auth_user_v2";
const STORAGE_REGISTERED_USER_KEY = "smartmoney_registered_user_v2";
const STORAGE_PIN_KEY = "smartmoney_auth_pin_v2";
const STORAGE_IS_AUTH_KEY = "smartmoney_is_authenticated_v2";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_IS_AUTH_KEY);
    return saved ? JSON.parse(saved) : false;
  });

  const [user, setUser] = useState<AuthenticatedUser | null>(() => {
    const saved = localStorage.getItem(STORAGE_USER_KEY);
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved);
      // Ensure dummy user is purged
      if (parsed.name === "김영수") return null;
      return parsed;
    } catch {
      return null;
    }
  });

  const [registeredUser, setRegisteredUser] = useState<{
    name: string;
    phone: string;
    authProvider: AuthProviderType;
    providerLabel: string;
  } | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_REGISTERED_USER_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (!parsed || !parsed.name || parsed.name === "김영수") return null;
      return parsed;
    } catch {
      return null;
    }
  });

  const [pinCode, setPinCodeState] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_PIN_KEY);
    if (saved === "123456") {
      localStorage.removeItem(STORAGE_PIN_KEY);
      return "";
    }
    return saved || "";
  });

  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Fetch initial user from SQLite on mount
  useEffect(() => {
    fetch("/api/user")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.user) {
          if (data.user.hasRegisteredIdentity && data.user.name && data.user.name !== "김영수") {
            const regInfo = {
              name: data.user.name,
              phone: data.user.phone || "",
              authProvider: data.user.authProvider || "KAKAO",
              providerLabel: data.user.providerLabel || "카카오 간편인증",
            };
            setRegisteredUser(regInfo);
            localStorage.setItem(STORAGE_REGISTERED_USER_KEY, JSON.stringify(regInfo));
          }

          if (!data.user.hasPin) {
            setPinCodeState("");
            localStorage.removeItem(STORAGE_PIN_KEY);
          }

          if (data.user.isAuthenticated && data.user.name && data.user.name !== "김영수") {
            setUser({
              id: data.user.id || `user_${Date.now()}`,
              name: data.user.name,
              email: data.user.email || "",
              phone: data.user.phone || "",
              authProvider: data.user.authProvider || "KAKAO",
              providerLabel: data.user.providerLabel || "카카오 간편인증",
              authenticatedAt: data.user.authenticatedAt || "방금 전",
              isBiometricEnabled: data.user.isBiometricEnabled ?? true,
            });
            setIsAuthenticated(true);
          } else {
            // If unauthenticated or dummy user
            setUser(null);
            setIsAuthenticated(false);
            localStorage.removeItem(STORAGE_USER_KEY);
            localStorage.setItem(STORAGE_IS_AUTH_KEY, "false");
          }
        } else {
          setUser(null);
          setIsAuthenticated(false);
          localStorage.removeItem(STORAGE_USER_KEY);
          localStorage.setItem(STORAGE_IS_AUTH_KEY, "false");
        }
      })
      .catch((err) => {
        console.error("Failed to load user from SQLite:", err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // Sync to localStorage as local fallback
  useEffect(() => {
    localStorage.setItem(
      STORAGE_IS_AUTH_KEY,
      JSON.stringify(isAuthenticated)
    );
    if (user && user.name && user.name !== "김영수") {
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_USER_KEY);
    }
  }, [isAuthenticated, user]);

  const clearAuthError = () => setAuthError(null);

  const getProviderLabel = (p: AuthProviderType): string => {
    switch (p) {
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
  };

  const sendVerificationCode = async (
    phone: string,
    provider: AuthProviderType
  ): Promise<{ success: boolean; code?: string; error?: string }> => {
    try {
      setAuthError(null);
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, provider }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "인증번호 발송 실패");
      }
      return { success: true, code: data.code };
    } catch (err: any) {
      const errMsg = err.message || "인증번호 발송 중 오류가 발생했습니다.";
      setAuthError(errMsg);
      return { success: false, error: errMsg };
    }
  };

  const verifyCodeAndLogin = async (details: {
    phone: string;
    code: string;
    name: string;
    provider: AuthProviderType;
    birth?: string;
    telecom?: string;
  }): Promise<boolean> => {
    try {
      setAuthError(null);
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "인증번호 확인 실패");
      }

      const now = new Date();
      const timeStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(
        2,
        "0"
      )}.${String(now.getDate()).padStart(2, "0")} ${String(
        now.getHours()
      ).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const authenticatedUser: AuthenticatedUser = {
        id: `user_${Date.now()}`,
        name: details.name.trim(),
        email: "",
        phone: details.phone.trim(),
        authProvider: details.provider,
        providerLabel: getProviderLabel(details.provider),
        authenticatedAt: timeStr,
        isBiometricEnabled: true,
      };

      const regInfo = {
        name: details.name.trim(),
        phone: details.phone.trim(),
        authProvider: details.provider,
        providerLabel: getProviderLabel(details.provider),
      };
      setRegisteredUser(regInfo);
      localStorage.setItem(STORAGE_REGISTERED_USER_KEY, JSON.stringify(regInfo));

      setUser(authenticatedUser);
      setIsAuthenticated(true);
      setIsLocked(false);
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
    try {
      setAuthError(null);
      if (!details.name || !details.name.trim()) {
        throw new Error("성명을 입력해주세요.");
      }

      const res = await fetch("/api/user/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          name: details.name.trim(),
          phone: details.phone.trim(),
          email: details.email?.trim() || "",
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "인증 실패");
      }

      const now = new Date();
      const timeStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(
        2,
        "0"
      )}.${String(now.getDate()).padStart(2, "0")} ${String(
        now.getHours()
      ).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const authenticatedUser: AuthenticatedUser = {
        id: `user_${Date.now()}`,
        name: details.name.trim(),
        email: details.email?.trim() || "",
        phone: details.phone.trim(),
        authProvider: provider,
        providerLabel: getProviderLabel(provider),
        authenticatedAt: timeStr,
        isBiometricEnabled: true,
      };

      const regInfo = {
        name: details.name.trim(),
        phone: details.phone.trim(),
        authProvider: provider,
        providerLabel: getProviderLabel(provider),
      };
      setRegisteredUser(regInfo);
      localStorage.setItem(STORAGE_REGISTERED_USER_KEY, JSON.stringify(regInfo));

      setUser(authenticatedUser);
      setIsAuthenticated(true);
      setIsLocked(false);
      return true;
    } catch (err: any) {
      setAuthError(err.message || "간편인증 처리 중 오류가 발생했습니다.");
      return false;
    }
  };

  const loginWithPin = async (enteredPin: string): Promise<boolean> => {
    setAuthError(null);

    // If no primary authentication (registered user) exists yet, block PIN login
    const currentReg = registeredUser;
    if (!currentReg || !currentReg.name || !currentReg.name.trim()) {
      setAuthError("먼저 카카오톡, 토스 등 본인인증으로 로그인한 후 PIN을 사용하실 수 있습니다.");
      return false;
    }

    try {
      const res = await fetch("/api/user/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: enteredPin }),
      });
      const data = await res.json();
      if (data.success) {
        // Fetch current user details after pin auth
        const userRes = await fetch("/api/user");
        const userData = await userRes.json();
        const userName = (userData.success && userData.user && userData.user.name) ? userData.user.name : currentReg.name;
        const userPhone = (userData.success && userData.user && userData.user.phone) ? userData.user.phone : currentReg.phone;
        const authProvider = (userData.success && userData.user && userData.user.authProvider) ? userData.user.authProvider : currentReg.authProvider;
        const providerLabel = (userData.success && userData.user && userData.user.providerLabel) ? userData.user.providerLabel : currentReg.providerLabel;

        setUser({
          id: userData?.user?.id || `user_${Date.now()}`,
          name: userName,
          email: userData?.user?.email || "",
          phone: userPhone,
          authProvider,
          providerLabel: `${providerLabel} (PIN 인증)`,
          authenticatedAt: new Date().toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          isBiometricEnabled: true,
        });

        setIsAuthenticated(true);
        setIsLocked(false);
        return true;
      } else {
        setAuthError(data.error || "비밀번호가 일치하지 않습니다.");
        return false;
      }
    } catch (e: any) {
      setAuthError(e.message || "비밀번호 인증 중 오류가 발생했습니다.");
      return false;
    }
  };

  const unlockWithPin = (enteredPin: string): boolean => {
    setAuthError(null);
    if (pinCode && pinCode.length === 6 && enteredPin === pinCode) {
      setIsLocked(false);
      return true;
    } else {
      setAuthError("비밀번호가 일치하지 않습니다.");
      return false;
    }
  };

  const unlockWithBiometrics = async (): Promise<boolean> => {
    setAuthError(null);
    await new Promise((resolve) => setTimeout(resolve, 500));
    setIsLocked(false);
    return true;
  };

  const setPinCode = async (newPin: string) => {
    setPinCodeState(newPin);
    localStorage.setItem(STORAGE_PIN_KEY, newPin);
    try {
      await fetch("/api/user/pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: newPin }),
      });
    } catch (err) {
      console.error("Failed to update PIN in SQLite:", err);
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/user/logout", { method: "POST" });
    } catch (err) {
      console.error("Failed to logout on server:", err);
    }
    setUser(null);
    setIsAuthenticated(false);
    setIsLocked(true);
    localStorage.removeItem(STORAGE_USER_KEY);
    localStorage.setItem(STORAGE_IS_AUTH_KEY, "false");
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
        hasPin: Boolean(pinCode),
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
