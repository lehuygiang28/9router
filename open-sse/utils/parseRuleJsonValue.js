/**
 * Parse body-rule values from the dashboard textarea.
 * Strict JSON only — safe for `"use client"` (no confbox / node: imports).
 * API string coercion with JSON5 fallback lives in coerceBodyRuleValue.server.js.
 */

/**
 * @param {string} text
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function parseRuleJsonText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { ok: false, error: "JSON value required" };

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, error: "Invalid JSON value" };
  }
}
