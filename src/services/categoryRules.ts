import type { CategoryRule, CategoryType } from "../types/finance";
import { CARD_PAYMENT_CATEGORY, FINANCE_KEYWORDS } from "../constants/categories";

/**
 * Standing category rules, matched loosely against a transaction's description.
 *
 * A statement writes the same recurring charge slightly differently every
 * month — "코웨이렌탈08", "코웨이렌탈09" — so a rule is a pattern rather than an
 * exact name. `*` stands for any run of characters, and a pattern with no
 * wildcard matches anywhere in the description, which is what "포함하면 같은
 * 것으로 본다" means in practice.
 */

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** Turns a rule pattern into a regular expression. Unanchored, case-insensitive. */
export function patternToRegex(pattern: string): RegExp {
  const body = escapeRegex(pattern.trim()).replace(/\*/g, ".*");
  return new RegExp(body, "i");
}

/** Ignores spacing differences, which statements are inconsistent about. */
function normalise(value: string): string {
  return (value || "").replace(/\s+/g, "");
}

export function ruleMatches(pattern: string, merchant: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  try {
    return patternToRegex(normalise(trimmed)).test(normalise(merchant));
  } catch {
    // A pattern that will not compile should never take the whole run down
    return false;
  }
}

/**
 * The rule that wins for a description.
 *
 * A rule the user confirmed beats one the classifier wrote — that is the whole
 * point of the distinction. Past that, the more specific (longer) pattern
 * wins, then the more recently touched.
 */
export function pickRule(
  rules: CategoryRule[],
  merchant: string,
  accountId?: string
): CategoryRule | null {
  const candidates = rules.filter(
    (rule) =>
      (!accountId || rule.accountId === accountId) && ruleMatches(rule.pattern, merchant)
  );
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    if (a.source !== b.source) return a.source === "USER" ? -1 : 1;
    if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length;
    return b.updatedAt.localeCompare(a.updatedAt);
  })[0];
}

/** Rules the user confirmed, used to override whatever the classifier says. */
export function userRulesOnly(rules: CategoryRule[]): CategoryRule[] {
  return rules.filter((rule) => rule.source === "USER");
}

/**
 * A sensible pattern to offer when the user assigns a category by hand.
 *
 * Statements number the same charge month by month — "코웨이렌탈08",
 * "코웨이렌탈09" — so a trailing run of digits becomes a wildcard. Everything
 * else is left alone; a pattern without a wildcard already matches loosely.
 */
export function suggestPattern(merchant: string): string {
  const trimmed = (merchant || "").trim();
  if (!trimmed) return "";
  const stripped = trimmed.replace(/[\s_-]*\d{1,4}$/, "");
  return stripped && stripped !== trimmed ? `${stripped}*` : trimmed;
}

/**
 * Card issuers, as they appear in a bank statement line.
 *
 * A withdrawal whose description carries an issuer immediately followed by
 * "카드" is the monthly card bill, however the bank decorates it: "삼성카드",
 * "삼성카드출금", "삼성카드결재", "삼성카드1234", "1234 삼성카드". Requiring the
 * issuer keeps ordinary debit-card purchase lines ("체크카드출금") out of it.
 */
const CARD_ISSUERS = [
  "KB",
  "국민",
  "신한",
  "삼성",
  "현대",
  "롯데",
  "우리",
  "하나",
  "BC",
  "비씨",
  "NH",
  "농협",
  "씨티",
  "카카오",
  "토스",
  "IBK",
  "기업",
  "우체국",
  "수협",
  "새마을",
  "SC",
  "케이뱅크",
  "광주",
  "전북",
  "제주",
  "경남",
  "대구",
  "부산",
];

const CARD_PAYMENT_PATTERNS = [
  new RegExp(`(?:${CARD_ISSUERS.join("|")})카드`, "i"),
  /카드대금/,
  /카드결제대금/,
  /카드값/,
];

/** True when a description reads as a card bill rather than a purchase. */
export function isCardPayment(merchant: string): boolean {
  const name = normalise(merchant);
  if (!name) return false;
  return CARD_PAYMENT_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Which of 보험 / 대출 / 기타 금융 a description belongs to, if any.
 *
 * These three replaced one 금융/보험 category, and the line itself says which
 * one it is often enough to be worth deciding here rather than asking.
 */
export function financeCategoryFor(merchant: string): CategoryType | null {
  const name = normalise(merchant);
  if (!name) return null;

  for (const { category, words } of FINANCE_KEYWORDS) {
    if (words.some((word) => name.toLowerCase().includes(word.toLowerCase()))) {
      return category;
    }
  }
  return null;
}

/**
 * A category the app can work out from the description alone, with no rule
 * stored and no model asked. Ranks below a rule the user confirmed and above
 * anything the classifier decides.
 *
 * Money coming in is left alone: "예금이자" is income, not a loan repayment,
 * and only the direction of the entry tells the two apart.
 */
export function builtInCategoryFor(
  merchant: string,
  isIncome = false
): CategoryType | null {
  if (isIncome) return null;
  if (isCardPayment(merchant)) return CARD_PAYMENT_CATEGORY;
  return financeCategoryFor(merchant);
}

/**
 * The category to file a description under, in the order the user asked for:
 * a rule they confirmed, then what the app can tell on its own, then a rule
 * the classifier left behind.
 */
export function resolveCategory(
  rules: CategoryRule[],
  merchant: string,
  accountId?: string,
  isIncome = false
): CategoryType | null {
  const confirmed = pickRule(userRulesOnly(rules), merchant, accountId);
  if (confirmed) return confirmed.category;

  const builtIn = builtInCategoryFor(merchant, isIncome);
  if (builtIn) return builtIn;

  return pickRule(rules, merchant, accountId)?.category ?? null;
}
