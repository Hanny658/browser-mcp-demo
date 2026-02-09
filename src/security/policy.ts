import fs from "fs/promises";
import path from "path";
import { config } from "../config.js";

const SENSITIVE_KEY_PATTERN = /(cookie|localstorage|sessionstorage|storagestate|userdata(dir)?|password|token|qr|private|message|dm|phone|email)/i;
const SENSITIVE_VALUE_PATTERN = /(cookie=|localstorage|sessionstorage|storagestate|userdata(dir)?|password|token)/i;

export function redactText(text: string): string {
  let output = text.replace(/\s+/g, " ").trim();
  output = output.replace(/\b1\d{10}\b/g, "[REDACTED_PHONE]");
  output = output.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  return output;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      const sanitized = sanitizeValue(val);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    return output;
  }
  return value;
}

export function sanitizeOutput<T>(value: T): T {
  return sanitizeValue(value) as T;
}

export function stringifyAndGuard(value: unknown): string {
  const sanitized = sanitizeOutput(value);
  const json = JSON.stringify(sanitized, null, 2);
  if (SENSITIVE_VALUE_PATTERN.test(json)) {
    console.error("[guard] sensitive output blocked:", json.slice(0, 1200));
    throw new Error("Sensitive data detected in output.");
  }
  return json;
}

export async function auditLog(
  action: string,
  sessionId: string,
  details?: { keyword?: string; noteUrl?: string }
): Promise<void> {
  const entry = {
    ts: new Date().toISOString(),
    sessionId,
    action,
    keyword: details?.keyword ? redactText(details.keyword).slice(0, 80) : undefined,
    noteUrl: details?.noteUrl ? redactText(details.noteUrl).slice(0, 200) : undefined
  };
  await fs.mkdir(path.dirname(config.auditLogPath), { recursive: true });
  await fs.appendFile(config.auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}
