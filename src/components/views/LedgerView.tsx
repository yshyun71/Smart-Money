import React, { useState, useMemo } from "react";
import { useFinance } from "../../context/FinanceContext";
import { TransactionItem } from "../transactions/TransactionItem";
import {
  Search,
  Filter,
  Plus,
  Pin,
  ShoppingBag,
  Coins,
  ReceiptText,
} from "lucide-react";

export const LedgerView: React.FC<{ onOpenAddModal: () => void }> = ({
  onOpenAddModal,
}) => {
  const { transactions, accounts } = useFinance();

  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<
    "ALL" | "EXPENSE" | "INCOME" | "FIXED" | "VARIABLE"
  >("ALL");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("ALL");

  // Filtering
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Search
      const matchSearch =
        tx.merchant.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (tx.memo && tx.memo.toLowerCase().includes(searchTerm.toLowerCase()));

      if (!matchSearch) return false;

      // Filter Type
      if (filterType === "EXPENSE" && tx.type !== "EXPENSE") return false;
      if (filterType === "INCOME" && tx.type !== "INCOME") return false;
      if (filterType === "FIXED" && tx.expenseType !== "FIXED") return false;
      if (filterType === "VARIABLE" && tx.expenseType !== "VARIABLE")
        return false;

      // Account filter
      if (selectedAccountId !== "ALL" && tx.accountId !== selectedAccountId) {
        return false;
      }

      return true;
    });
  }, [transactions, searchTerm, filterType, selectedAccountId]);

  // Group by Date
  const groupedByDate = useMemo(() => {
    const groups: { [date: string]: typeof filteredTransactions } = {};
    filteredTransactions.forEach((tx) => {
      if (!groups[tx.date]) groups[tx.date] = [];
      groups[tx.date].push(tx);
    });

    return Object.entries(groups).sort(
      ([dateA], [dateB]) => new Date(dateB).getTime() - new Date(dateA).getTime()
    );
  }, [filteredTransactions]);

  const formatDateLabel = (dStr: string) => {
    const d = new Date(dStr);
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const month = d.getMonth() + 1;
    const date = d.getDate();
    const dayName = dayNames[d.getDay()];
    return `${month}월 ${date}일 (${dayName})`;
  };

  return (
    <div className="space-y-3 pt-1">
      {/* Search & Add Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="가맹점, 카테고리, 메모 검색..."
            className="w-full bg-white rounded-2xl border border-slate-200/90 pl-9 pr-3.5 py-2.5 text-xs text-slate-900 focus:outline-hidden focus:border-emerald-500 shadow-2xs"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          )}
        </div>

        <button
          onClick={onOpenAddModal}
          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2.5 rounded-2xl font-bold text-xs shadow-xs active:scale-95 transition shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>직접 추가</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 select-none">
        <button
          onClick={() => setFilterType("ALL")}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition ${
            filterType === "ALL"
              ? "bg-slate-900 text-white shadow-2xs"
              : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          전체 ({transactions.length})
        </button>

        <button
          onClick={() => setFilterType("FIXED")}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1 transition ${
            filterType === "FIXED"
              ? "bg-indigo-600 text-white shadow-2xs"
              : "bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50/50"
          }`}
        >
          <Pin className="w-3 h-3 rotate-45" />
          <span>고정비만</span>
        </button>

        <button
          onClick={() => setFilterType("VARIABLE")}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1 transition ${
            filterType === "VARIABLE"
              ? "bg-amber-500 text-white shadow-2xs"
              : "bg-white text-amber-800 border border-amber-200 hover:bg-amber-50/50"
          }`}
        >
          <ShoppingBag className="w-3 h-3" />
          <span>변동비만</span>
        </button>

        <button
          onClick={() => setFilterType("INCOME")}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1 transition ${
            filterType === "INCOME"
              ? "bg-emerald-600 text-white shadow-2xs"
              : "bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50/50"
          }`}
        >
          <Coins className="w-3 h-3" />
          <span>수입만</span>
        </button>
      </div>

      {/* Account / Card Sub-Filter */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 text-[11px]">
        <span className="text-slate-600 font-semibold px-1 shrink-0">결제수단:</span>
        <button
          onClick={() => setSelectedAccountId("ALL")}
          className={`px-2 py-1 rounded-lg shrink-0 transition ${
            selectedAccountId === "ALL"
              ? "bg-slate-200 text-slate-900 font-bold"
              : "text-slate-700 hover:bg-slate-100"
          }`}
        >
          모든 카드/계좌
        </button>
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setSelectedAccountId(acc.id)}
            className={`px-2 py-1 rounded-lg shrink-0 transition flex items-center gap-1 ${
              selectedAccountId === acc.id
                ? "bg-slate-200 text-slate-900 font-bold"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: acc.color }}
            />
            <span>{acc.name}</span>
          </button>
        ))}
      </div>

      {/* Tip Banner for toggling */}
      <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl px-3 py-2 text-[11px] text-indigo-900 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Pin className="w-3.5 h-3.5 text-indigo-600 rotate-45 shrink-0" />
          <span>
            내역의 <strong>[고정비] / [변동비]</strong> 배지를 누르면 즉시 구분을 전환할 수 있습니다.
          </span>
        </div>
      </div>

      {/* Grouped Transaction List */}
      {groupedByDate.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-3xl border border-slate-200/80 shadow-2xs">
          <ReceiptText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs font-semibold text-slate-600">
            조건에 맞는 거래 내역이 없습니다.
          </p>
          <button
            onClick={() => {
              setSearchTerm("");
              setFilterType("ALL");
              setSelectedAccountId("ALL");
            }}
            className="mt-3 text-xs text-emerald-600 font-bold hover:underline"
          >
            필터 초기화
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByDate.map(([dateStr, items]) => {
            const dayExpense = items
              .filter((t) => t.type === "EXPENSE")
              .reduce((sum, t) => sum + t.amount, 0);
            const dayIncome = items
              .filter((t) => t.type === "INCOME")
              .reduce((sum, t) => sum + t.amount, 0);

            return (
              <div key={dateStr} className="space-y-2">
                {/* Date Group Header */}
                <div className="flex items-center justify-between px-1 text-xs">
                  <span className="font-bold text-slate-800">
                    {formatDateLabel(dateStr)}
                  </span>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
                    {dayIncome > 0 && (
                      <span className="text-emerald-600 font-bold">
                        +{dayIncome.toLocaleString()}원
                      </span>
                    )}
                    {dayExpense > 0 && (
                      <span>지출 {dayExpense.toLocaleString()}원</span>
                    )}
                  </div>
                </div>

                {/* Items in this date */}
                <div className="space-y-1.5">
                  {items.map((tx) => (
                    <TransactionItem key={tx.id} transaction={tx} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
