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
  "금융/보험",
  "카드대금",
  "급여",
  "기타수입",
  "기타지출",
];

/** Card bills settled from a bank account. */
export const CARD_PAYMENT_CATEGORY: BuiltInCategory = "카드대금";
