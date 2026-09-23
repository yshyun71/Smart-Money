import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { formatAmountInput, parseAmountInput } from "../../utils/format";
import { CategoryType, ExpenseType, Transaction, TransactionType } from "../../types/finance";
import { suggestPattern } from "../../services/categoryRules";
import { matchCardForBill, isCardAccount, settlesFromBank } from "../../services/cardLink";
import { CARD_PAYMENT_CATEGORY, TRANSFER_CATEGORY } from "../../constants/categories";
import {
  noteReach,
  planNote,
  classificationReach,
  planClassification,
  type NoteScope,
} from "../../services/spread";
import { CategorySelect } from "./CategorySelect";
import { ConfirmModal } from "../modals/ConfirmModal";
import { SearchModal } from "../modals/SearchModal";
import { checkTransaction, describeProblems } from "../../services/validate";
import {
  X,
  Plus,
  Pin,
  ShoppingBag,
  Coins,
  Save,
  Trash2,
  CheckSquare,
  Square,
  Tag,
  MessageSquareText,
  AlertTriangle,
} from "lucide-react";

export const AddTransactionModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** Present to edit an existing entry instead of creating one. */
  editing?: Transaction | null;
  /** Pre-selects the account when adding from an account's own ledger. */
  defaultAccountId?: string;
}> = ({ isOpen, onClose, editing = null, defaultAccountId }) => {
  const {
    addTransaction,
    updateTransaction,
    deleteTransaction,
    accounts,
    allTransactions,
    updateTransactions,
    saveCategoryRule,
    categoryForMerchant,
  } = useFinance();

  /** 수입인가 지출인가. 정기성과 **따로** 둡니다 (§6.6). */
  const [direction, setDirection] = useState<TransactionType>("EXPENSE");
  /** 고정인가 변동인가 — 수입에도 붙습니다. */
  const [recurring, setRecurring] = useState<ExpenseType>("VARIABLE");
  const isIncome = direction === "INCOME";
  const isFixed = recurring === "FIXED";
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState<CategoryType>("식비");
  const [selectedAccountId, setSelectedAccountId] = useState(
    accounts[0]?.id || ""
  );
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [recurringDay, setRecurringDay] = useState("5");
  const [memo, setMemo] = useState("");
  /** 저장을 막은 까닭 — 칸 아래에 그대로 보입니다(§12.8: OS 대화창을 쓰지 않습니다). */
  const [formError, setFormError] = useState<string | null>(null);
  /*
    설명은 memo와 다른 칸입니다. memo에는 명세서가 적어 준 구분과 할부 회차가
    들어 있고 그것이 중복 판정의 근거라, 사람이 쓰는 글은 따로 받습니다.
  */
  const [note, setNote] = useState("");
  const [noteScope, setNoteScope] = useState<NoteScope>("ONE");
  /** 같은 가맹점을 모아 볼 때의 이름. 비어 있으면 창이 닫힌 상태입니다. */
  const [similarOf, setSimilarOf] = useState<string | null>(null);

  /* 되돌리기 어려운 일은 공용 확인 창으로 묻습니다 (§12.8) */
  const [ask, setAsk] = useState<{
    title: string;
    message?: string;
    details?: string[];
    danger?: boolean;
    confirmLabel?: string;
    undoable?: boolean;
    run: () => void;
  } | null>(null);
  const [noteOverwrite, setNoteOverwrite] = useState(false);
  /** 분류(카테고리·고정비)를 이 건만 바꿀지, 같은 내역명 전체에 쓸지. */
  const [classifyScope, setClassifyScope] = useState<NoteScope>("ONE");
  /** For a card bill: which registered card it settles. */
  const [linkedAccountId, setLinkedAccountId] = useState("");
  /** Once the user has answered, including with "연결 안 함", nothing overrides it. */
  const [linkTouched, setLinkTouched] = useState(false);

  /*
    Changing a category here is a decision about this description, not only
    about this one row, so the same choice is offered as a standing rule: every
    later entry with a matching description lands in the same category, and the
    bulk classifier honours it ahead of whatever the model says.
  */
  const [makeRule, setMakeRule] = useState(false);
  const [rulePattern, setRulePattern] = useState("");
  const [patternTouched, setPatternTouched] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);
  /** The rule that would decide this description, shown as a hint. */
  const [ruleHint, setRuleHint] = useState<CategoryType | null>(null);

  // Load the entry being edited, or start clean, each time the modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (editing) {
      setDirection(editing.type);
      setRecurring(editing.expenseType === "FIXED" ? "FIXED" : "VARIABLE");
      setAmount(formatAmountInput(String(editing.amount)));
      setMerchant(editing.merchant);
      setCategory(editing.category);
      setSelectedAccountId(editing.accountId || accounts[0]?.id || "");
      setDate(editing.date);
      setRecurringDay(String(editing.recurringDay ?? 5));
      setMemo(editing.memo || "");
      setNote(editing.note || "");
      setLinkedAccountId(editing.linkedAccountId || "");
      setLinkTouched(false);
    } else {
      setDirection("EXPENSE");
      setRecurring("VARIABLE");
      setAmount("");
      setMerchant("");
      setCategory("식비");
      setSelectedAccountId(defaultAccountId || accounts[0]?.id || "");
      setDate(new Date().toISOString().split("T")[0]);
      setRecurringDay("5");
      setMemo("");
      setNote("");
      setLinkedAccountId("");
      setLinkTouched(false);
    }

    setNoteScope("ONE");
    setNoteOverwrite(false);
    setClassifyScope("ONE");
    setMakeRule(false);
    setPatternTouched(false);
    setCategoryTouched(false);
    setRulePattern(suggestPattern(editing ? editing.merchant : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing]);

  /*
    A description already covered by a rule fills the category in on its own,
    which is what "같은 가맹점이면 같은 카테고리"로 보인다는 뜻 — until the user
    overrides it on this form, which then wins.
  */
  useEffect(() => {
    if (!isOpen) return;
    const hit = merchant.trim()
      ? categoryForMerchant(merchant, selectedAccountId, isIncome)
      : null;
    setRuleHint(hit);
    if (hit && !editing && !categoryTouched) setCategory(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, merchant, selectedAccountId, editing, categoryTouched, isIncome]);

  // Follow the description until the user writes a pattern of their own
  useEffect(() => {
    if (!isOpen || patternTouched) return;
    setRulePattern(suggestPattern(merchant));
  }, [isOpen, merchant, patternTouched]);

  /*
    A card bill names its issuer, so the card it settles can usually be worked
    out — but only where one registered card fits. The user can always say.
  */
  useEffect(() => {
    // Clearing the field is an answer too: refilling it from the description
    // is what made "연결 안 함" impossible to save.
    if (!isOpen || linkTouched) return;
    if (category !== CARD_PAYMENT_CATEGORY || linkedAccountId) return;
    // 카드 자기 내역은 명세서를 대표하지 않습니다 — 연결은 계좌 출금과 명세서 사이의 일입니다
    if (!settlesFromBank(selectedAccountId, accounts)) return;

    const bill = matchCardForBill(
      merchant,
      parseAmountInput(amount),
      date.slice(0, 7),
      accounts,
      allTransactions
    );
    if (bill) setLinkedAccountId(bill.accountId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, category, merchant, amount, date, accounts, linkedAccountId, linkTouched]);

  // Moving an entry to another category is the moment the rule is worth making
  useEffect(() => {
    if (!isOpen || !editing) return;
    setMakeRule(editing.category !== category);
  }, [isOpen, editing, category]);

  /*
    같은 내역명이 몇 건이고 그중 몇 건에 이미 설명이 적혀 있는지. 무엇이
    바뀔지 누르기 전에 보여 주려는 것입니다.
  */
  const reach = useMemo(
    () => (editing ? noteReach(allTransactions, editing) : { total: 0, described: 0 }),
    [editing, allTransactions]
  );

  /*
    지금 폼에 적힌 분류. 훅 밖에서 다시 계산하면 조기 반환 위아래로 갈리므로
    여기서 한 번만 만듭니다(§14.2).
  */
  const wantedClass = useMemo(
    () => ({
      category,
      expenseType: recurring,
      isFixedRecurring: recurring === "FIXED",
      recurringDay: recurring === "FIXED" ? parseInt(recurringDay, 10) : undefined,
    }),
    [category, recurring, recurringDay]
  );

  const classifyReach = useMemo(
    () =>
      editing
        ? classificationReach(allTransactions, editing, wantedClass)
        : { total: 0, changing: 0 },
    [editing, allTransactions, wantedClass]
  );

  if (!isOpen) return null;

  const categoryChanged = Boolean(editing) && editing!.category !== category;
  /** 분류를 실제로 건드렸을 때만 적용 범위를 묻습니다. */
  const classifyChanged =
    Boolean(editing) &&
    (editing!.category !== category ||
      editing!.expenseType !== wantedClass.expenseType ||
      Boolean(editing!.isFixedRecurring) !== wantedClass.isFixedRecurring);
  const canOfferRule = merchant.trim() !== "" && Boolean(selectedAccountId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const numAmount = parseInt(amount.replace(/[^0-9]/g, ""), 10);
    const selectedAcc = accounts.find((a) => a.id === selectedAccountId);
    const paymentMethod = selectedAcc ? selectedAcc.name : "현금/기타";

    const type: TransactionType = direction;
    const expenseType: ExpenseType = recurring;

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
      note: note.trim() || undefined,
      isFixedRecurring: isFixed,
      recurringDay: isFixed ? parseInt(recurringDay, 10) : undefined,
      linkedAccountId:
        category === CARD_PAYMENT_CATEGORY && linkedAccountId ? linkedAccountId : undefined,
      // Not shown on this form, and not this form's to discard: it says which
      // statement an entry belongs to.
      billingMonth: editing?.billingMonth,
    };

    /*
      **저장하기 전에 검증합니다** (§17.7). 예전에는 금액과 내역명만 보고
      `alert` 로 말했습니다 — OS 대화창은 앱과 전혀 다르게 뜨고 설치한 PWA 에서는
      주소까지 노출하며(§12.8), 무엇보다 **날짜를 보지 않았습니다.** 날짜가 이상한
      줄은 어느 달 합계에도 들어가지 않아 찾을 길이 없어집니다.
    */
    const problems = checkTransaction({
      ...payload,
      amount: Number.isNaN(numAmount) ? Number.NaN : numAmount,
    });
    if (problems.length > 0) {
      /*
        계좌가 하나도 없으면 고를 상자 자체가 비어 있습니다 — 그때 `어느 카드·계좌인지
        정해야 합니다` 라고만 하면 이 화면에서 할 수 있는 일이 없습니다. 무엇을 먼저
        해야 하는지 말합니다(§12.11 의 첫 걸음과 같은 안내).
      */
      setFormError(
        accounts.length === 0
          ? "먼저 카드·계좌를 등록해주세요. 카드·계좌 탭에서 등록할 수 있습니다."
          : describeProblems(problems)
      );
      return;
    }

    // Saved first so the entry itself is never overwritten by its own rule
    if (makeRule && canOfferRule && rulePattern.trim()) {
      saveCategoryRule({
        accountId: selectedAccountId,
        pattern: rulePattern.trim(),
        category,
        source: "USER",
      });
    }

    if (editing) {
      updateTransaction({ ...payload, id: editing.id });

      /*
        같은 내역명의 나머지 건에도 같은 설명을 답니다. 가맹점 이름은 이 폼에서
        고친 값이 아니라 저장돼 있는 값으로 맞춥니다 — 나머지 건들이 갖고 있는
        이름이 그것이기 때문입니다.
      */
      /*
        분류는 규칙으로 덮을 수 없는 것이 둘 있습니다 — 이미 등록된 지난 달들과,
        규칙이 아예 담지 않는 고정비 여부. 그래서 여기서 바로 씁니다.
      */
      if (classifyScope === "SAME_MERCHANT") {
        const spread = planClassification(allTransactions, editing, wantedClass);
        if (spread.updates.length > 0) updateTransactions(spread.updates);
      }

      if (noteScope === "SAME_MERCHANT") {
        const wanted = note.trim();
        const plan = planNote(
          allTransactions,
          { ...editing, note: wanted || undefined },
          wanted,
          "SAME_MERCHANT",
          noteOverwrite
        );
        const others = plan.updates.filter((tx: Transaction) => tx.id !== editing.id);
        if (others.length > 0) updateTransactions(others);
      }
    } else {
      addTransaction(payload);
    }

    onClose();
  };

  const handleDelete = () => {
    if (!editing) return;
    setAsk({
      title: `'${editing.merchant}' 내역을 삭제할까요?`,
      danger: true,
      undoable: true,
      run: () => {
        deleteTransaction(editing.id);
        onClose();
      },
    });
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
              지출/수입 · 고정/변동
            </label>

            {/*
              **두 가지를 따로 묻습니다** (§6.6).

              예전에는 `변동지출 · 고정지출 · 수입` 세 칸이었습니다. 수입에는
              정기성이 없다는 전제였는데, 실제로는 **급여만큼 정기적인 돈이
              없습니다.** 셋을 넷으로 늘리면 좁은 화면에서 글자가 갈리므로,
              방향과 정기성을 두 줄로 나눕니다 — 모델과도 같은 모양입니다.
            */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl mb-1.5">
              {([
                ["EXPENSE", "지출", ShoppingBag, "bg-amber-500"],
                ["INCOME", "수입", Coins, "bg-emerald-600"],
              ] as const).map(([value, label, Icon, tone]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    if (value === direction) return;
                    setDirection(value);
                    /* 방향이 바뀌면 카테고리도 그 방향의 것이어야 합니다 (§6.1) */
                    setCategory(value === "INCOME" ? "급여" : "식비");
                    setCategoryTouched(false);
                  }}
                  className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-lg transition ${
                    direction === value
                      ? `${tone} text-white shadow-xs`
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
              {([
                ["VARIABLE", isIncome ? "변동수입" : "변동지출"],
                ["FIXED", isIncome ? "고정수입" : "고정지출"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRecurring(value)}
                  className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-lg transition ${
                    recurring === value
                      ? value === "FIXED"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "bg-slate-500 text-white shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {value === "FIXED" && <Pin className="w-3.5 h-3.5 rotate-45" />}
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {isFixed && (
              <p className="text-[11px] text-indigo-600 mt-1">
                📌 {isIncome
                  ? "고정수입: 급여·연금·임대료처럼 매달 들어오는 돈"
                  : "고정지출: 월세·관리비·통신비·정기구독·보험료처럼 매달 나가는 돈"}
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
            <CategorySelect
              direction={direction}
              value={category}
              onChange={(next) => {
                setCategoryTouched(true);
                setCategory(next);
              }}
            />

            {ruleHint && ruleHint !== category && (
              <p className="text-[10px] text-slate-400 mt-1">
                등록된 규칙은 이 내역명을 <strong>{ruleHint}</strong>로 봅니다.
              </p>
            )}

            {/*
              `이체`를 고르면 합계에서 빠집니다. 말하지 않으면 그 달 지출이
              갑자기 줄어든 이유를 알 수 없습니다 — 그리고 고정비로 표시하면
              도로 세어진다는 것도 여기서 알려 줍니다(6.5).
            */}
            {category === TRANSFER_CATEGORY && (
              <p
                className={`text-[10px] mt-1.5 px-2.5 py-2 rounded-xl border leading-relaxed ${
                  isFixed
                    ? "bg-indigo-50 border-indigo-200/70 text-indigo-800"
                    : "bg-slate-50 border-slate-200/70 text-slate-600"
                }`}
              >
                {isFixed ? (
                  <>
                    <strong>고정비로 표시했으므로 지출로 셉니다.</strong> 매달
                    빠져나가는 이체는 사실상 고정 지출이라, 합계·예산·분석에 그대로
                    들어갑니다.
                  </>
                ) : (
                  <>
                    내 계좌 사이에서 <strong>옮긴 돈</strong>으로 보고 월 합계·소비분석·
                    AI 분석에서 <strong>뺍니다</strong>. 통장 잔액과 계좌 내역은 그대로입니다.
                    {!isFixed &&
                      " 매달 같은 금액이 나가는 이체라면 위에서 [고정비]로 바꾸세요 — 그때는 지출로 셉니다."}
                  </>
                )}
              </p>
            )}

            {/* Keep this choice for every later entry with the same name */}
            {canOfferRule && (
              <div
                className={`mt-2 rounded-xl border p-2.5 space-y-2 transition ${
                  makeRule
                    ? "border-emerald-300 bg-emerald-50/60"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setMakeRule((prev) => !prev)}
                  className="flex items-start gap-1.5 text-left w-full cursor-pointer"
                >
                  {makeRule ? (
                    <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-px" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-400 shrink-0 mt-px" />
                  )}
                  <span className="text-[11px] font-bold text-slate-700 min-w-0">
                    같은 가맹점 / 내역명은 앞으로도 <strong>{category}</strong>로 분류
                    {categoryChanged && (
                      <span className="text-emerald-700"> (카테고리를 변경했습니다)</span>
                    )}
                  </span>
                </button>

                {makeRule && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={rulePattern}
                        onChange={(e) => {
                          setPatternTouched(true);
                          setRulePattern(e.target.value);
                        }}
                        placeholder="예: 코웨이렌탈*"
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-900 bg-white focus:border-emerald-500 focus:outline-hidden"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      이 값을 <strong>포함</strong>하면 같은 항목으로 봅니다. <code>*</code>는
                      임의의 글자를 뜻합니다. 등록 구분은 <strong>사용자</strong>가 되어 AI 자동
                      분류보다 우선 적용되고, [카테고리 관리]에서 수정·삭제할 수 있습니다.
                    </p>
                  </>
                )}
              </div>
            )}

            {/*
              **비슷한 항목 모아 보기.**

              이 계좌 안의 같은 내역명은 아래 `같은 내역명 모두`가 다룹니다.
              그런데 "이 가게에 그동안 얼마 썼지"는 계좌도 달도 넘어가는
              질문이라, 기간·범위를 정해 찾는 창으로 보냅니다(§12.9).
            */}
            {editing && (
              <button
                type="button"
                onClick={() => setSimilarOf(editing.merchant)}
                className="mt-2 w-full text-left px-2.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-emerald-400 transition text-[10px] text-slate-600 flex items-center justify-between gap-2 cursor-pointer"
              >
                <span className="min-w-0 truncate">
                  <strong className="text-slate-800">{editing.merchant}</strong> 내역을 기간·범위를
                  정해 모아 보기
                </span>
                <span className="shrink-0 font-bold text-emerald-700">찾기 ›</span>
              </button>
            )}

            {/*
              규칙은 앞으로 들어올 내역만 정하고, 그나마 카테고리뿐입니다.
              이미 등록된 지난 달들과 고정비 여부는 여기서 직접 씁니다.
            */}
            {editing && classifyReach.total > 1 && classifyChanged && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                <p className="text-[10px] font-bold text-slate-500">
                  이 계좌에 <span className="text-slate-800">{editing.merchant}</span>{" "}
                  내역이 {classifyReach.total}건 있습니다
                </p>

                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ["ONE", "이 건만"],
                      ["SAME_MERCHANT", `같은 내역명 ${classifyReach.total}건 모두`],
                    ] as [NoteScope, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setClassifyScope(value)}
                      className={`rounded-lg px-2 py-2 text-[11px] font-bold transition border ${
                        classifyScope === value
                          ? "bg-white border-emerald-400 text-emerald-700 shadow-xs"
                          : "bg-transparent border-slate-200 text-slate-500 hover:bg-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <p className="text-[10px] text-slate-400 leading-relaxed">
                  {classifyScope === "SAME_MERCHANT"
                    ? classifyReach.changing > 0
                      ? `다른 결제월을 포함해 ${classifyReach.changing}건의 분류가 함께 바뀝니다.`
                      : "나머지 건은 이미 같은 분류입니다."
                    : "다른 결제월의 같은 내역은 그대로 둡니다."}
                </p>
              </div>
            )}
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

          {/* Which card this bill settles, so its usage can be read from here */}
          {category === CARD_PAYMENT_CATEGORY && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                결제한 카드 (선택)
              </label>
              <select
                value={linkedAccountId}
                onChange={(e) => {
                  setLinkTouched(true);
                  setLinkedAccountId(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden bg-white"
              >
                <option value="">연결 안 함</option>
                {accounts.filter(isCardAccount).map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    [{acc.institution}] {acc.name}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                연결하면 입출금 목록에서 이 금액을 눌러 해당 카드의 월별 이용 내역을 볼 수
                있습니다.
              </p>
            </div>
          )}

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

            {isFixed && (
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

          {/* 설명 — 명세서가 말해 주지 않는 것을 사람이 적는 칸 */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
              <MessageSquareText className="w-3.5 h-3.5 text-slate-400" />
              설명 (선택)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 사무실 프린터 토너, 어머니 생신 선물"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-hidden"
            />

            {editing && reach.total > 1 && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                <p className="text-[10px] font-bold text-slate-500">
                  이 계좌에 <span className="text-slate-800">{editing.merchant}</span>{" "}
                  내역이 {reach.total}건 있습니다
                </p>

                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      ["ONE", "이 건만"],
                      ["SAME_MERCHANT", `같은 내역명 ${reach.total}건 모두`],
                    ] as [NoteScope, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setNoteScope(value)}
                      className={`rounded-lg px-2 py-2 text-[11px] font-bold transition border ${
                        noteScope === value
                          ? "bg-white border-emerald-400 text-emerald-700 shadow-xs"
                          : "bg-transparent border-slate-200 text-slate-500 hover:bg-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/*
                  이미 적어 둔 설명은 그 건에 대해 알려진 가장 구체적인 사실이라,
                  덮어쓸지 말지를 사람이 정하게 합니다.
                */}
                {noteScope === "SAME_MERCHANT" && reach.described > 0 && (
                  <div className="space-y-1.5 pt-1.5 border-t border-slate-200">
                    <p className="text-[10px] font-bold text-amber-700">
                      그중 {reach.described}건에는 이미 다른 설명이 적혀 있습니다
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          [false, "그대로 두기"],
                          [true, "덮어쓰기"],
                        ] as [boolean, string][]
                      ).map(([value, label]) => (
                        <button
                          key={String(value)}
                          type="button"
                          onClick={() => setNoteOverwrite(value)}
                          className={`rounded-lg px-2 py-2 text-[11px] font-bold transition border ${
                            noteOverwrite === value
                              ? "bg-white border-amber-400 text-amber-700 shadow-xs"
                              : "bg-transparent border-slate-200 text-slate-500 hover:bg-white"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {noteScope === "SAME_MERCHANT" && (
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    {noteOverwrite
                      ? `${reach.total}건 모두 이 설명으로 바뀝니다.`
                      : `설명이 비어 있는 ${reach.total - reach.described}건에만 적습니다.`}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 막은 까닭은 버튼 바로 위에 — 누른 자리에서 보여야 합니다 */}
          {formError && (
            <div className="mt-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
              <span className="text-[11px] font-bold text-rose-700 leading-relaxed">
                {formError}
              </span>
            </div>
          )}

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
  return (
    <>
      {createPortal(modalContent, document.body)}

      {/* 같은 가맹점 모아 보기 — 전체 기간에서 시작합니다 */}
      <SearchModal
        isOpen={similarOf !== null}
        initial={similarOf ? { similarTo: similarOf } : undefined}
        onClose={() => setSimilarOf(null)}
        onPick={() => setSimilarOf(null)}
      />

      <ConfirmModal
        isOpen={ask !== null}
        title={ask?.title ?? ""}
        message={ask?.message}
        details={ask?.details}
        danger={ask?.danger}
        confirmLabel={ask?.confirmLabel}
        undoable={ask?.undoable}
        onConfirm={() => ask?.run()}
        onClose={() => setAsk(null)}
      />
    </>
  );
};
