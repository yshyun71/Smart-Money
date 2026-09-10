import React, { useState, useEffect } from "react";
import { FinanceProvider, useFinance } from "./context/FinanceContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { PinAuthScreen } from "./components/auth/PinAuthScreen";
import { MobileHeader } from "./components/layout/MobileHeader";
import { BottomNavigation, NavTab } from "./components/layout/BottomNavigation";
import { HomeView } from "./components/views/HomeView";
import { LedgerView } from "./components/views/LedgerView";
import { FixedVsVariableView } from "./components/views/FixedVsVariableView";
import { AISavingsCoachView } from "./components/views/AISavingsCoachView";
import { ConnectedAssetsView } from "./components/views/ConnectedAssetsView";
import { AnalyticsDashboardView } from "./components/views/AnalyticsDashboardView";
import { BudgetManagementView } from "./components/views/BudgetManagementView";
import { AddTransactionModal } from "./components/transactions/AddTransactionModal";
import { SMSParserModal } from "./components/modals/SMSParserModal";
import { OfflineIndicator } from "./components/pwa/PWAInstallButton";
import { Wifi, Signal } from "lucide-react";

const MainContent: React.FC = () => {
  const { viewMode, aiAnalysis } = useFinance();
  const [activeTab, setActiveTab] = useState<NavTab>("home");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSMSModalOpen, setIsSMSModalOpen] = useState(false);

  const [currentTime, setCurrentTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes()
    ).padStart(2, "0")}`;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setCurrentTime(
        `${String(now.getHours()).padStart(2, "0")}:${String(
          now.getMinutes()
        ).padStart(2, "0")}`
      );
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const savingsCount =
    aiAnalysis?.savingsRecommendations?.filter((r) => !r.isImplemented)
      .length || 0;

  const renderActiveView = () => {
    switch (activeTab) {
      case "home":
        return (
          <HomeView
            onNavigateTab={setActiveTab}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            onOpenSMSModal={() => setIsSMSModalOpen(true)}
          />
        );
      case "analytics":
        return (
          <AnalyticsDashboardView
            onNavigateToBudget={() => setActiveTab("budget")}
            onNavigateToSavings={() => setActiveTab("ai_coach")}
          />
        );
      case "budget":
        return (
          <BudgetManagementView
            onNavigateToSavings={() => setActiveTab("ai_coach")}
          />
        );
      case "ledger":
        return (
          <LedgerView onOpenAddModal={() => setIsAddModalOpen(true)} />
        );
      case "fixed_variable":
        return (
          <FixedVsVariableView
            onNavigateToSavings={() => setActiveTab("ai_coach")}
          />
        );
      case "ai_coach":
        return <AISavingsCoachView />;
      case "assets":
        return (
          <ConnectedAssetsView
            onOpenSMSModal={() => setIsSMSModalOpen(true)}
          />
        );
      default:
        return (
          <HomeView
            onNavigateTab={setActiveTab}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            onOpenSMSModal={() => setIsSMSModalOpen(true)}
          />
        );
    }
  };

  const isMobileFrame = viewMode === "MOBILE_FRAME";

  return (
    <div
      className={`min-h-screen text-slate-900 flex flex-col items-center justify-start ${
        isMobileFrame
          ? "bg-slate-950 sm:py-5 sm:px-4"
          : "bg-slate-100 sm:bg-slate-950 sm:py-5 sm:px-4"
      }`}
    >
      {/*
        Mobile container / Android Frame

        In frame mode the height must be a real height, not a min/max pair:
        CSS resolves a conflict between them in favour of min-height, so the
        earlier pairing of a 850px minimum with a 92vh maximum forced 850px on
        any short viewport (a tablet, or a browser with visible chrome) and
        pushed the bottom of the frame — and with it the end of the scroll
        area — below the screen. Resetting the minimum matters too, or the
        full-height base class overrides the height the same way.

        The subtracted 3rem covers this wrapper's own vertical padding.
      */}
      <div
        className={`w-full bg-slate-50 flex flex-col relative transition-all duration-300 min-h-screen ${
          isMobileFrame
            ? "max-w-md sm:min-h-0 sm:h-[min(844px,calc(100dvh-3rem))] sm:rounded-[44px] sm:shadow-2xl sm:shadow-black/70 sm:border-[9px] sm:border-slate-800 sm:overflow-hidden"
            : "max-w-4xl sm:rounded-2xl sm:shadow-xl sm:border sm:border-slate-200"
        }`}
      >
        {/* Android / iOS Status Bar (Shown only in PC preview Frame mode, hidden on real phones) */}
        {isMobileFrame && (
          <div className="hidden sm:flex bg-white/95 backdrop-blur-md px-5 pt-2.5 pb-1 items-center justify-between text-[11px] font-bold text-slate-800 border-b border-slate-100 select-none z-50">
            {/* Left: Time & Telecom */}
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold tracking-tight">{currentTime}</span>
              <span className="text-[9px] font-semibold text-slate-400">SKT</span>
            </div>

            {/* Center: Sleek Dynamic Island / Camera Notch */}
            <div className="w-20 h-4 bg-slate-950 rounded-full flex items-center justify-between px-2 shadow-xs">
              <div className="w-2 h-2 rounded-full bg-slate-800 border border-slate-700/60" />
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-950 border border-indigo-700/50" />
            </div>

            {/* Right: 5G, Signal, Wifi, Battery */}
            <div className="flex items-center gap-1.5 text-slate-700">
              <span className="text-[9px] font-black text-slate-500">5G</span>
              <Signal className="w-3 h-3 text-slate-800" />
              <Wifi className="w-3 h-3 text-slate-800" />
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-bold text-slate-600">98%</span>
                <div className="w-4 h-2 rounded-[2px] border border-slate-700 p-[1px] flex items-center">
                  <div className="w-full h-full bg-slate-800 rounded-[1px]" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* App Header */}
        <MobileHeader onNavigateTab={setActiveTab} />

        {/* Scrollable View Content - Using flex-1 with smooth scrolling */}
        <main
          /*
            Bottom padding belongs here rather than in each view, because what
            it has to clear differs per case. Every case is tuned to leave the
            same 24px gap above the bottom bar:

              bar in the frame's flow      → 24px
              bar fixed over the content   → 24px + 64px bar
              …and at sm the wrapper's own 20px of bottom padding already
              contributes, so that much comes back off.
          */
          className={`flex-1 px-4 pt-2 relative overscroll-contain pb-[88px] ${
            isMobileFrame
              ? "sm:overflow-y-auto sm:pb-6"
              : "overflow-y-visible sm:pb-[68px]"
          }`}
        >
          {renderActiveView()}
        </main>

        {/* Bottom Navigation */}
        <BottomNavigation
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          savingsCount={savingsCount}
        />

        {/* Modals */}
        <AddTransactionModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
        />

        <SMSParserModal
          isOpen={isSMSModalOpen}
          onClose={() => setIsSMSModalOpen(false)}
        />

        {/* Offline notification banner */}
        <OfflineIndicator />
      </div>
    </div>
  );
};

const AppGuard: React.FC = () => {
  const { isLoading, isRegistered, isUnlocked } = useAuth();
  const { isDbReady } = useFinance();

  // The on-device database has to be open before any screen can render
  if (isLoading || !isDbReady) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-10 h-10 border-3 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mb-3" />
        <p className="text-xs text-slate-400 font-medium">
          {isDbReady ? "금융 보안 세션 확인 중..." : "기기 내 가계부 데이터 여는 중..."}
        </p>
      </div>
    );
  }

  // Setup on first run, PIN entry on every launch after that
  if (!isRegistered || !isUnlocked) {
    return <PinAuthScreen />;
  }

  return <MainContent />;
};

export default function App() {
  return (
    <AuthProvider>
      <FinanceProvider>
        <AppGuard />
      </FinanceProvider>
    </AuthProvider>
  );
}
