# 스마트 머니

카드 사용 내역과 통장 입출금을 자동으로 분석해 **수입·지출**, **고정비·변동비**, **월간 예산**을 한 화면에서 관리하고, AI가 실천 가능한 절약 항목을 추천해 주는 모바일 가계부 웹앱(PWA)입니다.

한국 사용자를 대상으로 설계되어 카테고리 분류, 간편인증 흐름, 카드·은행 결제 알림 문자(SMS) 파싱이 모두 국내 환경에 맞춰져 있습니다.

---

## 주요 기능

| 화면 | 설명 |
| --- | --- |
| **홈** | 이번 달 수입·지출·순저축 요약, 고정비/변동비 비율, 최근 거래 |
| **소비분석** | 카테고리별 지출 구성, 월별·연도별 추이 차트 |
| **예산·알림** | 카테고리 예산 설정과 자동 배분, 초과·임박 알림 배지 |
| **AI절약** | 재무 건강 점수, 맞춤 절약 항목 추천, 소비 습관 개선 팁, 코치 Q&A |
| **고정/변동** | 고정비·변동비 분리 조회 및 거래별 구분 전환 |
| **가계부** | 전체 거래 내역 검색·필터 |
| **연결자산** | 은행 계좌·신용/체크카드 등록, 잔액·청구액 동기화 |

그 밖에:

- **문자 자동 입력** — 카드 결제 알림 문자를 붙여넣으면 AI가 금액·가맹점·카테고리·고정비 여부를 판별해 여러 건을 한 번에 등록합니다.
- **PWA 설치** — 홈 화면에 추가해 단독 앱처럼 실행할 수 있고, 오프라인 상태를 배너로 알립니다.
- **간편인증 + PIN 잠금** — 카카오·토스·PASS·네이버 방식의 본인인증 후 6자리 PIN으로 앱을 잠급니다.
- **뷰 모드 전환** — PC에서는 390×844 스마트폰 프레임으로, 모바일에서는 전체 화면으로 렌더링합니다.

---

## 기술 스택

**프론트엔드** React 19 · TypeScript · Vite 6 · Tailwind CSS 4 · Recharts · Motion · lucide-react · vite-plugin-pwa

**백엔드** Express 4 · sql.js (WebAssembly SQLite) · Google Gemini (`@google/genai`)

---

## 아키텍처

```
브라우저 (React SPA)  ──REST──▶  Express 서버 (:3000)  ──▶  finance.db (SQLite 파일)
                                        │
                                        └──▶  AI API (절약 분석 · SMS 파싱 · 코치 챗)
```

개발 모드에서는 `server.ts` 하나가 Vite를 미들웨어로 물고 **API와 프론트엔드를 같은 포트(3000)에서 서빙**합니다. 별도의 프록시 설정이 필요 없습니다.

상태 관리는 두 개의 React Context에 모여 있습니다.

- `FinanceContext` — 계좌·거래·예산·AI 분석 상태와 모든 파생 집계(고정비 비율, 카테고리별 지출, 예산 초과 알림 등), 그리고 서버 호출 전부
- `AuthContext` — 간편인증 · PIN · 잠금 상태

---

## 시작하기

**필요 환경** Node.js 20 이상

```bash
# 1. 의존성 설치
npm install

# 2. 환경 변수 설정
cp .env.example .env
#   .env 를 열어 GEMINI_API_KEY 값을 채웁니다.
#   키가 없어도 서버는 뜨지만 AI 기능만 동작하지 않습니다.

# 3. 개발 서버 실행
npm run dev
```

브라우저에서 <http://localhost:3000> 으로 접속합니다. 첫 실행 시 `finance.db` 가 자동 생성되고 기본 카테고리 12종과 샘플 계좌·거래가 시드됩니다.

**로그인** — 이름과 휴대폰 번호를 입력하고 인증번호를 요청하면, 개발 환경에서는 발송된 6자리 코드가 응답에 그대로 표시됩니다. 테스트용 고정 코드 `123456` 도 통과합니다.

### 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (Express + Vite, :3000) |
| `npm run build` | 프론트엔드 빌드 + 서버 번들 → `dist/` |
| `npm start` | 프로덕션 실행 (`dist/server.cjs`) |
| `npm run lint` | TypeScript 타입 검사 |

---

## 데이터

모든 데이터는 프로젝트 루트의 **`finance.db`** 한 파일에 저장됩니다. sql.js가 파일을 메모리로 읽어 들이고, 쓰기가 일어날 때마다 디스크에 다시 기록합니다.

| 테이블 | 내용 |
| --- | --- |
| `users` | 사용자 1명(단일 계정), 인증 상태, PIN |
| `categories` | 기본 카테고리 12종 (고정비/변동비/수입 구분) |
| `accounts` | 연결된 은행 계좌 및 카드 |
| `transactions` | 거래 내역 (날짜·카테고리·계좌 인덱스) |
| `budgets` / `budget_configs` | 월별 카테고리 예산과 수입·저축 목표 |
| `ai_analyses` | 월별 AI 분석 결과 캐시 |

`finance.db` 는 개인 금융 데이터를 담는 실행 산출물이므로 **저장소에 커밋하지 않습니다**(`.gitignore` 처리). 스키마와 시드 데이터는 [`server/db.ts`](server/db.ts)에 코드로 정의되어 있어 파일이 없으면 서버가 다시 만들어 냅니다.

설정 화면에서 DB를 **초기 샘플 상태**로 되돌리거나 **거래 0건의 빈 상태**로 비울 수 있고, `.db` 파일을 그대로 내려받을 수도 있습니다.

---

## API

모든 엔드포인트는 `/api` 아래에 있습니다.

**DB** `GET /db/status` · `GET /db/export` · `POST /db/reset`

**인증** `GET /user` · `POST /auth/send-code` · `POST /auth/verify-code` · `POST /user/auth` · `PUT /user/pin` · `POST /user/logout`

**계좌·카드** `GET|POST /accounts` · `PUT|DELETE /accounts/:id` · `POST /accounts/sync`

**거래** `GET|POST /transactions` · `POST /transactions/batch` · `DELETE /transactions/:id` · `PATCH /transactions/:id/toggle-fixed`

**예산** `GET|POST /budgets`

**AI** `GET /ai/analysis` · `PATCH /ai/recommendation/:id/toggle` · `POST /ai/analyze-spending` · `POST /ai/parse-sms` · `POST /ai/ask-coach`

---

## 프로젝트 구조

```
├── server.ts              Express 서버 · 전체 REST API · AI 엔드포인트
├── server/db.ts           SQLite 초기화 · 스키마 · 시드 · 백업/복구
├── vite.config.ts         Vite + Tailwind + PWA 설정
├── src/
│   ├── App.tsx            인증 가드 · 탭 라우팅 · 디바이스 프레임
│   ├── context/           FinanceContext · AuthContext
│   ├── components/
│   │   ├── views/         7개 탭 화면
│   │   ├── auth/          간편인증 · 보안 설정
│   │   ├── transactions/  거래 추가 · 거래 아이템
│   │   ├── dashboard/     요약 카드 · 고정/변동 비율
│   │   ├── modals/        SMS 파서
│   │   ├── layout/        헤더 · 하단 네비게이션
│   │   └── pwa/           설치 안내 · 오프라인 배너
│   ├── data/              히스토리 차트용 기준 데이터
│   └── types/finance.ts   공통 타입 정의
└── scripts/               PWA 아이콘 생성
```

---

## 주의

이 프로젝트의 인증은 **개인용 데모 수준**이며, 아직 실서비스에 그대로 쓸 수 없습니다.

- 인증번호가 API 응답에 그대로 담기고, 고정 코드 `123456` 이 항상 통과합니다.
- PIN이 평문으로 저장되며 `localStorage` 에도 복사됩니다.
- 세션·토큰 개념이 없고, DB의 단일 사용자 행(`user_primary`)만 사용합니다.

여러 사용자를 받거나 외부에 공개하기 전에 인증 계층을 먼저 교체해야 합니다.

또한 계좌 연결과 잔액 동기화는 실제 금융기관 오픈뱅킹 API가 아니라 **로컬 DB에 기록된 값을 갱신하는 방식**입니다. 거래 입력은 직접 추가하거나 결제 알림 문자를 붙여넣어 등록합니다.
