# 세우기 — 빈 폴더에서 이 앱까지

> [CLAUDE.md](../CLAUDE.md) 묶음의 **부록**입니다. **절 번호를 일부러 붙이지 않았습니다** — `§4` 같은 번호는 소스 주석 312곳이 가리키는 이름이라, 여기에 같은 번호를 두면 읽는 사람이 엉뚱한 곳에 닿습니다.

이 문서는 **다시 만드는 사람을 위한 순서**입니다. 나머지 문서가 "왜 그렇게 되어 있는가"를 적는다면, 여기는 "무엇부터 놓는가"를 적습니다.

---

## 의존성

```bash
npm create vite@latest smart-money -- --template react-ts
cd smart-money
```

그다음 아래를 그대로 맞춥니다. **버전을 올릴 때도 `xlsx` 만은 반드시 이 URL 을 쓰세요** — npm 레지스트리의 `xlsx@0.18.5` 에는 미패치 취약점 2건이 있고 npm 에는 수정판이 없습니다.

```jsonc
// package.json
{
  "name": "smart-money",
  "version": "1.1.0",
  "type": "module",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.125.0",
    "@google/genai": "^2.4.0",
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^5.0.4",
    "lucide-react": "^0.546.0",
    "qrcode": "^1.5.4",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "recharts": "^3.10.1",
    "sql.js": "^1.14.2",
    "vite": "^6.2.3",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^22.14.0",
    "@types/qrcode": "^1.5.6",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@types/sql.js": "^1.4.11",
    "eslint": "^10.11.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.23.13",
    "typescript": "~5.8.2",
    "typescript-eslint": "^8.70.1",
    "vite-plugin-pwa": "^1.3.0"
  }
}
```

**락파일은 `package-lock.json` 하나만** 둡니다. `bun.lock` 이 함께 있던 때, 호스팅 빌드가 어느 쪽을 잡느냐에 따라 이미 지운 서버 의존성(`express`·`dotenv`)으로 설치가 흘러간 적이 있습니다.

**`@types/react` 를 빠뜨리지 마세요.** 이 저장소는 오랫동안 그것 없이 굴러갔고, 그동안 컴포넌트 계층(코드의 60%)이 타입 검사 밖에 있었습니다. 나중에 설치했을 때 **여섯 곳에서 실제 버그가 드러났습니다**(§14.1).

---

## 스크립트

```jsonc
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "lint": "tsc --noEmit && eslint src tests",
  "test": "tsx tests/statements.test.ts && tsx tests/cardlink.test.ts && … && tsx tests/core.test.ts",
  "check": "npm run lint && npm test"
}
```

`test` 는 16개 파일을 `&&` 로 이어 붙인 한 줄입니다(§15). 러너를 두지 않은 이유는 — 각 파일이 스스로 `process.exit(1)` 하고 통과 수를 세므로 러너가 해 줄 일이 없고, 의존성이 하나 줄기 때문입니다.

---

## 설정 파일

### `vite.config.ts` — 네 가지가 중요합니다

```ts
export default defineConfig(() => ({
  // (1) 빌드 시각을 번들에 박습니다 — 기기에서 "이 고침이 반영됐나"를 볼 유일한 방법
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },

  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // (2) wasm 을 빼면 오프라인에서 DB 를 못 엽니다. 기본 패턴에 없습니다
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        id: '/', start_url: '/', scope: '/',
        name: '스마트 머니 - 자동 가계부 & 지출 절약',
        short_name: '스마트 머니',
        theme_color: '#10B981', background_color: '#F8FAFC',
        display: 'standalone', orientation: 'portrait',
        // (3) 문자 앱의 '공유'로 받기 — GET 이라 서비스 워커 코드가 필요 없습니다 (§7.8)
        share_target: {
          action: '/', method: 'GET',
          params: { title: 'share_title', text: 'share_text', url: 'share_url' },
        },
        icons: [/* 192 any · 512 any · 512 maskable */],
      },
      devOptions: { enabled: true },
    }),
  ],

  server: {
    // (4) 포트는 데이터의 일부입니다 — IndexedDB 는 출처별로 갈리고 포트가 출처입니다 (§14.8)
    port: 3000,
    strictPort: true,
  },
}));
```

넷 다 빼면 **조용히** 깨집니다. `wasm` 이 빠지면 오프라인에서 화면은 뜨는데 로딩에서 멈추고, 포트가 바뀌면 빈 가계부가 열려 데이터가 사라진 것처럼 보입니다.

### `eslint.config.js` — 좁게

`tsc` 가 못 보는 것만 봅니다(§14.9). 취향 규칙(따옴표·세미콜론·정렬)은 넣지 않습니다 — 경고가 많아지면 중요한 것이 묻힙니다.

| 규칙 | 설정 | 까닭 |
| --- | --- | --- |
| `react-hooks/*` | recommended | 의존성을 잘못 잡아 예산 화면이 이전 달을 보여 준 일이 **두 번**(§14.7) |
| `@typescript-eslint/no-unused-vars` | error (`^_` 예외) | 첫 실행에서 죽은 코드 33곳, 그 안에 **지어낸 숫자**가 있었습니다 |
| `@typescript-eslint/no-explicit-any` | **warn** | 남은 빚을 보이게만. 지금 24곳(대부분 SQL 행) |
| `no-empty` | error (catch 포함) | 빈 블록은 대개 삼킨 오류입니다 |
| `react-hooks/set-state-in-effect` | **off** | 이 앱에는 그 패턴이 **필요합니다**(§14.7). 켜면 중요한 경고가 묻힙니다 |
| `react-hooks/preserve-manual-memoization` | **off** | 의도적인 좁은 의존성을 전부 경고합니다 |

### `wrangler.jsonc`

```jsonc
{
  "name": "smart-money",
  "compatibility_date": "2026-09-10",
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" }
}
```

`single-page-application` 이 아니면 새로고침 시 404 가 납니다.

### `.gitignore` — 모양으로 거릅니다

```
node_modules/ · dist/ · dev-dist/ · coverage/ · *.log · .env*
finance.db · DB Backup/ · *.db · *.sqlite · *.smbk     ← 실제 가계부
*.smuser                                               ← 사용자 한 명의 가계부
*.docx · *.pptx · *.xlsx                                ← 보고서·명세서 샘플
```

**이름이 아니라 모양으로** 거릅니다. 백업 `.db` 가 공개 저장소에 올라간 일이 실제로 있었고, 다음 파일은 다른 이름일 것이기 때문입니다.

### `.github/workflows/check.yml`

`main` 푸시와 PR 마다 `npm ci` → `npm run check` → `npm run build`. "커밋 전에 돌린다"는 규칙은 사람이 기억해야 하고, 언젠가 잊힙니다.

---

## 만드는 순서

의존 관계가 순서를 정합니다. 앞의 것이 없으면 뒤의 것을 만들 수 없습니다.

| # | 단계 | 만드는 것 | 문서 |
| --- | --- | --- | --- |
| 1 | 뼈대 | Vite·Tailwind·PWA 설정, `index.html`, `main.tsx`, `ErrorBoundary` | 이 문서 |
| 2 | 타입 | `types/finance.ts`, `constants/categories.ts` | [DATA](DATA.md) §4.4 · [DOMAIN](DOMAIN.md) §6.1 |
| 3 | DB | `db/schema.ts`(v1 스키마 + `migrate` + 자가복구) → `db/database.ts` → `db/repository.ts` | [DATA](DATA.md) §4 |
| 4 | 인증 | `AuthContext`, `pinCrypto`, 등록 3단계, PIN 화면 | [DATA](DATA.md) §5 |
| 5 | 상태 | `FinanceContext` — 읽기·쓰기·파생값의 중심 | [CLAUDE.md](../CLAUDE.md) §3 · §17.5 |
| 6 | 순수 로직 | `categoryRules` → `recurrence` → `balance` → `actuals` → `cardLink` | [DOMAIN](DOMAIN.md) · [IMPORT](IMPORT.md) §9 |
| 7 | 가져오기 | `csvImport` → `statementFormats` → `importQueue` → `CsvImportModal` | [IMPORT](IMPORT.md) §7 |
| 8 | 화면 | 하단 5탭 → 계좌 내역 → 거래 추가·수정 → 나머지 모달 | [UI](UI.md) §12 |
| 9 | 예산·분석 | `budgetPolicy` · `budgetStatus` · `history` · `trend` → 해당 화면 | [DOMAIN](DOMAIN.md) §11 |
| 10 | AI | `services/ai/`(어댑터) → `aiClient`(스키마) → AI 화면 | [DOMAIN](DOMAIN.md) §11.1~11.3 |
| 11 | 지키기 | `validate` · `integrity` · `undo` · `backupCrypto` · 데이터 점검 | [DATA](DATA.md) §4.5·§4.9 · §17.7 |
| 12 | 배포 | `wrangler.jsonc`, GitHub Actions, Cloudflare 연결 | [UI](UI.md) §13 |

**3번과 6번 사이에 회귀 세트를 시작하세요.** 나중에 붙이면 이미 굳은 동작을 거꾸로 따라 적게 되고, 그때는 틀린 것도 함께 굳습니다 — 실제로 DB 계층이 오래 그 상태였습니다(§15).

---

## 처음 실행했을 때 보여야 하는 것

제대로 세웠다면 `npm run dev` → `http://localhost:3000` 에서 이 순서가 나옵니다.

1. **첫 사용자 등록 화면** — 사용자가 0명이기 때문입니다. 이것이 안 나오고 목록이 나오면 DB 가 비어 있지 않은 것입니다.
2. 이름·연락처 → PIN 6자리 → 확인
3. **홈 화면에 네 걸음 안내** — 카드·계좌 등록 → 명세서 가져오기 → 고정비 가려내기 → 예산 정하기(§12.11)
4. `카드·계좌` 탭의 DB 카드에 **빌드 시각**과 `0건`

DB 카드가 `0건` 이고 저장 크기가 100KB 안팎이면 갓 만들어진 빈 DB 입니다. **데이터가 안 보인다는 신고를 받으면 주소창의 포트부터 확인하세요**(§14.8).

---

## 배포

```
Cloudflare Pages/Workers
  Build command   npm run build
  Deploy command  npx wrangler deploy
  NODE_VERSION    22
```

GitHub `main` 에 푸시하면 1~3분 뒤 배포됩니다. **배포되는 것은 `dist/` 뿐**이고, 그 안에 들어가는 것은 번들 결과물과 `public/` 을 그대로 복사한 것뿐입니다 — `public/` 에 둔 것은 주소만 알면 누구나 내려받습니다(§13.1).

- 반드시 **루트 경로**로 서빙합니다. 매니페스트의 `start_url`·`scope` 가 `/` 이고 서비스 워커가 그 범위를 잡습니다.
- 서비스 워커는 HTTPS 또는 localhost 에서만 동작합니다.
- **주소를 바꾸면 데이터가 따라오지 않습니다** — IndexedDB 는 출처별로 갈립니다(§14.8). 옮기려면 백업·복원을 거쳐야 합니다.
