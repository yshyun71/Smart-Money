import React, { useEffect, useMemo, useState } from "react";
import { useFinance } from "../../context/FinanceContext";
import type { CategoryType, TransactionType } from "../../types/finance";
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
  /**
   * 수입인가 지출인가 — **그 방향의 목록만** 보여 줍니다 (§6.1).
   *
   * 한 목록을 함께 쓰면 수입 건에 `주거` 가, 지출 건에 `급여` 가 붙습니다.
   * 실제 기기에서 그렇게 들어간 줄이 10건 있었고, 그 한 줄이 그 달 합계를
   * 조용히 비틉니다.
   */
  direction: TransactionType;
  className?: string;
  id?: string;
}> = ({ value, onChange, direction, className, id }) => {
  const { categoriesFor, addCategory } = useFinance();
  /*
    **목록을 메모해 둡니다.** `categoriesFor` 는 부를 때마다 새 배열을 만드므로,
    그대로 쓰면 아래 리셋 효과의 의존성이 매 렌더 바뀝니다 — `+ 직접 입력` 을
    고른 순간 효과가 돌아 입력칸을 다시 닫아 버렸습니다(§14.5와 같은 종류).
  */
  const categories = useMemo(() => categoriesFor(direction), [categoriesFor, direction]);

  const [isCustom, setIsCustom] = useState(false);
  const [draft, setDraft] = useState("");

  // A category that no longer exists in the list still has to show up while
  // its entry is open — an older name must never silently become another one.
  const options: CategoryType[] = categories.includes(value)
    ? categories
    : [...categories, value].filter(Boolean);

  /*
    바깥에서 값이 바뀌면 직접 입력 칸을 닫습니다 — 다른 카테고리가 골라졌다는
    뜻입니다. **`categories` 를 의존성에 넣지 마세요**: 목록은 내용이 같아도
    참조가 바뀔 수 있고, 그러면 `+ 직접 입력` 을 고른 순간 닫힙니다.
  */
  useEffect(() => {
    setIsCustom(false);
  }, [value]);

  const commitDraft = () => {
    const name = draft.trim();
    if (!name) return;
    /* 만든 것도 그 방향의 것입니다 — 같은 이름을 양쪽에 따로 둘 수 있습니다 */
    addCategory(name, direction);
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
