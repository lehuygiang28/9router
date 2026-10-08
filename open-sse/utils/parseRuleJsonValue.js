/**
 * Parse rule values edited as text (dashboard) or sent via API.
 * Uses confbox JSON5 (trailing commas, unquoted keys in objects) with strict JSON fallback.
 */

import { parseJSON5 } from "confbox";

/**
 * @param {string} text
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function parseRuleJsonText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, error: "JSON value required" };

  try {
    return { ok: true, value: parseJSON5(trimmed) };
  } catch {
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      return { ok: false, error: "Invalid JSON/JSON5 value" };
    }
  }
}

/**
 * Normalize a rule value from API JSON (already parsed) or legacy string payloads.
 * @param {unknown} value
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function coerceBodyRuleValue(value) {
  if (typeof value !== "string") {
    return { ok: true, value };
  }
  return parseRuleJsonText(value);
}
