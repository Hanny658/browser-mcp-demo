import OpenAI from "openai";
import { config } from "../config.js";
import { sanitizeOutput } from "../security/policy.js";

export class AgentNarrator {
  private client?: OpenAI;

  constructor() {
    if (config.openaiApiKey) {
      this.client = new OpenAI({ apiKey: config.openaiApiKey });
    }
  }

  async summarize(input: {
    action: string;
    state: string;
    outcome: string;
    detail?: Record<string, unknown> | undefined;
  }): Promise<string> {
    const fallback = `${input.action} -> ${input.outcome}`;
    if (!this.client) return fallback;

    const safeInput = sanitizeOutput(input);
    const prompt = [
      "Summarize this agent step for a UI log.",
      "Return 1-2 short sentences.",
      "Do NOT include chain-of-thought or sensitive data.",
      `Step: ${JSON.stringify(safeInput)}`
    ].join("\n");

    try {
      const response = await this.client.responses.create({
        model: config.openaiModel,
        input: prompt
      });
      const text = response.output_text?.trim();
      return text && text.length > 0 ? text : fallback;
    } catch {
      return fallback;
    }
  }
}
