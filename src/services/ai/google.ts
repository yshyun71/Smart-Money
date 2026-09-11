import { GoogleGenAI } from "@google/genai";
import type {
  AiAdapter,
  CallContext,
  JsonRequest,
  JsonSchema,
  TextRequest,
} from "./providers";
import { parseJsonLoosely } from "./providers";

/**
 * Google's schema dialect uses upper-case type names and has no
 * `additionalProperties`, so the shared JSON Schema is translated on the way in.
 */
function toGoogleSchema(schema: JsonSchema): Record<string, unknown> {
  const converted: Record<string, unknown> = {
    type: schema.type.toUpperCase(),
  };

  if (schema.description) converted.description = schema.description;
  if (schema.enum) converted.enum = schema.enum;
  if (schema.items) converted.items = toGoogleSchema(schema.items);

  if (schema.properties) {
    converted.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        toGoogleSchema(value),
      ])
    );
  }
  if (schema.required) converted.required = schema.required;

  return converted;
}

function client(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

export const googleAdapter: AiAdapter = {
  async generateJson(request: JsonRequest, { apiKey, model }: CallContext) {
    const response = await client(apiKey).models.generateContent({
      model,
      contents: request.prompt,
      config: {
        systemInstruction: request.system,
        responseMimeType: "application/json",
        responseSchema: toGoogleSchema(request.schema) as never,
      },
    });
    return parseJsonLoosely(response.text || "{}");
  },

  async generateText(request: TextRequest, { apiKey, model }: CallContext) {
    const response = await client(apiKey).models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      config: { systemInstruction: request.system },
    });
    return response.text || "";
  },
};
