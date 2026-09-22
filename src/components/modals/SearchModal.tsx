import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { won, withCommas } from "../../utils/format";
import {
  runQuery,
  queryTotals,
  toCsv,
  csvFileName,
  type Direction,
  type Kind,
  type LedgerQuery,
} from "../../services/query";
import type { ConnectedAccount, Transaction } from "../../types/finance";
import {
  Search,
  X,
  Download,
  ChevronRight,
  Lock,
  CreditCard,
  Landmark,
  Calendar,
} from "lucide-react";

/**
 * 내역 찾기 — 기간 · 범위 · 구분 · 카테고리 · 검색어.
 *
 * 세 가지 요구가 같은 화면으로 모입니다.
 * - **전체 기간 검색**: 내역 목록의 검색이 그 달 안에서만 되어서 "작년에 그
 *   병원 얼마 냈지"에 답할 수 없었습니다.
 * - **비슷한 항목 모아 보기**: 한 건을 고르면 같은 가맹점을 기간·범위를 정해
 *   모아 봅니다. 이름이 달라도 찾습니다(§10의 정규화).
 * - **카테고리별 내역 보기**: 카테고리 + 기간 + 범위.
 *
 * 그리고 무엇을 찾았든 **그대로 CSV 로 내려받습니다** — 조회 결과가 곧
 * 내보낼 것입니다.
 */
export const SearchModal: React.FC<{
  isOpen: boolean;
  /** 처음 열 때의 조건. `유사 내역 보기`가 가맹점 이름을 넣어 엽니다. */
  initial?: LedgerQuery;
  onClose: () => void;
  onPick: (transaction: Transaction) => void;
}> = ({ isOpen, initial, onClose, onPick }) => {
  const { allTransactions, accounts, categories, selectedMonth } = useFinance();

  const [query, setQuery] = useState<LedgerQuery>({});
  const [sortBy, setSortBy] = useState<"DATE" | "AMOUNT">("DATE");
  const [notice, setNotice] = useState<string | null>(null);

  /*
    열 때마다 주어진 조건으로 되돌립니다.

    조건은 **`isOpen` 이 켜지는 순간** 싣습니다 — 초기식에 두면 앱이 처음 뜰 때
    한 번만 계산되어, `유사 내역 보기`로 다시 열어도 옛 조건이 남습니다(§14.7).
  */
  useEffect(() => {
    if (!isOpen) return;
    setQuery(initial || {});
    setSortBy("DATE");
    setNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initial?.similarTo, initial?.categories?.join(), initial?.from, initial?.to]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const rows = useMemo(() => {
    const found = runQuery(allTransactions, query);
    return found
      .slice()
      .sort((a: Transaction, b: Transaction) =>
        sortBy === "AMOUNT"
          ? b.amount - a.amount
          : `${b.date} ${b.time || ""}`.localeCompare(`${a.date} ${a.time || ""}`)
      );
  }, [allTransactions, query, sortBy]);

  const totals = useMemo(() => queryTotals(rows), [rows]);

  if (!isOpen) return null;

  const set = (patch: Partial<LedgerQuery>) => setQuery((prev) => ({ ...prev, ...patch }));

  const accountOf = (id: string): ConnectedAccount | undefined =>
    accounts.find((account: ConnectedAccount) => account.id === id);

  /** 범위 — 고르지 않으면 전부입니다. */
  const toggleAccount = (id: string) =>
    setQuery((prev) => {
      const chosen = new Set(prev.accountIds || []);
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      return { ...prev, accountIds: Array.from(chosen) };
    });

  const download = () => {
    try {
      /*
        엑셀은 BOM 이 없으면 UTF-8 한글을 깨진 상태로 엽니다. 가져올 때
        euc-kr 을 다루며 배운 것과 같은 문제를 반대 방향에서 만나는 셈입니다(§7.2).
      */
      const blob = new Blob(["﻿" + toCsv(rows, accounts)], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFileName(query, rows.length);
      link.click();
      URL.revokeObjectURL(url);
      setNotice(`${rows.length}건을 CSV 로 내려받았습니다.`);
    } catch (error) {
      console.error("CSV 를 만들지 못했습니다:", error);
      setNotice("CSV 를 만들지 못했습니다.");
    }
  };

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-full text-[10px] font-bold transition cursor-pointer ${
      on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`;

  const content = (
    <div
      className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Search className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">내역 찾기</h3>
              <p className="text-[10px] text-slate-400 truncate">
                {query.similarTo
                  ? `'${query.similarTo}'과 같은 가맹점`
                  : "기간·범위·카테고리를 정해 전체에서 찾습니다"}
              </p>
            </div>
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

        {notice && (
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200/70 text-[11px] font-bold text-emerald-800">
            {notice}
          </div>
        )}

        {/* 검색어 */}
        <input
          type="text"
          value={query.text || ""}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="내역명·메모·설명에서 찾기"
          className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-800 focus:border-emerald-500 focus:outline-hidden"
        />

        {/* 유사 항목 모드 — 켜져 있으면 이름 조건이 더 세게 걸립니다 */}
        {query.similarTo && (
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-600 min-w-0 truncate">
              같은 가맹점만 보는 중 — 이름이 달라도 찾습니다
            </span>
            <button
              type="button"
              onClick={() => set({ similarTo: undefined })}
              className="shrink-0 whitespace-nowrap text-[10px] font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              해제
            </button>
          </div>
        )}

        {/* 기간 */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-slate-500">기간</span>
          <div className="flex items-center gap-1.5">
            <input
              type="month"
              value={query.from || ""}
              onChange={(e) => set({ from: e.target.value || undefined })}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-800 focus:border-emerald-500 focus:outline-hidden"
            />
            <span className="text-[10px] font-bold text-slate-500 shrink-0">~</span>
            <input
              type="month"
              value={query.to || ""}
              onChange={(e) => set({ to: e.target.value || undefined })}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-800 focus:border-emerald-500 focus:outline-hidden"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* 비우면 전체 기간입니다 — 그것이 이 화면의 기본값입니다 */}
            <button
              type="button"
              onClick={() => set({ from: undefined, to: undefined })}
              className={chip(!query.from && !query.to)}
            >
              전체 기간
            </button>
            <button
              type="button"
              onClick={() => set({ from: selectedMonth, to: selectedMonth })}
              className={chip(query.from === selectedMonth && query.to === selectedMonth)}
            >
              <Calendar className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" />
              {Number(selectedMonth.slice(5, 7))}월
            </button>
            <button
              type="button"
              onClick={() => set({ from: `${selectedMonth.slice(0, 4)}-01`, to: `${selectedMonth.slice(0, 4)}-12` })}
              className={chip(query.from === `${selectedMonth.slice(0, 4)}-01`)}
            >
              {selectedMonth.slice(0, 4)}년
            </button>
          </div>
        </div>

        {/* 범위 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-slate-500">범위</span>
            {(query.accountIds?.length || 0) > 0 && (
              <button
                type="button"
                onClick={() => set({ accountIds: [] })}
                className="text-[10px] font-bold text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                전체로
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {accounts.map((account: ConnectedAccount) => (
              <button
                key={account.id}
                type="button"
                onClick={() => toggleAccount(account.id)}
                className={chip((query.accountIds || []).includes(account.id))}
              >
                {account.type === "BANK" ? (
                  <Landmark className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" />
                ) : (
                  <CreditCard className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" />
                )}
                {account.name.length > 12 ? `${account.name.slice(0, 12)}…` : account.name}
              </button>
            ))}
          </div>
        </div>

        {/* 구분 · 카테고리 */}
        <div className="grid grid-cols-2 gap-2">
          <select
            value={query.direction || "ALL"}
            onChange={(e) => set({ direction: e.target.value as Direction })}
            className="px-2.5 py-2 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-800 bg-white focus:border-emerald-500 focus:outline-hidden"
          >
            <option value="ALL">수입·지출 전체</option>
            <option value="EXPENSE">지출만</option>
            <option value="INCOME">수입만</option>
          </select>
          <select
            value={query.kind || "ALL"}
            onChange={(e) => set({ kind: e.target.value as Kind })}
            className="px-2.5 py-2 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-800 bg-white focus:border-emerald-500 focus:outline-hidden"
          >
            <option value="ALL">고정·변동 전체</option>
            <option value="FIXED">고정비만</option>
            <option value="VARIABLE">변동비만</option>
          </select>
        </div>

        <select
          value={(query.categories || [])[0] || ""}
          onChange={(e) => set({ categories: e.target.value ? [e.target.value] : [] })}
          className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-800 bg-white focus:border-emerald-500 focus:outline-hidden"
        >
          <option value="">전체 카테고리</option>
          {categories.map((category: string) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        {/* 결과 */}
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/70 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-600">
              찾은 내역 {totals.count.toLocaleString()}건
            </span>
            <button
              type="button"
              onClick={download}
              disabled={rows.length === 0}
              className="shrink-0 whitespace-nowrap px-2.5 py-1 rounded-xl bg-white border border-slate-200 text-[10px] font-bold text-slate-700 hover:bg-slate-100 transition flex items-center gap-1 disabled:opacity-40 cursor-pointer disabled:cursor-default"
            >
              <Download className="w-3 h-3" />
              CSV 내려받기
            </button>
          </div>
          {totals.count > 0 && (
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>
                지출 <strong className="text-slate-800">{withCommas(totals.expense)}원</strong>
                {totals.income > 0 && (
                  <>
                    {" · "}수입{" "}
                    <strong className="text-emerald-700">{withCommas(totals.income)}원</strong>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => setSortBy((prev) => (prev === "DATE" ? "AMOUNT" : "DATE"))}
                className="shrink-0 font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                {sortBy === "DATE" ? "날짜순" : "금액순"} ⇅
              </button>
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-slate-400 leading-relaxed">
            조건에 맞는 내역이 없습니다.
            <br />
            기간을 <strong>전체 기간</strong>으로 넓혀보세요.
          </p>
        ) : (
          <div className="space-y-1.5">
            {/* 너무 많으면 앞의 200건만 — 나머지는 CSV 로 봅니다 */}
            {rows.slice(0, 200).map((tx: Transaction) => {
              const account = accountOf(tx.accountId);
              return (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => onPick(tx)}
                  className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition flex items-center gap-2.5 cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {tx.merchant}
                      {tx.expenseType === "FIXED" && (
                        <Lock className="w-2.5 h-2.5 inline -mt-0.5 ml-1 text-indigo-500" />
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {tx.date.replace(/-/g, ".")} · {tx.category}
                      {account ? ` · ${account.name}` : ""}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-black shrink-0 whitespace-nowrap ${
                      tx.type === "INCOME" ? "text-emerald-600" : "text-slate-800"
                    }`}
                  >
                    {tx.type === "INCOME" ? "+" : ""}
                    {won(tx.amount)}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                </button>
              );
            })}
            {rows.length > 200 && (
              <p className="text-[10px] text-slate-400 text-center py-2 leading-relaxed">
                {rows.length.toLocaleString()}건 중 200건만 보여 줍니다.
                <br />
                전부 보려면 <strong>CSV 로 내려받으세요.</strong>
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
        >
          닫기
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
