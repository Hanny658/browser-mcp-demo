import OpenAI from "openai";
import { config } from "../config.js";
import type { SiteId } from "../sites/types.js";

export type KeywordResult = {
  queries: string[];
  method: "model" | "fallback";
  reason?: string;
};

const normalizeQuery = (value: string) => value.replace(/\s+/g, " ").trim();

export class AgentKeyworder {
  private client?: OpenAI;

  constructor() {
    if (config.openaiApiKey) {
      this.client = new OpenAI({ apiKey: config.openaiApiKey });
    }
  }

  async extract(query: string, site?: SiteId): Promise<KeywordResult> {
    const base = normalizeQuery(query);
    if (!this.client) {
      return { queries: base ? [base] : [], method: "fallback", reason: "no_api_key" };
    }

    const targetLanguage = site === "xhs" ? "Chinese" : "English";
    const prompt = [
      "You are a search keyword extractor that identifies the intent of a user query.",
      "Return JSON only.",
      "Output schema: {\"queries\": [\"...\"]}.",
      "Rules:",
      "- Return 1-3 short search queries.",
      `- Always use ${targetLanguage} regardless of the input language.`,
      "- Keep location, cuisine, price, and key intent.",
      "- Avoid punctuation; keep concise.",
      `User query: ${base}`
    ].join("\n");

    try {
      const response = await this.client.responses.create({
        model: config.openaiModel,
        input: prompt,
        text: { format: { type: "json_object" } }
      });
      const text = response.output_text?.trim() ?? "";
      if (!text) {
        console.warn("[keyworder] fallback: empty output_text");
        return { queries: base ? [base] : [], method: "fallback", reason: "empty_output" };
      }
      const parsed = JSON.parse(text) as { queries?: unknown };
      const queries = Array.isArray(parsed.queries)
        ? parsed.queries.map((item) => normalizeQuery(String(item))).filter(Boolean)
        : [];
      if (queries.length > 0) {
        return { queries: queries.slice(0, 3), method: "model" };
      }
      console.warn("[keyworder] fallback: empty queries array");
      return { queries: base ? [base] : [], method: "fallback", reason: "empty_queries" };
    } catch (err) {
      const e = err as {
        status?: number;
        name?: string;
        message?: string;
        code?: string;
        type?: string;
        error?: { message?: string; type?: string; code?: string };
        request_id?: string;
        requestId?: string;
      };
      const status = e.status ?? "unknown";
      const code = e.code ?? e.error?.code ?? "unknown";
      const type = e.type ?? e.error?.type ?? "unknown";
      const message = e.message ?? e.error?.message ?? String(err);
      const requestId = e.request_id ?? e.requestId ?? "unknown";
      console.warn(
        `[keyworder] fallback: api_error (status=${status} type=${type} code=${code} request=${requestId}) ${String(
          message
        ).slice(0, 200)}`
      );
      return { queries: base ? [base] : [], method: "fallback", reason: "api_error" };
    }
  }
}
