import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { describeUndo, DEFAULT_UNDO_DAYS } from "../../services/undo";
import {
  Undo2,
  X,
  Settings2,
  Trash2,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";

/** 언제 한 일인지 — 목록에서 가장 먼저 읽히는 값입니다. */
function whenLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.floor((Date.now() - at.getTime()) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

/**
 * 기타 설정 — 되돌리기 보관 기간과, 되돌릴 수 있는 최근 작업.
 *
 * 되돌리기를 **토스트로만** 두지 않은 이유: 잘못 눌렀다는 것을 5초 안에
 * 알아차리는 일은 드뭅니다. 특히 `카테고리 일괄 적용`은 바뀐 결과를 다른
 * 화면에서 한참 뒤에 보게 됩니다. 그래서 목록으로 남겨 두고, 얼마나 남길지는
 * 사용자가 정합니다.
 */
export const MiscSettingsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** 데이터 점검 창은 거래 수정으로 이어지므로 부모가 띄웁니다(§14.4 층위). */
  onOpenCheck: () => void;
}> = ({ isOpen, onClose, onOpenCheck }) => {
  const {
    undoEntries,
    undo,
    clearUndoHistory,
    undoRetentionDays,
    setUndoRetentionDays,
  } = useFinance();

  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setNotice(null);
    setBusy(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
              <Settings2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">기타 설정</h3>
              <p className="text-[10px] text-slate-400">되돌리기 보관 기간과 최근 작업</p>
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

        {/*
          데이터 점검 — 새로 들어오는 값은 저장 전에 걸러지지만(§17.7), **그 전에
          들어온 것**은 그대로 남아 있습니다. 실제로 어느 달 합계에도 잡히지 않는
          줄이 46건 있었습니다.
        */}
        <button
          type="button"
          onClick={() => onOpenCheck()}
          className="w-full p-3 rounded-2xl bg-white border border-slate-200 hover:bg-slate-50 transition cursor-pointer flex items-center gap-2 text-left"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[11px] font-bold text-slate-800 block">데이터 점검</span>
            <span className="text-[10px] text-slate-400 leading-relaxed">
              있을 수 없는 날짜·없는 계좌·잘못 붙은 분류를 찾습니다
            </span>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
        </button>

        {/* 보관 기간 */}
        <div className="p-3 rounded-2xl bg-slate-50/80 border border-slate-200/60 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-[11px] font-bold text-slate-700 block">
                되돌리기 보관 기간
              </span>
              <span className="text-[10px] text-slate-400 leading-relaxed">
                지난 것은 자동으로 치웁니다. 임시 저장소는 백업 파일에 함께 실립니다.
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                min={1}
                max={90}
                value={undoRetentionDays}
                onChange={(e) => setUndoRetentionDays(Number(e.target.value))}
                className="w-16 text-right rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm font-black text-slate-900 focus:border-emerald-500 focus:outline-hidden"
              />
              <span className="text-xs font-bold text-slate-500">일</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {[1, 7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setUndoRetentionDays(days)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition cursor-pointer ${
                  undoRetentionDays === days
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {days}일{days === DEFAULT_UNDO_DAYS ? " (기본)" : ""}
              </button>
            ))}
          </div>
        </div>

        {/* 되돌릴 수 있는 작업 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs font-bold text-slate-900">
              되돌릴 수 있는 작업 ({undoEntries.length})
            </span>
            {undoEntries.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearUndoHistory();
                  setNotice("되돌리기 기록을 모두 지웠습니다.");
                }}
                className="shrink-0 whitespace-nowrap text-[10px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                기록 비우기
              </button>
            )}
          </div>

          {undoEntries.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-slate-400 leading-relaxed">
              되돌릴 작업이 없습니다.
              <br />
              삭제·분류 일괄 변경·예산 자동 배분을 하면 여기에 남습니다.
            </p>
          ) : (
            undoEntries.map((entry: any) => (
              <div
                key={entry.id}
                className="p-2.5 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-slate-800 truncate">
                    {describeUndo(entry)}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {whenLabel(entry.createdAt)}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(entry.id);
                    const ok = await undo(entry.id);
                    setBusy(null);
                    setNotice(
                      ok
                        ? "되돌렸습니다."
                        : "되돌리지 못했습니다. 담아 둔 정보가 비어 있거나 저장에 실패했습니다."
                    );
                  }}
                  className="shrink-0 whitespace-nowrap px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold transition flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                >
                  <Undo2 className="w-3 h-3" />
                  {busy === entry.id ? "되돌리는 중..." : "되돌리기"}
                </button>
              </div>
            ))
          )}
        </div>

        <p className="text-[10px] text-slate-400 leading-relaxed">
          되돌리기는 <strong>바꾸기 전의 내용을 그대로 다시 씁니다.</strong> 되돌린 뒤에
          다시 그 작업을 하려면 처음처럼 다시 하면 됩니다.
        </p>

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
