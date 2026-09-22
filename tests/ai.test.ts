/**
 * AI 계층에서 **호출 없이 확인할 수 있는 것** (§11.1·11.2).
 *
 * 이 계층 1,367줄에 오래도록 세트가 없었습니다. 네트워크가 끼어 전부를 검증할
 * 수는 없지만, 값이 큰 두 가지는 순수합니다.
 *
 * 1. **스키마의 모양.** 세 공급자가 같은 스키마를 받는데 **가장 엄격한 쪽**을
 *    기준으로 써야 합니다 — 모든 속성이 `required` 에, 모든 객체에
 *    `additionalProperties: false`. 하나만 빠져도 그 공급자에서만 요청이
 *    거절되고, 그 사실은 그 공급자를 쓰는 사용자만 겪습니다.
 * 2. **재시도 간격.** 틀리면 **사용자의 할당량이 더 빨리 탑니다**(§11.2) — 빠른
 *    재시도는 남은 몫을 태울 뿐 아무것도 낫게 하지 않습니다.
 */
import {
  ANALYSIS_SCHEMA,
  SMS_SCHEMA,
  MAPPING_SCHEMA,
  classifySchema,
} from "../src/services/aiClient";
import {
  backoffFor,
  describeAiFailure,
  isRateLimited,
  RETRY_ATTEMPTS,
} from "../src/services/ai";
import type { JsonSchema } from "../src/services/ai";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

/** 스키마 안의 모든 객체를 훑습니다 — 배열 안에 든 것까지. */
function objectsIn(schema: JsonSchema, path = "root"): [string, JsonSchema][] {
  const found: [string, JsonSchema][] = [];
  if (!schema || typeof schema !== "object") return found;

  if (schema.type === "object") found.push([path, schema]);
  for (const [key, child] of Object.entries(schema.properties || {})) {
    found.push(...objectsIn(child as JsonSchema, `${path}.${key}`));
  }
  if (schema.items) found.push(...objectsIn(schema.items as JsonSchema, `${path}[]`));
  return found;
}

const SCHEMAS: [string, JsonSchema][] = [
  ["분석", ANALYSIS_SCHEMA],
  ["문자", SMS_SCHEMA],
  ["열 인식", MAPPING_SCHEMA],
  ["자동 분류", classifySchema(["식비", "교통"]) as JsonSchema],
];

// ---------------------------------------------------------------------------
section("스키마는 가장 엄격한 공급자 기준으로 씁니다 (§11.1)");
// ---------------------------------------------------------------------------
{
  for (const [name, schema] of SCHEMAS) {
    const objects = objectsIn(schema);
    check(`${name} — 객체가 있습니다`, objects.length > 0, objects.length);

    /*
      ChatGPT 의 strict json_schema 는 **모든 속성이 `required` 에** 있어야 하고
      **모든 객체에 `additionalProperties: false`** 가 있어야 받습니다. 빠지면
      그 공급자에서만 400 이 납니다.
    */
    for (const [path, node] of objects) {
      const properties = Object.keys(node.properties || {});
      const required = (node.required || []) as string[];
      check(
        `${name} ${path} — 모든 속성이 required`,
        properties.every((key) => required.includes(key)),
        { properties, required }
      );
      check(
        `${name} ${path} — additionalProperties: false`,
        node.additionalProperties === false,
        node.additionalProperties
      );
    }
  }
}

// ---------------------------------------------------------------------------
section("자동 분류 스키마는 그 사용자의 카테고리를 담습니다 (§6.1)");
// ---------------------------------------------------------------------------
{
  /*
    사용자가 만든 카테고리도 값이 됩니다. 기본 목록만 넣으면 AI 가 그 이름을
    돌려줄 수 없어, 직접 만든 카테고리에는 한 건도 분류되지 않습니다.
  */
  const mine = classifySchema(["식비", "교통", "내가 만든 것"]) as JsonSchema;
  const text = JSON.stringify(mine);
  check("직접 만든 이름이 들어갑니다", text.includes("내가 만든 것"));
  check("기본 이름도 함께", text.includes("식비") && text.includes("교통"));

  /* 카테고리가 하나도 없어도 스키마는 만들어져야 합니다 */
  const none = classifySchema([]) as JsonSchema;
  check("빈 목록에도 모양이 있습니다", none.type === "object", none.type);
}

// ---------------------------------------------------------------------------
section("재시도 간격 — 틀리면 할당량이 더 빨리 탑니다 (§11.2)");
// ---------------------------------------------------------------------------
{
  check("시도 횟수는 4", RETRY_ATTEMPTS === 4, RETRY_ATTEMPTS);

  const busy = new Error("503 Service Unavailable: model is overloaded");
  const limited = new Error("429 RESOURCE_EXHAUSTED: rate limit exceeded");

  check("혼잡은 한도가 아닙니다", isRateLimited(busy) === false);
  check("429 는 한도", isRateLimited(limited) === true);
  check("quota 도 한도", isRateLimited(new Error("insufficient_quota")) === true);

  /*
    혼잡은 초 단위로 풀리고 한도는 창이 넘어가야 풀립니다. 그래서 **한도 쪽이
    훨씬 길어야** 합니다 — 짧게 두면 남은 몫을 더 빨리 태웁니다.
  */
  const busyWait = backoffFor(busy, 1);
  const limitWait = backoffFor(limited, 1);
  check("혼잡은 1.2초 언저리", busyWait >= 1200 && busyWait <= 1700, busyWait);
  check("한도는 15초 언저리", limitWait >= 15000 && limitWait <= 21000, limitWait);
  check("한도가 훨씬 깁니다", limitWait > busyWait * 5, { busyWait, limitWait });

  /* 시도할수록 벌어집니다 */
  const first = backoffFor(busy, 1);
  const third = backoffFor(busy, 3);
  check("회를 거듭하면 길어집니다", third > first, { first, third });

  /* 아무리 길어도 1분을 넘지 않습니다 — 넘으면 멈춘 것처럼 보입니다 */
  check("위쪽으로 막혀 있습니다", backoffFor(busy, 10) <= 60000, backoffFor(busy, 10));
  check("한도도 마찬가지", backoffFor(limited, 10) <= 60000);

  /*
    **공급자가 말해 준 시간이 우선입니다.** 구글은 본문에 `retryDelay: "31s"` 를
    넣고 나머지는 `Retry-After` 를 답니다 — 짐작보다 그쪽이 맞습니다.
  */
  const asked = backoffFor(new Error('429 { "retryDelay": "31s" }'), 1);
  check("retryDelay 를 따릅니다", asked === 31500, asked);

  const after = backoffFor(new Error("429 Too Many Requests, retry-after: 20"), 1);
  check("Retry-After 도 따릅니다", after === 20500, after);

  check(
    "말해 준 시간도 1분을 넘지 않습니다",
    backoffFor(new Error('429 { "retryDelay": "600s" }'), 1) === 60000
  );
}

// ---------------------------------------------------------------------------
section("실패는 한국어로 옮깁니다 — 원문 JSON 을 보여 주지 않습니다 (§11.2)");
// ---------------------------------------------------------------------------
{
  const said = (message: string) => describeAiFailure(new Error(message)).message;

  check("키 오류", said("API_KEY_INVALID").includes("AI 키"), said("API_KEY_INVALID"));
  check("401 도 키 오류", said("401 Unauthorized").includes("AI 키"));
  check(
    "모델명 오류",
    said("404 model gpt-9 not found").includes("모델 이름"),
    said("404 model gpt-9 not found")
  );
  check("혼잡", said("503 overloaded").includes("혼잡"));
  check("한도", said("429 RESOURCE_EXHAUSTED").includes("한도"));
  check("지연", said("DEADLINE_EXCEEDED").includes("지연"));
  check("네트워크", said("Failed to fetch").includes("네트워크"));
  check("서버 오류", said("500 INTERNAL").includes("일시적인 문제"));

  /*
    키 오류·모델명 오류·한도는 **배치를 반복해도 낫지 않습니다.** 그래서 안내가
    "잠시 후 다시"가 아니라 무엇을 고치라고 말해야 합니다.
  */
  check("키 오류는 고칠 곳을 말합니다", said("401").includes("설정"));
  check("모델명도", said("model not found").includes("설정"));

  /* 아는 모양이 아니면 원문을 그대로 두되, 빈 값에는 기본 문구를 씁니다 */
  check("모르는 오류는 그대로", said("알 수 없는 문제") === "알 수 없는 문제");
  check("빈 오류에도 말은 합니다", said("").length > 0);
  check("Error 가 아니어도", describeAiFailure("그냥 글자").message.length > 0);
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.log(`\n${failures.join("\n")}`);
  console.log(`\n${failures.length}개 실패 · ${passed}개 확인`);
  process.exit(1);
}
console.log(`\nALL PASS — ${passed}개 확인`);
