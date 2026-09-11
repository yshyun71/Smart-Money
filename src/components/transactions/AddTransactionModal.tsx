import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { formatAmountInput } from "../../utils/format";
import { CategoryType, ExpenseType, Transaction, TransactionType } from "../../types/finance";
import { X, Plus, Pin, ShoppingBag, Coins, Save, Trash2 } from "lucide-react";

const CATEGORIES: CategoryType[] = [
  "식비",
  "카페/간식",
  "주거/통신",
  "구독/미디어",
  "교통",
  "쇼핑",
  "문화/여가",
  "생활/의료",
  "금융/보험",
  "급여",
  "기타수입",
  "기타지출",
];

export const AddTransactionModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Present to edit an existing entry instead of creating one. */
  editing?: Transaction | null;
  /** Pre-selects the account when adding from an account's own ledger. */
  defaultAccountId?: string;
}> = ({ isOpen, onClose, editing = null, defaultAccountId }) => {
  const { addTransaction, updateTransaction, deleteTransaction, accounts } = useFinance();

  const [formType, setFormType] = useState<"VARIABLE" | "FIXED" | "INCOME">(
    "VARIABLE"
  );
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState<CategoryType>("식비");
  const [selectedAccountId, setSelectedAccountId] = useState(
    accounts[0]?.id || ""
  );
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [recurringDay, setRecurringDay] = useState("5");
  const [memo, setMemo] = useState("");

  // Load the entry being edited, or start clean, each time the modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (editing) {
      setFormType(
        editing.type === "INCOME"
          ? "INCOME"
          : editing.expenseType === "FIXED"
          ? "FIXED"
          : "VARIABLE"
      );
      setAmount(formatAmountInput(String(editing.amount)));
      setMerchant(editing.merchant);
      setCategory(editing.category);
      setSelectedAccountId(editing.accountId || accounts[0]?.id || "");
      setDate(editing.date);
      setRecurringDay(String(editing.recurringDay ?? 5));
      setMemo(editing.memo || "");
    } else {
      setFormType("VARIABLE");
      setAmount("");
      setMerchant("");
      setCategory("식비");
      setSelectedAccountId(defaultAccountId || accounts[0]?.id || "");
      setDate(new Date().toISOString().split("T")[0]);
      setRecurringDay("5");
      setMemo("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseInt(amount.replace(/[^0-9]/g, ""), 10);
    if (!numAmount || isNaN(numAmount) || !merchant.trim()) {
      alert("금액과 가맹점/내역명을 입력해주세요.");
      return;
    }

    const selectedAcc = accounts.find((a) => a.id === selectedAccountId);
    const paymentMethod = selectedAcc ? selectedAcc.name : "현금/기타";

    const type: TransactionType = formType === "INCOME" ? "INCOME" : "EXPENSE";
    const expenseType: ExpenseType =
      formType === "INCOME"
        ? "INCOME"
        : formType === "FIXED"
        ? "FIXED"
        : "VARIABLE";

    const payload = {
      date,
      time: editing?.time || new Date().toTimeString().substring(0, 5),
      type,
      expenseType,
      category,
      merchant: merchant.trim(),
      amount: numAmount,
      paymentMethod,
      accountId: selectedAccountId,
      memo: memo.trim() || undefined,
      isFixedRecurring: formType === "FIXED",
      recurringDay: formType === "FIXED" ? parseInt(recurringDay, 10) : undefined,
    };

    if (editing) {
      updateTransaction({ ...payload, id: editing.id });
    } else {
      addTransaction(payload);
    }

    onClose();
  };

  const handleDelete = () => {
    if (!editing) return;
    if (!confirm(`'${editing.merchant}' 내역을 삭제할까요?`)) return;
    deleteTransaction(editing.id);
    onClose();
  };

  /*
    Rendered into <body> and above the other sheets.
    This modal used to live inside the view's own tree with a z-index of 50,
    which put it behind the account ledger — that sheet is portalled to <body>
    at a far higher layer, and a z-index inside the device frame's stacking
    context can never climb out of it. Opening an entry for edit therefore did
    nothing visible until the ledger underneath was closed.
  */
  const modalContent = (
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-xs animate-in fade-in">
      <div className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">
            {editing ? "거래 내역 수정" : "거래 내역 직접 추가"}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Type Segmented Control */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              지출/수입 구분
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setFormType("VARIABLE");
                  if (category === "급여" || category === "주거/통신")
                    setCategory("식비");
                }}
                className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-lg transition ${
                  formType === "VARIABLE"
                    ? "bg-amber-500 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>변동지출</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFormType("FIXED");
                  setCategory("주거/통신");
                }}
                className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-lg transition ${
                  formType === "FIXED"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Pin className="w-3.5 h-3.5 rotate-45" />
                <span>고정지출</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFormType("INCOME");
                  setCategory("급여");
                }}
                className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-lg transition ${
                  formType === "INCOME"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Coins className="w-3.5 h-3.5" />
                <span>수입</span>
              </button>
            </div>
            {formType === "FIXED" && (
              <p className="text-[11px] text-indigo-600 mt-1">
                📌 고정비: 월세, 관리비, 통신비, 정기구독(넷플릭스 등), 보험료 등 정기 결제 항목
              </p>
            )}
          </div>

          {/* Amount input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              금액 (원)
            </label>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => {
                  setAmount(formatAmountInput(e.target.value));
                }}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-base font-bold text-slate-900 focus:border-emerald-500 focus:outline-hidden pr-8"
                required
              />
              <span className="absolute right-3.5 top-3 text-xs font-semibold text-slate-400">
                원
              </span>
            </div>
          </div>

          {/* Merchant / Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              가맹점 / 내역명
            </label>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="예: 스타벅스 강남점, 오피스텔 월세, 급여"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
              required
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              카테고리
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryType)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden bg-white"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Account / Card Select */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              결제 수단 (계좌/카드)
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden bg-white"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  [{acc.institution}] {acc.name} ({acc.identifier})
                </option>
              ))}
            </select>
          </div>

          {/* Date & (Optional Recurring day for fixed) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                거래 일자
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden bg-white"
              />
            </div>

            {formType === "FIXED" && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  매월 결제일 (1~31일)
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={recurringDay}
                  onChange={(e) => setRecurringDay(e.target.value)}
                  placeholder="예: 25"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
                />
              </div>
            )}
          </div>

          {/* Memo */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              메모 (선택)
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 친구와 저녁식사, 알뜰폰 변경 검토"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full mt-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 text-xs shadow-md shadow-emerald-600/20 active:scale-98 transition flex items-center justify-center gap-1.5"
          >
            {editing ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{editing ? "수정 내용 저장" : "가계부에 등록하기"}</span>
          </button>

          {editing && (
            <button
              type="button"
              onClick={handleDelete}
              className="w-full rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold py-3 text-xs transition flex items-center justify-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              <span>이 내역 삭제</span>
            </button>
          )}
        </form>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modalContent, document.body);
};
