import type { ParsedTable } from "./csvImport";

/**
 * 명세서가 자기 카드를 부르는 이름을 기억해, 다음 달에 알아보기.
 *
 * 파일 이름으로는 못 가리는 명세서가 흔합니다 — KB 의 `이용대금명세서_20260903.xlsx`
 * 에는 카드사조차 없습니다. 그렇다고 **파일 내용에서 카드사 이름을 찾으면 안 됩니다**:
 * 재 보았더니 여섯 중 하나만 맞고 둘은 적극적으로 틀렸습니다(§7.10) — 가맹점
 * `롯데백화점`, 결제 계좌 `청구합계-국민은행`, 통장의 `KB카드출금` 이 전부 카드사
 * 이름이기 때문입니다.
 *
 * 그런데 카드 명세서에는 **그 카드를 가리키는 칸**이 거의 언제나 있습니다 —
 * `JCB097`(KB) · `본인724`(신한) · `본 인 289`(삼성) · `0097`(우리) ·
 * `본인LOCA LIKIT 1.2`(롯데). 가맹점이 아니라 **카드 자신**이고, 같은 카드사 카드가
 * 두 장이어도 갈립니다.
 *
 * 그래서 **추측하지 않고 기억합니다.** 첫 달에 사람이 계좌를 고르면 그 값을 적어
 * 두고, 다음 달부터 알아봅니다. 사용자가 내린 판단을 되살리는 것이라 §7.4(기억된
 * 명세서 형식)와 성격이 같고, 언제든 화면에서 바꿀 수 있습니다.
 */

const STORAGE_KEY = "smart_money_card_labels_v1";
const LIMIT = 80;

interface RememberedLabel {
  accountId: string;
  savedAt: string;
}

type Store = Record<string, RememberedLabel>;

/**
 * 그 카드를 가리키는 칸의 이름들.
 *
 * **`카드구분` 은 넣지 않습니다** — 우리카드에서 그 칸은 `신용/본인` 이라 모든
 * 카드가 같습니다. 바로 옆의 `이용카드` 가 `0097` 로 카드를 가리킵니다.
 * `이용구분` 은 삼성이 그 자리에 카드를 적어서 넣되 **맨 뒤**입니다.
 */
const CARD_COLUMNS = ["이용카드", "사용카드", "카드번호", "이용구분"];

/** 공백·대소문자를 지운 비교용 값 — `본 인 289` 와 `본인289` 는 같은 카드입니다. */
export function labelKey(value: string): string {
  return (value || "").replace(/\s+/g, "").toUpperCase();
}

/**
 * 이 명세서가 자기 카드를 뭐라고 부르는가. 못 찾으면 빈 값입니다.
 *
 * 세 가지를 모두 넘겨야 카드 이름으로 봅니다.
 *
 * 1. **자릿수가 있어야 합니다.** 카드 이름에는 뒷자리가 들어갑니다(`097`·`724`·
 *    `289`·`0097`·`1.2`). `일시불`·`할부`·`신용/본인` 처럼 결제 방식을 적는 칸이
 *    같은 이름을 쓸 때 이 한 줄이 갈라 줍니다 — 그것을 카드로 기억하면 다음 달에
 *    엉뚱한 계좌를 가리킵니다.
 * 2. **줄마다 같아야 합니다.** 한 명세서는 한 카드의 것입니다(60% 이상).
 * 3. 빈 칸이 아니어야 합니다.
 */
export function cardLabelOf(table: ParsedTable | null): string {
  if (!table || table.rows.length === 0) return "";

  const flat = table.headers.map((header) => (header || "").replace(/\s+/g, ""));
  const column = CARD_COLUMNS.map((name) => flat.indexOf(name)).find(
    (index) => index >= 0
  );
  if (column === undefined) return "";

  const counts = new Map<string, number>();
  let filled = 0;
  for (const row of table.rows) {
    const value = (row[column] || "").trim();
    if (!value) continue;
    filled++;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  if (filled === 0) return "";

  let best = "";
  let most = 0;
  for (const [value, count] of counts) {
    if (count > most) {
      best = value;
      most = count;
    }
  }

  if (most / filled < 0.6) return "";
  if (!/\d/.test(best)) return "";
  return best;
}

function read(): Store {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* 사생활 보호 창이거나 저장이 꺼진 기기 — 가져오기 자체는 그대로 됩니다 */
  }
}

/**
 * 이 이름의 카드를 지난번에 어느 계좌로 넣었는가. 모르면 빈 값입니다.
 *
 * **돌려준 id 가 지금 있는 계좌인지는 부르는 쪽이 확인해야 합니다.** 그 사이에
 * 계좌가 지워졌거나, 이 기기의 다른 사용자 것일 수 있습니다(localStorage 에는
 * 사용자 구분이 없습니다 — §5). 없는 계좌를 가리키면 그냥 못 찾은 것으로 다룹니다.
 */
export function recallAccountForLabel(label: string): string {
  const key = labelKey(label);
  if (!key) return "";
  return read()[key]?.accountId || "";
}

/**
 * 사람이 계좌를 정하고 실제로 넣은 뒤에 적어 둡니다.
 *
 * **넣기 전에 적지 않습니다.** 고르다 만 값은 판단이 아니고, 그것을 기억하면
 * 다음 달에 되살아납니다(§7.4 가 사람이 확인한 뒤에 형식을 저장하는 것과 같습니다).
 */
export function rememberCardLabel(label: string, accountId: string): void {
  const key = labelKey(label);
  if (!key || !accountId) return;

  const store = read();
  store[key] = { accountId, savedAt: new Date().toISOString() };

  /* 오래된 것부터 덜어 내, 한 번뿐인 카드가 끝없이 쌓이지 않게 */
  const keys = Object.keys(store);
  if (keys.length > LIMIT) {
    keys
      .sort((a, b) => (store[a].savedAt < store[b].savedAt ? -1 : 1))
      .slice(0, keys.length - LIMIT)
      .forEach((old) => delete store[old]);
  }

  write(store);
}

/** 계좌를 지우면 그 계좌를 가리키던 기억도 함께 지웁니다(§4.4). */
export function forgetAccountLabels(accountId: string): void {
  const store = read();
  let touched = false;
  for (const key of Object.keys(store)) {
    if (store[key].accountId === accountId) {
      delete store[key];
      touched = true;
    }
  }
  if (touched) write(store);
}
