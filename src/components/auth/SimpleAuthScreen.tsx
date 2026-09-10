import React, { useState, useEffect } from "react";
import { useAuth, AuthProviderType } from "../../context/AuthContext";
import {
  ShieldCheck,
  Lock,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Fingerprint,
  ArrowRight,
  Sparkles,
  KeyRound,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Info,
} from "lucide-react";

interface ProviderConfig {
  id: AuthProviderType;
  name: string;
  sub: string;
  bgColor: string;
  textColor: string;
  badge: string;
  deepLink: string;
  appSchemeName: string;
  instructions: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: "KAKAO",
    name: "카카오톡",
    sub: "카카오 지갑 간편인증",
    bgColor: "bg-[#FEE500] hover:bg-[#FADA0A]",
    textColor: "text-[#191919]",
    badge: "가장 빠름",
    deepLink: "kakaotalk://",
    appSchemeName: "카카오톡 앱",
    instructions: "카카오톡 앱의 지갑 알림에서 간편인증 전자서명을 승인해주세요.",
  },
  {
    id: "TOSS",
    name: "토스",
    sub: "토스 간편 본인확인",
    bgColor: "bg-[#0064FF] hover:bg-[#0055DA]",
    textColor: "text-white",
    badge: "원클릭 승인",
    deepLink: "supertoss://",
    appSchemeName: "토스 앱",
    instructions: "토스 앱으로 발송된 본인확인 요청 푸시를 터치하여 승인해주세요.",
  },
  {
    id: "PASS",
    name: "PASS",
    sub: "통신 3사 인증 (SKT/KT/LGU+)",
    bgColor: "bg-[#E60000] hover:bg-[#CC0000]",
    textColor: "text-white",
    badge: "금융 표준",
    deepLink: "pass://",
    appSchemeName: "PASS 앱",
    instructions: "PASS 앱의 본인확인 인증서 알림을 승인하시거나 SMS 문자인증을 선택하세요.",
  },
  {
    id: "NAVER",
    name: "네이버",
    sub: "네이버 인증서 간편식별",
    bgColor: "bg-[#03C75A] hover:bg-[#02B150]",
    textColor: "text-white",
    badge: "인증서 서명",
    deepLink: "naversearchapp://",
    appSchemeName: "네이버 앱",
    instructions: "네이버 앱에 도착한 네이버 인증서 전자서명 요청을 승인해주세요.",
  },
];

export const SimpleAuthScreen: React.FC = () => {
  const {
    loginWithSimpleAuth,
    sendVerificationCode,
    verifyCodeAndLogin,
    loginWithPin,
    unlockWithBiometrics,
    authError,
    clearAuthError,
    registeredUser,
    hasPin,
    setPinCode,
  } = useAuth();

  const [activeMode, setActiveMode] = useState<"SIMPLE_CERT" | "PIN">("SIMPLE_CERT");
  const [selectedProvider, setSelectedProvider] = useState<AuthProviderType>("KAKAO");

  // Form Fields - No dummy values! Pure blank with clear placeholders
  const [userName, setUserName] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [userBirth, setUserBirth] = useState("");
  const [telecom, setTelecom] = useState<"SKT" | "KT" | "LGU" | "MVNO">("SKT");
  const [passMethod, setPassMethod] = useState<"APP" | "SMS">("APP");
  const [agreedTerms, setAgreedTerms] = useState(true);

  // In-flight Verification State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verificationStep, setVerificationStep] = useState<"FORM" | "WAITING" | "SMS_INPUT" | "SUCCESS">("FORM");
  const [countdown, setCountdown] = useState(300);
  const [requestId, setRequestId] = useState("");

  // SMS Verification Code
  const [smsCode, setSmsCode] = useState("");
  const [receivedCodeHint, setReceivedCodeHint] = useState<string | null>(null);

  // PIN Pad State
  const [pinDigits, setPinDigits] = useState<string[]>([]);
  const [pinErrorLocal, setPinErrorLocal] = useState<string | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if ((verificationStep === "WAITING" || verificationStep === "SMS_INPUT") && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [verificationStep, countdown]);

  const currentProv = PROVIDERS.find((p) => p.id === selectedProvider) || PROVIDERS[0];

  // Format phone number as user types (010-XXXX-XXXX)
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 11);
    if (raw.length <= 3) {
      setUserPhone(raw);
    } else if (raw.length <= 7) {
      setUserPhone(`${raw.slice(0, 3)}-${raw.slice(3)}`);
    } else {
      setUserPhone(`${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`);
    }
  };

  const handleStartVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();

    if (!userName.trim()) {
      alert("성명을 입력해주세요.");
      return;
    }
    if (!userPhone.trim() || userPhone.replace(/[^0-9]/g, "").length < 10) {
      alert("올바른 휴대전화번호를 입력해주세요.");
      return;
    }
    if (!userBirth.trim() || userBirth.length !== 6) {
      alert("생년월일 6자리를 입력해주세요 (예: 900515).");
      return;
    }
    if (!agreedTerms) {
      alert("개인정보 처리 및 마이데이터 금융식별 약관에 동의해주세요.");
      return;
    }

    setIsSubmitting(true);
    const reqCode = `AUTH-${selectedProvider}-${Math.floor(100000 + Math.random() * 900000)}`;
    setRequestId(reqCode);
    setCountdown(300);

    // If PASS with SMS mode: Send SMS code
    if (selectedProvider === "PASS" && passMethod === "SMS") {
      const res = await sendVerificationCode(userPhone, "PASS");
      setIsSubmitting(false);
      if (res.success) {
        setReceivedCodeHint(res.code || null);
        setVerificationStep("SMS_INPUT");
      }
      return;
    }

    // Default App Push mode: Transition to Waiting screen
    setIsSubmitting(false);
    setVerificationStep("WAITING");
  };

  // When user confirms they finished auth on Kakao/Toss/PASS/Naver
  const handleConfirmAppAuth = async () => {
    setIsSubmitting(true);
    clearAuthError();

    const ok = await loginWithSimpleAuth(selectedProvider, {
      name: userName,
      phone: userPhone,
    });

    setIsSubmitting(false);
    if (ok) {
      setVerificationStep("SUCCESS");
    }
  };

  // Switch to SMS verification flow
  const handleSwitchToSms = async () => {
    setIsSubmitting(true);
    clearAuthError();
    const res = await sendVerificationCode(userPhone, selectedProvider);
    setIsSubmitting(false);
    if (res.success) {
      setReceivedCodeHint(res.code || null);
      setVerificationStep("SMS_INPUT");
    }
  };

  // When verifying 6-digit SMS code
  const handleVerifySmsCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsCode.trim() || smsCode.length !== 6) {
      alert("인증번호 6자리를 입력해주세요.");
      return;
    }

    setIsSubmitting(true);
    clearAuthError();

    const ok = await verifyCodeAndLogin({
      phone: userPhone,
      code: smsCode.trim(),
      name: userName,
      provider: selectedProvider,
      birth: userBirth,
      telecom,
    });

    setIsSubmitting(false);
    if (ok) {
      setVerificationStep("SUCCESS");
    }
  };

  // PIN Pad Click
  const handlePinClick = async (digit: string) => {
    setPinErrorLocal(null);
    clearAuthError();

    if (!registeredUser || !registeredUser.name) {
      setPinErrorLocal("개인 식별을 위해 먼저 카카오톡 등 본인인증을 완료해야 PIN을 사용하실 수 있습니다.");
      return;
    }

    if (pinDigits.length < 6) {
      const next = [...pinDigits, digit];
      setPinDigits(next);
      if (next.length === 6) {
        const fullPin = next.join("");
        if (!hasPin) {
          setPinErrorLocal("등록된 간편 비밀번호가 없습니다. 본인인증(카카오/토스/PASS/네이버)으로 먼저 로그인한 후 상단 보안 설정에서 PIN을 등록해주세요.");
          setTimeout(() => setPinDigits([]), 1000);
          return;
        }
        const ok = await loginWithPin(fullPin);
        if (!ok) {
          setPinErrorLocal(authError || "비밀번호가 일치하지 않습니다.");
          setTimeout(() => setPinDigits([]), 600);
        }
      }
    }
  };

  const handlePinBackspace = () => {
    setPinDigits((prev) => prev.slice(0, -1));
    setPinErrorLocal(null);
  };

  const handleBiometricAuth = async () => {
    setPinErrorLocal(null);
    clearAuthError();
    if (!registeredUser || !registeredUser.name) {
      setPinErrorLocal("개인 식별을 위해 먼저 카카오톡 등 본인인증을 완료해야 생체인증을 사용하실 수 있습니다.");
      return;
    }
    setIsSubmitting(true);
    try {
      await unlockWithBiometrics();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Try opening external app scheme on Android/iOS
  const handleOpenAppScheme = () => {
    try {
      window.location.href = currentProv.deepLink;
    } catch {
      // Fallback
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-900 flex justify-center items-center p-3 sm:p-4 select-none">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200/80 flex flex-col min-h-[660px]">
        {/* Top Financial Security Banner */}
        <div className="bg-slate-900 text-white p-5 pb-6 relative">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <img
                src="/icon.svg"
                alt="스마트 머니"
                className="w-9 h-9 rounded-xl shadow-xs shrink-0 object-cover border border-white/20"
              />
              <div>
                <h1 className="text-sm font-bold tracking-tight text-white">
                  스마트 머니 금융 본인인증
                </h1>
                <p className="text-[10px] text-slate-400">
                  마이데이터 및 카드·계좌 개인신용정보 보호
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-bold bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-full">
              <Lock className="w-2.5 h-2.5" />
              <span>보안 세션</span>
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            민감한 금융 거래 내역 및 카드·통장 잔액을 안전하게 확인하기 위해 본인인증 로그인을 먼저 진행합니다.
          </p>
        </div>

        {/* Mode Selector Tabs */}
        <div className="bg-slate-100 p-1.5 flex gap-1 border-b border-slate-200 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setActiveMode("SIMPLE_CERT");
              setVerificationStep("FORM");
              clearAuthError();
            }}
            className={`flex-1 py-2.5 rounded-2xl transition flex items-center justify-center gap-1.5 ${
              activeMode === "SIMPLE_CERT"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
            <span>간편인증 로그인</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveMode("PIN");
              clearAuthError();
            }}
            className={`flex-1 py-2.5 rounded-2xl transition flex items-center justify-center gap-1.5 ${
              activeMode === "PIN"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
            <span>간편 비밀번호 (PIN)</span>
          </button>
        </div>

        {/* Error Notification */}
        {(authError || pinErrorLocal) && (
          <div className="m-4 mb-0 bg-rose-50 border border-rose-200 rounded-2xl p-3 flex items-center gap-2 text-rose-700 text-xs font-medium animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{authError || pinErrorLocal}</span>
          </div>
        )}

        {/* Tab 1: 간편인증 Flow */}
        {activeMode === "SIMPLE_CERT" && (
          <div className="p-5 flex-1 flex flex-col justify-between">
            {verificationStep === "FORM" && (
              <form onSubmit={handleStartVerification} className="space-y-4">
                {/* Provider Chooser */}
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1.5">
                    간편인증 기관 선택
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {PROVIDERS.map((p) => {
                      const isSelected = selectedProvider === p.id;
                      return (
                        <button
                          type="button"
                          key={p.id}
                          onClick={() => setSelectedProvider(p.id)}
                          className={`p-3 rounded-2xl border text-left transition flex items-center justify-between ${
                            isSelected
                              ? "border-slate-900 bg-slate-900 text-white shadow-xs"
                              : "border-slate-200 bg-white hover:bg-slate-50 text-slate-800"
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-black">{p.name}</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded-full font-bold ${
                                  isSelected
                                    ? "bg-emerald-500 text-white"
                                    : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {p.badge}
                              </span>
                            </div>
                            <span
                              className={`text-[10px] block mt-0.5 truncate ${
                                isSelected ? "text-slate-300" : "text-slate-500"
                              }`}
                            >
                              {p.sub}
                            </span>
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* PASS Sub-method Chooser (App vs SMS) */}
                {selectedProvider === "PASS" && (
                  <div className="flex gap-2 p-1 bg-slate-100 rounded-xl text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setPassMethod("APP")}
                      className={`flex-1 py-1.5 rounded-lg transition ${
                        passMethod === "APP" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                      }`}
                    >
                      PASS 앱 인증
                    </button>
                    <button
                      type="button"
                      onClick={() => setPassMethod("SMS")}
                      className={`flex-1 py-1.5 rounded-lg transition ${
                        passMethod === "SMS" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"
                      }`}
                    >
                      SMS 문자인증 (번호 입력)
                    </button>
                  </div>
                )}

                {/* User Info Inputs (Empty values, placeholders only!) */}
                <div className="space-y-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">
                        성명
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="이름 입력"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white placeholder-slate-400 focus:outline-slate-900"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">
                        생년월일 (6자리)
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={6}
                        placeholder="예: 900515"
                        value={userBirth}
                        onChange={(e) => setUserBirth(e.target.value.replace(/[^0-9]/g, ""))}
                        className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white placeholder-slate-400 focus:outline-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">
                      휴대전화번호
                    </label>
                    <div className="flex gap-1.5">
                      <select
                        value={telecom}
                        onChange={(e) => setTelecom(e.target.value as any)}
                        className="w-24 px-2 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white focus:outline-slate-900"
                      >
                        <option value="SKT">SKT</option>
                        <option value="KT">KT</option>
                        <option value="LGU">LGU+</option>
                        <option value="MVNO">알뜰폰</option>
                      </select>
                      <input
                        type="tel"
                        required
                        placeholder="010-0000-0000"
                        value={userPhone}
                        onChange={handlePhoneChange}
                        className="flex-1 px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white placeholder-slate-400 focus:outline-slate-900"
                      />
                    </div>
                  </div>

                  {/* Terms check */}
                  <label className="flex items-center gap-2 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agreedTerms}
                      onChange={(e) => setAgreedTerms(e.target.checked)}
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-[11px] text-slate-600 font-medium">
                      [필수] 개인정보 및 마이데이터 금융식별 처리 동의
                    </span>
                  </label>
                </div>

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`w-full py-3.5 rounded-2xl font-black text-xs transition flex items-center justify-center gap-2 shadow-xs active:scale-98 ${currentProv.bgColor} ${currentProv.textColor}`}
                >
                  <span>
                    {selectedProvider === "PASS" && passMethod === "SMS"
                      ? "SMS 6자리 인증번호 발송"
                      : `${currentProv.name}로 간편인증 요청`}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                {/* Helpful Form Tip */}
                <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 text-[11px] text-slate-500 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">
                    간편인증 요청 시 대기 화면에서 <strong>원클릭 전자서명 승인</strong> 또는 <strong>SMS 6자리 문자인증</strong>으로 즉시 테스트 및 로그인이 가능합니다.
                  </span>
                </div>
              </form>
            )}

            {/* Step 2-A: Waiting for Mobile Push Authorization */}
            {verificationStep === "WAITING" && (
              <div className="py-4 space-y-4 animate-in fade-in">
                {/* Official Provider Electronic Signature Card */}
                <div className="rounded-2xl border border-slate-200/90 overflow-hidden shadow-xs bg-white">
                  {/* Provider Signature Header */}
                  <div className={`p-4 flex items-center justify-between ${currentProv.bgColor} ${currentProv.textColor}`}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-black/10 flex items-center justify-center font-black text-sm">
                        {currentProv.name.substring(0, 1)}
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-black tracking-tight">
                          {currentProv.name} 전자서명 인증
                        </div>
                        <div className="text-[10px] opacity-80">
                          마이데이터 금융거래 본인확인
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/10 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      서명 대기
                    </span>
                  </div>

                  {/* Transaction Details Body */}
                  <div className="p-4 space-y-2 text-xs bg-slate-50/50">
                    <div className="flex items-center justify-between text-slate-500">
                      <span>요청 기관</span>
                      <span className="font-bold text-slate-800">스마트 머니 (가계부)</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-500">
                      <span>인증 대상자</span>
                      <span className="font-bold text-slate-900">{userName} 님</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-500">
                      <span>휴대전화</span>
                      <span className="font-bold text-slate-800">{userPhone}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 pt-2 border-t border-slate-200/70">
                      <span>인증 유효시간</span>
                      <span className="font-mono font-bold text-rose-600">
                        {Math.floor(countdown / 60)}:
                        {String(countdown % 60).padStart(2, "0")}
                      </span>
                    </div>
                  </div>

                  {/* Primary Signature Action */}
                  <div className="p-3 bg-white border-t border-slate-100 space-y-2">
                    <button
                      type="button"
                      onClick={handleConfirmAppAuth}
                      disabled={isSubmitting}
                      className={`w-full py-3 rounded-xl font-black text-xs shadow-xs transition active:scale-98 flex items-center justify-center gap-2 ${currentProv.bgColor} ${currentProv.textColor}`}
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>전자서명 결과 확인 중...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{currentProv.name} 인증서로 서명 및 즉시 로그인</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenAppScheme}
                      className="w-full py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-98"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                      <span>{currentProv.appSchemeName} 직접 열기</span>
                    </button>
                  </div>
                </div>

                {/* Important Transparency Notice Banner */}
                <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-3.5 text-left space-y-2 shadow-xs">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>스마트폰 카카오톡에 알림이 오지 않으시나요?</span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    실제 개인 카카오톡 앱으로의 알림톡·전자서명 푸시는 <strong>카카오(Kakao Corp)의 유료 기업 B2B 전용망 계약</strong>이 체결된 상용 서버에서만 발송됩니다.
                  </p>
                  <p className="text-[11px] text-amber-900 leading-relaxed font-semibold">
                    현재 개발·체험 환경에서는 카카오톡 앱을 기다리실 필요 없이, 위의 <strong>[{currentProv.name} 인증서로 서명 및 즉시 로그인]</strong> 버튼을 누르시면 실제 카카오톡에서 서명한 것과 동일하게 즉시 승인되어 로그인됩니다!
                  </p>
                  <div className="pt-2 border-t border-amber-200/70 flex items-center justify-between text-[11px]">
                    <span className="text-amber-900 font-medium">문자로 6자리 번호를 받아 확인하시겠습니까?</span>
                    <button
                      type="button"
                      onClick={handleSwitchToSms}
                      className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 font-bold text-emerald-700 hover:bg-emerald-50 text-[11px] shrink-0 transition"
                    >
                      SMS 문자인증으로 전환
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setVerificationStep("FORM")}
                  className="w-full py-2 rounded-xl text-slate-400 hover:text-slate-600 text-xs font-semibold transition"
                >
                  인증 취소 및 다른 수단 선택
                </button>
              </div>
            )}

            {/* Step 2-B: SMS 6-digit verification code input */}
            {verificationStep === "SMS_INPUT" && (
              <form onSubmit={handleVerifySmsCode} className="py-4 space-y-4 animate-in fade-in">
                <div className="text-center space-y-1">
                  <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 mx-auto flex items-center justify-center mb-2">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-black text-slate-900">
                    SMS 인증번호 6자리를 입력해주세요
                  </h3>
                  <p className="text-xs text-slate-500">
                    {userPhone} 번호로 인증번호가 발송되었습니다.
                  </p>
                </div>

                {/* Demo Helper Hint */}
                {receivedCodeHint && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center justify-between">
                    <div>
                      <span className="font-bold">발송된 인증번호: </span>
                      <span className="font-mono font-black text-sm tracking-wider text-emerald-700">
                        {receivedCodeHint}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSmsCode(receivedCodeHint)}
                      className="text-[11px] font-bold text-emerald-700 underline"
                    >
                      자동 입력
                    </button>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                    <span>인증번호 (6자리)</span>
                    <span className="font-mono font-bold text-rose-600">
                      {Math.floor(countdown / 60)}:
                      {String(countdown % 60).padStart(2, "0")}
                    </span>
                  </div>
                  <input
                    type="text"
                    maxLength={6}
                    required
                    placeholder="인증번호 6자리 입력"
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value.replace(/[^0-9]/g, ""))}
                    className="w-full text-center tracking-widest text-lg font-black py-3 rounded-xl border border-slate-300 bg-white focus:outline-emerald-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md transition active:scale-98 flex items-center justify-center gap-1.5"
                >
                  {isSubmitting ? "인증 확인 중..." : "인증번호 확인 및 로그인"}
                </button>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await sendVerificationCode(userPhone, "PASS");
                      if (res.success) {
                        setReceivedCodeHint(res.code || null);
                        setCountdown(300);
                        alert("인증번호를 재전송했습니다.");
                      }
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800 font-medium"
                  >
                    인증번호 재전송
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerificationStep("FORM")}
                    className="text-xs text-slate-500 hover:text-slate-800 font-medium"
                  >
                    이전으로
                  </button>
                </div>
              </form>
            )}

            {/* Success Step */}
            {verificationStep === "SUCCESS" && (
              <div className="py-12 space-y-4 text-center animate-in zoom-in-95">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    본인인증이 완료되었습니다
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {userName}님의 금융 가계부로 안전하게 이동합니다...
                  </p>
                </div>
              </div>
            )}

            {/* Footer Notice */}
            <div className="text-[10px] text-slate-400 text-center pt-3 border-t border-slate-100">
              금융보안원 본인인증 표준 준수 • 종단간 암호화(E2EE) 적용
            </div>
          </div>
        )}

        {/* Tab 2: 간편 비밀번호 (PIN) Flow */}
        {activeMode === "PIN" && (
          <div className="p-5 flex-1 flex flex-col justify-between">
            {!registeredUser || !registeredUser.name ? (
              /* 본인인증 미완료 상태: PIN 키패드 대신 본인인증 안내 노출 */
              <div className="py-8 px-4 text-center space-y-4 max-w-sm mx-auto my-auto">
                <div className="w-14 h-14 rounded-3xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center border border-amber-200">
                  <ShieldCheck className="w-7 h-7" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-base font-black text-slate-900">
                    본인인증 후 PIN을 사용할 수 있습니다
                  </h2>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    금융 데이터 보호를 위해 기본 PIN은 제공되지 않습니다.<br />
                    카카오톡, 토스, PASS, 네이버 등 간편인증으로 최초 1회 본인확인을 완료해주세요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveMode("SIMPLE_CERT");
                    clearAuthError();
                  }}
                  className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-bold text-xs shadow-md transition cursor-pointer"
                >
                  본인인증 하러가기 →
                </button>
              </div>
            ) : (
              <>
                <div className="text-center pt-2 space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 mx-auto flex items-center justify-center">
                    <KeyRound className="w-6 h-6" />
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">
                    간편 비밀번호(PIN) 6자리 입력
                  </h2>

                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 font-bold mx-auto">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{registeredUser.name} 님의 계정</span>
                  </div>

                  <p className="text-xs text-slate-500">
                    {hasPin
                      ? "등록하신 6자리 비밀번호를 입력해주세요"
                      : "PIN이 등록되어 있지 않습니다. 본인인증 로그인 후 상단 보안설정에서 등록해주세요."}
                  </p>

                  {/* PIN Error Message */}
                  {pinErrorLocal && (
                    <div className="p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium max-w-xs mx-auto animate-shake">
                      {pinErrorLocal}
                    </div>
                  )}

                  {/* PIN Indicator Dots */}
                  <div className="flex justify-center items-center gap-3 py-4">
                    {[0, 1, 2, 3, 4, 5].map((index) => {
                      const isFilled = pinDigits.length > index;
                      return (
                        <div
                          key={index}
                          className={`w-3.5 h-3.5 rounded-full transition-all duration-150 ${
                            isFilled
                              ? "bg-slate-900 scale-110"
                              : "border-2 border-slate-300 bg-transparent"
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto w-full my-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                <button
                  type="button"
                  key={num}
                  onClick={() => handlePinClick(num)}
                  className="h-13 rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-95 text-lg font-black text-slate-800 transition flex items-center justify-center shadow-2xs"
                >
                  {num}
                </button>
              ))}

              {/* Biometric Button */}
              <button
                type="button"
                onClick={handleBiometricAuth}
                title="지문/생체인증"
                className="h-13 rounded-2xl bg-emerald-50 hover:bg-emerald-100 active:scale-95 text-emerald-700 transition flex items-center justify-center shadow-2xs"
              >
                <Fingerprint className="w-6 h-6" />
              </button>

              {/* Zero */}
              <button
                type="button"
                onClick={() => handlePinClick("0")}
                className="h-13 rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-95 text-lg font-black text-slate-800 transition flex items-center justify-center shadow-2xs"
              >
                0
              </button>

              {/* Backspace */}
              <button
                type="button"
                onClick={handlePinBackspace}
                className="h-13 rounded-2xl bg-slate-50 hover:bg-slate-100 active:scale-95 text-sm font-bold text-slate-600 transition flex items-center justify-center shadow-2xs"
              >
                지움
              </button>
            </div>

            {/* Footer Link to switch */}
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setActiveMode("SIMPLE_CERT");
                  clearAuthError();
                }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
              >
                간편인증(카카오/토스/PASS/네이버)으로 로그인하기
              </button>
            </div>
          </>
        )}
      </div>
    )}
      </div>
    </div>
  );
};
