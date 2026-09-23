import React, { useRef, useState } from "react";
import type { UpkeepNotice, UpkeepKind } from "../../services/upkeep";
import { swipeAxis, swipeDismisses, swipeOffset, type SwipeAxis } from "../../services/swipe";
import {
  ArrowRight,
  X,
  FileWarning,
  ShieldAlert,
  TrendingUp,
  CalendarClock,
} from "lucide-react";

/**
 * 홈의 알림 한 줄 (§12.12).
 *
 * 누르면 그 자리로 가고, `X` 를 누르거나 **옆으로 밀면** 닫힙니다. 판정은
 * `services/swipe.ts` 가 하고 여기서는 그리기만 합니다(§17.5).
 *
 * **색은 무게에 따라 다릅니다.** 백업은 놓치면 되돌릴 수 없어 붉은색, 명세서는
 * 그 달이 비어 주황색, 오른 금액은 알아차려야 할 사실이라 호박색, 예고는 그냥
 * 알면 되는 것이라 회색입니다. 전부 붉게 칠하면 무엇이 급한지 가려지지 않습니다.
 */
export const NOTICE_TONE: Record<
  UpkeepKind,
  { box: string; icon: string; title: string; detail: string; Icon: typeof ArrowRight }
> = {
  BACKUP: {
    box: "bg-rose-50 border-rose-200 hover:bg-rose-100/60",
    icon: "text-rose-600",
    title: "text-rose-900",
    detail: "text-rose-700",
    Icon: ShieldAlert,
  },
  STATEMENT: {
    box: "bg-orange-50 border-orange-200 hover:bg-orange-100/60",
    icon: "text-orange-600",
    title: "text-orange-900",
    detail: "text-orange-700",
    Icon: FileWarning,
  },
  AMOUNT_UP: {
    box: "bg-amber-50 border-amber-200 hover:bg-amber-100/60",
    icon: "text-amber-600",
    title: "text-amber-900",
    detail: "text-amber-700",
    Icon: TrendingUp,
  },
  UPCOMING: {
    box: "bg-white border-slate-200 hover:bg-slate-50",
    icon: "text-slate-400",
    title: "text-slate-800",
    detail: "text-slate-500",
    Icon: CalendarClock,
  },
};

/** 밀어서 닫을 때 줄이 화면 밖으로 나가는 시간. */
const LEAVE_MS = 160;

/**
 * 얼마나 밀었을 때 다 흐려지는가.
 *
 * **너비를 읽지 않습니다.** 그리는 중에 `ref` 를 보면 첫 렌더에는 값이 없고,
 * 있어도 레이아웃을 강제로 재계산하게 됩니다. 흐려지는 정도는 눈에 보이는
 * 효과일 뿐이라 고정 거리로 충분합니다 — 닫히는 지점(§`swipeDismisses`)과는
 * 다른 값이어도 됩니다.
 */
const FADE_PX = 220;

export const NoticeRow: React.FC<{
  notice: UpkeepNotice;
  onOpen: () => void;
  onDismiss: () => void;
}> = ({ notice, onOpen, onDismiss }) => {
  const tone = NOTICE_TONE[notice.kind];
  const Icon = tone.Icon;

  const box = useRef<HTMLDivElement>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<SwipeAxis>("NONE");
  /* 민 뒤에 따라오는 click 을 막는 표시 — 밀어 놓고 화면이 열리면 안 됩니다 */
  const dragged = useRef(false);

  const [offset, setOffset] = useState(0);
  const [sliding, setSliding] = useState(false);

  const widthOf = () => box.current?.offsetWidth || 320;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    from.current = { x: e.clientX, y: e.clientY };
    axis.current = "NONE";
    dragged.current = false;
    setSliding(false);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!from.current) return;
    const dx = e.clientX - from.current.x;
    const dy = e.clientY - from.current.y;

    /*
      **방향이 정해지기 전에는 아무것도 하지 않습니다.** 세로로 넘기려던
      손가락을 가로로 읽으면 목록 스크롤이 끊깁니다(§12.12).
    */
    if (axis.current === "NONE") {
      const next = swipeAxis(dx, dy);
      if (next === "NONE") return;
      axis.current = next;
      if (next === "HORIZONTAL") {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* 이미 놓친 포인터 — 캡처 없이도 동작합니다 */
        }
      }
    }
    if (axis.current !== "HORIZONTAL") return;

    dragged.current = true;
    setOffset(swipeOffset(dx, widthOf()));
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    const started = from.current;
    from.current = null;
    if (!started || axis.current !== "HORIZONTAL") {
      setOffset(0);
      return;
    }

    const dx = e.clientX - started.x;
    const width = widthOf();
    setSliding(true);

    if (swipeDismisses(dx, width)) {
      setOffset(Math.sign(dx) * width);
      window.setTimeout(onDismiss, LEAVE_MS);
      return;
    }
    setOffset(0);
  };

  return (
    <div
      ref={box}
      /* 세로 넘기기는 브라우저에 맡기고 가로만 우리가 봅니다 */
      style={{
        transform: `translateX(${offset}px)`,
        opacity: offset === 0 ? 1 : Math.max(0.25, 1 - Math.abs(offset) / FADE_PX),
        touchAction: "pan-y",
        transition: sliding ? `transform ${LEAVE_MS}ms ease-out, opacity ${LEAVE_MS}ms ease-out` : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={() => {
        from.current = null;
        setSliding(true);
        setOffset(0);
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (dragged.current) return;
          onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen();
        }}
        className={`w-full text-left p-3 rounded-2xl border transition-colors cursor-pointer flex items-start gap-2 select-none ${tone.box}`}
      >
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${tone.icon}`} />
        <div className="min-w-0 flex-1">
          <span className={`text-[11px] font-bold block truncate ${tone.title}`}>
            {notice.title}
          </span>
          <span className={`text-[10px] leading-relaxed block ${tone.detail}`}>
            {notice.detail}
          </span>
        </div>
        <ArrowRight className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${tone.icon}`} />
        {/*
          미는 몸짓을 모르는 사람과 마우스를 쓰는 사람이 있으므로 **닫기는 늘
          눌러서도** 됩니다. 스와이프는 거들 뿐입니다.
        */}
        <button
          type="button"
          aria-label="이 알림 닫기"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className={`shrink-0 -mt-1 -mr-1 w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/5 transition cursor-pointer ${tone.icon}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
