import React, { useState, useEffect } from "react";
import { useFinance } from "../../context/FinanceContext";
import { useAuth } from "../../context/AuthContext";
import { UserSecurityModal } from "../auth/UserSecurityModal";
import { PinSetupModal } from "../auth/PinSetupModal";
import { AIKeyModal } from "../settings/AIKeyModal";
import { PWAInstallGuideModal } from "../pwa/PWAInstallButton";
import { hasApiKey, onApiKeyChange } from "../../services/aiClient";
import { NavTab } from "./BottomNavigation";
import {
  RefreshCw,
  Smartphone,
  Maximize2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Bell,
  CreditCard,
  ShieldCheck,
  Settings,
  KeyRound,
  Sparkles,
} from "lucide-react";

export const MobileHeader: React.FC<{
  onNavigateTab?: (tab: NavTab) => void;
}> = ({ onNavigateTab }) => {
  const {
    selectedMonth,
    setSelectedMonth,
    syncAccounts,
    isSyncing,
    viewMode,
    setViewMode,
    budgetAlerts,
  } = useFinance();

  const { profile } = useAuth();
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [showAIKeyModal, setShowAIKeyModal] = useState(false);
  const [aiKeyRegistered, setAiKeyRegistered] = useState(hasApiKey);

  // Keep the "미등록" badge in sync when the key is added or removed
  useEffect(() => onApiKeyChange(setAiKeyRegistered), []);

  // Dismiss the settings dropdown with Escape
  useEffect(() => {
    if (!showSettingsMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSettingsMenu(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettingsMenu]);

  const currentActualMonth = `${new Date().getFullYear()}-${String(
    new Date().getMonth() + 1
  ).padStart(2, "0")}`;
  const isCurrentMonth = selectedMonth === currentActualMonth;

  const handleResetToCurrentMonth = () => {
    setSelectedMonth(currentActualMonth);
  };

  const handlePrevMonth = () => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const prevDate = new Date(year, month - 2, 1);
    const newMonth = `${prevDate.getFullYear()}-${String(
      prevDate.getMonth() + 1
    ).padStart(2, "0")}`;
    setSelectedMonth(newMonth);
  };

  const handleNextMonth = () => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const nextDate = new Date(year, month, 1);
    const newMonth = `${nextDate.getFullYear()}-${String(
      nextDate.getMonth() + 1
    ).padStart(2, "0")}`;
    setSelectedMonth(newMonth);
  };

  const formatMonthTitle = (mStr: string) => {
    const [y, m] = mStr.split("-");
    return `${y}년 ${Number(m)}월`;
  };

  const alertCount = budgetAlerts.length;

  const settingsMenuItems = [
    {
      icon: CreditCard,
      label: "연동된 카드 및 계좌관리",
      description: "은행 계좌·카드 등록 및 잔액 확인",
      badge: undefined as string | undefined,
      onSelect: () => onNavigateTab?.("assets"),
    },
    {
      icon: KeyRound,
      label: "간편비밀번호 등록/변경",
      description: "잠금 해제에 사용할 6자리 PIN",
      badge: undefined,
      onSelect: () => setShowPinModal(true),
    },
    {
      icon: Sparkles,
      label: "AI 등록",
      description: "내 API 키로 AI 절약 분석·문자 인식 사용",
      badge: aiKeyRegistered ? undefined : "미등록",
      onSelect: () => setShowAIKeyModal(true),
    },
    {
      icon: Smartphone,
      label: "스마트폰에 '스마트 머니' 전용앱 설치",
      description: "설치 안내 및 모바일 전용 링크·QR 코드",
      badge: undefined,
      onSelect: () => setShowPwaGuide(true),
    },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-4 pt-2.5 pb-2.5 select-none w-full shadow-2xs">
      {/* Top Main Navigation Row */}
      <div className="flex items-center justify-between gap-2">
        {/* Left: Brand Identity */}
        <div
          onClick={() => onNavigateTab?.("home")}
          className="flex items-center gap-2 cursor-pointer group"
          title="홈 대시보드로 이동"
        >
          <img
            src="/icon.svg"
            alt="스마트 머니"
            className="w-8 h-8 rounded-xl shadow-xs shadow-emerald-500/20 group-hover:scale-105 transition-transform shrink-0 object-cover"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-extrabold tracking-tight text-slate-900 truncate">
                스마트 머니
              </h1>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-1.5 py-0.5 rounded-md leading-none shrink-0">
                AI 가계부
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-medium truncate">
              카드·계좌 자동 분석
            </p>
          </div>
        </div>

        {/* Right: Cleanly Grouped Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* User Authentication & Security Capsule */}
          <button
            id="user-security-capsule-btn"
            onClick={() => setShowSecurityModal(true)}
            className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200/90 text-xs transition active:scale-95 group cursor-pointer"
            title="내 등록 정보 및 보안 설정"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-bold text-slate-800 text-[11px] max-w-[42px] sm:max-w-[70px] truncate">
              {profile?.name || "내 정보"}
            </span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 group-hover:scale-110 transition-transform" />
          </button>

          {/* Budget Alert Bell */}
          <button
            onClick={() => onNavigateTab?.("budget")}
            title="예산 초과 및 지출 알림 확인"
            className="relative p-1.5 rounded-xl border border-slate-200/80 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition active:scale-95"
          >
            <Bell className="w-4 h-4" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-rose-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center ring-2 ring-white animate-pulse">
                {alertCount}
              </span>
            )}
          </button>

          {/* Real-time Sync Button */}
          <button
            id="sync-accounts-btn"
            onClick={syncAccounts}
            disabled={isSyncing}
            title="카드/계좌 거래내역 실시간 동기화"
            className="p-1.5 rounded-xl border border-slate-200/80 text-slate-600 hover:text-emerald-600 hover:bg-slate-100 transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 ${isSyncing ? "animate-spin text-emerald-600" : ""}`}
            />
          </button>

          {/* Settings Menu */}
          <div className="relative">
            <button
              id="settings-menu-btn"
              onClick={() => setShowSettingsMenu((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={showSettingsMenu}
              title="설정"
              className={`p-1.5 rounded-xl border transition active:scale-95 ${
                showSettingsMenu
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200/80 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <Settings
                className={`w-4 h-4 transition-transform duration-200 ${
                  showSettingsMenu ? "rotate-45" : ""
                }`}
              />
            </button>

            {showSettingsMenu && (
              <>
                {/* Click-outside catcher */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowSettingsMenu(false)}
                />

                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 z-50 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                >
                  <div className="px-3 pt-2.5 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                    설정
                  </div>
                  {settingsMenuItems.map(({ icon: Icon, label, description, badge, onSelect }) => (
                    <button
                      key={label}
                      role="menuitem"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        onSelect();
                      }}
                      className="w-full px-3 py-2.5 flex items-start gap-2.5 text-left hover:bg-slate-50 active:bg-slate-100 transition border-t border-slate-100 first-of-type:border-t-0"
                    >
                      <div className="w-7 h-7 shrink-0 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-slate-900 leading-snug flex items-center gap-1.5">
                          <span className="min-w-0">{label}</span>
                          {badge && (
                            <span className="shrink-0 text-[9px] font-bold text-amber-700 bg-amber-100 border border-amber-200/70 px-1.5 py-0.5 rounded-full leading-none">
                              {badge}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
                          {description}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* View mode toggle (Phone frame vs Wide) */}
          <button
            id="toggle-viewmode-btn"
            onClick={() =>
              setViewMode(
                viewMode === "MOBILE_FRAME" ? "RESPONSIVE_FULL" : "MOBILE_FRAME"
              )
            }
            title={
              viewMode === "MOBILE_FRAME"
                ? "확장 와이드 전체 화면 전환"
                : "모바일 폰 프레임 전환"
            }
            className="flex items-center justify-center p-1.5 rounded-xl border border-slate-200/80 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition active:scale-95"
          >
            {viewMode === "MOBILE_FRAME" ? (
              <Maximize2 className="w-4 h-4 text-slate-600" />
            ) : (
              <Smartphone className="w-4 h-4 text-emerald-600" />
            )}
          </button>
        </div>
      </div>

      {/* Month & Financial Period Navigator Bar */}
      <div className="mt-2.5 flex items-center justify-between bg-slate-50/90 rounded-2xl px-2.5 py-1.5 border border-slate-200/70">
        <button
          onClick={handlePrevMonth}
          title="이전 달 조회"
          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-xl transition active:scale-95 shadow-2xs"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
            <Calendar className="w-3.5 h-3.5 text-emerald-600" />
            <span>{formatMonthTitle(selectedMonth)} 가계부</span>
          </div>

          {!isCurrentMonth && (
            <button
              onClick={handleResetToCurrentMonth}
              className="text-[10px] font-bold text-emerald-700 bg-emerald-100/70 hover:bg-emerald-200/70 px-2 py-0.5 rounded-full transition active:scale-95"
            >
              이번 달로
            </button>
          )}
        </div>

        <button
          onClick={handleNextMonth}
          title="다음 달 조회"
          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-xl transition active:scale-95 shadow-2xs"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* User Security Modal */}
      <UserSecurityModal
        isOpen={showSecurityModal}
        onClose={() => setShowSecurityModal(false)}
      />

      {/* Settings menu targets */}
      <PinSetupModal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
      />

      <AIKeyModal
        isOpen={showAIKeyModal}
        onClose={() => setShowAIKeyModal(false)}
      />

      <PWAInstallGuideModal
        isOpen={showPwaGuide}
        onClose={() => setShowPwaGuide(false)}
      />
    </header>
  );
};
