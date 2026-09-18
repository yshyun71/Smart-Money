export type TransactionType = "EXPENSE" | "INCOME";

export type ExpenseType = "FIXED" | "VARIABLE" | "INCOME";

/** The categories the app ships with. */
export type BuiltInCategory =
  | "주거"
  | "통신"
  | "구독/미디어"
  | "식비"
  | "카페/간식"
  | "교통"
  | "쇼핑"
  | "문화/여가"
  | "생활"
  | "의료"
  | "보험"
  | "대출"
  | "기타 금융"
  | "카드대금"
  | "급여"
  | "기타수입"
  | "기타지출";

/**
 * A built-in category, or one the user typed in themselves.
 *
 * `string & {}` keeps the built-in names as suggestions while letting any
 * other name through — a user-defined category is stored and treated exactly
 * like a shipped one.
 */
export type CategoryType = BuiltInCategory | (string & {});

/** Whether a figure was entered by the user or worked out by the app. */
export type ValueSource = "USER" | "AUTO";

export interface ConnectedAccount {
  id: string;
  name: string;
  type: "BANK" | "CREDIT_CARD" | "CHECK_CARD";
  institution: string; // e.g. "카카오뱅크", "KB국민", "신한", "현대"
  identifier: string; // e.g. "3333-**-****" or "****-1234"
  balanceOrBilled: number; // For bank: current balance; for card: current billing amount
  /** ISO timestamp the balance is true as of — a balance means little without one. */
  balanceAsOf: string;
  balanceSource: ValueSource;
  color: string;
  isAutoSyncEnabled: boolean;
  lastSyncedAt: string;
  /**
   * For a card: the account its bill is taken from.
   *
   * A registered account is referred to by id, so its withdrawals can be found
   * and tied to the statements they settle. An account the user has not
   * registered is kept as a name, which is all it can be.
   */
  paymentAccountId?: string;
  paymentAccountLabel?: string;
}

/** Who decided a category rule: the user, or the classifier. */
export type RuleSource = "USER" | "AI";

/**
 * A standing instruction: anything from this account whose description matches
 * the pattern belongs in this category.
 *
 * The pattern is matched loosely — `*` stands for any run of characters, and a
 * pattern with no wildcard matches anywhere in the description. "코웨이렌탈*"
 * therefore covers "코웨이렌탈09" and "코웨이렌탈08" alike.
 */
export interface CategoryRule {
  id: string;
  accountId: string;
  pattern: string;
  category: CategoryType;
  source: RuleSource;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  type: TransactionType;
  expenseType: ExpenseType; // FIXED: 고정비, VARIABLE: 변동비, INCOME: 수입
  category: CategoryType;
  merchant: string;
  amount: number;
  paymentMethod: string;
  accountId: string;
  /** What the statement said: 구분, 할부 회차 — written by the importer. */
  memo?: string;
  /**
   * What the person says it was.
   *
   * Kept apart from `memo` because the importer owns that one: the 회차 it
   * carries is what tells one month's instalment from the next, both for the
   * duplicate check and the 할부 filter. A note typed over it would quietly
   * make next month's billing look like a duplicate of this one.
   */
  note?: string;
  isFixedRecurring?: boolean;
  recurringDay?: number; // e.g. 매월 25일
  /**
   * For a card bill paid out of a bank account: the card it settles, so the
   * month's usage can be read from the payment.
   */
  linkedAccountId?: string;
  /**
   * The billing month this entry belongs to, as YYYY-MM.
   *
   * On a card purchase it is the month the purchase is billed in, which is not
   * the month it was used in — an instalment is used once and billed for
   * months afterwards. On the withdrawal that settles a bill it is the
   * statement being settled, so the two can be read together without working
   * the match out again every time.
   */
  billingMonth?: string;
}

export interface SavingsRecommendation {
  id: string;
  title: string;
  category: string;
  type: "고정비 절약" | "변동비 절약" | string;
  estimatedMonthlySavings: number; // in KRW
  difficulty: "쉬움" | "보통" | "도전";
  currentIssue: string;
  actionPlan: string;
  concreteExample?: string; // 구체적 실천 예시 (Before vs After)
  isImplemented?: boolean;
}

export interface HabitImprovementTip {
  id: string;
  title: string;
  category: string;
  description: string;
  concreteExample: string;
  expectedMonthlyBenefit: number;
  badge: string;
  tag: string;
}

export interface AISpendingAnalysis {
  summary: string;
  healthScore: number;
  fixedRatioAnalysis: string;
  variablePaceAnalysis: string;
  totalPotentialMonthlySavings: number;
  savingsRecommendations: SavingsRecommendation[];
  habitImprovements?: HabitImprovementTip[];
  weeklyActionChecklist: string[];
  coachEncouragement: string;
  analyzedAt: string;
}

export interface MonthlyBudgetConfig {
  month: string; // YYYY-MM
  monthlyIncome: number; // 사용자 입력 월별 수입
  fixedExpenses: number; // 사용자 입력 월별 고정 지출
  savingsTarget: number; // 목표 저축액
  categoryBudgets: Record<string, number>; // 카테고리별 예산 금액
  alertThresholdPercent: number; // 알림 기준 (기본 80%)
  enablePushAlerts: boolean;
  /**
   * 수입·고정비 값이 어디서 왔는지.
   *
   * 잔액의 `balanceSource`와 같은 발상입니다 — 숫자만 남기면 실적에서 불러온
   * 것인지 사람이 고친 것인지 나중에 알 수 없고, 그 둘은 신뢰도가 다릅니다.
   */
  incomeSource?: "USER" | "ACTUALS";
  fixedSource?: "USER" | "ACTUALS";
}

export interface CategoryBudgetStatus {
  category: CategoryType | string;
  budget: number;
  spent: number;
  remaining: number;
  percentage: number;
  /**
   * `UNSET` — 예산을 정하지 않은 카테고리.
   *
   * 예전에는 예산 0원이면서 지출이 있는 칸이 `SAFE`로 남아, 초록 막대가
   * 가득 찬 채 "안전 · 100% 소진"이라고 적혀 있었습니다. 안전한 것도
   * 초과한 것도 아니라 **아직 정하지 않은 것**입니다.
   */
  status: "SAFE" | "WARNING" | "EXCEEDED" | "UNSET";
}

export interface BudgetAlert {
  id: string;
  category: string;
  type: "WARNING" | "EXCEEDED";
  spent: number;
  budget: number;
  percentage: number;
  message: string;
  createdAt: string;
  isRead?: boolean;
}

export interface MonthlyBudget {
  month: string; // YYYY-MM
  incomeGoal: number;
  fixedBudget: number;
  variableBudget: number;
}
