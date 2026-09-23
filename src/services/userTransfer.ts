/**
 * 사용자 한 명을 통째로 옮기기 (§4.10).
 *
 * 전체 백업(§4.6)은 **`.db` 파일 전체**라, 복원하면 이 기기의 모든 사용자가
 * 파일에 든 사람들로 바뀝니다. 기기를 바꾸는 데에는 맞지만 "내 것만 새 기기로
 * 옮기고 싶다"에는 쓸 수 없습니다 — 그러면 그 기기에 있던 다른 사람의 가계부가
 * 함께 사라집니다.
 *
 * §4.6 이 그때를 위해 적어 둔 방법이 이것입니다: **내보낼 때 그 사용자의 행만
 * 담고, 가져올 때 그 사람을 통째로 갈아 끼웁니다. 전체 백업과 섞지 않습니다.**
 *
 * ## 왜 이것이 성립하는가
 *
 * 이 앱의 데이터는 전부 `user_id` 로 닫혀 있고 **교차 참조가 사용자 경계를 넘지
 * 않습니다** — 카드대금의 `linked_account_id`, 카드의 `payment_account_id`,
 * 규칙의 `account_id` 가 모두 같은 사람의 계좌를 가리킵니다. 그래서 한 사람을
 * 들어내도 다른 사람 쪽에 끊어지는 실이 없습니다.
 *
 * ## id 를 새로 매기지 않습니다
 *
 * `budget_configs` 의 `income_excluded`·`fixed_excluded`·`savings_excluded` 는
 * **거래 id 가 든 JSON 배열**입니다(§11.4) — "이 15건은 실적에서 뺐다"는 사람의
 * 판단이 거기 들어 있습니다. id 를 새로 매기면 그 판단이 **오류 없이 조용히**
 * 사라집니다(`sumActuals` 가 모르는 id 를 무시하므로). 그래서 파일에 든 id 를
 * 그대로 씁니다.
 *
 * 그 대가로 **파일의 id 가 곧 누구를 갈아 끼울지를 정합니다**(§4.10의 판정).
 */

import { SCHEMA_VERSION } from "../db/schema";

export const USER_FILE_FORMAT = "smartmoney-user";
/** 파일 **형식**의 판. 스키마 버전과 다릅니다 — 이쪽은 봉투의 모양입니다. */
export const USER_FILE_VERSION = 1;

/**
 * 한 사람의 것이 들어 있는 테이블.
 *
 * **`repository.deleteUser` 와 같은 목록이어야 합니다.** 한쪽에만 테이블을
 * 더하면, 지울 때는 남고 옮길 때는 빠지는 식으로 갈립니다(§5의 규칙 그대로).
 */
export const PER_USER_TABLES = [
  "accounts",
  "transactions",
  "budgets",
  "budget_configs",
  "ai_analyses",
  "category_rules",
  "custom_categories",
  "budget_policy",
  "sms_inbox",
] as const;

export type Row = Record<string, unknown>;

export interface UserExport {
  format: string;
  version: number;
  /** 만들 때의 `PRAGMA user_version`. 가져올 때 사다리를 어디서부터 탈지 정합니다. */
  schemaVersion: number;
  exportedAt: string;
  /** `users` 행 그대로 — **PIN 해시까지** 옵니다(§4.6과 같습니다). */
  user: Row;
  tables: Record<string, Row[]>;
}

/**
 * 담지 않는 것.
 *
 * - **`undo_log`** — 바꾸기 전의 행 사본입니다(§4.9). 옮겨 가면 새 기기에서
 *   "되돌리기"가 옛 기기의 상태를 되살립니다. 7일이면 사라질 임시 저장소를
 *   옮길 이유가 없습니다.
 * - **localStorage 의 것들** — AI 키(§11.1), 기억된 명세서 형식(§7.4), 숨긴
 *   알림·백업 알림 기간·마지막 백업 시각(§12.12). DB 에 없으므로 **어떤
 *   백업으로도** 따라가지 않습니다. 화면이 그 사실을 말해야 합니다.
 */
export const NOT_CARRIED = ["undo_log"] as const;

export function isUserExport(value: unknown): value is UserExport {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<UserExport>;
  if (file.format !== USER_FILE_FORMAT) return false;
  if (typeof file.schemaVersion !== "number") return false;
  if (!file.user || typeof file.user !== "object") return false;
  if (!file.tables || typeof file.tables !== "object") return false;
  return true;
}

/** 글자에서 읽어 냅니다. 모양이 아니면 `null` — 던지지 않습니다. */
export function readUserFile(text: string): UserExport | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isUserExport(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface ExportSummary {
  name: string;
  accounts: number;
  transactions: number;
  rules: number;
  months: number;
  exportedAt: string;
  schemaVersion: number;
}

/** 확인 창이 **건수로** 말하기 위한 값입니다(§12.8). */
export function summariseExport(file: UserExport): ExportSummary {
  const rows = (table: string) => file.tables[table]?.length || 0;
  return {
    name: String(file.user.name || "이름 없음"),
    accounts: rows("accounts"),
    transactions: rows("transactions"),
    rules: rows("category_rules"),
    months: rows("budget_configs"),
    exportedAt: String(file.exportedAt || ""),
    schemaVersion: file.schemaVersion,
  };
}

export type RefusalKind =
  | "NOT_A_USER_FILE"
  | "NO_USER"
  | "NEWER_SCHEMA"
  | "NAME_TAKEN"
  | "EMPTY";

export interface KnownUser {
  id: string;
  name: string;
}

export interface ImportCheck {
  ok: boolean;
  refusal?: RefusalKind;
  why?: string;
  /**
   * 갈아 끼울 사람. 파일의 id 를 가진 사람이 이 기기에 있으면 그 사람이고,
   * 없으면 `null`(새로 생깁니다).
   */
  replacing: KnownUser | null;
  /**
   * 갈아 끼우는데 **이름이 달라지는가.**
   *
   * `user_primary` 는 첫 사용자가 쓰던 고정 id 라 기기마다 다른 사람이 그것을
   * 갖고 있을 수 있습니다. 그때 이 값이 참이 되고, 화면은 **누가 지워지는지**를
   * 더 분명히 말해야 합니다 — 남의 가계부를 지우는 일이기 때문입니다.
   */
  nameChanges: boolean;
}

/**
 * 가져와도 되는 파일인가 (§4.10).
 *
 * **파일의 id 가 누구를 갈아 끼울지 정합니다.** 대상을 화면에서 따로 고르게
 * 하면, 파일의 행들이 **다른 사람의 id 밑으로** 들어가야 하고 그러면
 * `budget_configs` 의 거래 id 목록(§11.4)과 어긋납니다. id 를 그대로 쓰는
 * 대가로 대상도 파일이 정합니다.
 */
export function checkImport(
  file: UserExport | null,
  options: { users: KnownUser[]; schemaVersion?: number }
): ImportCheck {
  const none: ImportCheck = { ok: false, replacing: null, nameChanges: false };
  const current = options.schemaVersion ?? SCHEMA_VERSION;

  if (!file) {
    return {
      ...none,
      refusal: "NOT_A_USER_FILE",
      why: "사용자 백업 파일이 아닙니다. 전체 백업(.db·.smbk)은 카드·계좌 화면의 백업 복원을 쓰세요.",
    };
  }

  const id = String(file.user?.id || "");
  const name = String(file.user?.name || "").trim();
  if (!id || !name) {
    return { ...none, refusal: "NO_USER", why: "파일에 사용자 정보가 없습니다." };
  }

  /*
    **미래의 파일은 열지 않습니다.** 사다리는 위로만 놓여 있어(§4.3) 더 새로운
    버전을 지금 구조로 낮출 방법이 없습니다. 짐작해 여는 것은 지어내는
    일입니다(§17.1).
  */
  if (file.schemaVersion > current) {
    return {
      ...none,
      refusal: "NEWER_SCHEMA",
      why: `더 새로운 버전(v${file.schemaVersion})에서 만든 파일입니다. 이 기기는 v${current}입니다 — 앱을 먼저 업데이트하세요.`,
    };
  }

  const rows = PER_USER_TABLES.reduce(
    (total, table) => total + (file.tables[table]?.length || 0),
    0
  );
  if (rows === 0 && !file.tables.accounts) {
    return { ...none, refusal: "EMPTY", why: "파일에 옮길 내용이 없습니다." };
  }

  const replacing = options.users.find((user) => user.id === id) || null;

  /*
    이름은 로그인 화면에서 사람을 고르는 값입니다(§5). 같은 이름이 둘이면
    누구인지 고를 수 없으므로, **다른 사람이 이미 쓰는 이름**이면 막습니다.
  */
  const clash = options.users.find((user) => user.name === name && user.id !== id);
  if (clash) {
    return {
      ...none,
      refusal: "NAME_TAKEN",
      why: `이 기기에 이미 '${name}' 사용자가 있습니다. 사용자 관리에서 한쪽 이름을 바꾼 뒤 다시 시도하세요.`,
      replacing,
    };
  }

  return {
    ok: true,
    replacing,
    nameChanges: replacing !== null && replacing.name !== name,
  };
}

/**
 * 무슨 일이 일어나는지 한 줄로 — 확인 창이 쓰는 말입니다.
 *
 * **건수로 말합니다**(§12.8). "덮어씁니다" 만으로는 무게를 알 수 없고, 이
 * 작업은 되돌릴 수 없습니다(§4.10).
 */
export function describePlan(
  check: ImportCheck,
  file: UserExport,
  existing?: { accounts: number; transactions: number }
): string[] {
  const summary = summariseExport(file);
  const lines: string[] = [];

  if (check.replacing) {
    const had = existing
      ? `계좌·카드 ${existing.accounts}개와 내역 ${existing.transactions.toLocaleString()}건이 지워집니다`
      : "지금 들어 있는 내역이 지워집니다";
    lines.push(`'${check.replacing.name}' 의 ${had}`);
    if (check.nameChanges) {
      lines.push(`그 자리에 '${summary.name}' 이 들어옵니다 — 이름이 바뀝니다`);
    }
  } else {
    lines.push(`'${summary.name}' 사용자가 새로 생깁니다`);
  }

  lines.push(
    `계좌·카드 ${summary.accounts}개 · 내역 ${summary.transactions.toLocaleString()}건 · 규칙 ${summary.rules}개를 들여옵니다`
  );
  lines.push("간편 비밀번호도 파일에 든 것으로 바뀝니다");
  lines.push("다른 사용자의 가계부는 그대로 남습니다");
  lines.push("AI 키와 기억해 둔 명세서 형식은 따라오지 않습니다");

  return lines;
}
