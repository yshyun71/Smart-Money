import React from "react";
import { Transaction, CategoryType } from "../../types/finance";
import { useFinance } from "../../context/FinanceContext";
import {
  Home,
  Tv,
  Utensils,
  Coffee,
  Bus,
  ShoppingBag,
  Sparkles,
  HeartPulse,
  ShieldCheck,
  Coins,
  CreditCard,
  Receipt,
  Trash2,
  Pin,
  Calendar,
} from "lucide-react";

const getCategoryIcon = (category: CategoryType) => {
  switch (category) {
    case "주거/통신":
      return <Home className="w-4 h-4 text-blue-600" />;
    case "구독/미디어":
      return <Tv className="w-4 h-4 text-purple-600" />;
    case "식비":
      return <Utensils className="w-4 h-4 text-orange-600" />;
    case "카페/간식":
      return <Coffee className="w-4 h-4 text-amber-600" />;
    case "교통":
      return <Bus className="w-4 h-4 text-emerald-600" />;
    case "쇼핑":
      return <ShoppingBag className="w-4 h-4 text-pink-600" />;
    case "문화/여가":
      return <Sparkles className="w-4 h-4 text-indigo-600" />;
    case "생활/의료":
      return <HeartPulse className="w-4 h-4 text-red-500" />;
    case "금융/보험":
      return <ShieldCheck className="w-4 h-4 text-teal-600" />;
    case "카드대금":
      return <CreditCard className="w-4 h-4 text-indigo-600" />;
    case "급여":
    case "기타수입":
      return <Coins className="w-4 h-4 text-emerald-600" />;
    default:
      return <Receipt className="w-4 h-4 text-slate-600" />;
  }
};

const getCategoryBg = (category: CategoryType) => {
  switch (category) {
    case "주거/통신":
      return "bg-blue-50";
    case "구독/미디어":
      return "bg-purple-50";
    case "식비":
      return "bg-orange-50";
    case "카페/간식":
      return "bg-amber-50";
    case "교통":
      return "bg-emerald-50";
    case "쇼핑":
      return "bg-pink-50";
    case "문화/여가":
      return "bg-indigo-50";
    case "생활/의료":
      return "bg-red-50";
    case "금융/보험":
      return "bg-teal-50";
    case "카드대금":
      return "bg-indigo-50";
    case "급여":
    case "기타수입":
      return "bg-emerald-50";
    default:
      return "bg-slate-100";
  }
};

export const TransactionItem: React.FC<{ transaction: Transaction }> = ({
  transaction,
}) => {
  const { toggleFixedType, deleteTransaction } = useFinance();

  const isIncome = transaction.type === "INCOME";
  const isFixed = transaction.expenseType === "FIXED";

  return (
    <div className="group flex items-center justify-between p-3.5 bg-white hover:bg-slate-50/80 rounded-2xl border border-slate-200/70 transition-all shadow-2xs">
      <div className="flex items-center gap-3 min-w-0">
        {/* Category Icon */}
        <div
          className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${getCategoryBg(
            transaction.category
          )}`}
        >
          {getCategoryIcon(transaction.category)}
        </div>

        {/* Info */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-xs font-bold text-slate-900 truncate">
              {transaction.merchant}
            </h3>

            {/* Fixed vs Variable Badge (Clickable to toggle) */}
            {!isIncome && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFixedType(transaction.id);
                }}
                title="클릭하여 고정비/변동비 전환"
                className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.2 rounded-md transition ${
                  isFixed
                    ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                    : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                }`}
              >
                {isFixed && <Pin className="w-2.5 h-2.5 rotate-45" />}
                <span>{isFixed ? "고정비" : "변동비"}</span>
              </button>
            )}

            {isIncome && (
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-emerald-100 text-emerald-800">
                수입
              </span>
            )}
          </div>

          {/* Subtext: payment method & date */}
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
            <span className="text-slate-600 font-medium">
              {transaction.paymentMethod}
            </span>
            <span>•</span>
            <span>{transaction.date.substring(5)}</span>
            <span>{transaction.time}</span>
            {transaction.recurringDay && (
              <>
                <span>•</span>
                <span className="text-indigo-600 font-medium flex items-center gap-0.5">
                  <Calendar className="w-2.5 h-2.5" /> 매월 {transaction.recurringDay}일
                </span>
              </>
            )}
          </div>

          {transaction.memo && (
            <p className="text-[10px] text-slate-500 mt-0.5 italic truncate">
              "{transaction.memo}"
            </p>
          )}
        </div>
      </div>

      {/* Amount & Actions */}
      <div className="text-right shrink-0 pl-2 flex items-center gap-2">
        <div>
          <div
            className={`text-sm font-extrabold tracking-tight ${
              isIncome ? "text-emerald-600" : "text-slate-900"
            }`}
          >
            {isIncome ? "+" : "-"}
            {transaction.amount.toLocaleString()}원
          </div>
          <div className="text-[10px] text-slate-400 font-medium">
            {transaction.category}
          </div>
        </div>

        {/* Delete button */}
        <button
          onClick={() => deleteTransaction(transaction.id)}
          title="내역 삭제"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-slate-300 hover:text-rose-500 transition rounded-lg"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
