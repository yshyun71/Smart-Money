import type { AiAdapter, CallContext, JsonRequest, TextRequest } from "./providers";
import { parseJsonLoosely } from "./providers";

/**
 * ChatGPT over the Chat Completions endpoint.
 *
 * No SDK: the official package pulls in a large Node-oriented surface for what
 * is one HTTP call here, and the browser needs nothing it provides. Structured
 * output uses `json_schema` in strict mode, which is why every schema in this
 * app lists all properties as required with `additionalProperties: false`.
 */
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

interface ChatChoice {
  message?: { content?: string | null; refusal?: string | null };
}

interface ChatResponse {
  choices?: ChatChoice[];
  error?: { message?: string; code?: string; type?: string };
}

async function call(
  body: Record<string, unknown>,
  apiKey: string
): Promise<ChatResponse> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  let payload: ChatResponse = {};
  try {
    payload = (await response.json()) as ChatResponse;
  } catch {
    /* a non-JSON body is reported from the status below */
  }

  if (!response.ok) {
    const detail = payload.error?.message || response.statusText;
    // Carry the status so the shared retry logic can recognise it
    throw new Error(`${response.status} ${detail}`);
  }

  return payload;
}

function readMessage(payload: ChatResponse): string {
  const choice = payload.choices?.[0];
  if (choice?.message?.refusal) {
    throw new Error(`ChatGPT가 요청을 거부했습니다: ${choice.message.refusal}`);
  }
  return choice?.message?.content || "";
}

export const openaiAdapter: AiAdapter = {
  async generateJson(request: JsonRequest, { apiKey, model }: CallContext) {
    const payload = await call(
      {
        model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
      },
      apiKey
    );

    return parseJsonLoosely(readMessage(payload));
  },

  async generateText(request: TextRequest, { apiKey, model }: CallContext) {
    const payload = await call(
      {
        model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
      },
      apiKey
    );

    return readMessage(payload);
  },
};
