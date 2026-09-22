import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { ConfirmModal } from "../modals/ConfirmModal";
import {
  FLAW_LABELS,
  guessedMonth,
  inspect,
  tally,
  zombies,
  type Flaw,
  type FlawKind,
} from "../../services/integrity";
import type { Transaction } from "../../types/finance";
import { ShieldCheck, X, AlertTriangle, Trash2, ChevronRight } from "lucide-react";

/**
 * 이미 들어와 있는 것을 점검하는 자리 (§17.7).
 *
 * 새로 들어오는 값은 이제 `validate` 가 막습니다. 그런데 **그 전에 들어온 것**은
 * 그대로 남아 있고, 실제 기기에서 `2026-26-08` 같은 줄이 46건 나왔습니다 — 달이
 * 1~12 밖이라 어느 달 합계에도 잡히지 않고, 연월 선택 창은 한 해에 12칸만
 * 보여 주므로 **닿을 수조차 없었습니다.**
 *
 * 그래서 이 화면이 하는 일은 둘입니다: **세어 보여 주기**, 그리고 **지워도 되는
 * 것만 지우기**. 나머지는 고칠 것이라 목록에서 눌러 거래 수정으로 갑니다.
 */
export const DataCheckModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onEdit: (tx: Transaction) => void;
}> = ({ isOpen, onClose, onEdit }) => {
  const { allTransactions, accounts, deleteTransactions } = useFinance();
  const [open, setOpen] = useState<FlawKind | null>(null);
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const flaws = useMemo(
    () => (isOpen ? inspect({ transactions: allTransactions, accounts }) : []),
    [isOpen, allTransactions, accounts]
  );
  const rolled = useMemo(() => tally(flaws), [flaws]);
  const removable = useMemo(() => zombies(flaws), [flaws]);

  if (!isOpen) return null;

  const byId = new Map(allTransactions.map((tx: Transaction) => [tx.id, tx]));

  const remove = () => {
    const ids = removable.map((flaw) => flaw.id);
    setAsking(false);
    if (ids.length === 0) return;

    try {
      deleteTransactions(ids);
      setNotice(`${ids.length}건을 지웠습니다 · 기타 설정에서 되돌릴 수 있습니다`);
      setOpen(null);
    } catch {
      setNotice("지우지 못했습니다. 잠시 뒤 다시 시도해주세요.");
    }
  };

  const shown: Flaw[] = open ? flaws.filter((flaw) => flaw.kind === open) : [];

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
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">데이터 점검</h3>
              <p className="text-[10px] text-slate-400">
                말이 안 되는 줄을 찾아 보여 줍니다 · 전체 {allTransactions.length.toLocaleString()}건
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
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-bold text-emerald-800">
            {notice}
          </div>
        )}

        {rolled.length === 0 ? (
          <div className="py-8 text-center space-y-1.5">
            <ShieldCheck className="w-8 h-8 mx-auto text-emerald-500" />
            <p className="text-xs font-bold text-slate-700">이상한 줄이 없습니다</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              날짜·계좌·결제월·분류를 모두 훑었습니다. 앞으로 들어오는 값도 저장 전에
              같은 규칙으로 걸러집니다.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              {rolled.map((row) => (
                <button
                  key={row.kind}
                  type="button"
                  onClick={() => setOpen(open === row.kind ? null : row.kind)}
                  className={`w-full p-2.5 rounded-xl border text-left flex items-center gap-2 transition cursor-pointer ${
                    open === row.kind
                      ? "bg-slate-100 border-slate-300"
                      : "bg-white border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold text-slate-800">
                      {FLAW_LABELS[row.kind]}
                    </div>
                    {row.removable > 0 && (
                      <div className="text-[10px] text-slate-500">
                        그중 {row.removable}건은 다른 계좌에 사본이 있습니다
                      </div>
                    )}
                  </div>
                  <span className="text-xs font-black text-slate-900 shrink-0">
                    {row.count}건
                  </span>
                  <ChevronRight
                    className={`w-3.5 h-3.5 text-slate-300 shrink-0 transition ${
                      open === row.kind ? "rotate-90" : ""
                    }`}
                  />
                </button>
              ))}
            </div>

            {/*
              지우기는 **사본이 있는 깨진 날짜**에만 나옵니다. 그 줄은 같은 지출이
              제대로 들어간 사본이 있어 잃을 것이 없습니다. 나머지는 그 지출의
              유일한 기록이라 고칠 것이지 버릴 것이 아닙니다(§17.3).
            */}
            {removable.length > 0 && (
              <button
                type="button"
                onClick={() => setAsking(true)}
                className="w-full py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                사본이 있는 {removable.length}건 지우기
              </button>
            )}

            {open && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  {shown[0]?.detail} · 누르면 그 거래를 고칠 수 있습니다.
                </p>
                {shown.slice(0, 60).map((flaw) => {
                  const tx = byId.get(flaw.id);
                  const month = guessedMonth(tx?.date || "");
                  return (
                    <button
                      key={`${flaw.kind}-${flaw.id}`}
                      type="button"
                      disabled={!tx}
                      onClick={() => tx && onEdit(tx)}
                      className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-left hover:bg-slate-50 transition cursor-pointer disabled:cursor-default"
                    >
                      <div className="text-[11px] font-bold text-slate-800 truncate">
                        {flaw.label}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {flaw.duplicateOf ? "다른 계좌에 사본이 있습니다" : ""}
                        {/*
                          달은 되살릴 수 있어도 **날은 잃었습니다** — 보여 주기만 하고
                          고쳐 쓰지 않습니다(§17.1).
                        */}
                        {month
                          ? `${flaw.duplicateOf ? " · " : ""}원래 ${month} 의 것으로 보입니다`
                          : ""}
                      </div>
                    </button>
                  );
                })}
                {shown.length > 60 && (
                  <p className="text-[10px] text-slate-400">
                    {shown.length - 60}건 더 있습니다.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
        >
          닫기
        </button>
      </div>

      <ConfirmModal
        isOpen={asking}
        title={`${removable.length}건을 지웁니다`}
        message="같은 지출이 다른 계좌에 제대로 들어가 있는 줄만 지웁니다. 날짜가 있을 수 없는 값이라 어느 달 합계에도 잡히지 않던 줄입니다."
        details={removable.slice(0, 5).map((flaw) => flaw.label)}
        confirmLabel="지우기"
        undoable
        onConfirm={remove}
        onClose={() => setAsking(false)}
      />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
