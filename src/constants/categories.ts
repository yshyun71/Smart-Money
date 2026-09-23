import type {
  BuiltInCategory,
  ExpenseCategory,
  IncomeCategory,
  TransactionType,
} from "../types/finance";

/**
 * 앱이 들고 나오는 카테고리 — **방향마다 따로**입니다 (§6.1).
 *
 * 한 목록을 수입과 지출이 함께 쓰면, 수입 건에 `식비` 가 붙거나 지출 건에
 * `급여` 가 붙는 일이 실제로 생깁니다(실데이터에 수입인데 `주거` 8건, `카드대금`
 * 2건이 있었습니다). 그 한 줄이 그 달 합계를 조용히 비틀고, 화면 어디에도
 * 오류가 뜨지 않습니다.
 *
 * **같은 이름이 양쪽에 필요하면 각각 등록합니다.** `이체` 가 그런 경우입니다 —
 * 보낸 이체와 받은 이체는 같은 말이지만 서로 다른 방향의 일이고, 한 항목으로
 * 두면 어느 쪽인지 알 수 없습니다(§6.5).
 *
 * 사용자가 직접 만든 것은 DB(`custom_categories`)에 **방향과 함께** 저장되고
 * 실행 중에 뒤에 붙습니다 — 앱 전체가 목록을 읽는 자리는 파이낸스 컨텍스트의
 * `categoriesFor(방향)` 하나뿐입니다.
 */
export const INCOME_CATEGORIES: IncomeCategory[] = [
  "급여",
  "이체",
  "금융/자산수입",
  "기타수입",
];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "식비",
  "카페/간식",
  "주거",
  "통신",
  "구독/미디어",
  "교통",
  "쇼핑",
  "문화/여가",
  "생활",
  "의료",
  "보험",
  "대출",
  "금융/자산",
  "이체",
  "카드대금",
  "저축",
  "기타지출",
];

/** 두 목록을 이어 붙인 것 — 방향을 모르는 자리(아이콘·색)에서만 씁니다. */
export const BUILT_IN_CATEGORIES: BuiltInCategory[] = Array.from(
  new Set<BuiltInCategory>([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])
);

/** 그 방향에서 고를 수 있는 기본 카테고리. */
export function builtInCategoriesFor(direction: TransactionType): BuiltInCategory[] {
  return direction === "INCOME" ? [...INCOME_CATEGORIES] : [...EXPENSE_CATEGORIES];
}

/** 방향이 맞지 않는 카테고리가 왔을 때 돌아갈 자리. */
export function fallbackCategory(direction: TransactionType): BuiltInCategory {
  return direction === "INCOME" ? "기타수입" : "기타지출";
}

/**
 * 그 카테고리를 그 방향에서 쓸 수 있는가.
 *
 * 사용자가 만든 이름은 이 함수가 알지 못하므로 **기본 목록에 없으면 참**입니다 —
 * 판정은 부르는 쪽이 `custom_categories` 까지 합쳐 합니다. 여기서 거짓을
 * 돌려주면 사용자가 만든 카테고리가 전부 막힙니다.
 */
export function fitsDirection(category: string, direction: TransactionType): boolean {
  const income = (INCOME_CATEGORIES as string[]).includes(category);
  const expense = (EXPENSE_CATEGORIES as string[]).includes(category);
  if (!income && !expense) return true;
  return direction === "INCOME" ? income : expense;
}

/** Card bills settled from a bank account. */
export const CARD_PAYMENT_CATEGORY: BuiltInCategory = "카드대금";

/**
 * 저축으로 빠져나간 돈.
 *
 * 계좌에서만 의미가 있습니다 — 카드로는 저축하지 않습니다. 예산 화면의
 * `목표 저축액`과 짝을 이루고, **고정비 합계에서는 빠집니다**: 적금이 매달
 * 같은 날 같은 금액으로 나가 고정비로 판정되더라도, 고정비에 한 번 세고
 * 저축에 또 세면 가용 변동비가 그만큼 두 번 깎입니다.
 */
export const SAVINGS_CATEGORY: BuiltInCategory = "저축";

/**
 * 내 계좌 사이에서 옮긴 돈 — 쓴 돈이 아닙니다.
 *
 * 생활비 계좌로 옮기거나 다른 은행으로 넘긴 돈은 **가계부를 떠나지 않았습니다.**
 * 그런데 통장 내역에는 출금으로 찍히므로 `기타지출`에 들어가 소비로 세어졌고,
 * 받는 쪽은 `기타수입`이 되어 그 달 수입을 부풀렸습니다 — 8월 수입 실적
 * 8,314,074원 중 급여는 3,052,140원뿐이라, 예산을 세우려면 매달 실적 목록에서
 * 15건을 손으로 빼야 했습니다.
 *
 * **다만 모든 이체가 그런 것은 아닙니다.** 매달 같은 날 같은 금액이 나가는
 * 이체는 사람이 "이건 내 고정 지출"이라고 판단한 것이고, 그때는 지출로
 * 세는 것이 맞습니다. 그 뜻을 담는 칸이 이미 있습니다 — 고정비 여부입니다.
 * 그래서 빠지는 것은 **이체이면서 고정비가 아닌 것**뿐입니다(`isAssetMove`).
 *
 * 카테고리를 따로 둔 이유: `설명`은 어떤 계산에도 닿지 않고, 규칙
 * (`category_rules`)이 담을 수 있는 것도 카테고리뿐입니다(6.4). 한 번 규칙을
 * 걸어 두면 다음 달부터 저절로 제자리에 들어갑니다.
 */
export const TRANSFER_CATEGORY: BuiltInCategory = "이체";

/**
 * 카테고리 예산에서 빼는 항목들.
 *
 * 둘 다 다른 자리에서 이미 셈해지는 돈입니다 — 카드대금은 그 카드의 명세서로,
 * 저축은 `목표 저축액`으로. 가용 변동비(`수입 − 고정비 − 저축`)가 이미 저축을
 * 뺀 금액이라, 저축에 다시 예산을 주면 없는 돈을 배분하게 됩니다.
 */
export const BUDGET_EXCLUDED_CATEGORIES: BuiltInCategory[] = [
  CARD_PAYMENT_CATEGORY,
  SAVINGS_CATEGORY,
];

/** What one 금융/보험 category was split into. */
export const FINANCE_CATEGORIES: BuiltInCategory[] = ["보험", "대출", "금융/자산"];

/**
 * Which of the three a statement line belongs to, by what it says.
 *
 * Checked in this order, so "보험료 대출상환" lands in 보험 rather than 대출 —
 * the more specific word wins. The last entry is the catch-all for financial
 * traffic that is neither: savings, funds, pensions, securities.
 */
export const FINANCE_KEYWORDS: { category: BuiltInCategory; words: string[] }[] = [
  {
    category: "보험",
    words: [
      "보험",
      "화재",
      "해상",
      "손해",
      "생명",
      "실손",
      "실비",
      "공제회",
      "라이프플래닛",
    ],
  },
  {
    category: "대출",
    words: [
      "대출",
      "원리금",
      "이자",
      "상환",
      "할부금융",
      "캐피탈",
      "카드론",
      "마이너스통장",
      "중도금",
      "주택담보",
      "전세자금",
    ],
  },
  {
    /*
      모아 두는 돈. 굴리는 돈(펀드·증권·투자)은 금융/자산에 남겨 둡니다 —
      "저축"이라는 말로 가장 흔히 뜻하는 것은 적금·예금·청약이고, 예산 화면의
      `목표 저축액`과 짝을 이루는 것도 그쪽입니다.

      금융/자산보다 **먼저** 검사되어야 합니다(6.3 — 더 좁은 것이 먼저).
    */
    category: "저축",
    words: ["적금", "예금", "저축", "청약", "ISA", "CMA", "IRP"],
  },
  {
    category: "금융/자산",
    words: ["펀드", "연금", "증권", "신탁", "투자"],
  },
];

/** `저축`으로 옮겨 간 말들 — 마이그레이션이 과거 내역을 다시 세울 때 씁니다. */
export const SAVINGS_KEYWORDS: string[] = [
  "적금",
  "예금",
  "저축",
  "청약",
  "ISA",
  "CMA",
  "IRP",
];

/** Rent, utilities and the like, as against what the phone line costs. */
export const HOUSING_KEYWORDS: { category: BuiltInCategory; words: string[] }[] = [
  {
    category: "통신",
    words: [
      "통신",
      "SKT",
      "KT",
      "LGU",
      "LG U+",
      "유플러스",
      "텔레콤",
      "알뜰폰",
      "요금제",
      "인터넷",
      "와이파이",
      "휴대폰",
      "핸드폰",
      "모바일",
      "브로드밴드",
      "헬로비전",
      "스카이라이프",
    ],
  },
  {
    category: "주거",
    words: [
      "월세",
      "전세",
      "임대",
      "관리비",
      "전기",
      "가스",
      "수도",
      "난방",
      "아파트",
      "주택",
      "오피스텔",
      "도시가스",
      "한국전력",
      "한전",
      "상하수도",
    ],
  },
];

/** Everyday upkeep, as against anything medical. */
export const LIVING_KEYWORDS: { category: BuiltInCategory; words: string[] }[] = [
  {
    category: "의료",
    words: [
      "약국",
      "병원",
      "의원",
      "치과",
      "한의원",
      "한방",
      "클리닉",
      "메디컬",
      "내과",
      "외과",
      "피부과",
      "안과",
      "이비인후과",
      "산부인과",
      "정형외과",
      "건강검진",
      "제약",
    ],
  },
  {
    category: "생활",
    words: [
      "미용실",
      "이발",
      "헤어",
      "네일",
      "세탁",
      "빨래",
      "청소",
      "수리",
      "철물",
      "생활용품",
      "다이소",
      "잡화",
      "목욕",
      "사우나",
    ],
  },
];

/**
 * A category that was one and became several, and how to tell its rows apart.
 *
 * The same tables serve two purposes: filing an entry as it arrives, and
 * moving the rows already recorded under the old name when the split ships.
 */
export interface CategorySplit {
  from: string;
  /** Where a row goes when none of the words match. */
  fallback: BuiltInCategory;
  rules: { category: BuiltInCategory; words: string[] }[];
}

export const CATEGORY_SPLITS: CategorySplit[] = [
  { from: "주거/통신", fallback: "주거", rules: HOUSING_KEYWORDS },
  { from: "생활/의료", fallback: "생활", rules: LIVING_KEYWORDS },
];

/**
 * Categories a monthly budget treats as committed rather than discretionary,
 * so the variable-spending figures leave them out.
 */
export const FIXED_BUDGET_CATEGORIES: BuiltInCategory[] = [
  "주거",
  "통신",
  "보험",
  "대출",
  "금융/자산",
  // 저축은 쓰기로 정해 둔 돈이 아니라 떼어 두는 돈입니다
  "저축",
];
