import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * 규칙을 좁게 씁니다.
 *
 * `tsc` 가 못 보는 것만 봅니다 — 훅 규칙과, 쓰지 않는 코드입니다. 취향에 관한
 * 규칙(따옴표·세미콜론·정렬)은 넣지 않았습니다: 이 저장소에는 포맷을 다투는
 * 사람이 없고, 경고가 많아지면 정작 중요한 것이 묻힙니다.
 *
 * **훅 규칙을 넣은 까닭**은 겪어서입니다. `useEffect` 의 의존성을 잘못 잡아
 * 예산 화면이 이전 달 값을 보여 준 일이 두 번 있었고(§14.7), 둘 다 사람 눈으로
 * 찾았습니다. 기계가 먼저 말해 주는 편이 낫습니다.
 */
export default tseslint.config(
  { ignores: ["dist", "dev-dist", "node_modules", "DB Backup"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /*
        `any` 는 경고로 둡니다.

        `@types/react` 가 없던 동안 컴포넌트가 `any` 로 흘렀고, 그 자리를 아직
        다 걷어내지 못했습니다(33곳). 오류로 두면 지금 당장 전부 고쳐야 하므로,
        남은 빚이 보이게만 해 둡니다.
      */
      "@typescript-eslint/no-explicit-any": "warn",

      /* 쓰지 않는 것은 지웁니다. `_` 로 시작하면 일부러 둔 것으로 봅니다 */
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      /* 빈 블록은 대개 삼킨 오류입니다 — 주석이 있으면 일부러 둔 것으로 봅니다 */
      "no-empty": ["error", { allowEmptyCatch: false }],

      /*
        **`set-state-in-effect` 는 끕니다.**

        이 앱에는 그 패턴이 **필요합니다.** 컨텍스트에서 비동기로 도착한 값을
        입력칸에 싣는 일이 그것인데(§14.7), 그렇게 하지 않으면 월을 옮겨도
        칸이 바뀌지 않습니다 — 실제로 두 번 겪은 사고입니다. 33곳이 전부
        그 종류라 켜 두면 정작 중요한 경고가 묻힙니다.
      */
      "react-hooks/set-state-in-effect": "off",

      /*
        렌더 중에 컴포넌트를 만드는 것은 진짜 문제이지만(상태가 초기화됩니다),
        지금 걸리는 세 곳은 등록 화면의 작은 조각들이라 한 번에 고치기보다
        보이게 둡니다.
      */
      "react-hooks/static-components": "warn",

      /*
        `Date.now`·`Math.random` 을 렌더 중에 부르지 말라는 규칙입니다. 걸린
        두 곳은 **사용자가 누를 때 도는 함수** 안이라 렌더가 아닙니다 —
        규칙이 호출 시점을 알 수 없어 생기는 경고이므로 낮춥니다.
      */
      "react-hooks/purity": "warn",

      /*
        **`preserve-manual-memoization` 은 끕니다.**

        React Compiler 가 기존 `useMemo`·`useCallback` 을 그대로 보존할 수
        있는지 알려 주는 진단입니다. 이 프로젝트는 컴파일러를 쓰지 않으므로
        (`@vitejs/plugin-react` 기본 설정) 고칠 대상이 없고, 컨텍스트의 메모
        하나를 건드릴 때마다 열 줄씩 쏟아집니다. 컴파일러를 켜는 날 다시
        켜세요 — 그때는 실제로 뜻이 있는 경고입니다.
      */
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    /* 테스트는 의도적으로 느슨한 타입을 씁니다 — 형식을 흉내내는 것이 일입니다 */
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  }
);
