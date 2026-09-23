import type { ConnectedAccount, Transaction } from "../types/finance";
import type { RecurringItem } from "./recurrence";
import { looksStopped } from "./recurrence";
import { monthLabel, shiftMonth, thisMonthKey } from "./trend";

/**
 * 앱이 먼저 말해 주는 것들 (§12.12).
 *
 * 이 가계부의 가장 큰 약점은 계산이 아니라 **사람이 잊는 것**입니다. 명세서를
 * 안 넣으면 그 달이 통째로 비고, 백업을 안 하면 기기 고장이 곧 전손이며,
 * 구독료가 오른 것은 명세서를 한 줄씩 읽어야 알 수 있습니다. 셋 다 **앱이 이미
 * 아는 사실**입니다 — 마지막 결제월, 마지막 백업 시각, 반복 판정의 금액.
 *
 * 그래서 계산을 새로 하지 않고 **있는 것을 말합니다.** 판단은 전부 여기 순수
 * 함수에 두고 홈 화면은 결과를 늘어놓기만 합니다(§17.5).
 *
 * **지어내지 않습니다**(§17.1). 근거가 없으면 한 줄도 내지 않습니다 — 명세서를
 * 한 번도 넣지 않은 카드, 반복으로 판정되지 않은 결제, 내역이 하나도 없는
 * 가계부에는 할 말이 없습니다.
 */

export type UpkeepKind = "STATEMENT" | "UPCOMING" | "AMOUNT_UP" | "BACKUP";

export interface UpkeepNotice {
  /** 숨김·중복을 가리는 열쇠. 같은 사실이면 같은 값이어야 합니다. */
  id: string;
  kind: UpkeepKind;
  /** 한 줄로 읽히는 말. */
  title: string;
  detail: string;
  /** 누르면 열 곳. 없으면 누를 것이 없습니다. */
  accountId?: string;
  amount?: number;
}

/**
 * 달이 시작하자마자 묻지 않습니다.
 *
 * 명세서는 결제월 초에 나옵니다 — KB 는 9월 명세서를 9월 3일에 보내고 롯데는
 * 중순입니다. 1일부터 "없습니다"라고 말하면 그것은 알림이 아니라 잡음입니다.
 */
const NAG_FROM_DAY = 10;

/**
 * 이번 달 명세서가 아직 없는 카드 (§12.12).
 *
 * **근거는 "지난달은 들어왔는데 이번 달은 아직"입니다.** 이번 달 것만 보고
 * 판단하면 해지한 카드와 오래 안 쓴 카드가 매달 올라옵니다 — 그 목록은 곧
 * 아무도 읽지 않게 됩니다. 지난달이 있었다는 것만이 "지금도 쓰는 카드"라는
 * 근거입니다.
 */
export function missingStatements(
  accounts: ConnectedAccount[],
  transactions: Transaction[],
  today: Date = new Date()
): UpkeepNotice[] {
  if (today.getDate() < NAG_FROM_DAY) return [];

  const month = thisMonthKey(today);
  const previous = shiftMonth(month, -1);

  /* 카드마다 어느 결제월이 들어와 있는지 */
  const seen = new Map<string, Set<string>>();
  for (const tx of transactions) {
    const key = tx.billingMonth || "";
    if (!key) continue;
    if (!seen.has(tx.accountId)) seen.set(tx.accountId, new Set());
    seen.get(tx.accountId)!.add(key);
  }

  const notices: UpkeepNotice[] = [];

  for (const account of accounts) {
    if (account.type === "BANK") continue;
    const months = seen.get(account.id);
    if (!months) continue;
    if (months.has(month)) continue;
    if (!months.has(previous)) continue;

    notices.push({
      id: `STATEMENT:${account.id}:${month}`,
      kind: "STATEMENT",
      title: `${account.name} ${monthLabel(month)} 명세서가 아직 없습니다`,
      detail: `${monthLabel(previous)}까지는 들어와 있습니다. 카드사에서 내려받아 가져오세요.`,
      accountId: account.id,
    });
  }

  return notices;
}

/** 그 달에 없는 날(31일 없는 달)은 말일로 당깁니다. */
function dayInMonth(year: number, monthIndex: number, day: number): Date {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, last));
}

/** 시각을 떼고 날짜끼리만 셉니다 — 몇 시에 열었는지로 답이 달라지면 안 됩니다. */
function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

function isoDay(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * 며칠 안에 빠져나갈 정기 결제 (§12.12).
 *
 * 반복 판정(§10)이 이미 결제일과 금액을 알고 있습니다. 남은 것은 **오늘로부터
 * 며칠인가**뿐입니다.
 *
 * **이번 달에 이미 나간 것은 말하지 않습니다.** `lastSeen` 이 이번 달이면 그
 * 결제는 끝난 것이고, 그런데도 "3일 뒤"라고 말하면 같은 돈이 두 번 나가는 것처럼
 * 읽힙니다. 두 달 넘게 안 보이는 것(§12.10 `looksStopped`)도 뺍니다 — 끊겼을 수
 * 있는 결제를 예고하는 것은 지어내는 일입니다(§17.1).
 */
export function upcomingCharges(
  items: RecurringItem[],
  today: Date = new Date(),
  withinDays = 7
): UpkeepNotice[] {
  const month = thisMonthKey(today);
  const found: { days: number; notice: UpkeepNotice }[] = [];

  for (const item of items) {
    if (looksStopped(item, today)) continue;
    if (item.lastSeen.slice(0, 7) === month) continue;

    let due = dayInMonth(today.getFullYear(), today.getMonth(), item.paymentDay);
    if (daysBetween(today, due) < 0) {
      due = dayInMonth(today.getFullYear(), today.getMonth() + 1, item.paymentDay);
    }
    const days = daysBetween(today, due);
    if (days > withinDays) continue;

    const when = days === 0 ? "오늘" : `${days}일 뒤`;
    found.push({
      days,
      notice: {
        id: `UPCOMING:${item.key}:${isoDay(due)}`,
        kind: "UPCOMING",
        title: `${when} ${item.merchant} ${item.amount.toLocaleString()}원`,
        detail: `${item.monthCount}개월째 매월 ${item.paymentDay}일 전후에 나갔습니다.`,
        accountId: item.accountId,
        amount: item.amount,
      },
    });
  }

  /* 가까운 것부터, 같은 날이면 큰 것부터 */
  return found
    .sort((a, b) => a.days - b.days || (b.notice.amount || 0) - (a.notice.amount || 0))
    .map((entry) => entry.notice);
}

/**
 * 오른 것으로 보는 문턱 — 비율과 금액을 **둘 다** 넘어야 합니다.
 *
 * 비율만 보면 1,000원짜리의 100원이 10%로 걸리고, 금액만 보면 50만원 월세의
 * 1만원 차이가 매달 올라옵니다.
 */
const JUMP_RATIO = 0.05;
const JUMP_WON = 1000;
/** 오래된 인상은 소식이 아닙니다. */
const JUMP_FRESH_DAYS = 45;

/**
 * 오르는 것이 당연한 것.
 *
 * `카드대금` 은 **한 달 치 소비의 합**입니다 — 매달 달라지는 것이 정상이라
 * "올랐습니다"가 거의 매달 뜹니다. 실제 자료에서 `우리카드결제`가 522,347원 →
 * 814,623원으로 잡혔는데, 그 숫자는 카드·계좌 화면과 청구예정액이 이미 더 정확히
 * 말하고 있습니다(§9.4). 매달 뜨는 알림은 곧 읽히지 않습니다.
 */
const JUMP_SKIP_CATEGORIES = new Set(["카드대금"]);

/**
 * 지난번보다 오른 정기 결제 (§12.12).
 *
 * **평균이 아니라 바로 앞 결제와 견줍니다.** 평균에는 방금 오른 금액이 이미
 * 섞여 있어 차이가 희석되고, 사용자가 확인할 수 있는 사실도 "지난달보다
 * 올랐다" 쪽입니다.
 *
 * 내린 것은 말하지 않습니다 — 알아차려야 할 사실이 아닙니다.
 */
export function amountJumps(
  items: RecurringItem[],
  today: Date = new Date()
): UpkeepNotice[] {
  const notices: UpkeepNotice[] = [];

  for (const item of items) {
    if (item.previous === null) continue;
    if (JUMP_SKIP_CATEGORIES.has(item.category)) continue;
    const gap = item.amount - item.previous;
    if (gap < JUMP_WON) continue;
    if (item.previous > 0 && gap / item.previous < JUMP_RATIO) continue;

    const last = new Date(item.lastSeen);
    if (Number.isNaN(last.getTime())) continue;
    if (daysBetween(last, today) > JUMP_FRESH_DAYS) continue;

    notices.push({
      id: `AMOUNT_UP:${item.key}:${item.lastSeen}`,
      kind: "AMOUNT_UP",
      title: `${item.merchant} ${gap.toLocaleString()}원 올랐습니다`,
      detail: `${item.previous.toLocaleString()}원 → ${item.amount.toLocaleString()}원 (${item.lastSeen})`,
      accountId: item.accountId,
      amount: gap,
    });
  }

  return notices.sort((a, b) => (b.amount || 0) - (a.amount || 0));
}

/** 백업 알림 기본 간격. `0`은 알리지 않는다는 뜻입니다. */
export const DEFAULT_BACKUP_DAYS = 30;

export function normaliseBackupDays(value: unknown): number {
  const days = Math.floor(Number(value));
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.min(365, days);
}

/**
 * 백업한 지 오래됐다는 알림 (§12.12).
 *
 * **서버가 없으므로 기기 고장이 곧 전손입니다**(§1). 이 앱에서 백업은 편의가
 * 아니라 유일한 방어선인데, 지금까지는 사용자가 스스로 기억해야 했습니다.
 *
 * - **내역이 없으면 말하지 않습니다.** 지킬 것이 없는데 권하는 것은 잡음입니다.
 * - **한 번도 안 했으면 그렇게 말합니다.** "며칠 지났다"고 적을 수 없는 상태와
 *   오래된 상태는 다른 사실입니다(§17.1).
 * - 간격이 `0`이면 아무것도 내지 않습니다. 끄는 것은 사용자의 결정입니다.
 *
 * **마지막 백업 시각은 이 브라우저의 기억입니다**(localStorage). 기기를 옮기거나
 * 브라우저 자료를 지우면 함께 사라지고, 그때는 "한 번도 안 했다"로 보입니다 —
 * 실제로 그 기기에서는 백업한 적이 없으므로 맞는 말입니다.
 */
export function backupDue(options: {
  lastBackupAt: string | null;
  days: number;
  entryCount: number;
  today?: Date;
}): UpkeepNotice | null {
  const { lastBackupAt, entryCount } = options;
  const today = options.today || new Date();
  const days = normaliseBackupDays(options.days);
  if (days === 0) return null;
  if (entryCount <= 0) return null;

  if (!lastBackupAt) {
    return {
      id: "BACKUP:never",
      kind: "BACKUP",
      title: "아직 백업한 적이 없습니다",
      detail: `내역 ${entryCount.toLocaleString()}건이 이 기기에만 있습니다. 카드·계좌 화면에서 백업 파일을 내려받으세요.`,
    };
  }

  const last = new Date(lastBackupAt);
  if (Number.isNaN(last.getTime())) return null;
  const since = daysBetween(last, today);
  if (since < days) return null;

  return {
    id: `BACKUP:${lastBackupAt.slice(0, 10)}`,
    kind: "BACKUP",
    title: `백업한 지 ${since}일 됐습니다`,
    detail: `마지막 백업 ${lastBackupAt.slice(0, 10)}. 서버가 없어 이 기기가 고장 나면 되찾을 방법이 없습니다.`,
  };
}

/**
 * 홈에 내놓을 순서.
 *
 * 되돌릴 수 없는 것이 먼저입니다 — 백업(잃으면 끝) → 명세서(그 달이 통째로 빔)
 * → 오른 금액(고칠 수 있음) → 예고(그냥 알면 됨).
 */
const ORDER: UpkeepKind[] = ["BACKUP", "STATEMENT", "AMOUNT_UP", "UPCOMING"];

/**
 * 예고는 몇 줄까지.
 *
 * 실제 자료에서 이레 안에 나갈 정기 결제가 넷이었고, 백업·명세서까지 더하면
 * 홈의 첫 화면이 알림으로 덮입니다. **예고는 이 목록에서 가장 가벼운 소식**이고,
 * 전부 보는 자리는 이미 있습니다(§12.10 정기 결제 모아 보기). 놓치면 되돌릴 수
 * 없는 것들이 스크롤 밖으로 밀리지 않게 가까운 셋만 둡니다.
 */
export const UPCOMING_LIMIT = 3;

/**
 * 닫은 기록 한 줄 — `id` 또는 `id|YYYY-MM-DD`.
 *
 * **예산 경고와 같은 자리에 담습니다**(`dismissedAlertIds`). 저장소를 하나 더
 * 만들면 "닫은 것"이 두 곳에 흩어지고 한쪽만 고쳐질 자리가 생깁니다. 예산
 * 경고는 날짜 없이 id 만 적어 왔고, 그 줄은 여기서 **기한 없는 닫기**로 읽혀
 * 지금과 똑같이 동작합니다.
 *
 * 날짜를 붙이는 것은 **백업뿐**입니다. 나머지 셋은 id 자체가 사실을 담고 있어
 * (`STATEMENT:카드:2026-09`) 사실이 바뀌면 id 가 바뀌고, 닫은 기록이 저절로
 * 비껴갑니다 — 10월이 되면 다시 뜹니다.
 */
export function dismissalFor(notice: UpkeepNotice, today: Date = new Date()): string {
  return notice.kind === "BACKUP" ? `${notice.id}|${isoDay(today)}` : notice.id;
}

function dismissalParts(entry: string): { id: string; at: string | null } {
  const bar = entry.indexOf("|");
  if (bar < 0) return { id: entry, at: null };
  return { id: entry.slice(0, bar), at: entry.slice(bar + 1) };
}

/**
 * 닫아 둔 알림인가.
 *
 * **백업만 "닫기"가 "미루기"입니다.** `BACKUP:never` 는 백업을 할 때까지 id 가
 * 영영 그대로라, 영구 숨김을 허용하면 기기 고장이 곧 전손인 구조에서 **유일한
 * 방어선이 실수로 민 손가락 하나에 꺼집니다**(§1). 그래서 알림 기간만큼만
 * 쉬었다가 다시 올라오고, 영영 끄는 길은 `설정 → 기타 설정 → 알림 기간 0일`에
 * 그대로 둡니다 — 끄는 것은 사용자의 결정이되(§17.2) 그 결정은 설정에서
 * 명시적으로 하는 편이 맞습니다.
 *
 * **날짜가 없는 백업 기록은 숨기지 않습니다.** 언제 닫았는지 모르면 얼마나
 * 미룰지도 알 수 없고, 모를 때 감추는 쪽으로 기울면 그 침묵이 곧 전손입니다.
 */
export function noticeHidden(
  notice: UpkeepNotice,
  dismissals: string[],
  options: { backupDays: number; today?: Date }
): boolean {
  const today = options.today || new Date();

  for (const entry of dismissals) {
    const { id, at } = dismissalParts(entry);
    if (id !== notice.id) continue;

    if (notice.kind !== "BACKUP") return true;

    if (!at) continue;
    const from = new Date(`${at}T00:00:00`);
    if (Number.isNaN(from.getTime())) continue;
    const snooze = normaliseBackupDays(options.backupDays);
    if (snooze > 0 && daysBetween(from, today) < snooze) return true;
  }

  return false;
}

export interface NoticeSplit {
  shown: UpkeepNotice[];
  hidden: UpkeepNotice[];
}

/**
 * 보여 줄 것과 닫아 둔 것.
 *
 * **닫은 것을 목록에서 지우지 않습니다.** 잘못 닫았을 때 되돌릴 방법이 없으면
 * 닫기 버튼이 위험한 버튼이 됩니다 — 화면이 `숨긴 N건 보기`로 펼쳐 줍니다
 * (§12.12).
 */
export function splitNotices(
  notices: UpkeepNotice[],
  dismissals: string[],
  options: { backupDays: number; today?: Date }
): NoticeSplit {
  const shown: UpkeepNotice[] = [];
  const hidden: UpkeepNotice[] = [];

  for (const notice of notices) {
    (noticeHidden(notice, dismissals, options) ? hidden : shown).push(notice);
  }

  return { shown, hidden };
}

/**
 * 다시 보이게 할 때 지울 기록.
 *
 * 같은 알림을 여러 번 닫았으면 기록도 여러 줄입니다(백업은 닫을 때마다 날짜가
 * 다릅니다). **하나만 지우면 다른 줄이 계속 감춥니다.**
 */
export function withoutDismissal(dismissals: string[], id: string): string[] {
  return dismissals.filter((entry) => dismissalParts(entry).id !== id);
}

export function upkeepNotices(input: {
  accounts: ConnectedAccount[];
  transactions: Transaction[];
  recurring: RecurringItem[];
  lastBackupAt: string | null;
  backupDays: number;
  today?: Date;
  withinDays?: number;
}): UpkeepNotice[] {
  const today = input.today || new Date();
  const backup = backupDue({
    lastBackupAt: input.lastBackupAt,
    days: input.backupDays,
    entryCount: input.transactions.length,
    today,
  });

  const all = [
    ...(backup ? [backup] : []),
    ...missingStatements(input.accounts, input.transactions, today),
    ...amountJumps(input.recurring, today),
    ...upcomingCharges(input.recurring, today, input.withinDays).slice(0, UPCOMING_LIMIT),
  ];

  return all.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
