/**
 * 옆으로 밀어 닫기 (§12.12).
 *
 * 라이브러리를 더하지 않습니다 — 손가락이 얼마나 움직였는지를 보는 산수이고,
 * 이 앱은 쓰지 않는 의존성을 남기지 않기로 했습니다(§2에서 `motion` 을 걷어낸
 * 것과 같은 까닭).
 *
 * **위험한 것은 애니메이션이 아니라 판정입니다.** 알림 줄은 세로로 스크롤되는
 * 목록 안에 있고, 그 자체가 **누르면 화면을 여는 버튼**입니다. 세 동작이 같은
 * 손가락 하나를 두고 다툽니다.
 *
 * | 사용자가 하려던 것 | 잘못 판정하면 |
 * | --- | --- |
 * | 목록을 세로로 넘김 | 스크롤이 끊기고 알림이 따라 움직입니다 |
 * | 알림을 눌러 이동 | 손가락이 몇 px 흔들렸다고 닫혀 버립니다 |
 * | 옆으로 밀어 닫기 | 아무 일도 일어나지 않습니다 |
 *
 * 그래서 **축을 먼저 잠급니다**: 어느 쪽으로 갈지 정해지기 전에는 아무것도 하지
 * 않고, 한 번 정해지면 그 방향만 봅니다. 이 판정이 조용히 틀리는 자리라 화면
 * 밖으로 떼어 회귀 세트에 넣었습니다(§17.5).
 */

export type SwipeAxis = "NONE" | "HORIZONTAL" | "VERTICAL";

/**
 * 아직 아무 방향도 아닌 거리.
 *
 * 누를 때 손가락은 언제나 조금 움직입니다. 이 값이 없으면 탭이 전부 스와이프로
 * 시작해 버립니다.
 */
export const AXIS_LOCK_PX = 8;

/**
 * 어느 쪽으로 가는 손가락인가.
 *
 * **세로가 기본값입니다.** 비겼을 때(`|dx| === |dy|`) 세로로 보는 것이 맞습니다 —
 * 스크롤을 뺏는 쪽이 닫기를 놓치는 쪽보다 나쁩니다.
 */
export function swipeAxis(dx: number, dy: number, lock: number = AXIS_LOCK_PX): SwipeAxis {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (Math.max(x, y) < lock) return "NONE";
  return x > y ? "HORIZONTAL" : "VERTICAL";
}

/** 닫히는 거리 — 줄 너비의 이만큼, 또는 아래 픽셀 중 작은 쪽. */
export const DISMISS_RATIO = 0.35;
export const DISMISS_MIN_PX = 72;

/**
 * 손을 뗐을 때 닫을 것인가.
 *
 * 너비에 비례시키는 이유: 넓은 화면에서 고정 픽셀은 너무 짧고, 좁은 화면에서는
 * 너무 깁니다. 대신 **아주 넓은 화면에서도 한없이 길어지지 않게** 상한을 둡니다.
 *
 * 방향은 가리지 않습니다 — 왼쪽으로 미는 사람과 오른쪽으로 미는 사람이 모두
 * 있고, 둘 다 "치운다"는 같은 뜻입니다.
 */
export function swipeDismisses(dx: number, width: number): boolean {
  const need = Math.min(DISMISS_MIN_PX, Math.max(1, width) * DISMISS_RATIO);
  return Math.abs(dx) >= need;
}

/**
 * 민 만큼 따라오는 거리.
 *
 * 닫히는 지점을 넘어가면 더 끌려오지 않게 눌러 줍니다(고무줄). 끝까지 따라오면
 * 어디서 손을 떼야 닫히는지 알 수 없습니다.
 */
export function swipeOffset(dx: number, width: number): number {
  const limit = Math.min(DISMISS_MIN_PX, Math.max(1, width) * DISMISS_RATIO);
  if (Math.abs(dx) <= limit) return dx;
  const extra = Math.abs(dx) - limit;
  return Math.sign(dx) * (limit + extra * 0.3);
}
