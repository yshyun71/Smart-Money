/**
 * 예산 알림을 **기기 알림으로** 띄우기.
 *
 * 예전에는 `enablePushAlerts`·`알림 기준 80%` 설정이 있고 화면에는 "푸시"라고
 * 적혀 있었지만, `Notification` 을 쓰는 곳은 **테스트 버튼 한 곳**뿐이었습니다.
 * 한도를 넘겨도 아무것도 발송되지 않고 앱을 열어야 배너로 보였습니다 — 설정이
 * 실제보다 많은 것을 약속하고 있었습니다(§17.1).
 *
 * **할 수 있는 것과 할 수 없는 것을 분명히 합니다.**
 * - 할 수 있음: 앱이 열려 있을 때(또는 백그라운드에 살아 있을 때) 알림 띄우기.
 * - 할 수 없음: 앱이 완전히 닫힌 뒤의 발송. 서버가 없으므로 웹푸시(`Push API`)를
 *   쓸 수 없고 — 그것은 VAPID 키와 발송 서버를 요구합니다 — 로컬 예약 API 도
 *   브라우저에 없습니다(§1의 전제).
 *
 * 그래서 이름도 `기기 알림`으로 적고, 닫힌 뒤에는 오지 않는다고 화면이
 * 말합니다. 못 하는 것을 하는 척하지 않는 것이 이 앱의 규칙입니다.
 */

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

export function notifyPermission(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotifyPermission;
}

/** 사용자가 직접 켠 순간에만 물어봅니다 — 아무 때나 묻는 창은 대개 거절됩니다. */
export async function askNotifyPermission(): Promise<NotifyPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission as NotifyPermission;
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return "denied";
  }
}

export interface NotifyItem {
  /** 같은 알림을 두 번 띄우지 않기 위한 열쇠. */
  id: string;
  title: string;
  body: string;
}

/**
 * 아직 띄우지 않은 것만 골라냅니다.
 *
 * 같은 알림을 다시 띄우지 않는 것이 요점입니다 — 예산 상태는 렌더마다 다시
 * 계산되므로, 걸러내지 않으면 화면을 만질 때마다 같은 알림이 쏟아집니다.
 * 판단을 순수 함수로 두어 검증할 수 있게 합니다(§17.5).
 */
export function pendingNotifications(
  items: NotifyItem[],
  alreadySent: Iterable<string>
): NotifyItem[] {
  const sent = new Set(alreadySent);
  const seen = new Set<string>();

  return items.filter((item) => {
    if (!item.id || sent.has(item.id) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * 실제로 띄웁니다. 띄운 것의 id 를 돌려줍니다.
 *
 * 권한이 없거나 브라우저가 지원하지 않으면 **조용히 아무것도 하지 않습니다** —
 * 알림은 보조 수단이고, 앱 안의 경고 띠가 본래의 통로입니다.
 */
export function showNotifications(items: NotifyItem[]): string[] {
  if (notifyPermission() !== "granted") return [];

  const shown: string[] = [];
  for (const item of items) {
    try {
      new Notification(item.title, {
        body: item.body,
        // 같은 태그는 덮어씁니다 — 알림 그늘에 같은 카테고리가 쌓이지 않게
        tag: item.id,
        icon: "/icon.svg",
      });
      shown.push(item.id);
    } catch (error) {
      console.error("알림을 띄우지 못했습니다:", error);
    }
  }
  return shown;
}
