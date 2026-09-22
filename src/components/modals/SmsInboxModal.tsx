import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useFinance } from "../../context/FinanceContext";
import { formatAmountInput, parseAmountInput, won } from "../../utils/format";
import { CategorySelect } from "../transactions/CategorySelect";
import type { SmsInboxItem } from "../../context/FinanceContext";
import { INSTALL_FEATURE_NAME } from "../pwa/PWAInstallButton";
import {
  MessageSquareText,
  X,
  CheckSquare,
  Square,
  Share2,
  ClipboardPaste,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Pencil,
  ChevronDown,
} from "lucide-react";

type Filter = "ALL" | "NEW" | "CHECK" | "DUPLICATE";

/**
 * 담은 결과를 한 줄로.
 *
 * **빠진 건수를 반드시 말합니다.** 광고·청구 통지·출금예정 안내는 금액이 적혀
 * 있어도 거래가 아니라 자동으로 빠지는데, 그 사실을 말하지 않으면 있어야 할
 * 건이 없을 때 사용자가 알아차릴 방법이 없습니다.
 */
function describeIntake(
  result: { added: number; skipped: number; ignored: number },
  what: string
): string {
  const { added, skipped, ignored } = result;
  const aside = [
    skipped > 0 ? `이미 담긴 ${skipped}건` : "",
    ignored > 0 ? `거래가 아닌 ${ignored}건` : "",
  ].filter(Boolean);

  if (added > 0) {
    return `${what}에서 ${added}건을 담았습니다.${
      aside.length > 0 ? ` (${aside.join(" · ")} 제외)` : ""
    }`;
  }
  if (skipped > 0) return "이미 대기함에 담겨 있는 문자입니다.";
  if (ignored > 0) {
    return `거래 문자가 아니어서 ${ignored}건 모두 빠졌습니다. 광고·청구금액 안내·출금예정 알림은 담지 않습니다.`;
  }
  return "거래 내역을 찾지 못했습니다. 금액이 적힌 결제 문자인지 확인해주세요.";
}

/**
 * 결제 문자로 들어온 내역을 확인하고 등록하는 화면.
 *
 * 이 기능의 자리를 분명히 해 둘 필요가 있습니다. 문자는 명세서를 **대신하지
 * 않습니다** — 명세서가 할부 회차·수수료·차감까지 갖춘 정확한 기록이고,
 * 문자의 값은 **즉시성** 하나입니다. 달이 끝나기 전에 오늘 쓴 것을 넣어 예산
 * 소진율을 맞게 보는 것.
 *
 * 그래서 나중에 같은 거래가 명세서로 다시 들어옵니다. 그때 두 줄이 되지 않도록
 * 문자로 넣은 줄에는 `origin: "SMS"` 가 붙고, 명세서 가져오기가 **같은 날짜·
 * 같은 금액**이면 그 줄을 알아보고 덮어씁니다(7.6·7.8).
 *
 * 문자함을 앱이 직접 읽을 수는 없습니다 — 브라우저에 그런 API 가 없고,
 * Android 의 READ_SMS 는 네이티브 앱 권한이며 iOS 에는 아예 없습니다. 무엇을
 * 골라 넘기느냐가 곧 기간과 대상을 정하는 일이라, 기간 선택 칸도 두지 않습니다.
 *
 * 넘기는 길은 셋이고, **클립보드가 실제로 가장 짧습니다.**
 *
 * 1. `텍스트 복사` → [복사한 문자 담기]. 삼성 메시지의 말풍선 메뉴에는 공유가
 *    없고(`전달`은 문자 앱 안에서만) 복사만 있어, 이 길이 기본입니다.
 * 2. 붙여넣기 — 클립보드 권한이 막혔거나 https 가 아닐 때.
 * 3. 공유(`share_target`) — 앱을 설치했고, `텍스트 선택` 후 선택 도구에 공유가
 *    있을 때. 매니페스트가 바뀌었으니 **다시 설치**해야 목록에 나타납니다.
 */
export const SmsInboxModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  /** 공유로 들어온 글. 열릴 때 한 번 대기함에 담습니다. */
  sharedText?: string | null;
  onSharedConsumed?: () => void;
}> = ({ isOpen, onClose, sharedText, onSharedConsumed }) => {
  const {
    smsInbox,
    receiveSmsText,
    reviseSmsItem,
    registerSmsItems,
    dismissSmsItems,
    deleteSmsItems,
    accounts,
  } = useFinance();

  const [pasted, setPasted] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPasted("");
    setNotice(null);
    setFilter("ALL");
    setChosen(new Set());
    setEditing(null);
  }, [isOpen]);

  /*
    공유로 들어온 글은 열릴 때 한 번만 담습니다. 담고 나면 부모가 비워 주어
    다시 담기지 않게 합니다 — 같은 글이 두 번 들어오면 대기함이 불어납니다.
  */
  useEffect(() => {
    if (!isOpen || !sharedText || !sharedText.trim()) return;
    setNotice(describeIntake(receiveSmsText(sharedText), "공유된 문자"));
    onSharedConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sharedText]);

  const shown = useMemo(() => {
    return smsInbox.filter((item: SmsInboxItem) => {
      if (filter === "ALL") return true;
      if (filter === "DUPLICATE") return item.match?.kind === "EXACT";
      if (filter === "CHECK") return item.match?.kind === "LIKELY";
      return !item.match;
    });
  }, [smsInbox, filter]);

  if (!isOpen) return null;

  const counts = {
    all: smsInbox.length,
    fresh: smsInbox.filter((item: SmsInboxItem) => !item.match).length,
    check: smsInbox.filter((item: SmsInboxItem) => item.match?.kind === "LIKELY").length,
    dup: smsInbox.filter((item: SmsInboxItem) => item.match?.kind === "EXACT").length,
  };

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 계좌를 아직 못 고른 건은 등록할 수 없습니다 — 어디에 넣을지 모릅니다. */
  const ready = Array.from(chosen).filter((id) => {
    const item = smsInbox.find((row: SmsInboxItem) => row.id === id);
    return item?.parsed.accountId;
  });

  const handleRegister = () => {
    const items = ready.map((id) => {
      const item = smsInbox.find((row: SmsInboxItem) => row.id === id)!;
      return {
        id,
        accountId: item.parsed.accountId as string,
        /*
          같은 거래가 이미 있으면 **덮어씁니다.** 문자가 더 새로운 정보일 수
          있고(가맹점 이름이 더 읽기 쉬운 경우), 무엇보다 같은 돈이 두 줄이
          되는 것을 막습니다. 어느 줄을 덮을지는 이미 화면에 적혀 있습니다.
        */
        replaceId: item.match?.id,
      };
    });

    const { added, replaced } = registerSmsItems(items);
    setChosen(new Set());
    setNotice(
      added + replaced === 0
        ? "등록된 건이 없습니다."
        : `${added}건 등록${replaced > 0 ? ` · ${replaced}건 대체` : ""}했습니다.`
    );
  };

  const content = (
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom duration-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-start gap-2 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <MessageSquareText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">결제 문자 등록</h3>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                문자 앱에서 <strong>복사</strong>하거나 <strong>공유</strong>해서 담습니다
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="w-11 h-11 shrink-0 flex items-center justify-center -mr-2 -mt-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/*
          문자 앱에서 앱으로 넘기는 두 가지 길.

          삼성 메시지의 말풍선 길게 누르기 메뉴에는 **공유가 없습니다** — `전달`
          (문자 앱 안에서만)과 `텍스트 복사`뿐이고, 안드로이드 공유 시트를
          띄우지 않습니다. 그래서 `텍스트 복사` → 클립보드에서 담기가 실제로
          가장 짧은 길이고, 이것을 기본으로 둡니다. 공유는 `텍스트 선택` 후
          선택 도구에 공유가 있는 경우에만 쓸 수 있습니다.
        */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
          <button
            type="button"
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (!text.trim()) {
                  setNotice("클립보드가 비어 있습니다. 문자 앱에서 [텍스트 복사]를 먼저 누르세요.");
                  return;
                }
                setNotice(describeIntake(receiveSmsText(text), "클립보드"));
              } catch {
                /*
                  권한을 막았거나 https 가 아니면 클립보드를 읽을 수 없습니다.
                  그럴 때는 아래 칸이 있으니 길이 끊기지는 않습니다.
                */
                setNotice(
                  "클립보드를 읽지 못했습니다. 아래 칸에 직접 붙여넣어 주세요."
                );
              }
            }}
            className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition flex items-center justify-center gap-1.5"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>복사한 문자 담기</span>
          </button>

          <p className="text-[10px] text-slate-500 leading-relaxed">
            문자 앱에서 말풍선을 길게 눌러 <strong>[텍스트 복사]</strong> → 여기서 위
            버튼. 여러 건은 문자 앱에서 <strong>여러 개 선택 후 복사</strong>하면 한 번에
            담깁니다. 광고·청구금액 안내·출금예정 알림은 <strong>자동으로 빠지고</strong>{" "}
            몇 건이 빠졌는지 알려 드립니다.
          </p>

          <details>
            <summary className="text-[10px] font-bold text-slate-500 cursor-pointer flex items-center gap-1">
              <Share2 className="w-3 h-3 text-slate-400" />
              직접 붙여넣기 / 공유로 보내기
              <ChevronDown className="w-3 h-3 text-slate-400 ml-auto" />
            </summary>
            <div className="pt-2 space-y-2">
              <textarea
                rows={3}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="문자를 그대로 붙여넣으세요. 여러 건을 한 번에 넣어도 됩니다."
                className="w-full rounded-xl border border-slate-200 p-2.5 text-[11px] text-slate-900 font-mono leading-relaxed focus:border-emerald-500 focus:outline-hidden"
              />
              <button
                type="button"
                disabled={!pasted.trim()}
                onClick={() => {
                  const result = receiveSmsText(pasted);
                  setPasted("");
                  setNotice(describeIntake(result, "붙여넣은 글"));
                }}
                className="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition disabled:opacity-40"
              >
                읽어서 담기
              </button>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                <strong>공유</strong>로 보내려면 앱을 홈 화면에 설치한 뒤(설정 →{" "}
                {INSTALL_FEATURE_NAME}), 문자 앱에서 <strong>[텍스트 선택]</strong> → 글을 고르고 → 선택
                도구의 공유를 쓰세요. 말풍선을 길게 눌렀을 때 나오는 메뉴에는 공유가
                없습니다 — 삼성 메시지는 거기서 공유 시트를 띄우지 않습니다.
              </p>
            </div>
          </details>
        </div>

        {notice && (
          <p className="text-[11px] font-bold text-slate-600 bg-slate-50 border border-slate-200/70 rounded-xl px-2.5 py-2 leading-relaxed">
            {notice}
          </p>
        )}

        {smsInbox.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <MessageSquareText className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs font-bold text-slate-500">대기 중인 문자가 없습니다</p>
            <p className="text-[11px] text-slate-400 leading-relaxed px-4">
              문자 앱에서 결제 문자를 <strong>복사</strong>하고 위의{" "}
              <strong>[복사한 문자 담기]</strong>를 누르세요. 여러 건을 함께 복사하면 한
              번에 담깁니다.
              <br />
              <span className="text-slate-300">
                앱이 문자함을 직접 읽을 수는 없습니다 — 브라우저에 그런 기능이 없고,
                문자 읽기 권한은 네이티브 앱에만 있습니다.
              </span>
            </p>
          </div>
        ) : (
          <>
            {/* 상태별 묶음 */}
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  ["ALL", `전체 ${counts.all}`],
                  ["NEW", `새 내역 ${counts.fresh}`],
                  ["CHECK", `확인 ${counts.check}`],
                  ["DUPLICATE", `중복 ${counts.dup}`],
                ] as [Filter, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`py-1.5 rounded-lg text-[10px] font-bold transition border ${
                    filter === value
                      ? "bg-white border-emerald-400 text-emerald-700"
                      : "bg-slate-50 border-slate-200 text-slate-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                setChosen(
                  chosen.size === shown.length
                    ? new Set()
                    : new Set(shown.map((item: SmsInboxItem) => item.id))
                )
              }
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70 text-[11px] font-bold text-slate-600 hover:bg-slate-100 transition"
            >
              <span className="flex items-center gap-1.5">
                {chosen.size === shown.length && shown.length > 0 ? (
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-slate-400" />
                )}
                전체 선택
              </span>
              <span className="text-slate-400">
                {chosen.size}/{shown.length}건
              </span>
            </button>

            <div className="space-y-1.5">
              {shown.map((item: SmsInboxItem) => {
                const isChosen = chosen.has(item.id);
                const isEditing = editing === item.id;
                const dup = item.match?.kind === "EXACT";
                const check = item.match?.kind === "LIKELY";
                const account = accounts.find(
                  (row: { id: string }) => row.id === item.parsed.accountId
                );

                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border transition ${
                      dup
                        ? "bg-slate-50 border-slate-200"
                        : check
                          ? "bg-amber-50/60 border-amber-200"
                          : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="p-2.5 flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() => toggle(item.id)}
                        className="mt-0.5 shrink-0"
                        aria-label="선택"
                      >
                        {isChosen ? (
                          <CheckSquare className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {item.parsed.merchant || "내역명 없음"}
                          </span>
                          <span
                            className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full shrink-0 ${
                              dup
                                ? "bg-slate-200 text-slate-600"
                                : check
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {dup ? "중복" : check ? "확인 필요" : "새 내역"}
                          </span>
                          {item.parsed.confidence === "LOW" && (
                            <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-full shrink-0">
                              못 읽은 칸 있음
                            </span>
                          )}
                        </div>

                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {item.parsed.date}
                          {item.parsed.time ? ` ${item.parsed.time}` : ""} ·{" "}
                          {item.parsed.category || "카테고리 없음"}
                          {item.parsed.method ? ` · ${item.parsed.method}` : ""}
                        </div>

                        {/* 어느 계좌에 넣을지 — 문자가 말해 주지 않으면 비어 있습니다 */}
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <select
                            value={item.parsed.accountId || ""}
                            onChange={(e) =>
                              reviseSmsItem(item.id, {
                                ...item.parsed,
                                accountId: e.target.value || undefined,
                              })
                            }
                            className={`flex-1 min-w-0 rounded-lg border px-2 py-1 text-[10px] font-bold focus:outline-hidden ${
                              item.parsed.accountId
                                ? "border-slate-200 bg-white text-slate-700"
                                : "border-rose-300 bg-rose-50 text-rose-700"
                            }`}
                          >
                            <option value="">계좌·카드를 고르세요</option>
                            {accounts.map((row: { id: string; name: string }) => (
                              <option key={row.id} value={row.id}>
                                {row.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setEditing(isEditing ? null : item.id)}
                            title="내역 고치기"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {check && (
                          <p className="mt-1.5 text-[10px] font-bold text-amber-700 leading-relaxed">
                            <AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                            같은 날 같은 금액의 내역이 이미 있는데 이름이 다릅니다. 같은
                            건이면 등록하면 덮어쓰고, 다른 건이면 선택에서 빼주세요.
                          </p>
                        )}
                        {dup && (
                          <p className="mt-1.5 text-[10px] text-slate-500 leading-relaxed">
                            <CheckCircle2 className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                            이미 등록된 내역입니다. 선택하면 그 줄을 이 내용으로 덮어씁니다.
                          </p>
                        )}

                        {isEditing && (
                          <div className="mt-2 space-y-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200/70">
                            <input
                              type="text"
                              value={item.parsed.merchant}
                              onChange={(e) =>
                                reviseSmsItem(item.id, {
                                  ...item.parsed,
                                  merchant: e.target.value,
                                })
                              }
                              placeholder="내역명"
                              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[11px] focus:border-emerald-500 focus:outline-hidden"
                            />
                            <div className="grid grid-cols-2 gap-1.5">
                              <input
                                type="date"
                                value={item.parsed.date}
                                onChange={(e) =>
                                  reviseSmsItem(item.id, {
                                    ...item.parsed,
                                    date: e.target.value,
                                  })
                                }
                                className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] focus:border-emerald-500 focus:outline-hidden"
                              />
                              <input
                                type="text"
                                inputMode="numeric"
                                value={formatAmountInput(String(item.parsed.amount))}
                                onChange={(e) =>
                                  reviseSmsItem(item.id, {
                                    ...item.parsed,
                                    amount: parseAmountInput(e.target.value),
                                  })
                                }
                                className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-right font-bold focus:border-emerald-500 focus:outline-hidden"
                              />
                            </div>
                            <CategorySelect
                              value={item.parsed.category || "기타지출"}
                              onChange={(next: string) =>
                                reviseSmsItem(item.id, { ...item.parsed, category: next })
                              }
                            />
                            <p className="text-[9px] text-slate-400 font-mono leading-relaxed break-all">
                              {item.rawText}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <div
                          className={`text-xs font-black whitespace-nowrap ${
                            item.parsed.type === "INCOME" ? "text-emerald-700" : "text-slate-900"
                          }`}
                        >
                          {item.parsed.type === "INCOME" ? "+" : "-"}
                          {won(item.parsed.amount)}
                        </div>
                        {account && (
                          <div className="text-[9px] text-slate-400 truncate max-w-24">
                            {account.name}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {chosen.size > ready.length && (
              <p className="text-[10px] font-bold text-rose-600 leading-relaxed">
                고른 {chosen.size}건 중 {chosen.size - ready.length}건은 계좌·카드를 아직
                고르지 않아 등록되지 않습니다.
              </p>
            )}

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={chosen.size === 0}
                onClick={() => {
                  deleteSmsItems(Array.from(chosen));
                  setChosen(new Set());
                  setNotice("선택한 문자를 대기함에서 지웠습니다.");
                }}
                className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs transition disabled:opacity-40 flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                지우기
              </button>
              <button
                type="button"
                disabled={chosen.size === 0}
                onClick={() => {
                  dismissSmsItems(Array.from(chosen));
                  setChosen(new Set());
                  setNotice("선택한 문자를 등록하지 않고 치웠습니다.");
                }}
                className="py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs transition disabled:opacity-40"
              >
                넘기기
              </button>
              <button
                type="button"
                disabled={ready.length === 0}
                onClick={handleRegister}
                className="py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition disabled:opacity-40"
              >
                {ready.length}건 등록
              </button>
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              문자로 넣은 내역은 <strong>임시</strong>입니다. 나중에 같은 거래가 카드사
              명세서로 들어오면 그쪽이 더 정확하므로(할부 회차·수수료·차감까지)
              <strong> 같은 날짜·같은 금액이면 자동으로 대체</strong>됩니다.
            </p>
          </>
        )}
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
};
