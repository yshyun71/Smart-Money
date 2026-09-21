import React, { useState, useEffect, useMemo } from "react";
import { useFinance } from "../../context/FinanceContext";
import { useAuth } from "../../context/AuthContext";
import { UserSecurityModal } from "../auth/UserSecurityModal";
import { AIKeyModal } from "../settings/AIKeyModal";
import { UserManageModal } from "../settings/UserManageModal";
import { INSTALL_FEATURE_NAME, PWAInstallGuideModal } from "../pwa/PWAInstallButton";
import { MonthPickerModal } from "../transactions/MonthPickerModal";
import {
  activeProviderLabel,
  hasApiKey,
  onAiSettingsChange,
} from "../../services/aiClient";
import { NavTab } from "./BottomNavigation";
import {
  RefreshCw,
  Smartphone,
  Maximize2,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Bell,
  CreditCard,
  ShieldCheck,
  Settings,
  Sparkles,
  UserPlus,
  LogOut,
} from "lucide-react";

/**
 * 월 이동 바를 감출 탭.
 *
 * **이유가 두 가지이고, 서로 다릅니다.**
 *
 * - `assets` — 달이라는 개념이 없습니다. 그 화면은 **지금의** 잔액과 **앞으로**
 *   낼 청구액을 보여 주므로 달을 고를 여지가 없고, `selectedMonth`를 읽는 곳이
 *   한 군데도 없습니다. 눌러도 아무 일이 없는 조작기를 남겨 두면 사용자는
 *   자기가 무엇을 잘못했는지 찾게 됩니다 — 실제로 "이게 하는 역할이
 *   무엇인가요?"라는 질문을 받았습니다.
 * - `analytics` — 달에 따라 값이 **바뀌는데도** 감춥니다. 그 화면은 월별·연도별·
 *   기간 추이 세 모드를 갖고, 연도와 기간은 이미 화면 안에서 고릅니다. 월별만
 *   조작기가 화면 밖 위쪽에 있으면 셋 중 하나만 규칙이 다르고, 나머지 두 모드
 *   에서는 그 바가 아무 일도 하지 않습니다. 그래서 **월 선택도 화면 안으로**
 *   옮겼습니다(§12.5).
 *
 * → 새 탭을 넣을 때 "달을 쓰니까 목록에서 빼야지"로 판단하지 마세요. 기준은
 *   **그 화면이 자기 기간 선택기를 갖는가**입니다.
 *
 * 포함이 아니라 **제외** 목록인 이유: 나머지 탭은 전부 달에 따라 값이 바뀌고
 * 자기 선택기가 없습니다(컨텍스트가 내주는 `transactions` 자체가 그 달로
 * 걸러진 목록입니다). 새 탭이 생겼을 때 목록에 넣는 것을 잊어 바를 잃는 쪽보다,
 * 필요 없을 때 빼는 쪽이 안전합니다.
 */
const MONTHLESS_TABS: NavTab[] = ["assets", "analytics"];

export const MobileHeader: React.FC<{
  onNavigateTab?: (tab: NavTab) => void;
  /** 월 이동 바를 띄울지 정하는 데 씁니다. */
  activeTab?: NavTab;
}> = ({ onNavigateTab, activeTab }) => {
  const {
    selectedMonth,
    setSelectedMonth,
    allTransactions,
    syncAccounts,
    isSyncing,
    viewMode,
    setViewMode,
    budgetAlerts,
  } = useFinance();

  const { currentUser, users, logout } = useAuth();
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [showAIKeyModal, setShowAIKeyModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [aiKeyRegistered, setAiKeyRegistered] = useState(() => hasApiKey());
  const [aiProvider, setAiProvider] = useState(() => activeProviderLabel());

  // Keep the menu row in sync when a key is added, removed or switched
  useEffect(
    () =>
      onAiSettingsChange(() => {
        setAiKeyRegistered(hasApiKey());
        setAiProvider(activeProviderLabel());
      }),
    []
  );

  // Dismiss the settings dropdown with Escape
  useEffect(() => {
    if (!showSettingsMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSettingsMenu(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettingsMenu]);

  /*
    달마다 몇 건이 있는지. 고르기 전에 보이면 빈 달을 헛되게 열지 않습니다.
    상단 바는 가계부 전체를 다루므로 계좌를 가리지 않고 셉니다.
  */
  const monthCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of allTransactions as { date: string }[]) {
      const key = tx.date.slice(0, 7);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [allTransactions]);

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
      danger: false,
      onSelect: () => onNavigateTab?.("assets"),
    },
    {
      icon: Sparkles,
      label: "AI 등록",
      description: aiProvider
        ? `사용 중: ${aiProvider}`
        : "Gemini·Claude·ChatGPT 중 내 키를 등록",
      badge: aiKeyRegistered ? undefined : "미등록",
      danger: false,
      onSelect: () => setShowAIKeyModal(true),
    },
    {
      icon: UserPlus,
      // 추가만이 아니라 수정·삭제까지 하는 화면입니다
      label: "사용자 관리",
      description: `사용자 추가·수정·삭제 · 현재 ${users.length}명`,
      badge: undefined,
      danger: false,
      onSelect: () => setShowUserModal(true),
    },
    {
      icon: Smartphone,
      label: INSTALL_FEATURE_NAME,
      description: "설치 안내 및 모바일 전용 링크·QR 코드",
      badge: undefined,
      danger: false,
      onSelect: () => setShowPwaGuide(true),
    },
    {
      icon: LogOut,
      label: "로그아웃",
      description: "로그인 화면으로 돌아갑니다",
      badge: undefined,
      danger: true,
      onSelect: logout,
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
              {currentUser?.name || "내 정보"}
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
                  {settingsMenuItems.map(({ icon: Icon, label, description, badge, danger, onSelect }) => (
                    <button
                      key={label}
                      role="menuitem"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        onSelect();
                      }}
                      className={`w-full px-3 py-2.5 flex items-start gap-2.5 text-left transition border-t border-slate-100 first-of-type:border-t-0 ${
                        danger
                          ? "hover:bg-rose-50 active:bg-rose-100"
                          : "hover:bg-slate-50 active:bg-slate-100"
                      }`}
                    >
                      <div
                        className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${
                          danger ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div
                          className={`text-[11px] font-bold leading-snug flex items-center gap-1.5 ${
                            danger ? "text-rose-700" : "text-slate-900"
                          }`}
                        >
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
      {!(activeTab && MONTHLESS_TABS.includes(activeTab)) && (
      <div className="mt-2.5 flex items-center justify-between bg-slate-50/90 rounded-2xl px-2.5 py-1.5 border border-slate-200/70">
        <button
          onClick={handlePrevMonth}
          title="이전 달 조회"
          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-xl transition active:scale-95 shadow-2xs"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          {/*
            연월을 직접 고르는 길. 화살표만 있을 때는 지난 봄 명세서를 보려면
            아홉 번을 눌러야 했고, 달 이름이 눌릴 것처럼 생겼는데 아무 일도
            일어나지 않았습니다 — 가장 눌러 보고 싶은 자리입니다.
          */}
          <button
            type="button"
            onClick={() => setShowMonthPicker(true)}
            title="연월 직접 선택"
            className="flex items-center gap-1.5 text-xs font-black text-slate-800 px-1.5 py-0.5 -mx-1.5 rounded-lg hover:bg-white transition active:scale-95 cursor-pointer"
          >
            <Calendar className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>{formatMonthTitle(selectedMonth)} 가계부</span>
            <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
          </button>

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
      )}

      {/* 연월 직접 선택 — 연월을 고르는 자리는 모두 이 창을 씁니다 (12.6) */}
      <MonthPickerModal
        isOpen={showMonthPicker}
        value={selectedMonth}
        counts={monthCounts}
        onSelect={setSelectedMonth}
        onClose={() => setShowMonthPicker(false)}
      />

      {/* User Security Modal */}
      <UserSecurityModal
        isOpen={showSecurityModal}
        onClose={() => setShowSecurityModal(false)}
      />

      {/* Settings menu targets */}
      <AIKeyModal
        isOpen={showAIKeyModal}
        onClose={() => setShowAIKeyModal(false)}
      />

      <UserManageModal
        isOpen={showUserModal}
        onClose={() => setShowUserModal(false)}
      />

      <PWAInstallGuideModal
        isOpen={showPwaGuide}
        onClose={() => setShowPwaGuide(false)}
      />
    </header>
  );
};
