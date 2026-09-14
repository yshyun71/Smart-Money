# 스마트 머니 — 개발 지침서

이 문서는 **이 문서만 가지고 같은 프로그램을 다시 만들 수 있도록** 구조·규칙·판단 근거를 기록한 것입니다.
코드를 고칠 때는 아래 "원칙"과 14절 "함정"을 먼저 읽으세요.

> **이 문서를 코드와 함께 고칩니다.**
> 프로그램을 바꾸면 영향받는 절을 같은 커밋에서 갱신합니다. 문서가 코드와 어긋나는 순간
> 이 문서는 목적을 잃고, 다음 작업이 잘못된 전제 위에서 시작됩니다.
> 자주 바뀌는 곳: **4.3** 마이그레이션 이력 · **4.4** 테이블 DDL · **6** 카테고리 ·
> **7** 가져오기 규칙 · **9** 카드 연결 · **12** 화면 구성 · **14** 함정(새로 겪은 사고).

---

## 1. 이 앱이 무엇인가

한국 개인용 가계부 PWA입니다. 은행 통장과 카드사 명세서를 **엑셀·CSV로 가져와** 분류하고, 고정비/변동비를 가려내고, 예산과 절약을 관리합니다.

세 가지가 이 앱의 성격을 결정합니다.

1. **서버가 없습니다.** 모든 데이터는 기기 안 SQLite(sql.js, WebAssembly)에 있고 IndexedDB에 저장됩니다. 백엔드도, 계정 서버도 없습니다.
2. **AI는 사용자의 키로 브라우저에서 직접 호출합니다.** 키는 기기에만 있고, AI 없이도 앱의 모든 기본 기능이 동작해야 합니다.
3. **금융기관 자동 연동은 없습니다.** 오픈뱅킹은 사업자 등록이, 스크래핑은 마이데이터 라이선스가 필요합니다. 개인 사용자는 **명세서 파일 가져오기**가 유일한 현실적 경로입니다. 이 전제를 뒤집지 마세요.

---

## 2. 기술 스택과 명령

| 항목 | 내용 |
| --- | --- |
| 프레임워크 | React 19 + TypeScript + Vite 6 |
| 스타일 | Tailwind CSS 4 (`@tailwindcss/vite`) |
| 아이콘 | `lucide-react` |
| 차트 | `recharts` |
| DB | `sql.js` 1.14 (WASM SQLite) + IndexedDB |
| 엑셀 | `xlsx` **0.20.3, npm 아닌 SheetJS CDN tarball** |
| PWA | `vite-plugin-pwa` (`registerType: 'autoUpdate'`) |
| AI SDK | `@google/genai`, `@anthropic-ai/sdk`, OpenAI는 fetch |
| 배포 | Cloudflare Workers(정적 자산) + GitHub `main` 푸시 |

```bash
npm run dev      # 개발 서버
npm run lint     # tsc --noEmit  (이 프로젝트의 유일한 정적 검사)
npm run build    # vite build → dist/
```

**의존성 주의**
- `xlsx`는 반드시 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`로 설치합니다. npm 레지스트리의 `xlsx@0.18.5`에는 미패치 취약점 2건이 있습니다.
- `@types/react`가 **없습니다.** 아래 "함정" 절을 반드시 읽으세요.

---

## 3. 디렉터리 구조

```
src/
├── main.tsx                  ErrorBoundary로 감싼 진입점
├── App.tsx                   인증 게이트 + 탭 전환 + 프레임/와이드 모드
├── types/finance.ts          모든 도메인 타입
├── constants/categories.ts   카테고리 목록·키워드 표 (단일 출처)
├── db/
│   ├── schema.ts             SCHEMA_VERSION · MIGRATIONS · 자가복구 · 샘플 데이터
│   ├── database.ts           sql.js 초기화 · IndexedDB 저장 · 통계 · 내보내기/가져오기
│   └── repository.ts         모든 SQL. 화면은 이 파일만 통해 DB에 접근
├── context/
│   ├── AuthContext.tsx       사용자 등록·로그인·로그아웃
│   └── FinanceContext.tsx    앱 상태의 중심. 모든 쓰기 동작이 여기를 지남
├── services/
│   ├── csvImport.ts          파일 해독 · 표 파싱 · 열 매칭 · 초안 생성
│   ├── statementFormats.ts   확인된 명세서 형식 기억 (localStorage)
│   ├── categoryRules.ts      패턴 규칙 · 카드대금/금융 자동 판별
│   ├── cardLink.ts           카드-출금 연결 · 결제월 대조 · 청구예정액
│   ├── balance.ts            잔액 조정 산식
│   ├── recurrence.ts         고정비 반복 판정
│   ├── pinCrypto.ts          PBKDF2 PIN 해시
│   ├── aiClient.ts           프롬프트 + JSON 스키마 (기능별)
│   └── ai/                   공급자 어댑터 계층
├── components/
│   ├── auth/ dashboard/ layout/ modals/ pwa/ settings/ transactions/ views/
│   └── ErrorBoundary.tsx
└── utils/
    ├── format.ts             금액·기준일시 포맷
    └── accountTone.ts        계좌/카드 색상
```

**계층 규칙**: 화면 → Context → repository → database. 화면이 `repository`나 `database`를 직접 부르지 않습니다(내보내기/가져오기 등 일부 관리 기능 예외). `services/`는 순수 로직이며 React를 모릅니다.

---

## 4. 데이터베이스

### 4.1 원칙

- **DB 파일을 배포하지 않습니다.** 최초 실행 시 기기에서 만들어지고, 그 뒤로는 프로그램만 교체됩니다.
- 구조 변경은 **마이그레이션 추가로만** 합니다. 이미 배포된 마이그레이션은 절대 수정하지 않습니다.
- 버전은 SQLite의 `PRAGMA user_version`에 있습니다. `.db` 파일을 내보냈다 가져와도 따라갑니다.
- 모든 사용자 데이터에는 `user_id`가 있고, `repository.ts`의 `requireUser()`가 모든 질의에 붙입니다. **범위 없는 질의가 나올 수 없는 구조**입니다.

### 4.2 자가 복구 (중요)

실제로 **버전만 올라가고 컬럼이 없는 기기**가 발생한 적이 있습니다(`pin_hash` 누락). 그 상태는 버전만 믿는 코드로는 영원히 복구되지 않습니다. 그래서:

- `EXPECTED_COLUMNS` — 있어야 할 컬럼 목록. 매 실행마다 `repairMissingColumns()`가 확인하고 없으면 추가합니다.
- `EXPECTED_TABLES` — 나중에 생긴 테이블의 DDL. `repairMissingTables()`가 없으면 만듭니다.
- `addColumn()`은 먼저 존재를 확인하고 ALTER 합니다(중복 실행 안전).

**새 컬럼·테이블을 추가하면 이 두 목록에도 반드시 넣으세요.**

### 4.3 마이그레이션 이력

| v | 내용 |
| --- | --- |
| 1 | 초기 스키마 (users, categories, accounts, transactions, budgets, budget_configs, ai_analyses) |
| 2 | PIN을 평문 대신 PBKDF2 해시로 (`pin_hash`, `pin_salt`, `pin_iterations`, 평문 `pin` 제거) |
| 3 | 사용자별 분리 — accounts/transactions에 `user_id` 추가, budgets/budget_configs/ai_analyses는 복합 PK로 **재구축**(SQLite는 PK 변경 불가) |
| 4 | `accounts.balance_as_of`, `balance_source`, `category_rules` 테이블 |
| 5 | `custom_categories` 테이블, 기본 카테고리에 `카드대금` |
| 6 | `금융/보험` → `보험`·`대출`·`기타 금융` 분리 (내역·규칙·예산 이관) |
| 7 | `주거/통신` → `주거`·`통신`, `생활/의료` → `생활`·`의료` 분리 |
| 8 | `transactions.linked_account_id` (카드대금이 결제하는 카드) |
| 9 | `transactions.billing_month` (결제월) |
| 10 | `accounts.payment_account_id`, `payment_account_label` (카드의 결제 계좌) |

현재 `SCHEMA_VERSION = 10`.

### 4.4 테이블 (현재 형태)

```sql
users(id PK, name, email, phone, pin, pin_hash, pin_salt, pin_iterations,
      auth_provider, provider_label, is_authenticated, is_biometric_enabled,
      authenticated_at, created_at)

categories(id PK, name UNIQUE, type, icon, color, is_default)   -- 앱은 읽지 않음. 참고용
custom_categories(id PK, user_id, name, type, created_at, UNIQUE(user_id, name))

accounts(id PK, user_id, name, type, institution, identifier,
         balance_or_billed, balance_as_of, balance_source,
         payment_account_id, payment_account_label,
         color, is_auto_sync_enabled, last_synced_at, created_at)

transactions(id PK, user_id, date, time, type, expense_type, category, merchant,
             amount, payment_method, account_id, memo,
             is_fixed_recurring, recurring_day,
             linked_account_id, billing_month, created_at)

category_rules(id PK, user_id, account_id, pattern, category, source,
               created_at, updated_at)

budgets(user_id, month, category, amount, PK(user_id, month, category))
budget_configs(user_id, month, ... , PK(user_id, month))
ai_analyses(user_id, month, analysis_json, health_score, updated_at, PK(user_id, month))
```

- `accounts.type`은 타입 선언상 `"BANK" | "CREDIT_CARD" | "CHECK_CARD"`이지만 **실제 저장값은 `"BANK"` 또는 `"CARD"`** 입니다. 판별은 항상 `type === "BANK"` / `type !== "BANK"`로 하세요.
- 날짜는 `YYYY-MM-DD`, 시각은 `HH:mm`, 결제월은 `YYYY-MM`, 기준일시는 ISO 문자열입니다.

### 4.5 저장

`run()`/`runBatch()`는 쓰기 후 `scheduleSave()`로 IndexedDB 저장을 합칩니다(연속 쓰기를 한 번의 왕복으로). 개별 함수에서 `persist()`를 부를 필요가 없습니다.

---

## 5. 인증과 사용자

- **최초 실행 시 사용자 0명** → 3단계 등록 화면(이름·연락처 → PIN → 확인).
- PIN은 **PBKDF2-HMAC-SHA256, 310,000회, 16바이트 랜덤 솔트**(`pinCrypto.ts`). 평문은 저장하지 않습니다.
- 로그인은 사용자 선택 → PIN 6자리. 사용자별로 **가계부가 완전히 분리**됩니다.
- 설정 메뉴: `연동된 카드 및 계좌관리` / `간편비밀번호 등록·변경` / `사용자 추가` / `AI 등록` / `스마트폰 앱 설치`.
- 카카오·토스·PASS·네이버 같은 외부 인증은 **개인 개발자가 쓸 수 없습니다**(사업자·심사 필요). PIN이 대안입니다.

---

## 6. 카테고리 체계

### 6.1 목록 (`constants/categories.ts` — 단일 출처)

```
식비, 카페/간식, 주거, 통신, 구독/미디어, 교통, 쇼핑, 문화/여가,
생활, 의료, 보험, 대출, 기타 금융, 카드대금, 급여, 기타수입, 기타지출
```

- `CategoryType = BuiltInCategory | (string & {})` — 사용자가 직접 만든 이름도 값이 됩니다.
- 사용자 카테고리는 `custom_categories`에 **사용자별로** 저장되고, 기본 목록 뒤에 붙습니다.
- 카테고리를 쓰는 모든 화면은 `useFinance().categories` 하나만 봅니다. 컴포넌트마다 목록을 복제하지 마세요.
- 선택 UI는 항상 `CategorySelect` 컴포넌트를 씁니다(`+ 직접 입력` 포함).
- 아이콘/색상: `TransactionItem.tsx`의 `getCategoryIcon`/`getCategoryBg`, `AnalyticsDashboardView.tsx`의 `CATEGORY_COLORS`. 셋 다 **default 분기**가 있어 새 카테고리도 깨지지 않습니다.

### 6.2 판정 우선순위 (절대 바꾸지 말 것)

```
1) 사용자 규칙 (category_rules, source=USER)
2) 앱 자체 판별 (카드대금 → 보험/대출/기타 금융)   ※ 지출 건에만 적용
3) AI 규칙 (category_rules, source=AI)
4) AI 자동 분류 결과 / 가져오기 시 키워드 추정
```

`resolveCategory(rules, merchant, accountId, isIncome)`가 1~3을 담당합니다. **입금 건에는 자체 판별을 적용하지 않습니다** — `예금이자`는 지출이면 대출 관련이지만 입금이면 수입이고, 방향만이 그 둘을 가릅니다.

### 6.3 자체 판별 규칙

- **카드대금**: `CARD_ISSUERS`(KB·국민·신한·삼성·현대·롯데·우리·하나·BC·비씨·NH·농협·씨티·카카오·토스·IBK·기업·우체국·수협·새마을·SC·케이뱅크와 지방은행) 중 하나가 **바로 뒤에 "카드"를 달고** 나오면 카드 결제대금으로 봅니다. `KB카드`, `우리카드출금`, `삼성카드결재`, `롯데카드1234`, `1234 신한카드` 모두 해당. 카드사명이 없는 `체크카드출금`은 제외됩니다.
- **보험 / 대출 / 기타 금융**: `FINANCE_KEYWORDS`를 이 순서로 검사합니다(더 좁은 것이 먼저).
- **주거/통신, 생활/의료**: `HOUSING_KEYWORDS`, `LIVING_KEYWORDS`. 이 표들은 **가져오기 추정과 마이그레이션 이관에 같이 쓰입니다** — 그래서 과거 데이터가 "새로 가져왔다면 갔을 자리"로 갑니다. 새 분리를 할 때도 같은 방식을 쓰세요(`CATEGORY_SPLITS`).

### 6.4 카테고리 규칙 (`category_rules`)

- `계좌 / 패턴 / 카테고리 / 등록구분(USER|AI)`.
- 패턴은 **포함 매칭**입니다. `*`는 임의 문자열, 공백 무시, 대소문자 무시. `코웨이렌탈*` → `코웨이렌탈08`, `코웨이렌탈09`.
- 우선순위: `USER` > 더 긴 패턴 > 최근 수정(`pickRule`).
- 거래 내역 수정에서 카테고리를 바꾸면 규칙 등록 체크박스가 켜지고, 패턴은 끝자리 숫자를 떼어 제안합니다(`suggestPattern`).
- AI 자동 분류 결과도 `source=AI`로 적립되고, 사용자가 `사용자로` 버튼으로 승격할 수 있습니다.
- **AI 규칙이 USER 규칙을 덮어쓰지 못합니다**(`saveCategoryRule`에서 차단).
- `카테고리 관리` 화면: 규칙 목록(각 행에 체크박스), `전체 선택`, `새 규칙 등록`, **`카테고리 일괄 적용`**(선택한 규칙만 그 계좌 전체 내역에 재적용, 규칙별 적용 건수를 요약 팝업으로 보고), 하단에 `내가 추가한 카테고리` 관리.

---

## 7. 명세서 가져오기 (가장 까다로운 부분)

### 7.1 흐름

```
PICK(계좌·파일 선택) → MAP(열 지정·미리보기) → REVIEW(중복 확인) → DONE(결과)
```

### 7.2 파일 해독

`decodeFile`: UTF-8 BOM → UTF-8 → euc-kr/windows-949 순서로 시도합니다. 한국 은행 파일은 대부분 euc-kr입니다.
`loadStatementFile`: `.xls/.xlsx`는 `import("xlsx")`로 **동적 로드**해 CSV로 바꿉니다(별도 청크 ≈500KB). `cellDates: true`, `sheet_to_csv({ blankrows: false, rawNumbers: false })`. 시트가 여럿이면 사용자가 고릅니다.

### 7.3 표 인식

- `findHeaderRow`: 머리글 힌트 단어가 가장 많은 줄(최대 30줄 안에서).
- **두 줄 머리글 병합**: 머리글 다음 줄이 날짜도 금액도 아니면 하위 머리글로 보고, **병합된 제목을 아래 빈 칸으로 이어 붙여** 합칩니다. KB 카드 명세서의 `이번달 결제금액`(제목) / `회차·원금·수수료(이자)`(이름)가 이 경우입니다. 이걸 안 하면 `회차` 열이 금액으로 잡혀 **할부 건만 인식되고 나머지가 전부 사라집니다.**

### 7.4 열 매칭 (3단계, 이 순서)

1. **기억된 형식** — `statementFormats.ts`가 머리글 서명(`공백 제거·소문자·| 연결`)으로 localStorage에 보관합니다. 사용자가 MAP 단계를 넘어가면(= 사람이 확인함) 저장합니다. 다음 달 같은 파일은 호출 없이 즉시 적용됩니다.
2. **규칙 판별** — `autoDetectMapping(headers, rows)`. 이름으로 찾고, 그 결과가 **날짜 있는 행의 60% 이상을 읽지 못하면** 실제 데이터에서 다시 찾습니다(`detectFromRows`).
3. **AI 판별** — 위가 실패하고 키가 등록되어 있을 때만. `detectStatementColumns(headers, sampleRows)`에 **머리글과 표본 5행만** 보내고 열 번호만 받습니다. 파일 전체를 보내지 않으며, 규칙보다 잘 읽을 때만 채택합니다. 화면에 출처(`자동 지정` / `AI가 인식` / `이전에 확인한 형식`)를 표시하고 `AI로 다시 인식하기`를 제공합니다.

**금액이 될 수 없는 열**: 잔액, 한도, 누계, 회차, 개월, 건수, 포인트, 마일리지, 번호. (`적립예정 포인트`가 "적립"에 걸려 입금으로 읽히던 사고가 있었습니다.)
**메모 열**은 `구분`을 `할부개월`보다 먼저 잡습니다 — `할부`/`일시불` 값이 할부 판정에 쓰이기 때문입니다.

### 7.5 값 해석

- `normaliseDate`: `2026-09-05`, `2026.9.5`, `20260905`, **`26.08.03`(두 자리 연도)**, `260803`, `09-05`(연도 없음) 순으로 시도하고, 월>12·일>31이면 그 해석을 버립니다. 두 자리 연도 미지원 때문에 명세서 전체가 `2026년 26월`로 들어간 사고가 있었습니다.
- `normaliseAmount`: 콤마·원·공백 제거, 음수 부호 인식.
- `guessCategory`: 자체 판별(카드대금/금융/주거·통신/생활·의료) → 키워드 표 → `기타지출`/`기타수입`.
- `guessExpenseType`: 고정비 키워드로 1차 추정(최종 판정은 AI 자동 분류에서).

### 7.6 중복 판정

- 키: `날짜 | 공백 제거한 내역명 | 금액 [| 할부 회차]`
- **가져오는 그 계좌 안에서만** 비교합니다. 전체 가계부에서 비교하다가 다른 카드의 같은 결제가 중복으로 잡혀 명세서 전체가 0건 등록되던 사고가 있었습니다.
- **할부**: 같은 구매가 매달 같은 날짜·가맹점·금액으로 반복 청구됩니다. KB의 `8/10` 같은 회차가 있으면 회차가 키의 일부가 되어 달끼리 구분됩니다. **회차 없이 `할부`라고만 되어 있으면 중복 판정에서 제외**합니다(어느 달 청구분인지 알 방법이 없으므로). 대신 같은 파일을 두 번 올리면 중복 등록됩니다.
- REVIEW 화면은 **모든 줄을 파일 순서대로** 보여주고 각 줄에 `추가`(초록) / `중복`(주황) 태그를 붙입니다. 덮어쓰기로 선택한 중복은 남색, 건너뛰기는 회색+취소선. `전체/추가/중복` 필터와 `모두 건너뛰기`/`모두 덮어쓰기`를 제공합니다.

### 7.7 카드 명세서 고유 항목

- **결제(청구) 년월**: `결제일·청구년월` 열이 있으면 행마다 읽고, 없으면 화면에서 한 번 지정합니다(기본값은 파일의 가장 최근 이용월). `transactions.billing_month`에 저장됩니다.
- **잔액 조정 체크박스는 은행 계좌에만** 나옵니다. 카드는 잔액이 아니라 청구액입니다.

---

## 8. 잔액과 기준일시

- 잔액은 **금액 + 기준일시(`0000년00월00일 00시`) + 출처(`USER`/`AUTO`)** 세 가지가 한 벌입니다. 계좌 등록 시에도, 수정 시에도 함께 받습니다.
- **기준일시 이전 거래는 잔액을 움직이지 않습니다.** 이미 그 금액에 반영돼 있기 때문입니다(`services/balance.ts`의 `movesBalance`).
- 통장: 입금 +, 출금 −. 카드: 사용 +, 환불 −.
- 가져오기 시 `현재 잔액 수정`을 체크하면 기준일시 이후 항목만 합산해 조정하고, 새 기준일시는 반영된 항목 중 가장 늦은 거래 시점, 출처는 `AUTO`가 됩니다.
- 카드의 **청구 예정액은 사용자가 입력하지 않습니다**(9.3 참조). 카드 행에는 수정 버튼이 없습니다.

---

## 9. 카드와 결제 계좌

### 9.1 연결 구조

- 카드에는 `payment_account_id`(등록된 계좌) 또는 `payment_account_label`(직접 입력)이 있습니다. 등록 화면과 수정 화면 양쪽에 있습니다.
- 은행의 카드대금 출금 건에는 `linked_account_id`(어느 카드) + `billing_month`(어느 결제월)가 저장됩니다.

### 9.2 어느 카드인지 가리는 법 (`matchCardForBill`)

```
1) 내역명의 카드사로 후보를 좁힌다 (없으면 전체 카드)
2) 후보 중 "결제월 합계 == 출금액"인 카드·결제월을 찾는다
3) 그런 후보가 둘 이상이면 연결하지 않는다 (같은 금액을 청구한 다른 카드일 수 있음)
4) 금액으로 정해지지 않고 해당 카드사 카드가 한 장뿐이면 그 카드
5) 다른 출금이 이미 가져간 결제월은 후보에서 제외 (1 출금 ↔ 1 명세서)
```

**카드사 이름만으로 연결하면 안 됩니다.** 같은 카드사 카드가 여러 장일 수 있습니다.

### 9.3 자동 연결·해지 (`reconcileCardBills`)

가져오기·직접 추가·삭제 시점에 실행됩니다.

- 결제월 합계와 같은 금액의 카드대금 출금이 **그 카드의 결제 계좌**에 있으면 자동으로 연결하고 **결제월까지 기록**합니다.
- 그 결제월 내역이 모두 삭제되면 출금이 어떤 달과도 맞지 않게 되므로 **연결과 결제월을 함께 해지**합니다. 다른 달의 연결은 그대로입니다.
- 연결을 **기록**하는 것이 핵심입니다. 화면에서 매번 다시 계산하면 자동 연결과 수동 연결이 서로 다르게 보입니다(실제로 그런 버그가 있었습니다).

### 9.4 청구 예정액 (`pendingBill`)

사용자가 입력하는 값이 아니라 계산합니다.

1. 결제 확인이 된 경우 → **마지막으로 정산된 결제월 이후** 등록된 이용분 (`8월 결제 이후 이용분`)
2. 미정산 명세서가 두 달 이상 쌓인 경우 → **가장 최근 명세서** 기준 (`9월 명세서 기준`)
3. 명세서 정보가 없는 경우 → **이번 달 1일부터** 이용분 (`9월 1일부터 이용분`)

목록의 건수도 같은 기준입니다. 환불은 차감합니다.

### 9.5 화면

- 카드 내역 화면에는 **잔액·수입 합계가 없습니다.** `이용 합계` 하나만 표시합니다.
- 구분 필터는 카드에서 `전체·고정비·변동비`(수입 없음), 계좌에서 `전체·고정비·변동비·수입`.
- 카드 전용 필터: `전체·카드대출·일시불·할부`. 카드대출은 카테고리가 `대출`인 건, 할부는 메모의 할부 표기로 판정합니다.
- 조회 기준: 카드는 `결제월 기준` / `이용일자 기준`을 고를 수 있습니다. 할부는 한 번 쓰고 여러 달 청구되므로 두 답이 다릅니다.
- 계좌 목록에서 카드대금 건의 금액 아래에 `8월 명세서 ›` 바로가기가 나오고, 누르면 그 달의 카드 이용 내역이 열립니다.

---

## 10. 고정비 판정 (`recurrence.ts`)

고정비/변동비가 이름만으로 모호할 때의 기준입니다.

- **서로 다른 3개월 이상**(`MIN_MONTHS = 3`)에서
- **같은 가맹점/내역명**(공백·특수문자 정규화)이
- **같은 날짜대**(`DAY_TOLERANCE = 4`일, 월말은 `MONTH_END_FROM = 26`일 이후를 같은 대로 취급 — 공휴일·주말 밀림과 말일 차이 보정)

로 반복되면 고정비입니다. 고정비로 판정되면 **거래 일자들에서 매월 결제일을 자동 산정**해 채웁니다. 이 근거를 AI에게도 그대로 전달하고, AI는 이 판단을 우선 신뢰하도록 프롬프트에 지시합니다.

---

## 11. AI 계층

### 11.1 구조

`services/ai/`가 공급자 차이를 흡수합니다. 위 계층은 **평범한 JSON Schema를 넣고 파싱된 JSON을 받습니다.**

| 공급자 | 구현 | 기본 모델 |
| --- | --- | --- |
| Google Gemini | `responseSchema` (타입 대문자) | `gemini-3.8-flash` |
| Claude | strict tool + `tool_choice: auto`, `dangerouslyAllowBrowser: true` | `claude-opus-5` |
| ChatGPT | `response_format: json_schema` strict | `gpt-5.5` |

스키마는 **가장 엄격한 공급자 기준**으로 씁니다: 모든 속성을 `required`에, 모든 객체에 `additionalProperties: false`.

키는 `설정 → AI 등록`에서 공급자별로 등록하고 localStorage에 보관합니다. 키가 없으면 AI 기능만 비활성화되고 나머지는 정상 동작해야 합니다.

### 11.2 실패 대응

- 재시도 4회. **503(혼잡)은 1.2초 기준, 429(한도)는 15초 기준** 백오프이며 `retryDelay`/`Retry-After`를 우선합니다.
- 한 번이라도 한도에 걸리면 이후 배치 간격을 1.5초 → 13초로 넓힙니다. 빠른 재시도는 남은 할당량을 더 빨리 태웁니다.
- `classifyTransactions`는 **예외를 던지지 않습니다.** `{ results, failed, error }`를 돌려주어 부분 성공을 보존합니다. 배치(40건) 단위로 적용하고, 실패한 건은 선택 상태로 남겨 재시도할 수 있게 합니다.
- 키 오류·네트워크 오류·모델명 오류·할당량 소진은 배치를 반복해도 낫지 않으므로 즉시 중단합니다.
- 사용자에게는 항상 한국어 메시지로 바꿔 보여줍니다. 원문 JSON을 노출하지 마세요.

### 11.3 기능

| 함수 | 용도 |
| --- | --- |
| `analyzeSpending` | 재무 건강도·절약 추천·습관 개선 |
| `classifyTransactions` | 고정비/변동비 + 카테고리 일괄 분류 |
| `parsePaymentMessages` | 결제 문자 붙여넣기 파싱 |
| `askCoach` | 절약 코치 문답 |
| `detectStatementColumns` | 명세서 열 구조 판별 (머리글+표본 5행만 전송) |

AI 자동 분류는 **사용자 규칙 → 자체 판별 → AI** 순으로 적용하고, 끝나면 요약 팝업(고정비 변경·변동비 변경·카테고리 정정·결제일 기입·변경 없음·사용자 규칙 우선 적용·AI 규칙 등록 건수 + 실제 변경 목록)을 띄웁니다. **팝업은 자동으로 닫히지 않습니다.**

---

## 12. 화면 구성

하단 탭: `홈` · `소비분석` · `예산·알림` · `AI절약` · `카드·계좌`.

주요 화면과 모달:

| 파일 | 역할 |
| --- | --- |
| `views/ConnectedAssetsView` | 카드·계좌 목록, 등록, DB 관리(내보내기/가져오기/초기화) |
| `transactions/AccountLedgerModal` | 계좌·카드별 내역. 조회 조건·선택·AI 분류·각종 진입점 |
| `modals/CsvImportModal` | 4단계 가져오기 |
| `transactions/CategoryRulesModal` | 카테고리 규칙 + 일괄 적용 |
| `transactions/CardUsageModal` | 카드대금에서 연 이용 내역 |
| `modals/AccountEditModal` | 계좌·카드 정보 수정(구분 변경 포함) |
| `modals/BalanceEditModal` | 잔액 + 기준일시 + 출처 |
| `transactions/MonthPickerModal` | 연월 직접 선택(월별 건수 표시) |

### 12.1 계좌 내역 화면의 조건 블록 순서

```
[헤더: 아이콘 · 이름 · 기관·번호 · 연필(정보 수정) · 닫기]
[합계: 계좌=잔액·지출·수입 / 카드=이용 합계]
[버튼 3개: 엑셀·CSV · 직접 추가 · 카테고리 관리]
[AI 자동 분류 + 돋보기(설명 펼침)]
┌ 조회 조건 ──────────────────────────
│ (카드만) 결제월 기준 / 이용일자 기준
│ 월별 / 기간별
│   월별: 2026년 08월  ◀  2026년 09월 ▾  ▶  2026년 10월
│   기간별: [YYYY-MM] 부터 [YYYY-MM] 까지
│ 전체 / 고정비 / 변동비 (/ 수입)
│ (카드만) 전체 / 카드대출 / 일시불 / 할부
│ 카테고리 드롭다운
│ ─────────────
│ ☑ 전체 선택            선택 삭제   조회 N건
│ 선택 N건 합계                    1,234,000원
└──────────────────────────────────
[월별로 묶인 목록]
```

### 12.2 표시 규칙

- **모든 금액에 3자리 콤마**를 씁니다. `utils/format.ts`의 `won`/`withCommas`를 쓰세요. 입력 필드는 `formatAmountInput`/`parseAmountInput` 쌍으로 다룹니다. **`parseInt("1,234,000")`은 1입니다** — 직접 파싱하지 마세요.
- 계좌는 **인디고**, 카드는 **앰버**입니다(`utils/accountTone.ts`). 등록 버튼·요약 카드·목록 아이콘·상세 화면 헤더가 모두 같은 색을 씁니다.
- 데이터가 없으면 **숫자를 지어내지 않습니다.** 분석 전 건강도는 `–`와 `아직 분석 전`으로 표시합니다. 예시 가맹점명을 실제 데이터처럼 보여주지 마세요.

---

## 13. PWA와 배포

```jsonc
// wrangler.jsonc
{ "name": "smart-money", "compatibility_date": "2026-09-10",
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" } }
```

- Cloudflare: Build command `npm run build`, Deploy command `npx wrangler deploy`. 배포 디렉터리는 `wrangler.jsonc`의 `assets.directory`가 결정합니다.
- GitHub `main`에 푸시하면 Cloudflare가 빌드·배포합니다(1~3분).
- `workbox.globPatterns`에 **`wasm`을 반드시 포함**해야 오프라인에서 DB가 열립니다.
- 서비스 워커는 HTTPS 또는 localhost에서만 동작합니다.
- `registerType: 'autoUpdate'`라 **한 번 실행에서 새 버전을 받고 다음 실행에서 화면에 반영**됩니다. 사용자에게는 "두 번 열어보라"고 안내하거나, 새로고침 안내를 띄우세요.
- `ErrorBoundary`가 흰 화면 대신 오류 메시지와 `캐시 비우고 다시 열기`(서비스 워커·캐시 삭제 후 새로고침)를 보여줍니다.

---

## 14. 함정 (반드시 읽을 것)

### 14.1 React 타입이 없습니다

`@types/react`가 설치돼 있지 않습니다. 그래서:

- `useFinance()`의 반환값이 `any`가 되어 **컴포넌트 안의 타입 오류가 `tsc`에 걸리지 않습니다.** `npm run lint` 통과가 컴포넌트의 정확성을 보장하지 않습니다.
- `services/`, `db/`, `utils/`는 제대로 검사됩니다. **중요한 로직은 이 계층에 두고 순수 함수로 만든 뒤 Node 하네스로 검증하세요.**
- 클래스 컴포넌트는 `props`/`setState`를 `declare`로 명시해야 합니다(`ErrorBoundary` 참고).
- `Array.from(anyValue)`는 `unknown[]`이 됩니다. 명시적 타입 주석이 필요합니다.

### 14.2 훅은 조기 반환보다 위에

`if (!isOpen) return null;` **아래에 훅을 추가하면** 열림/닫힘 사이에 훅 개수가 달라져 `Rendered more hooks than during the previous render`로 앱 전체가 죽습니다(흰 화면). 실제로 발생한 사고입니다. 모든 `useState/useMemo/useEffect`는 조기 반환 위에 두세요.

### 14.3 상태 갱신 함수는 순수해야

StrictMode는 업데이터를 두 번 호출합니다. `setState(prev => ...)` 안에서 부수효과를 일으키는 코드는 이 규칙을 알고 작성하세요(이 프로젝트의 `reconcileCardBills`는 멱등하게 작성돼 있습니다). 등록 로직을 업데이터 안에 넣어 두 번 실행되던 버그가 있었습니다.

### 14.4 모달은 `<body>`로 포털

기기 프레임에 `position: relative`가 있어 **스태킹 컨텍스트가 갇힙니다.** 내부 z-index로는 빠져나올 수 없습니다. 모달은 `createPortal(node, document.body)`로 띄우고 아래 층위를 지킵니다.

| z-index | 화면 |
| --- | --- |
| 9998 | 계좌 내역 |
| 9999 | 가져오기, 설정·인증 계열(AI 등록·사용자 관리·PIN·앱 설치) |
| 10000 | 거래 추가·수정, 카테고리 관리, 잔액/계좌 수정, 연월 선택, 카드 이용 내역 |
| 10001 | AI 분류 결과, 카테고리 일괄 적용 결과 |

Escape 키는 **가장 위 모달만** 닫아야 합니다. 아래 모달의 keydown 핸들러에 위 모달의 열림 상태를 조건으로 넣으세요.

### 14.5 효과 의존성에 인라인 화살표 금지

`onClose`처럼 부모가 매 렌더 새로 만드는 함수를 리셋 효과의 의존성에 넣으면, 부모가 리렌더될 때마다 상태가 초기화됩니다. 결과 팝업이 몇 초 만에 사라지던 버그의 원인입니다. **리셋 효과와 키 리스너 효과를 분리하세요.**

### 14.6 CSS

- `min-height`가 `max-height`를 이깁니다. 프레임 모드에서 화면이 잘리던 원인입니다.
- flex 자식의 `mx-auto`는 교차축 stretch를 무효화합니다. 하단 탭이 가운데로 몰리던 원인입니다.

### 14.7 소스 편집 도구

Python heredoc 문자열 치환으로 소스를 고치다 **`\b`가 실제 0x08 바이트로 들어가** 조용히 기능이 깨진 적이 있습니다. 백슬래시 이스케이프가 들어가는 편집은 heredoc 대신 파일로 스크립트를 쓰거나 편집 도구를 쓰세요. 치환 후에는 대상이 실제로 바뀌었는지 확인하세요(`grep`).

---

## 15. 검증 방법

이 프로젝트에는 테스트 프레임워크가 없습니다. 대신 **일회용 Node 하네스**로 검증합니다.

```bash
npx tsx ./__something.test.ts   # 검증 후 삭제
```

지금까지 이렇게 검증한 것들(같은 방식으로 이어가세요):

- 마이그레이션: v0부터 전체 실행, 중간 버전에서 업그레이드, 재실행 멱등성, 데이터 보존, 컬럼/테이블 누락 자가복구
- 날짜 파싱(4자리·2자리 연도·연도 없음·비날짜), 금액 열 판별, 두 줄 머리글, 할부 회차
- 카테고리 판정 우선순위, 카드사 매칭, 결제월 대조, 청구 예정액 3가지 기준
- 잔액 조정 산식(기준일시 경계, 통장/카드 부호, 환불)
- PIN 해시, 반복 결제 판정

sql.js를 노드에서 쓸 때는 `initSqlJs({ locateFile: () => "./node_modules/sql.js/dist/sql-wasm.wasm" })`로 초기화합니다.

---

## 16. 커밋

- 한 커밋에 한 가지 변화. 제목은 **무엇을 하는지**(명령형), 본문은 **왜 그렇게 했는지**와 어떤 문제를 고쳤는지.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `finance.db`는 `.gitignore`에 있습니다. 저장소에도 빌드 결과물에도 들어가지 않습니다.

---

## 17. 앞으로 손댈 때 지킬 것

1. **데이터를 지어내지 않습니다.** 모르면 `–`로 두고 왜 모르는지 적습니다.
2. **추측으로 연결하지 않습니다.** 카드·명세서·중복 판정 모두, 근거가 없으면 비워 두고 사용자가 정하게 합니다.
3. **기존 데이터를 조용히 버리지 않습니다.** 화면에 없는 필드라도 저장 시 유지하세요(결제월을 날려먹은 적이 있습니다).
4. **구조를 바꾸면 마이그레이션과 `EXPECTED_*` 목록을 함께 고칩니다.**
5. **로직은 `services/`의 순수 함수로**, 화면은 그것을 부르기만 하도록. 타입 검사가 닿는 곳이 거기뿐입니다.
6. 새 판정 규칙을 넣을 때는 **가져오기와 마이그레이션이 같은 표를 쓰게** 하세요. 과거 데이터와 새 데이터가 달리 분류되면 합계가 맞지 않습니다.
