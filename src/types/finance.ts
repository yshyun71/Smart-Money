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
  | "저축"
  | "이체"
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
  /**
   * `"BANK"`(통장) 또는 `"CARD"`(카드).
   *
   * 예전 선언은 `"BANK" | "CREDIT_CARD" | "CHECK_CARD"` 였는데 **저장되는 값은
   * 처음부터 `BANK`·`CARD` 였습니다.** 타입이 거짓을 말하고 있었고, 그래서
   * `type IN ('CREDIT_CARD','CHECK_CARD')` 로 카드를 찾던 SQL 이 **한 건도 맞히지
   * 못한 채** 조용히 아무 일도 하지 않았습니다(카드 청구액이 갱신되지 않던 원인).
   *
   * `@types/react` 를 설치하자 이 거짓말이 여섯 곳에서 한꺼번에 드러났습니다.
   * 판별은 `type === "BANK"` / `!== "BANK"` 로 합니다.
   */
  type: "BANK" | "CARD";
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
  /**
   * 이 줄이 어디서 왔는가.
   *
   * 문자로 넣은 건은 **임시**입니다 — 같은 거래가 나중에 명세서로 다시 들어오고,
   * 그쪽이 할부 회차·수수료·차감까지 갖춘 정확한 기록입니다. 그때 문자 건을
   * 알아보고 **대체**해야 같은 돈이 두 번 세지지 않습니다(7.6).
   *
   * 문자에는 회차가 없고 가맹점 이름도 명세서와 다르게 적히므로, 출처를
   * 모르면 "같은 날 같은 금액인데 이름이 다른 두 줄"을 구분할 근거가 없습니다.
   */
  origin?: "SMS" | "STATEMENT" | "MANUAL";
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
  /**
   * 이 줄이 **DB 에 들어온** 시각 (ISO). 거래 날짜가 아닙니다.
   *
   * 지난달 명세서를 오늘 가져오면 `date` 는 지난달이지만 이 값은 오늘입니다.
   * "AI 분석 이후에 들어온 내역인가"를 가릴 수 있는 유일한 근거입니다(11.6).
   */
  createdAt?: string;
}

import type { AnalysisBasis } from "../services/analysisFreshness";

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
  /** 분석 시각 — 사람이 읽는 문자열. 견주는 데는 쓸 수 없습니다. */
  analyzedAt: string;
  /**
   * 분석 시각 (ISO).
   *
   * `analyzedAt` 은 만들 때의 지역 문자열이라 기기 설정에 따라 모양이 갈리고
   * 견줄 수 없습니다. "이 분석 이후에 들어온 내역"을 세려면 견줄 수 있는 값이
   * 따로 있어야 합니다(11.6).
   */
  analyzedAtIso?: string;
  /**
   * 무엇을 보고 만든 분석인가 — 그때의 건수와 합계.
   *
   * 삭제와 수정은 흔적을 남기지 않으므로, 그때의 숫자를 적어 두지 않으면
   * 지금과 견줄 방법이 없습니다.
   */
  basis?: AnalysisBasis;
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
  /**
   * 저축도 실적을 가질 수 있습니다 — 계좌에서 `저축` 카테고리로 나간 돈.
   *
   * 고정비 합계에서는 빠지므로 두 번 세지 않습니다: 적금이 매달 같은 날 같은
   * 금액으로 나가 고정비로 판정되더라도, 가용 변동비가 `수입 − 고정비 − 저축`
   * 이라 양쪽에 세면 같은 돈이 두 번 깎입니다.
   */
  savingsSource?: "USER" | "ACTUALS";
  /**
   * 실적에서 빼기로 한 거래의 id.
   *
   * 한 번뿐인 상여금이나 계좌 사이의 이체는 다음 달에 또 들어오지 않으므로
   * 예산의 기준이 될 수 없습니다. 그래서 실적 목록에서 뺄 수 있는데, **무엇을
   * 뺐는지도 함께 남겨야** 나중에 그 금액이 어떤 기준인지 알 수 있습니다 —
   * 합계만 저장하니 목록을 열 때마다 전부 선택된 상태로 보여, 저장된 값과
   * 목록의 합계가 다른 이유를 설명할 방법이 없었습니다.
   *
   * 지워진 거래의 id 가 남아 있어도 무해합니다(`sumActuals`가 무시합니다).
   */
  incomeExcluded?: string[];
  fixedExcluded?: string[];
  savingsExcluded?: string[];
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
