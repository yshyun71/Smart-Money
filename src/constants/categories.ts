import type { BuiltInCategory } from "../types/finance";

/**
 * The categories the app ships with, in the order they are offered.
 *
 * Anything the user adds themselves lives in the database and is appended to
 * this list at runtime — see `categories` on the finance context, which is the
 * one place the whole app reads the list from.
 */
export const BUILT_IN_CATEGORIES: BuiltInCategory[] = [
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
  "기타 금융",
  "카드대금",
  "급여",
  "기타수입",
  "기타지출",
];

/** Card bills settled from a bank account. */
export const CARD_PAYMENT_CATEGORY: BuiltInCategory = "카드대금";

/** What one 금융/보험 category was split into. */
export const FINANCE_CATEGORIES: BuiltInCategory[] = ["보험", "대출", "기타 금융"];

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
    category: "기타 금융",
    words: [
      "적금",
      "예금",
      "펀드",
      "연금",
      "증권",
      "저축",
      "청약",
      "ISA",
      "CMA",
      "IRP",
      "신탁",
      "투자",
    ],
  },
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
  "기타 금융",
];
