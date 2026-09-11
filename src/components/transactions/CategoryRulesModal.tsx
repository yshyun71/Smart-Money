import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { CategorySelect } from "./CategorySelect";
import type { CategoryRule, CategoryType, Transaction } from "../../types/finance";
import { pickRule } from "../../services/categoryRules";
import {
  CategoryApplyResultModal,
  type AppliedRule,
  type CategoryApplyResult,
} from "./CategoryApplyResultModal";
import { BUILT_IN_CATEGORIES } from "../../constants/categories";
import {
  X,
  Plus,
  Save,
  Trash2,
  Tag,
  Sparkles,
  UserCheck,
  Pencil,
  Wand2,
  CheckCircle2,
  AlertCircle,
  CheckSquare,
  Square,
} from "lucide-react";

/** Counts how many descriptions a pattern covers, using the same loose match. */
function matchCount(names: string[], pattern: string): number {
  const target = (pattern || "").replace(/\s+/g, "");
  if (!target) return 0;
  try {
    const body = target.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp(body, "i");
    return names.filter((name) => regex.test((name || "").replace(/\s+/g, ""))).length;
  } catch {
    return 0;
  }
}

/**
 * The standing rules for one account: anything matching this pattern belongs in
 * this category. They apply when entries arrive — typed in, imported, or
 * classified — and a rule the user confirmed always beats one the classifier
 * wrote.
 */
export const CategoryRulesModal: React.FC<{
  isOpen: boolean;
  accountId: string;
  onClose: () => void;
}> = ({ isOpen, accountId, onClose }) => {
  const {
    accounts,
    allTransactions,
    categoryRules,
    saveCategoryRule,
    deleteCategoryRule,
    setCategoryRuleSource,
    categories,
    deleteCategory,
    updateTransactions,
  } = useFinance();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draftPattern, setDraftPattern] = useState("");
  const [draftCategory, setDraftCategory] = useState<CategoryType>("식비");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  /*
    Which rules a bulk apply will use, held as the ones left OUT rather than
    the ones taken in: every rule starts ticked, and one added while this sheet
    is open joins in on its own instead of being quietly skipped.
  */
  const [excludedRuleIds, setExcludedRuleIds] = useState<Set<string>>(new Set());
  /** What the last bulk apply did, shown as a popup over this sheet. */
  const [result, setResult] = useState<CategoryApplyResult | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEditingId(null);
    setIsAdding(false);
    setDraftPattern("");
    setDraftCategory("식비");
    setError(null);
    setNotice(null);
    setExcludedRuleIds(new Set());
    setResult(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !result) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, result]);

  const account = accounts.find((a: { id: string }) => a.id === accountId);

  const rules: CategoryRule[] = useMemo(
    () =>
      categoryRules
        .filter((rule: CategoryRule) => rule.accountId === accountId)
        .slice()
        .sort((a: CategoryRule, b: CategoryRule) => {
          if (a.source !== b.source) return a.source === "USER" ? -1 : 1;
          return a.pattern.localeCompare(b.pattern, "ko");
        }),
    [categoryRules, accountId]
  );

  const accountEntries: Transaction[] = useMemo(
    () =>
      allTransactions.filter((tx: Transaction) => tx.accountId === accountId),
    [allTransactions, accountId]
  );

  const merchantNames: string[] = useMemo(
    () => accountEntries.map((tx) => tx.merchant),
    [accountEntries]
  );

  /** The ticked rules, in the same precedence order as the full set. */
  const chosenRules = useMemo(
    () => rules.filter((rule) => !excludedRuleIds.has(rule.id)),
    [rules, excludedRuleIds]
  );

  /**
   * What the ticked rules would change across everything recorded on this
   * account. Only those rules are consulted — nothing else gets to weigh in,
   * so what the list says is what the button does.
   */
  const pending = useMemo(() => {
    if (chosenRules.length === 0) return [];
    return accountEntries.flatMap((tx) => {
      const rule = pickRule(chosenRules, tx.merchant, accountId);
      if (!rule || rule.category === tx.category) return [];
      return [{ ruleId: rule.id, tx: { ...tx, category: rule.category } }];
    });
  }, [accountEntries, chosenRules, accountId]);

  const allRulesChosen = rules.length > 0 && chosenRules.length === rules.length;

  const toggleRule = (id: string) => {
    setNotice(null);
    setExcludedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllRules = () => {
    setNotice(null);
    setExcludedRuleIds(
      allRulesChosen ? new Set(rules.map((rule) => rule.id)) : new Set()
    );
  };

  const runApply = () => {
    setNotice(null);

    if (chosenRules.length === 0) {
      setNotice({ ok: false, text: "적용할 규칙을 먼저 선택해주세요." });
      return;
    }

    if (pending.length === 0) {
      setNotice({
        ok: true,
        text: `선택한 ${chosenRules.length}개 규칙으로 바뀌는 내역이 없습니다. 이 계좌 ${accountEntries.length}건은 이미 규칙에 맞게 분류되어 있습니다.`,
      });
      return;
    }

    if (
      !confirm(
        `선택한 ${chosenRules.length}개 규칙을 이 계좌 ${accountEntries.length}건 전체에 적용해 ${pending.length}건의 카테고리를 변경합니다. 계속할까요?`
      )
    ) {
      return;
    }

    // Counted per rule before the write, since the rows change underneath
    const counts = new Map<string, number>();
    for (const item of pending) {
      counts.set(item.ruleId, (counts.get(item.ruleId) || 0) + 1);
    }

    const applied: AppliedRule[] = chosenRules
      .map((rule) => ({
        pattern: rule.pattern,
        category: rule.category,
        source: rule.source,
        count: counts.get(rule.id) || 0,
      }))
      .sort((a, b) => b.count - a.count);

    try {
      updateTransactions(pending.map((item) => item.tx));
      setResult({
        changed: pending.length,
        scanned: accountEntries.length,
        rulesUsed: chosenRules.length,
        account: account.name,
        applied,
      });
    } catch {
      setNotice({ ok: false, text: "일괄 적용에 실패했습니다. 잠시 후 다시 시도해주세요." });
    }
  };

  /** Categories the user typed in, as opposed to the ones the app ships. */
  const ownCategories: CategoryType[] = useMemo(
    () =>
      categories.filter(
        (name: CategoryType) => !BUILT_IN_CATEGORIES.includes(name as never)
      ),
    [categories]
  );

  /** Across every account, since a category is not an account's property. */
  const usageOf = (name: CategoryType) =>
    allTransactions.filter((tx: { category: string }) => tx.category === name).length;

  if (!isOpen || !account) return null;

  const startAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setDraftPattern("");
    setDraftCategory("식비");
    setError(null);
  };

  const startEdit = (rule: CategoryRule) => {
    setIsAdding(false);
    setEditingId(rule.id);
    setDraftPattern(rule.pattern);
    setDraftCategory(rule.category);
    setError(null);
  };

  const cancelDraft = () => {
    setIsAdding(false);
    setEditingId(null);
    setError(null);
  };

  const commitDraft = () => {
    const pattern = draftPattern.trim();
    if (!pattern) {
      setError("가맹점 / 내역명 패턴을 입력해주세요.");
      return;
    }

    const clash = rules.find(
      (rule) =>
        rule.id !== editingId &&
        rule.pattern.trim().toLowerCase() === pattern.toLowerCase()
    );
    if (clash) {
      setError("같은 패턴이 이미 등록되어 있습니다.");
      return;
    }

    // Anything saved from this screen is the user's own decision — which is
    // also how a rule the classifier wrote gets promoted.
    saveCategoryRule({
      id: editingId || undefined,
      accountId,
      pattern,
      category: draftCategory,
      source: "USER",
    });
    cancelDraft();
  };

  const handleDelete = (rule: CategoryRule) => {
    if (!confirm(`'${rule.pattern}' 규칙을 삭제할까요?`)) return;
    deleteCategoryRule(rule.id);
    if (editingId === rule.id) cancelDraft();
  };

  const handleDeleteCategory = (name: CategoryType) => {
    const used = usageOf(name);
    const warning = used > 0 ? `
이미 ${used}건에 사용 중이며, 그 내역의 분류는 그대로 남습니다.` : "";
    if (!confirm(`'${name}' 카테고리를 목록에서 삭제할까요?${warning}`)) return;
    deleteCategory(name);
  };

  const draftForm = (
    <div className="p-3 rounded-2xl bg-white border border-emerald-300 space-y-2.5 shadow-xs">
      <div>
        <label className="block text-[11px] font-bold text-slate-700 mb-1">
          가맹점 / 내역명 패턴
        </label>
        <input
          type="text"
          value={draftPattern}
          onChange={(e) => setDraftPattern(e.target.value)}
          placeholder="예: 코웨이렌탈*"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
        />
        <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
          입력한 값을 <strong>포함</strong>하면 같은 항목으로 봅니다. <code>*</code>는 임의의
          글자를 뜻하며, <code>코웨이렌탈*</code>은 코웨이렌탈08 · 코웨이렌탈09를 모두
          포함합니다.
        </p>
        {draftPattern.trim() !== "" && (
          <p className="text-[10px] text-emerald-700 mt-1 font-bold">
            지금 이 계좌의 {matchCount(merchantNames, draftPattern)}건과 일치합니다.
          </p>
        )}
      </div>

      <div>
        <label className="block text-[11px] font-bold text-slate-700 mb-1">카테고리</label>
        <CategorySelect
          value={draftCategory}
          onChange={setDraftCategory}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 bg-white focus:border-emerald-500 focus:outline-hidden"
        />
      </div>

      {error && <p className="text-[10px] font-bold text-rose-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={cancelDraft}
          className="flex-1 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition cursor-pointer"
        >
          취소
        </button>
        <button
          type="button"
          onClick={commitDraft}
          className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          <span>사용자 규칙으로 저장</span>
        </button>
      </div>
    </div>
  );

  const modalContent = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3.5 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Tag className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="truncate">카테고리 관리</span>
            </h3>
            <p className="text-[10px] text-slate-400 truncate">{account.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-11 h-11 flex items-center justify-center -mr-2 -mt-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-[10px] text-slate-500 leading-relaxed bg-slate-50 border border-slate-200/80 rounded-xl p-2.5">
          여기 등록된 규칙은 내역이 새로 등록될 때와 AI 자동 분류가 실행될 때 함께
          적용됩니다. <strong className="text-emerald-700">사용자</strong> 규칙이 언제나{" "}
          <strong className="text-indigo-700">AI</strong> 규칙보다 우선합니다.
          <br />
          아래에서 규칙을 선택하고 <strong>[카테고리 일괄 적용]</strong>을 누르면, 선택한
          규칙을 이 계좌의 <strong>모든 내역</strong>에 다시 적용합니다.
        </p>

        {/* Add, and reapply what is already registered */}
        {isAdding ? (
          draftForm
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={startAdd}
              className="py-2.5 px-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition flex items-center justify-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">새 규칙 등록</span>
            </button>
            <button
              type="button"
              onClick={runApply}
              disabled={accountEntries.length === 0 || chosenRules.length === 0}
              title="선택한 규칙을 이 계좌의 모든 내역에 적용합니다"
              className="py-2.5 px-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] transition flex items-center justify-center gap-1 disabled:opacity-40 cursor-pointer"
            >
              <Wand2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                카테고리 일괄 적용
                {pending.length > 0 ? ` (${pending.length}건)` : ""}
              </span>
            </button>
          </div>
        )}

        {notice && (
          <div
            className={`p-2.5 rounded-xl text-[10px] font-bold flex items-start gap-1.5 ${
              notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"
            }`}
          >
            {notice.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
            )}
            <span className="min-w-0 break-words">{notice.text}</span>
          </div>
        )}

        {/* Rules */}
        {rules.length === 0 ? (
          <div className="py-10 text-center space-y-1.5">
            <Tag className="w-8 h-8 mx-auto text-slate-300" />
            <div className="text-xs font-bold text-slate-700">등록된 규칙이 없습니다</div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              거래 내역 수정 화면에서 카테고리를 바꾸면 규칙이 자동으로 쌓입니다.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* 전체 선택 sits with the count, over the list it governs */}
            <div className="flex items-center justify-between gap-2 px-1">
              <button
                type="button"
                onClick={toggleAllRules}
                className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 hover:text-slate-900 transition cursor-pointer"
              >
                {allRulesChosen ? (
                  <CheckSquare className="w-4 h-4 text-indigo-600" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400" />
                )}
                <span>전체 선택</span>
              </button>
              <span className="text-[10px] text-slate-400">
                규칙 {rules.length}건 중 {chosenRules.length}건 선택
              </span>
            </div>

            <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {rules.map((rule) =>
                editingId === rule.id ? (
                  <div key={rule.id} className="p-2 bg-emerald-50/50">
                    {draftForm}
                  </div>
                ) : (
                  <div
                    key={rule.id}
                    className={`flex items-center gap-1 pr-3 py-2.5 transition ${
                      excludedRuleIds.has(rule.id) ? "bg-white" : "bg-indigo-50/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleRule(rule.id)}
                      aria-label={
                        excludedRuleIds.has(rule.id) ? "일괄 적용에 포함" : "일괄 적용에서 제외"
                      }
                      className="pl-3 pr-1.5 shrink-0 cursor-pointer"
                    >
                      {excludedRuleIds.has(rule.id) ? (
                        <Square className="w-4 h-4 text-slate-300" />
                      ) : (
                        <CheckSquare className="w-4 h-4 text-indigo-600" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-bold text-slate-900 truncate font-mono">
                          {rule.pattern}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 flex items-center gap-0.5 ${
                            rule.source === "USER"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-indigo-100 text-indigo-700"
                          }`}
                        >
                          {rule.source === "USER" ? (
                            <UserCheck className="w-2.5 h-2.5" />
                          ) : (
                            <Sparkles className="w-2.5 h-2.5" />
                          )}
                          {rule.source === "USER" ? "사용자" : "AI"}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {rule.category} · 이 계좌 {matchCount(merchantNames, rule.pattern)}건
                        일치
                      </div>
                    </div>

                    <div className="flex items-center shrink-0">
                      {rule.source === "AI" && (
                        <button
                          type="button"
                          onClick={() => setCategoryRuleSource(rule.id, "USER")}
                          title="사용자 규칙으로 확정"
                          className="px-1.5 py-1.5 rounded-lg text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 transition cursor-pointer whitespace-nowrap"
                        >
                          사용자로
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => startEdit(rule)}
                        aria-label="규칙 수정"
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(rule)}
                        aria-label="규칙 삭제"
                        className="p-2 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* Categories the user made, which belong to them rather than to an account */}
        {ownCategories.length > 0 && (
          <div className="space-y-1.5 pt-1 border-t border-slate-100">
            <div className="px-1 pt-2 text-[11px] font-bold text-slate-700">
              내가 추가한 카테고리 {ownCategories.length}개
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ownCategories.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-slate-100 text-[11px] font-bold text-slate-700"
                >
                  {name}
                  <span className="text-[9px] font-normal text-slate-400">
                    {usageOf(name)}건
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(name)}
                    aria-label={`${name} 삭제`}
                    className="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-rose-500 hover:bg-white transition cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed px-1">
              카테고리는 계좌와 무관하게 내 가계부 전체에서 함께 쓰입니다. 삭제해도 이미
              등록된 내역의 분류는 바뀌지 않습니다.
            </p>
          </div>
        )}

        <div className="pt-1">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition active:scale-98 touch-manipulation cursor-pointer flex items-center justify-center"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return (
    <>
      {createPortal(modalContent, document.body)}
      <CategoryApplyResultModal result={result} onClose={() => setResult(null)} />
    </>
  );
};
