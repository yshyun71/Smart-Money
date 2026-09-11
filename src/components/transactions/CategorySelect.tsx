import React, { useEffect, useState } from "react";
import { useFinance } from "../../context/FinanceContext";
import type { CategoryType } from "../../types/finance";
import { Check, Plus } from "lucide-react";

const CUSTOM = "__CUSTOM__";

/**
 * The category picker used everywhere a category is chosen.
 *
 * Besides the list on offer it carries a 직접 입력 entry: the name typed there
 * is registered like any other category and appears in the list from then on,
 * for this user.
 */
export const CategorySelect: React.FC<{
  value: CategoryType;
  onChange: (next: CategoryType) => void;
  className?: string;
  id?: string;
}> = ({ value, onChange, className, id }) => {
  const { categories, addCategory } = useFinance();

  const [isCustom, setIsCustom] = useState(false);
  const [draft, setDraft] = useState("");

  // A category that no longer exists in the list still has to show up while
  // its entry is open — an older name must never silently become another one.
  const options: CategoryType[] = categories.includes(value)
    ? categories
    : [...categories, value].filter(Boolean);

  useEffect(() => {
    if (categories.includes(value)) setIsCustom(false);
  }, [value, categories]);

  const commitDraft = () => {
    const name = draft.trim();
    if (!name) return;
    addCategory(name);
    onChange(name);
    setIsCustom(false);
    setDraft("");
  };

  const selectClass =
    className ||
    "w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden bg-white";

  return (
    <>
      <select
        id={id}
        value={isCustom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setDraft("");
            setIsCustom(true);
            return;
          }
          setIsCustom(false);
          onChange(e.target.value as CategoryType);
        }}
        className={selectClass}
      >
        {options.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
        <option value={CUSTOM}>+ 직접 입력</option>
      </select>

      {isCustom && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
            }}
            onBlur={commitDraft}
            placeholder="새 카테고리 이름"
            autoFocus
            className="min-w-0 flex-1 rounded-xl border border-emerald-300 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={commitDraft}
            disabled={draft.trim() === ""}
            aria-label="카테고리 추가"
            className="shrink-0 px-2.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-40 cursor-pointer"
          >
            {draft.trim() ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
    </>
  );
};
