import React from "react";
import {
  Home,
  BarChart3,
  Sliders,
  PieChart,
  Sparkles,
  ReceiptText,
  CreditCard,
} from "lucide-react";
import { useFinance } from "../../context/FinanceContext";

export type NavTab =
  | "home"
  | "analytics"
  | "budget"
  | "fixed_variable"
  | "ai_coach"
  | "ledger"
  | "assets";

interface BottomNavigationProps {
  activeTab: NavTab;
  onChangeTab: (tab: NavTab) => void;
  savingsCount?: number;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({
  activeTab,
  onChangeTab,
  savingsCount = 0,
}) => {
  const { budgetAlerts } = useFinance();
  const alertCount = budgetAlerts.length;

  const tabs = [
    {
      id: "home" as NavTab,
      label: "홈",
      icon: Home,
    },
    {
      id: "analytics" as NavTab,
      label: "소비분석",
      icon: BarChart3,
    },
    {
      id: "budget" as NavTab,
      label: "예산·알림",
      icon: Sliders,
      badge: alertCount > 0 ? `${alertCount}` : undefined,
      badgeColor: "bg-rose-500",
    },
    {
      id: "ai_coach" as NavTab,
      label: "AI절약",
      icon: Sparkles,
      badge: savingsCount > 0 ? "추천" : undefined,
      badgeColor: "bg-emerald-600",
    },
    {
      id: "assets" as NavTab,
      label: "카드·계좌",
      icon: CreditCard,
    },
  ];

  const { viewMode } = useFinance();
  const isMobileFrame = viewMode === "MOBILE_FRAME";

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 mx-auto select-none safe-bottom transition-all duration-300 ${
        isMobileFrame ? "max-w-md" : "max-w-4xl"
      }`}
    >
      <div className="flex items-center justify-around h-16 px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              id={`nav-tab-${tab.id}`}
              onClick={() => onChangeTab(tab.id)}
              className={`relative flex flex-col items-center justify-center w-full h-full pt-1 transition active:scale-90 ${
                isActive
                  ? "text-emerald-600 font-bold"
                  : "text-slate-400 hover:text-slate-600 font-medium"
              }`}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-transform ${
                    isActive ? "scale-110 stroke-[2.4]" : "stroke-[1.8]"
                  }`}
                />
                {tab.badge && (
                  <span
                    className={`absolute -top-1.5 -right-3.5 ${
                      tab.badgeColor || "bg-rose-500"
                    } text-white text-[9px] font-bold px-1 py-0.2 rounded-full ring-2 ring-white`}
                  >
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] mt-1 tracking-tight leading-none">
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute bottom-1 w-5 h-0.5 bg-emerald-600 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
