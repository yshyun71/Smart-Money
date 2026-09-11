import Anthropic from "@anthropic-ai/sdk";
import type { AiAdapter, CallContext, JsonRequest, TextRequest } from "./providers";
import { parseJsonLoosely } from "./providers";

/**
 * Claude, called straight from the device.
 *
 * `dangerouslyAllowBrowser` is required for browser use and makes the SDK send
 * the direct-browser-access header CORS needs. The name is a warning about
 * shipping a shared key to end users — here the key belongs to the person
 * holding the phone and never leaves it, which is the case it is meant for.
 */
const MAX_TOKENS = 16000;

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/**
 * Structured output comes back through a strict tool rather than a forced
 * tool_choice: the newest Claude models reject `tool_choice` of `any`/`tool`,
 * so the tool is offered with `auto` and the instruction names it. `strict`
 * still guarantees the arguments match the schema.
 */
export const anthropicAdapter: AiAdapter = {
  async generateJson(request: JsonRequest, { apiKey, model }: CallContext) {
    const toolName = request.schemaName;

    const response = await client(apiKey).messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: request.system,
      // Bulk classification is a simple, high-volume task
      ...(request.bulk ? { output_config: { effort: "low" as const } } : {}),
      tools: [
        {
          name: toolName,
          description: "분석 결과를 이 스키마에 맞춰 전달합니다.",
          input_schema: request.schema as never,
          strict: true,
        },
      ],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: `${request.prompt}\n\n결과는 반드시 \`${toolName}\` 도구를 호출해서 전달하세요. 설명 문장은 쓰지 마세요.`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error(
        "Claude가 이 요청에 응답하지 않았습니다. 내용을 조정하거나 다른 모델을 사용해보세요."
      );
    }

    const toolUse = response.content.find(
      (block) => block.type === "tool_use" && block.name === toolName
    );
    if (toolUse && toolUse.type === "tool_use") {
      return toolUse.input;
    }

    // Some models answer in prose even when a tool is offered
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    return parseJsonLoosely(text);
  },

  async generateText(request: TextRequest, { apiKey, model }: CallContext) {
    const response = await client(apiKey).messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Claude가 이 요청에 응답하지 않았습니다.");
    }

    return response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
  },
};
