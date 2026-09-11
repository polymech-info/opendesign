import OpenAI from "openai";

/** Path on the OpenDesign API. The SDK needs an absolute URL. */
export const LLM_BASE_PATH = "/api/llm/v1";

export type LlmModel = {
  id: string;
  ownedBy?: string;
  isDefault?: boolean;
};

export function llmBaseURL(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:5174";
  return `${origin}${LLM_BASE_PATH}`;
}

export function createOpenAIClient(opts?: { sessionId?: string }): OpenAI {
  const headers: Record<string, string> = {};
  if (opts?.sessionId) headers["X-Tanit-Session"] = opts.sessionId;
  return new OpenAI({
    apiKey: "opend",
    baseURL: llmBaseURL(),
    dangerouslyAllowBrowser: true,
    defaultHeaders: headers,
  });
}

export async function listLlmModels(): Promise<LlmModel[]> {
  try {
    const res = await fetch(`${llmBaseURL()}/models`);
    if (!res.ok) return [];
    const body = (await res.json()) as {
      data?: Array<{ id?: string; owned_by?: string; tanit_is_default?: boolean }>;
    };
    return (body.data ?? [])
      .filter((m): m is { id: string; owned_by?: string; tanit_is_default?: boolean } => Boolean(m.id))
      .map((m) => ({
        id: m.id,
        ownedBy: m.owned_by,
        isDefault: Boolean(m.tanit_is_default),
      }));
  } catch {
    return [];
  }
}
