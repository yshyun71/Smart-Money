import type { AISpendingAnalysis, Transaction } from "../types/finance";
import {
  describeAiFailure,
  generateJson,
  generateText,
  MissingApiKeyError,
  RETRY_ATTEMPTS,
  sleep,
  withRetry,
  type JsonSchema,
} from "./ai";

export {
  activeProviderLabel,
  clearProviderConfig,
  getAiSettings,
  hasApiKey,
  maskApiKey,
  MissingApiKeyError,
  onAiSettingsChange,
  PROVIDER_ORDER,
  PROVIDERS,
  saveProviderConfig,
  setActiveProvider,
  validateProvider,
  type ProviderId,
  type ProviderInfo,
} from "./ai";

/**
 * The app's AI features, expressed once and run against whichever provider the
 * user registered. Schemas are written so the strictest provider accepts them:
 * every property listed in `required`, `additionalProperties: false` on every
 * object.
 */

const str = (description?: string): JsonSchema => ({ type: "string", description });
const int = (description?: string): JsonSchema => ({ type: "integer", description });

function object(
  properties: Record<string, JsonSchema>,
  description?: string
): JsonSchema {
  return {
    type: "object",
    description,
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const CATEGORY_NAMES = [
  "식비", "카페/간식", "주거/통신", "구독/미디어", "교통", "쇼핑",
  "문화/여가", "생활/의료", "금융/보험", "급여", "기타수입", "기타지출",
];

// ---------------------------------------------------------------------------
// 1. Spending analysis & savings coaching
// ---------------------------------------------------------------------------

export interface SpendingAnalysisInput {
  month: string;
  totalIncome: number;
  totalExpense: number;
  fixedExpenseTotal: number;
  variableExpenseTotal: number;
  fixedItems: { merchant: string; amount: number; category: string }[];
  variableTopCategories: { category: string; amount: number; percentage: number }[];
  recentTransactions: Transaction[];
}

const ANALYSIS_SCHEMA = object({
  summary: str("이번 달 소비에 대한 종합 진단 요약"),
  healthScore: int("재무 건강 점수 (0-100)"),
  fixedRatioAnalysis: str("고정비 비율 적정성 평가 및 피드백"),
  variablePaceAnalysis: str("변동비 지출 속도 및 과소비 요인 분석"),
  totalPotentialMonthlySavings: int("추천 항목 실천 시 예상되는 월간 총 절약 가능 금액 (원)"),
  savingsRecommendations: {
    type: "array",
    items: object({
      title: str("절약 항목 명칭"),
      category: str("관련 카테고리"),
      type: str("고정비 절약 또는 변동비 절약"),
      estimatedMonthlySavings: int("월 예상 절약액 (원)"),
      difficulty: str("난이도 (쉬움, 보통, 도전)"),
      currentIssue: str("현재 지출 현황 및 문제점"),
      actionPlan: str("구체적 실천 팁과 방법"),
      concreteExample: str("Before & After 수치가 명시된 구체적 실천 예시"),
    }),
  },
  habitImprovements: {
    type: "array",
    items: object({
      title: str("습관 개선 타이틀"),
      category: str("습관 분류"),
      description: str("개선 원리 및 설명"),
      concreteExample: str("구체적 실천 사례"),
      expectedMonthlyBenefit: int("예상 월 혜택/절약액"),
      badge: str("핵심 효과 뱃지"),
      tag: str("분류 태그"),
    }),
  },
  weeklyActionChecklist: {
    type: "array",
    items: str(),
    description: "이번 주 즉시 실천할 3~4가지 액션 체크리스트",
  },
  coachEncouragement: str("동기 부여가 되는 한마디"),
});

export async function analyzeSpending(
  input: SpendingAnalysisInput
): Promise<Omit<AISpendingAnalysis, "analyzedAt">> {
  const fixedShare =
    input.totalExpense > 0 ? Math.round((input.fixedExpenseTotal / input.totalExpense) * 100) : 0;
  const variableShare =
    input.totalExpense > 0 ? Math.round((input.variableExpenseTotal / input.totalExpense) * 100) : 0;

  const prompt = `
당신은 대한민국 최고의 공인 개인 재무설계사이자 가계부 절약 코칭 전문가입니다.
사용자의 이번 달(${input.month}) 카드 사용 내역과 통장 계좌 입출금 분석 데이터를 바탕으로, 고정비와 변동비를 정밀 진단하고 실질적으로 실천 가능한 '맞춤형 절약 추천 항목'과 '소비 습관 개선 방안'을 구체적인 예시와 함께 분석해주세요.

[사용자 재무 현황]
- 총 수입: ${Number(input.totalIncome || 0).toLocaleString()}원
- 총 지출: ${Number(input.totalExpense || 0).toLocaleString()}원
- 월간 고정비 지출: ${Number(input.fixedExpenseTotal || 0).toLocaleString()}원 (${fixedShare}%)
- 월간 변동비 지출: ${Number(input.variableExpenseTotal || 0).toLocaleString()}원 (${variableShare}%)
- 주요 고정비 항목: ${JSON.stringify(input.fixedItems || [])}
- 주요 변동비 지출 카테고리: ${JSON.stringify(input.variableTopCategories || [])}
- 최근 지출 샘플: ${JSON.stringify((input.recentTransactions || []).slice(0, 15))}

[분석 및 추천 지침]
1. 고정비 적정성(권장: 수입의 30~40% 이내)과 변동비 지출 습관(외식, 배달, 카페, 택시, 불필요한 구독 등)을 냉철하고 따뜻하게 평가하세요.
2. 실질적으로 매월 아낄 수 있는 구체적인 절약 항목(최소 4~5개)을 계산된 예상 절약 금액(원 단위 숫자)과 함께 제안하세요. **반드시 각 항목마다 현실적인 전/후 비교 수치가 담긴 구체적인 실천 예시(concreteExample)**를 제공하세요. (예: "월 12회 배달(34만원) 중 4회로 축소 및 퇴근길 밀키트 대체 시 월 11만원 절감", "SKT 8.5만원 요금제 -> 알뜰폰 3.3만원 번호이동 시 연 62만원 절약" 등)
3. 카드 및 계좌 소비 습관 개선을 위한 '소비 습관 개선 방안(habitImprovements)'(무지출 데이, 장바구니 24시간 냉각기, 선불 생활비 계좌 분리 등)을 구체적 예시와 함께 제시하세요.
4. 이번 주 당장 실행할 수 있는 체크리스트와 종합 재무 건강 점수(0~100점)를 산출하세요.
`;

  try {
    return await withRetry(() =>
      generateJson<Omit<AISpendingAnalysis, "analyzedAt">>({
        system:
          "당신은 친절하면서도 숫자에 정밀한 금융 가계부 전문 AI입니다. 한국 소비자의 실생활 물가와 금융 상품(알뜰폰, OTT, 배달비, 대중교통 등)에 맞춘 현실적 조언과 구체적 사례를 JSON으로 출력하세요.",
        prompt,
        schema: ANALYSIS_SCHEMA,
        schemaName: "spending_analysis",
      })
    );
  } catch (error) {
    throw describeAiFailure(error);
  }
}

// ---------------------------------------------------------------------------
// 2. Payment notification (SMS / push) parsing
// ---------------------------------------------------------------------------

export type ParsedTransaction = Omit<Transaction, "id" | "accountId"> & {
  accountId?: string;
};

const SMS_SCHEMA = object({
  transactions: {
    type: "array",
    items: object({
      merchant: str("상호명 또는 입금처"),
      amount: int("원 단위 금액 (양의 정수)"),
      type: { type: "string", enum: ["EXPENSE", "INCOME"] },
      expenseType: { type: "string", enum: ["FIXED", "VARIABLE", "INCOME"] },
      category: { type: "string", enum: CATEGORY_NAMES },
      paymentMethod: str("문자 내 카드명 또는 계좌명"),
      date: str("YYYY-MM-DD"),
      time: str("HH:mm, 없으면 12:00"),
      memo: str("추가 메모, 없으면 빈 문자열"),
    }),
  },
});

export async function parsePaymentMessages(rawText: string): Promise<ParsedTransaction[]> {
  const currentYear = new Date().getFullYear();

  const prompt = `
다음 한국 은행/카드 결제 알림 문자(SMS) 또는 푸시 알림 텍스트를 분석하여 구조화된 가계부 거래 내역으로 변환하세요.
여러 건이 포함되어 있을 수 있습니다.

[알림 문자 텍스트]:
${rawText}

[분류 규칙]:
1. 금액(amount): 원 단위 숫자 (양의 정수)
2. 유형(type): "EXPENSE"(지출) 또는 "INCOME"(수입)
3. 지출구분(expenseType): 고정비 성격(월세, 관리비, 넷플릭스, 쿠팡와우, 유튜브, 통신요금, 보험료, 대출이자, 학원비 등 정기결제)은 "FIXED", 그 외 일반 소비(식비, 카페, 마트, 쇼핑, 택시 등)는 "VARIABLE". 수입인 경우 "INCOME".
4. 카테고리(category): 목록 중 하나로 매핑.
5. 날짜(date): YYYY-MM-DD 형식 (연도가 없으면 ${currentYear}년으로 간주)
6. 시간(time): HH:mm (없으면 "12:00")
7. 결제수단(paymentMethod): 문자 내 카드명/계좌명 (예: "KB국민카드", "신한카드", "카카오뱅크", "토스뱅크" 등)
8. 가맹점/적요(merchant): 상호명 또는 입금처
`;

  try {
    const parsed = await withRetry(() =>
      generateJson<{ transactions?: ParsedTransaction[] }>({
        system:
          "한국 신용카드, 체크카드, 은행 입출금 SMS 및 푸시 알림 문자를 정확히 파싱하는 금융 NLP 도우미입니다.",
        prompt,
        schema: SMS_SCHEMA,
        schemaName: "parsed_transactions",
      })
    );
    return Array.isArray(parsed.transactions) ? parsed.transactions : [];
  } catch (error) {
    throw describeAiFailure(error);
  }
}

// ---------------------------------------------------------------------------
// 3. Classifying imported entries
// ---------------------------------------------------------------------------

export interface ClassifyItem {
  index: number;
  date: string;
  merchant: string;
  amount: number;
  isIncome: boolean;
  currentCategory: string;
  currentExpenseType: string;
  /** Evidence computed from the user's own history, not guessed. */
  recurrence: string;
  recurrenceQualifies: boolean;
  paymentDay: number | null;
}

export interface ClassifyResult {
  index: number;
  expenseType: "FIXED" | "VARIABLE" | "INCOME";
  category: string;
  reason?: string;
}

const CLASSIFY_SCHEMA = object({
  results: {
    type: "array",
    items: object({
      index: int("입력의 index 값"),
      expenseType: { type: "string", enum: ["FIXED", "VARIABLE", "INCOME"] },
      category: { type: "string", enum: CATEGORY_NAMES },
      reason: str("한 줄 근거"),
    }),
  },
});

/** Kept small enough that one response stays well inside the output limit. */
const CLASSIFY_BATCH_SIZE = 40;

async function classifyBatch(items: ClassifyItem[]): Promise<ClassifyResult[]> {
  const prompt = `
다음은 사용자의 가계부 거래 내역입니다. 각 항목의 **지출구분(고정비/변동비)**과 **카테고리**를 분류하세요.

[카테고리 목록 — 반드시 이 중 하나]
${CATEGORY_NAMES.join(", ")}

[지출구분 판단 규칙]
1. 수입(isIncome=true)은 반드시 expenseType="INCOME".
2. 성격이 명확한 항목은 이름으로 판단합니다.
   - 고정비: 월세, 관리비, 통신요금, 보험료, 대출이자, 정기구독(넷플릭스·유튜브·쿠팡와우 등), 학원비, 정기 적금/저축
   - 변동비: 외식, 배달, 카페, 마트·편의점, 택시, 쇼핑, 문화생활, 병원·약국
3. **고정비인지 변동비인지 모호한 경우**에는 아래 recurrence(사용자 실제 거래 이력에서 계산한 반복 결제 근거)를 기준으로 판단하세요.
   - recurrenceQualifies=true 이면 고정비로 분류합니다.
     (같은 가맹점/내역명이 서로 다른 3개월 이상에서, 매월 거의 같은 날짜에 반복됨. 공휴일·주말로 결제일이 밀리는 경우와 월말 날짜 차이는 이미 보정되어 있습니다.)
   - recurrenceQualifies=false 이면 변동비로 분류합니다.
4. 이미 지정된 currentExpenseType이 규칙과 맞으면 유지해도 됩니다.

[분류 대상]
${JSON.stringify(
  items.map((item) => ({
    index: item.index,
    date: item.date,
    merchant: item.merchant,
    amount: item.amount,
    isIncome: item.isIncome,
    currentCategory: item.currentCategory,
    currentExpenseType: item.currentExpenseType,
    recurrence: item.recurrence,
    recurrenceQualifies: item.recurrenceQualifies,
  }))
)}

모든 항목에 대해 index를 그대로 유지한 결과를 빠짐없이 반환하세요.
`;

  const parsed = await generateJson<{ results?: ClassifyResult[] }>({
    system:
      "한국 가계부 거래 내역을 고정비/변동비와 카테고리로 정확히 분류하는 분류기입니다. 제공된 반복 결제 근거를 우선 신뢰하고, 추측을 덧붙이지 말고 JSON만 출력하세요.",
    prompt,
    schema: CLASSIFY_SCHEMA,
    schemaName: "transaction_classification",
    bulk: true,
  });

  return Array.isArray(parsed.results) ? parsed.results : [];
}

export interface ClassifyProgress {
  done: number;
  total: number;
  /** Shown to the user while waiting out a busy model. */
  note?: string;
}

export interface ClassifyRun {
  results: ClassifyResult[];
  /** Entries whose batch never came back, after retries. */
  failed: number;
  /** Why the last batch gave up, if any did. */
  error?: string;
}

/**
 * Pacing between batches.
 *
 * Free tiers cap requests per minute, and seven batches fired back to back is
 * exactly the shape that trips one. The gap starts small and, once a rate
 * limit has been seen, widens for the rest of the run — retrying at the
 * original pace spends the quota that just ran out.
 */
const BATCH_GAP_MS = 1500;
const THROTTLED_GAP_MS = 13000;

/**
 * Classifies in batches, retrying a busy model and keeping whatever came back.
 *
 * A few hundred rows is several requests, and losing all of them because the
 * seventh hit "high demand" would waste the six that succeeded — so batches
 * are applied independently and failures are reported alongside the results.
 */
export async function classifyTransactions(
  items: ClassifyItem[],
  onProgress?: (progress: ClassifyProgress) => void
): Promise<ClassifyRun> {
  const results: ClassifyResult[] = [];
  let failed = 0;
  let lastError: string | undefined;
  let done = 0;
  let throttled = false;

  for (let start = 0; start < items.length; start += CLASSIFY_BATCH_SIZE) {
    const batch = items.slice(start, start + CLASSIFY_BATCH_SIZE);

    try {
      const batchResults = await withRetry(
        () => classifyBatch(batch),
        RETRY_ATTEMPTS,
        (waitMs, attempt, rateLimited) => {
          if (rateLimited) throttled = true;
          onProgress?.({
            done,
            total: items.length,
            note: `${
              rateLimited ? "요청 한도에 걸려 대기 중" : "AI 서버가 혼잡합니다"
            }. ${Math.round(waitMs / 1000)}초 후 재시도 (${attempt}/${RETRY_ATTEMPTS - 1})`,
          });
        }
      );
      results.push(...batchResults);
    } catch (error) {
      const described = describeAiFailure(error);
      // A bad key, no network, a wrong model name or an exhausted quota will
      // not clear between batches — stop rather than repeating it six times.
      // The run is still returned, never thrown, so the caller can always show
      // what happened instead of losing it to an exception.
      if (
        error instanceof MissingApiKeyError ||
        /키|네트워크|한도|모델 이름/.test(described.message)
      ) {
        return {
          results,
          failed: items.length - results.length,
          error: described.message,
        };
      }
      failed += batch.length;
      lastError = described.message;
    }

    done = Math.min(start + batch.length, items.length);
    onProgress?.({ done, total: items.length });

    if (start + CLASSIFY_BATCH_SIZE < items.length) {
      const gap = throttled ? THROTTLED_GAP_MS : BATCH_GAP_MS;
      if (throttled) {
        onProgress?.({
          done,
          total: items.length,
          note: `요청 한도를 피해 ${Math.round(gap / 1000)}초 간격으로 진행 중`,
        });
      }
      await sleep(gap);
    }
  }

  return { results, failed, error: lastError };
}

// ---------------------------------------------------------------------------
// 4. Coach Q&A
// ---------------------------------------------------------------------------

export async function askCoach(question: string, context: unknown): Promise<string> {
  const system = `
당신은 사용자의 금융 데이터(총 수입, 고정비, 변동비, 카드 및 계좌 지출 내역)를 꼼꼼히 파악하고 있는 AI 스마트 머니 절약 코치입니다.
사용자의 질문에 대해 현실적이고 수치에 근거한 절약 조언, 예산 관리 팁, 고정비 절감 노하우를 명확하고 정중한 한국어로 답변하세요.
답변은 300자 내외로 핵심을 짚어주고, 2~3가지의 즉시 실행 가능한 행동 팁(Bullet points)을 포함하세요.
  `;

  const prompt = `
[사용자 현재 재무 상황 요약]:
${JSON.stringify(context || {})}

[질문]:
${question}
  `;

  try {
    return await withRetry(() => generateText({ system, prompt }));
  } catch (error) {
    throw describeAiFailure(error);
  }
}
