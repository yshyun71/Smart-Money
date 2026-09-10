import React, { useState } from "react";
import { useFinance } from "../../context/FinanceContext";
import { useAuth } from "../../context/AuthContext";
import { UserSecurityModal } from "../auth/UserSecurityModal";
import { PWAInstallButton } from "../pwa/PWAInstallButton";
import { NavTab } from "./BottomNavigation";
import {
  RefreshCw,
  Wallet,
  Smartphone,
  Maximize2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Bell,
  CreditCard,
  ShieldCheck,
  Lock,
  LogOut,
  User,
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

  const { user } = useAuth();
  const [showSecurityModal, setShowSecurityModal] = useState(false);

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
            title="금융 보안 인증 및 PIN/세션 관리 (클릭하여 확인)"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-bold text-slate-800 text-[11px] max-w-[42px] sm:max-w-[70px] truncate">
              {user?.name || "인증"}
            </span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 group-hover:scale-110 transition-transform" />
          </button>

          {/* Connected Assets Quick Access */}
          <button
            onClick={() => onNavigateTab?.("assets")}
            title="연동된 카드 및 계좌 관리"
            className="p-1.5 rounded-xl border border-slate-200/80 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 transition active:scale-95"
          >
            <CreditCard className="w-4 h-4" />
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

          {/* PWA Install Icon */}
          <PWAInstallButton compact />

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
    </header>
  );
};
