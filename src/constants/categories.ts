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
  "주거/통신",
  "구독/미디어",
  "교통",
  "쇼핑",
  "문화/여가",
  "생활/의료",
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

/**
 * Categories a monthly budget treats as committed rather than discretionary,
 * so the variable-spending figures leave them out.
 */
export const FIXED_BUDGET_CATEGORIES: BuiltInCategory[] = [
  "주거/통신",
  "보험",
  "대출",
  "기타 금융",
];
