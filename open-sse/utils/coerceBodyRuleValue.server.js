/**
 * Server/API-only coercion for body-rule values (JSON5 + strict JSON).
 * Do not import from client components — confbox is not browser-safe.
 */

import { parseJSON5 } from "confbox";
import { parseRuleJsonText } from "./parseRuleJsonValue.js";

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function coerceBodyRuleValue(value) {
  if (typeof value !== "string") {
    return { ok: true, value };
  }
  const strict = parseRuleJsonText(value);
  if (strict.ok) return strict;
  const trimmed = value.trim();
  try {
    return { ok: true, value: parseJSON5(trimmed) };
  } catch {
    return { ok: false, error: "Invalid JSON value" };
  }
}
