import { GoogleGenAI, Type } from "@google/genai";
import type { AISpendingAnalysis, Transaction } from "../types/finance";

/**
 * AI features run straight from the device against the user's own API key.
 * The key is stored only in this browser's localStorage and is never sent
 * anywhere except to Google's API.
 */

const STORAGE_KEY = "smartmoney_ai_api_key_v1";
const AI_MODEL = "gemini-3.8-flash";

export const AI_KEY_ISSUE_URL = "https://aistudio.google.com/apikey";
export const AI_MODEL_NAME = AI_MODEL;

export class MissingApiKeyError extends Error {
  constructor() {
    super("AI 키가 등록되지 않았습니다. 설정 메뉴의 [AI 등록]에서 키를 먼저 입력해주세요.");
    this.name = "MissingApiKeyError";
  }
}

type Listener = (hasKey: boolean) => void;
const listeners = new Set<Listener>();

export function getApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function hasApiKey(): boolean {
  return getApiKey().trim().length > 0;
}

export function saveApiKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key.trim());
  } catch (error) {
    console.error("AI 키를 저장하지 못했습니다:", error);
  }
  listeners.forEach((listener) => listener(hasApiKey()));
}

export function clearApiKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("AI 키를 삭제하지 못했습니다:", error);
  }
  listeners.forEach((listener) => listener(false));
}

/** Subscribe to key changes; returns an unsubscribe function. */
export function onApiKeyChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Masks the stored key for display, e.g. "AIza••••••••7fQ2". */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${"•".repeat(8)}${trimmed.slice(-4)}`;
}

function client(): GoogleGenAI {
  const key = getApiKey().trim();
  if (!key) throw new MissingApiKeyError();
  return new GoogleGenAI({ apiKey: key });
}

/** Turns SDK failures into messages that mean something to the user. */
function describeFailure(error: unknown): Error {
  if (error instanceof MissingApiKeyError) return error;
  const message = error instanceof Error ? error.message : String(error);

  if (/api[_ ]?key|API_KEY_INVALID|401|403/i.test(message)) {
    return new Error("AI 키가 올바르지 않거나 권한이 없습니다. 설정 > AI 등록에서 키를 확인해주세요.");
  }
  if (/quota|429|RESOURCE_EXHAUSTED/i.test(message)) {
    return new Error("AI 사용량 한도를 초과했습니다. 잠시 후 다시 시도해주세요.");
  }
  if (/fetch|network|Failed to fetch/i.test(message)) {
    return new Error("네트워크에 연결되어 있지 않습니다. AI 기능은 인터넷 연결이 필요합니다.");
  }
  return new Error(message || "AI 요청에 실패했습니다.");
}

/** Verifies a key by making the smallest possible call. */
export async function validateApiKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const probe = new GoogleGenAI({ apiKey: key.trim() });
    await probe.models.generateContent({
      model: AI_MODEL,
      contents: "ping",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeFailure(error).message };
  }
}

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
    const response = await client().models.generateContent({
      model: AI_MODEL,
      contents: prompt,
      config: {
        systemInstruction:
          "당신은 친절하면서도 숫자에 정밀한 금융 가계부 전문 AI입니다. 한국 소비자의 실생활 물가와 금융 상품(알뜰폰, OTT, 배달비, 대중교통 등)에 맞춘 현실적 조언과 구체적 사례를 JSON으로 출력하세요.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: "이번 달 소비에 대한 종합 진단 요약" },
            healthScore: { type: Type.INTEGER, description: "재무 건강 점수 (0-100)" },
            fixedRatioAnalysis: { type: Type.STRING, description: "고정비 비율 적정성 평가 및 피드백" },
            variablePaceAnalysis: { type: Type.STRING, description: "변동비 지출 속도 및 과소비 요인 분석" },
            totalPotentialMonthlySavings: {
              type: Type.INTEGER,
              description: "추천 항목 실천 시 예상되는 월간 총 절약 가능 금액 (원)",
            },
            savingsRecommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "절약 항목 명칭" },
                  category: {
                    type: Type.STRING,
                    description: "관련 카테고리 (주거/통신, 구독/미디어, 식비/배달, 교통, 쇼핑 등)",
                  },
                  type: { type: Type.STRING, description: "고정비 절약 또는 변동비 절약" },
                  estimatedMonthlySavings: { type: Type.INTEGER, description: "월 예상 절약액 (원)" },
                  difficulty: { type: Type.STRING, description: "난이도 (쉬움, 보통, 도전)" },
                  currentIssue: { type: Type.STRING, description: "현재 지출 현황 및 문제점" },
                  actionPlan: { type: Type.STRING, description: "구체적 실천 팁과 방법" },
                  concreteExample: {
                    type: Type.STRING,
                    description: "Before & After 수치와 실행 브랜드/방법이 명시된 구체적 실천 예시",
                  },
                },
                required: [
                  "title",
                  "category",
                  "type",
                  "estimatedMonthlySavings",
                  "difficulty",
                  "currentIssue",
                  "actionPlan",
                  "concreteExample",
                ],
              },
            },
            habitImprovements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "습관 개선 타이틀" },
                  category: { type: Type.STRING, description: "습관 분류" },
                  description: { type: Type.STRING, description: "개선 원리 및 설명" },
                  concreteExample: { type: Type.STRING, description: "구체적 실천 사례" },
                  expectedMonthlyBenefit: { type: Type.INTEGER, description: "예상 월 혜택/절약액" },
                  badge: { type: Type.STRING, description: "핵심 효과 뱃지" },
                  tag: { type: Type.STRING, description: "분류 태그" },
                },
                required: [
                  "title",
                  "category",
                  "description",
                  "concreteExample",
                  "expectedMonthlyBenefit",
                  "badge",
                  "tag",
                ],
              },
            },
            weeklyActionChecklist: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "이번 주 즉시 실천할 3~4가지 액션 체크리스트",
            },
            coachEncouragement: { type: Type.STRING, description: "동기 부여가 되는 한마디" },
          },
          required: [
            "summary",
            "healthScore",
            "fixedRatioAnalysis",
            "variablePaceAnalysis",
            "totalPotentialMonthlySavings",
            "savingsRecommendations",
            "habitImprovements",
            "weeklyActionChecklist",
            "coachEncouragement",
          ],
        },
      },
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    throw describeFailure(error);
  }
}

// ---------------------------------------------------------------------------
// 2. Payment notification (SMS / push) parsing
// ---------------------------------------------------------------------------

export type ParsedTransaction = Omit<Transaction, "id" | "accountId"> & { accountId?: string };

export async function parsePaymentMessages(rawText: string): Promise<ParsedTransaction[]> {
  const currentYear = new Date().getFullYear();

  const prompt = `
다음 한국 은행/카드 결제 알림 문자(SMS) 또는 푸시 알림 텍스트를 분석하여 구조화된 가계부 거래 내역 JSON 배열로 변환하세요.
여러 건이 포함되어 있을 수 있습니다.

[알림 문자 텍스트]:
${rawText}

[분류 규칙]:
1. 금액(amount): 원 단위 숫자 (양의 정수)
2. 유형(type): "EXPENSE"(지출) 또는 "INCOME"(수입)
3. 지출구분(expenseType): 고정비 성격(월세, 관리비, 넷플릭스, 쿠팡와우, 유튜브, 통신요금, 보험료, 대출이자, 학원비 등 정기결제)은 "FIXED", 그 외 일반 소비(식비, 카페, 마트, 쇼핑, 택시 등)는 "VARIABLE". 수입인 경우 "INCOME".
4. 카테고리(category): "식비", "카페/간식", "주거/통신", "구독/미디어", "교통", "쇼핑", "문화/여가", "생활/의료", "금융/보험", "급여", "기타수입", "기타지출" 중 하나로 매핑.
5. 날짜(date): YYYY-MM-DD 형식 (연도가 없으면 ${currentYear}년으로 간주)
6. 시간(time): HH:mm (없으면 "12:00")
7. 결제수단(paymentMethod): 문자 내 카드명/계좌명 (예: "KB국민카드", "신한카드", "카카오뱅크", "토스뱅크" 등)
8. 가맹점/적요(merchant): 상호명 또는 입금처
`;

  try {
    const response = await client().models.generateContent({
      model: AI_MODEL,
      contents: prompt,
      config: {
        systemInstruction:
          "한국 신용카드, 체크카드, 은행 입출금 SMS 및 푸시 알림 문자를 정확히 파싱하는 금융 NLP 도우미입니다.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            transactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  merchant: { type: Type.STRING },
                  amount: { type: Type.INTEGER },
                  type: { type: Type.STRING, enum: ["EXPENSE", "INCOME"] },
                  expenseType: { type: Type.STRING, enum: ["FIXED", "VARIABLE", "INCOME"] },
                  category: { type: Type.STRING },
                  paymentMethod: { type: Type.STRING },
                  date: { type: Type.STRING },
                  time: { type: Type.STRING },
                  memo: { type: Type.STRING },
                },
                required: [
                  "merchant",
                  "amount",
                  "type",
                  "expenseType",
                  "category",
                  "paymentMethod",
                  "date",
                ],
              },
            },
          },
          required: ["transactions"],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{"transactions":[]}');
    return Array.isArray(parsed.transactions) ? parsed.transactions : [];
  } catch (error) {
    throw describeFailure(error);
  }
}

// ---------------------------------------------------------------------------
// 3. Coach Q&A
// ---------------------------------------------------------------------------

export async function askCoach(question: string, context: unknown): Promise<string> {
  const systemPrompt = `
당신은 사용자의 금융 데이터(총 수입, 고정비, 변동비, 카드 및 계좌 지출 내역)를 꼼꼼히 파악하고 있는 AI 스마트 머니 절약 코치입니다.
사용자의 질문에 대해 현실적이고 수치에 근거한 절약 조언, 예산 관리 팁, 고정비 절감 노하우를 명확하고 정중한 한국어로 답변하세요.
답변은 300자 내외로 핵심을 짚어주고, 2~3가지의 즉시 실행 가능한 행동 팁(Bullet points)을 포함하세요.
  `;

  const userContent = `
[사용자 현재 재무 상황 요약]:
${JSON.stringify(context || {})}

[질문]:
${question}
  `;

  try {
    const response = await client().models.generateContent({
      model: AI_MODEL,
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      config: { systemInstruction: systemPrompt },
    });
    return response.text || "";
  } catch (error) {
    throw describeFailure(error);
  }
}
