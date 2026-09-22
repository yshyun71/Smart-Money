import type { ConnectedAccount, Transaction } from "../types/finance";
import { issuersIn } from "./cardLink";
import {
  duplicateKey,
  findSimilarEntry,
  instalmentMarker,
  isInstalment,
  type DraftRow,
} from "./csvImport";

/**
 * 여러 파일을 한 번에, 그리고 한 파일의 줄을 새 것과 이미 있는 것으로 가르기.
 *
 * 은행 하나와 카드 세 장을 쓰면 매달 파일이 네 개입니다. 지금까지는 창을 네 번
 * 열어 계좌를 네 번 고르고 네 번 같은 네 단계를 걸어야 했습니다 — 파일을 고르는
 * 자리가 한 개짜리였을 뿐, 나머지 단계는 파일마다 그대로 반복해도 되는 것이었습니다.
 *
 * 줄을 가르는 판정(§7.6·§7.8)도 여기 있습니다. `CsvImportModal` 안에 있었고,
 * **회귀 세트가 닿지 않았습니다** — 할부 회차와 문자 대체는 둘 다 틀렸을 때
 * 같은 결제가 두 줄이 되거나 명세서가 통째로 0건 등록되는 종류의 판정입니다.
 */

/* ------------------------------------------------------------------ 가르기 */

export type Decision = "SKIP" | "OVERWRITE";

export interface DuplicateItem {
  draft: DraftRow;
  existing: Transaction;
  decision: Decision;
}

export interface SplitResult {
  fresh: DraftRow[];
  duplicates: DuplicateItem[];
}

/**
 * 읽어 낸 줄을 **새 것**과 **이미 등록된 것**으로 가릅니다.
 *
 * **그 계좌 안에서만** 비교합니다(§7.6). 같은 가게·같은 날·같은 금액이 다른
 * 카드에 찍혀 있으면 서로 다른 결제이고, 그것을 이미 등록된 것으로 보아 명세서가
 * 통째로 0건 등록된 사고가 있었습니다.
 */
export function splitDrafts(options: {
  drafts: DraftRow[];
  /** 가계부 전체. 계좌 비교는 이 함수가 합니다. */
  existing: Transaction[];
  accountId: string;
}): SplitResult {
  const { drafts, existing, accountId } = options;

  const byKey = new Map<string, Transaction>();
  for (const tx of existing) {
    if (tx.accountId !== accountId) continue;
    const key = duplicateKey(tx);
    if (!byKey.has(key)) byKey.set(key, tx);
  }

  const duplicates: DuplicateItem[] = [];
  const fresh: DraftRow[] = [];

  for (const draft of drafts) {
    /*
      할부는 같은 구매가 매달 같은 날짜·가맹점·금액으로 다시 청구됩니다.
      명세서가 회차를 적어 주면(`8/10`) 그것이 중복 키에 들어가 달끼리 구분되고,
      `할부`라고만 되어 있으면 이 달이 어느 달인지 말해 주는 것이 없으므로
      **중복으로 보지 않습니다** — 다음 달 명세서의 할부 건이 지난달 것과 같은
      건으로 걸러지던 원인이었습니다.
    */
    const unnumbered = isInstalment(draft.memo) && instalmentMarker(draft.memo) === "";
    const exact = unnumbered ? undefined : byKey.get(duplicateKey(draft));

    if (exact) {
      duplicates.push({ draft, existing: exact, decision: "SKIP" });
      continue;
    }

    /*
      문자로 넣어 둔 임시 줄을 명세서가 대체합니다(§7.8).

      `duplicateKey` 는 내역명이 같아야 중복으로 보는데, 문자와 명세서 사이에서는
      이름이 거의 언제나 다릅니다 — 문자 `스타벅스 강남R점` / 명세서 `스타벅스강남알`.
      그대로 두면 같은 결제가 두 줄이 되어 그 달 합계가 두 배로 잡히고, 카드대금
      자동 연결(§9.2)까지 어긋납니다.

      그래서 **같은 계좌·같은 날짜·같은 금액**이면서 그 줄이 **문자에서 온 것일
      때만** 같은 건으로 보고 기본값을 덮어쓰기로 둡니다. 사람이 넣은 줄이나 다른
      명세서 줄은 건드리지 않습니다 — 같은 날 같은 금액을 다른 곳에서 쓴 것일 수
      있고, 근거 없이 합치지 않습니다(§17.2).
    */
    const claimed = new Set(duplicates.map((item) => item.existing.id));
    const similar = findSimilarEntry(
      existing,
      {
        date: draft.date,
        merchant: draft.merchant,
        amount: draft.amount,
        type: draft.type,
        accountId,
      },
      { ignoreIds: claimed }
    );

    if (similar?.origin === "SMS") {
      /* 돌려받는 것은 id 뿐이므로 그 줄을 다시 찾습니다 */
      const row = existing.find((tx) => tx.id === similar.id);
      if (row) {
        duplicates.push({ draft, existing: row, decision: "OVERWRITE" });
        continue;
      }
    }

    fresh.push(draft);
  }

  return { fresh, duplicates };
}

/* -------------------------------------------------------------------- 대기줄 */

export type FileState = "PENDING" | "DONE" | "FAILED";

export interface QueuedFile {
  name: string;
  /** 어느 계좌·카드로. **모르면 빈 값입니다** — 지어내지 않습니다(§17.2). */
  accountId: string;
  state: FileState;
  added?: number;
  replaced?: number;
  skipped?: number;
  /** 실패·건너뜀의 까닭. 실패 현황을 말하는 데 쓰입니다(§7.9). */
  reason?: string;
}

/**
 * 파일 이름이 말하는 계좌.
 *
 * 카드사가 내려주는 파일 이름에는 거의 언제나 카드사가 적혀 있습니다 —
 * `samsungcard_20260826.xlsx`, `이용대금명세서_2608(신용.체크)_….xls`. 결제월을
 * 이름에서 읽는 것(§7.7)과 같은 근거를 계좌 고르기에도 씁니다.
 *
 * **한 계좌로 좁혀지지 않으면 비워 둡니다.** 카드사 이름이 없거나, 그 카드사
 * 카드를 두 장 쓰고 있으면 어느 쪽인지 알 방법이 없습니다 — 추측으로 골라 두면
 * 사람은 이미 정해진 줄 알고 그대로 넘깁니다(§9.2·§17.2와 같은 기준).
 */
export function guessAccountForFile(
  fileName: string,
  accounts: ConnectedAccount[]
): string {
  const issuers = issuersIn(fileName);
  if (issuers.length === 0) return "";

  const matches = accounts.filter((account) => {
    const label = `${account.name || ""} ${account.institution || ""}`;
    return issuers.some((issuer) => issuersIn(label).includes(issuer));
  });

  return matches.length === 1 ? matches[0].id : "";
}

/** 고른 파일들을 대기줄로. 이름 순이 아니라 **고른 순서**를 지킵니다. */
export function queueFrom(names: string[], accounts: ConnectedAccount[]): QueuedFile[] {
  return names.map((name) => ({
    name,
    accountId: guessAccountForFile(name, accounts),
    state: "PENDING" as FileState,
  }));
}

/** 아직 처리하지 않은 첫 파일. 없으면 `-1`. */
export function activeIndex(queue: QueuedFile[]): number {
  return queue.findIndex((item) => item.state === "PENDING");
}

/**
 * `2 / 3번째 파일 · 삼성카드`.
 *
 * 파일마다 같은 네 단계를 걷게 되므로, **몇 번째의 무엇을 보고 있는지**가 화면에
 * 없으면 어디쯤인지 알 수 없습니다.
 */
export function queueLabel(
  queue: QueuedFile[],
  index: number,
  accounts: ConnectedAccount[] = []
): string {
  if (index < 0 || index >= queue.length) return "";
  const item = queue[index];
  const account = accounts.find((candidate) => candidate.id === item.accountId);
  const where = `${index + 1} / ${queue.length}번째 파일`;
  return account?.name ? `${where} · ${account.name}` : where;
}

/** 한 항목의 결과·계좌를 갈아 끼웁니다. 원본을 바꾸지 않습니다. */
export function markQueue(
  queue: QueuedFile[],
  index: number,
  patch: Partial<QueuedFile>
): QueuedFile[] {
  return queue.map((item, at) => (at === index ? { ...item, ...patch } : item));
}

/** 계좌를 정하지 않은 파일이 남아 있으면 시작하지 않습니다. */
export function queueReady(queue: QueuedFile[]): boolean {
  return queue.length > 0 && queue.every((item) => Boolean(item.accountId));
}

export interface QueueSummary {
  files: number;
  done: number;
  failed: number;
  added: number;
  replaced: number;
  skipped: number;
}

/**
 * 끝난 뒤의 현황.
 *
 * **실패한 줄을 쏟아내지 않고 숫자와 까닭을 말합니다**(§7.9). 파일 하나가
 * 실패해도 나머지는 이미 저장됐고, 그 사실이 먼저 보여야 합니다.
 */
export function queueSummary(queue: QueuedFile[]): QueueSummary {
  const sum = (pick: (item: QueuedFile) => number | undefined) =>
    queue.reduce((total, item) => total + (pick(item) || 0), 0);

  return {
    files: queue.length,
    done: queue.filter((item) => item.state === "DONE").length,
    failed: queue.filter((item) => item.state === "FAILED").length,
    added: sum((item) => item.added),
    replaced: sum((item) => item.replaced),
    skipped: sum((item) => item.skipped),
  };
}
