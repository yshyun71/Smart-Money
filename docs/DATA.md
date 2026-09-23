# 데이터 — 저장·마이그레이션·백업·인증·잔액

> **4 · 5 · 8절.** [CLAUDE.md](../CLAUDE.md) 묶음의 일부입니다. 절 번호는 소스 주석이 가리키는 값이라 바뀌지 않습니다.

이 앱에는 서버가 없습니다. 그래서 **기기 안의 이 파일 하나가 사용자 가계부의 전부**이고, 여기서 잃으면 되돌릴 곳이 없습니다. 이 문서의 규칙은 대부분 실제로 데이터를 잃을 뻔한 사고에서 나왔습니다.

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
| 11 | `transactions.note` (사용자가 직접 적는 설명) |
| 12 | `budget_policy` 테이블, `budget_configs.income_source`·`fixed_source` |
| 13 | `budget_configs.savings_source` |
| 14 | `저축` 카테고리 신설 — 적금·예금·청약 **지출**을 `기타 금융`에서 이관 |
| 15 | `sms_inbox` 테이블, `transactions.origin` (SMS/STATEMENT/MANUAL) |
| 16 | `budget_configs.income_excluded`·`fixed_excluded`·`savings_excluded` (실적에서 뺀 거래 id) |
| 17 | `undo_log` 테이블 (되돌리기 임시 저장소) |
| 18 | **수입의 고정/변동**(`expense_type` 에서 `'INCOME'` 제거) · **방향별 카테고리**(`기타 금융` → `금융/자산`·`금융/자산수입`, 방향에 맞지 않는 것은 그 방향의 `기타`로) · `custom_categories.direction` 과 `UNIQUE(user_id, name, direction)` 재구축 |

현재 `SCHEMA_VERSION = 18`.

### 4.4 테이블 (현재 형태)

```sql
users(id PK, name, email, phone, pin, pin_hash, pin_salt, pin_iterations,
      auth_provider, provider_label, is_authenticated, is_biometric_enabled,
      authenticated_at, created_at)

categories(id PK, name UNIQUE, type, icon, color, is_default)   -- 앱은 읽지 않음. 참고용
custom_categories(id PK, user_id, name, type, direction, created_at,
                  UNIQUE(user_id, name, direction))   -- 같은 이름을 양쪽에 (6.1)

accounts(id PK, user_id, name, type, institution, identifier,
         balance_or_billed, balance_as_of, balance_source,
         payment_account_id, payment_account_label,
         color, is_auto_sync_enabled, last_synced_at, created_at)

transactions(id PK, user_id, date, time, type, expense_type, category, merchant,
             amount, payment_method, account_id, memo, note,   -- expense_type 은 FIXED|VARIABLE (6.6)
             is_fixed_recurring, recurring_day,
             linked_account_id, billing_month, created_at)

category_rules(id PK, user_id, account_id, pattern, category, source,
               created_at, updated_at)

-- 확인 전의 문자. 등록해야 transactions 로 갑니다 (7.8)
sms_inbox(id PK, user_id, received_at, raw_text, parsed_json,
          status, created_at)

budgets(user_id, month, category, amount, PK(user_id, month, category))
budget_configs(user_id, month, monthly_income, fixed_expenses, savings_target,
               alert_threshold_percent, enable_push_alerts,
               income_source, fixed_source, savings_source,
               income_excluded, fixed_excluded, savings_excluded,   -- JSON 배열
               updated_at, PK(user_id, month))

-- 달에 매이지 않습니다. 사용자당 한 행 (11.5)
budget_policy(user_id PK, mode, rules_json, updated_at)

-- 바꾸기 전의 행 사본. 보관 기간이 지나면 지웁니다 (4.9)
undo_log(id PK, user_id, kind, label, payload_json, created_at)
ai_analyses(user_id, month, analysis_json, health_score, updated_at, PK(user_id, month))
```

- `accounts.type`은 타입 선언상 `"BANK" | "CREDIT_CARD" | "CHECK_CARD"`이지만 **실제 저장값은 `"BANK"` 또는 `"CARD"`** 입니다. 판별은 항상 `type === "BANK"` / `type !== "BANK"`로 하세요.
- 날짜는 `YYYY-MM-DD`, 시각은 `HH:mm`, 결제월은 `YYYY-MM`, 기준일시는 ISO 문자열입니다.
- **계좌·카드를 지우면 그것에 매인 것이 함께 사라집니다**(`deleteAccount`). 예전에는 `accounts` 한 줄만 지워 **내역이 고아로 남았습니다** — 실제 기기에서 KB국민카드 501건·KB국민은행 469건이 합계에는 계속 잡히는데 화면에서는 열 수 없었습니다. 확인 문구는 `연동을 해제하고 삭제`라고 말했지만 둘 다 아니었습니다.
  → 함께 지우는 것: 그 계좌의 거래, 그 계좌에 매인 카테고리 규칙(§6.4), 이 카드를 가리키던 카드대금의 **연결**(출금 자체는 남습니다), 이 계좌를 결제 계좌로 쓰던 카드의 지정.
  → 함께 지워지는 것은 DB 밖에도 있습니다 — 그 계좌를 가리키던 **명세서의 카드 이름 기억**(§7.10, localStorage).
  → 확인 창이 **건수로** 말하고(`accountFootprint`), 되돌릴 수 있습니다(§4.9).
  → **새 테이블에 `account_id` 를 넣으면 `deleteAccount` 에도 추가하세요.** `deleteUser`(§5)와 같은 규칙입니다.
- **`transactions.origin`** 은 그 줄이 어디서 왔는지입니다 — `SMS`(문자, **임시**) · `STATEMENT`(명세서) · `MANUAL`(직접 입력). 문자 건은 나중에 명세서가 대체해야 하므로 출처를 모르면 그 판단을 할 수 없습니다(7.8).
- **`transactions.created_at` 은 화면까지 실립니다**(`createdAt`). 거래 날짜가 아니라 **DB 에 들어온 시각**이라, 지난달 명세서를 오늘 가져오면 `date` 는 지난달이어도 이 값은 오늘입니다. "AI 분석 이후에 들어온 내역인가"를 가릴 수 있는 유일한 근거입니다(11.6).
- **`memo`와 `note`는 주인이 다릅니다.** `memo`는 **명세서가 적어 준 것**(`구분`, 할부 회차 `4/10`)이고 가져오기가 씁니다. `note`는 **사람이 적는 설명**입니다. 절대 합치지 마세요 — `memo`의 회차가 중복 판정 키(7.6)와 `할부` 필터(9.5)의 근거라, 사람이 그 칸에 글을 쓰면 다음 달 같은 할부가 중복으로 걸러집니다.

### 4.5 백업 파일 암호화 (`services/backupCrypto.ts`)

**백업 파일은 이 기기를 떠나는 유일한 물건입니다** — 다운로드 폴더, 메일 첨부, 동기화 폴더. 그래서 암호를 걸 수 있습니다.

```
[SMBK1 5B][반복횟수 4B][salt 16B][IV 12B][AES-256-GCM 암호문]
```

- 키는 **PBKDF2-HMAC-SHA256 600,000회**로 파생하고 본문은 **AES-256-GCM**입니다. 반복 횟수를 파일에 적어 두므로 나중에 올려도 이미 만든 백업이 열립니다.
- **GCM을 쓰는 이유**: 암호가 틀리거나 한 바이트라도 바뀌면 복호화가 **실패**합니다. 그럴듯한 쓰레기를 돌려주지 않으므로, 그것을 DB로 여는 사고(4.6)가 나지 않습니다.
- **암호에 제한을 두지 않습니다.** 길이·구성·금지 패턴 전부 없습니다. 그런 규칙은 조건을 겨우 만족하는 가장 짧은 값을 고르게 만들고, 앱은 그 사람이 무엇을 기억할 수 있는지 알지 못합니다. **앞뒤 공백도 임의로 떼지 않습니다** — 나중에 열리지 않게 됩니다. 대신 `passphraseAdvice`가 얼마나 약한지 **말해 줄 뿐 막지는 않습니다**.
  → 6자리 숫자는 가능한 값이 100만 가지입니다. 이 PC 1코어에서 PBKDF2 600,000회가 316ms였으니 전수 탐색이 88시간, 8코어면 11시간, GPU면 분 단위입니다. PIN을 그대로 써도 되지만 안전하지는 않다는 뜻이고, 화면에도 그렇게 적혀 있습니다.
- **암호를 잊으면 누구도 열 수 없습니다.** 서버가 없어 되돌릴 방법이 없고, 이 화면에서 가장 중요한 경고입니다.
- 확장자는 `.smbk`, 평문 백업은 예전처럼 `.db`. **암호가 걸렸는지는 확장자가 아니라 머리의 표식으로 판별**합니다(`isEncryptedBackup`) — 이름은 얼마든지 바뀝니다. **평문 백업도 계속 읽습니다.**
- 암호를 비워 두면 예전처럼 평문 `.db`가 나옵니다. 이미 그렇게 만들어 둔 백업이 있고, 또 만들지 못하게 막는 것은 사용자 대신 결정하는 일입니다.

**암호화가 지키지 못하는 것** — 기기 안의 DB는 여전히 평문입니다. IndexedDB에 그대로 있어 브라우저 프로필에 접근할 수 있으면 읽힙니다. PIN은 화면을 가리는 자물쇠일 뿐 데이터를 암호화하지 않고, AI 키도 localStorage에 평문입니다. **백업 암호화는 파일 하나만 지킵니다.**

### 4.6 백업과 복원의 범위

**백업 파일은 사용자별이 아니라 `.db` 파일 전체입니다**(`exportDatabaseBytes()` = `db.export()`). 그래서 복원은 **이 기기의 모든 사용자**를 파일에 든 사용자들로 바꿉니다 — 백업에 없던 사람은 가계부째 사라지고, 백업에 있던 사람은 **PIN 해시까지** 되살아나 그 계정으로 로그인할 수 있게 됩니다.

- 확인 문구에 **이 기기의 사용자 명단**을 넣어, 누구의 가계부가 사라지는지 이름으로 말합니다.
- 복원 뒤에는 **반드시 로그아웃**합니다. 세션은 메모리의 `currentUserId`를 들고 있는데 복원된 파일에 그 id가 없을 수 있고, 그러면 모든 조회가 `WHERE user_id = '없는 id'`가 되어 **0건**이 됩니다 — 데이터가 사라진 것처럼 보이는, 4.7·14.8과 같은 함정입니다.
- "한 사용자의 것만 다른 계정으로 옮기기"는 **지원하지 않습니다.** 필요해지면 내보낼 때 현재 사용자 행만 담고 가져올 때 `user_id`를 갈아 끼우는 별도 기능으로 만드세요. 전체 백업과 섞지 마세요.

### 4.7 열지 못했을 때 (데이터 손실 방지)

**빈 데이터베이스와 열지 못한 데이터베이스는 정반대의 뜻입니다.** 예전에는 둘을 같게 다뤄서, 읽기가 한 번 실패하면 앱이 조용히 빈 DB로 시작하고 → 사용자 0명이니 **첫 사용자 등록 화면**을 띄우고 → 거기서 뭔가를 입력하면 `finance.db` **같은 키에 덮어써서** 원본이 사라졌습니다. 읽기 실패 한 번이 곧 영구 손실이었습니다.

지금은 이렇게 동작합니다(`db/database.ts`).

- `idbRead()` 실패 → `DatabaseUnavailable`을 **던집니다.** 빈 DB로 내려가지 않습니다.
- 저장본은 있는데 `new SQL.Database(bytes)`가 실패(손상) → **원본 바이트를 `finance.db.unreadable` 키로 먼저 보관**한 뒤 던집니다. 열리지 않는다고 쓸모없는 것이 아닙니다 — 그 바이트가 사용자 가계부의 유일한 사본입니다.
- `persist()`는 `openFailure`가 설정돼 있으면 **아무것도 쓰지 않습니다.** 읽지 못한 것 위에 쓰지 않는다는 규칙을 마지막으로 한 번 더 지킵니다.
- 저장본이 **아예 없을 때만** 새 DB로 시작합니다. 그것이 진짜 첫 실행입니다.
- `FinanceContext`가 `dbError`로 내보내고, `App.tsx`의 `AppGuard`가 **전용 화면**을 띄웁니다 — 주소·포트를 확인하라는 안내와 `다시 시도`뿐이고, **쓰는 버튼은 하나도 없습니다.**

**실패를 삼키지 마세요.** 화면이 "0건"으로 보이면 사용자는 데이터가 사라졌다고 믿습니다. 실제로 그렇게 신고를 받았습니다(14.8).

### 4.8 저장 — 전부 아니면 전무, 그리고 실패를 말하기

`run()`/`runBatch()`는 쓰기 후 `scheduleSave()`로 IndexedDB 저장을 합칩니다(연속 쓰기를 한 번의 왕복으로). 개별 함수에서 `persist()`를 부를 필요가 없습니다.

- **`runBatch` 는 한 트랜잭션입니다**(`BEGIN`/`COMMIT`/`ROLLBACK`). 예전에는 트랜잭션 없이 순차 실행해서, 명세서 300건을 넣다가 중간에 실패하면 **절반만 적용된 채** 남고 다시 시도하면 앞쪽이 중복으로 들어갔습니다. 원자성이 있으면 **재시도가 안전해집니다** — 7.9가 이것에 기대고 있습니다.
  → 깊이(`batchDepth`)를 세어 **가장 바깥만** 트랜잭션을 엽니다. 안쪽에서 `BEGIN` 이 다시 불리면 오류가 납니다.
  → 되돌린 뒤에는 **저장하지 않습니다.** 메모리가 이미 저장된 상태와 같으므로 쓸 것이 없습니다.
- **`persist()` 는 세 번까지 다시 시도하고, 그래도 실패하면 말합니다.** 예전에는 `console.error` 한 줄로 끝났습니다 — 화면은 "등록 완료"를 보여 주는데 IndexedDB 에는 한 바이트도 쓰이지 않은 채(용량 초과·사생활 보호 모드·디스크 꽉 참) 다시 열면 그 작업이 전부 사라졌습니다. **메모리에 썼다는 것과 남았다는 것은 다른 사실입니다.**
  → `watchSaveFailure(listener)` 로 알리고, `FinanceContext.saveFailure` 를 거쳐 `App` 이 **닫을 수 없는 붉은 띠**를 띄웁니다. 그 띠가 떠 있는 동안의 입력은 남지 않으므로 닫게 두지 않습니다.
  → 다음 저장이 성공하면 띠가 내려갑니다.

### 4.9 되돌리기 (`services/undo.ts`)

삭제·분류 일괄 변경·예산 자동 배분은 **한 번에 수백 건**을 바꿉니다. 그런데 되돌릴 방법이 없어서, 잘못 눌렀다는 것을 알아차린 순간 할 수 있는 일이 아무것도 없었습니다.

- **역연산을 만들지 않습니다.** `카테고리 일괄 적용`의 역연산을 계산하려면 규칙·우선순위를 거꾸로 풀어야 하고, 그 계산이 틀리면 되돌리기가 **새 손상**이 됩니다. 대신 **바뀌기 전의 행을 그대로 적어 두고**(`undo_log.payload_json`) 되돌릴 때 다시 씁니다 — 계산이 없으므로 틀릴 것도 없습니다.
- 담는 네 가지: `DELETE_ENTRIES`(지운 거래) · `DELETE_ACCOUNT`(계좌 + 그 내역 + 규칙) · `RECLASSIFY`(바뀌기 전 분류) · `BUDGETS`(그 달 한도 전체).
- **복원도 한 배치입니다**(§4.8). 절반만 되돌아오면 되돌리기가 손상이 됩니다. 되돌린 뒤에는 무엇이 되살아났는지 알 수 없으므로 **전부 다시 읽습니다**.
- **보관 기간은 기본 7일**이고 `설정 → 기타 설정`에서 1~90일로 바꿉니다(§5). 앱을 열 때 지난 것을 치웁니다 — 임시 저장소가 백업 파일에 함께 실리므로(§4.6) 쌓이는 채로 두면 백업이 커집니다.
  → **날짜가 깨진 줄은 지우지 않습니다.** 판단할 수 없다는 이유로 없애지 않습니다(§17.3).
  → 경계를 **지난 것만** 골라냅니다(`expiredUndoIds`). 하루를 더 얹는 실수가 반복되는 자리라 함수로 떼어 검증합니다.
- **담아 둔 것이 비면 되돌릴 수 없다고 말합니다**(`canUndo`). 버튼을 눌렀는데 아무 일도 없는 것이 가장 나쁩니다.
- 되돌릴 수 있는 일을 묻는 확인 창은 그 사실을 함께 알립니다 — `설정 → 기타 설정에서 되돌릴 수 있습니다`. 결정의 무게가 달라집니다.

---

## 5. 인증과 사용자

- **최초 실행 시 사용자 0명** → 3단계 등록 화면(이름·연락처 → PIN → 확인).
- PIN은 **PBKDF2-HMAC-SHA256, 310,000회, 16바이트 랜덤 솔트**(`pinCrypto.ts`). 평문은 저장하지 않습니다.
- 로그인은 사용자 선택 → PIN 6자리. 사용자별로 **가계부가 완전히 분리**됩니다.
- 설정 메뉴: `연동된 카드 및 계좌관리` / **`사용자 관리`** / `AI 등록` / `'스마트 머니' 전용 앱 설치`(§13.2) / **`기타 설정`**(되돌리기 보관 기간과 최근 작업 — §4.9, 그리고 **데이터 점검** — §17.7). **비밀번호 변경은 설정 메뉴에 없습니다** — 사용자 관리 안에 있습니다. 한 사람의 이름·연락처·비밀번호를 한자리에서 다루는 편이 맞고, 같은 일을 두 곳에 두면 한쪽만 고쳐집니다.
- **사용자 관리**(`UserManageModal`)에서 추가·**수정**·삭제를 합니다. 수정은 등록 때 받는 것을 전부 바꿀 수 있습니다 — `이름`, `연락처`, `간편 비밀번호`. **`id`만 고정**이고, 가계부 전체가 그 값에 매달려 있기 때문입니다. 비밀번호 칸을 비워 두면 그대로 둡니다.
- **이름은 유일해야 합니다.** 로그인 화면에서 사람을 고르는 값이기 때문입니다. `repository.isNameTaken(name, exceptId)`가 최종 판정이고, 수정 화면은 **PIN을 받기 전에** 먼저 확인해 알려 줍니다 — 6자리를 다 누른 뒤에 "이미 쓰는 이름"이라고 하면 헛수고입니다.
- **비밀번호는 글자로 받지 않습니다.** 수정 화면의 `간편비밀번호 등록·변경` 버튼이 `PinSetupModal`을 띄우고, 거기서 키패드로 두 번 눌러 확인합니다. 이름·연락처와 **따로 저장**되므로 그 화면에서 바꾸면 `[변경 확인]`을 누르지 않아도 적용됩니다(`savePinHash(대상id, …)`가 세션이 아니라 넘긴 id에 씁니다).
- **수정은 두 단계입니다**: `입력` → `[변경 확인]` → `확인`(내 PIN). 확인 단계에서는 **입력 항목을 감추고** 무엇이 어떻게 바뀌는지(`이름 홍길동 → 일지매`)만 보여 줍니다 — 그 자리는 "이대로 저장할까"만 묻는 자리이고, 거기서 비밀번호를 바꾸러 나가는 길이 보이면 무엇을 확인하는 중인지 흐려집니다. 뒤로가기(`←`)는 **한 단계씩** 돌아갑니다(확인 → 입력 → 목록). 목록으로 튕기면 입력한 것이 사라집니다.
- **이름·연락처가 그대로면 `[변경 확인]`은 눌리지 않습니다.** 비밀번호는 이 판정에 넣지 않습니다 — 그쪽은 전용 화면에서 이미 저장됐으니 확인할 것이 남지 않습니다.
- **수정도 삭제와 같이 로그인한 사용자의 PIN을 받습니다**(`editUser`, `resetPin`). 대상 사용자는 그 자리에 없고, 남의 이름이나 비밀번호를 바꾸는 일은 삭제만큼 무거운 일입니다. `resetPin(targetId, newPin, authorizingPin)` 하나가 자기 것과 남의 것을 모두 처리합니다 — 자기 비밀번호를 바꿀 때 확인받는 "현재 비밀번호"가 곧 로그인한 사용자의 비밀번호라 같은 길입니다.
- **마지막 사용자도 지울 수 있습니다.** 사용자 0명은 이 앱이 정상으로 다루는 상태이고(첫 실행 등록 화면), 막을 기술적 이유가 없습니다. 대신 삭제 화면이 **"마지막 사용자입니다. 이 기기의 가계부가 전부 사라지고 첫 사용자 등록부터 다시 시작합니다"**라고 분명히 말합니다.
- **사용자를 지우면 그 사람의 것이 전부 지워집니다** — `user_id`를 가진 7개 테이블(`accounts`·`transactions`·`budgets`·`budget_configs`·`ai_analyses`·`category_rules`·`custom_categories`)과 `users` 행이 **한 번의 배치**로, 그리고 **그 사용자의 AI 키**(11.1)까지. 새 테이블에 `user_id`를 넣으면 `repository.deleteUser`에도 반드시 추가하세요.
- localStorage에 남는 것: 기억된 명세서 형식, 숨긴 알림. 둘 다 가계부 데이터가 아니고 사용자 구분이 없습니다.
- 카카오·토스·PASS·네이버 같은 외부 인증은 **개인 개발자가 쓸 수 없습니다**(사업자·심사 필요). PIN이 대안입니다.

---

## 8. 잔액과 기준일시

- 잔액은 **금액 + 기준일시(`0000년00월00일 00시`) + 출처(`USER`/`AUTO`)** 세 가지가 한 벌입니다. 계좌 등록 시에도, 수정 시에도 함께 받습니다.
- **기준일시 이전 거래는 잔액을 움직이지 않습니다.** 이미 그 금액에 반영돼 있기 때문입니다(`services/balance.ts`의 `movesBalance`).
- 통장: 입금 +, 출금 −. 카드: 사용 +, 환불 −.
- 가져오기 시 `현재 잔액 수정`을 체크하면 기준일시 이후 항목만 합산해 조정하고, 새 기준일시는 반영된 항목 중 가장 늦은 거래 시점, 출처는 `AUTO`가 됩니다.
- 카드의 **청구 예정액은 사용자가 입력하지 않습니다**(9.3 참조). 카드 행에는 수정 버튼이 없습니다.

---
