/**
 * Per-custom-provider request body transforms (set / remove / merge by dot path).
 * Applied after translation and executor transformRequest (incl. json_schema fallback).
 *
 * Stored rule `value` is always a JSON value (string | number | boolean | null | object | array)
 * after API normalization — not a stringified JSON blob. The dashboard edits values as text and
 * parses with parseRuleJsonText (JSON) before PUT.
 */
import { coerceBodyRuleValue } from "./coerceBodyRuleValue.server.js";

export const MAX_BODY_RULES = 30;
export const MAX_BODY_VALUE_JSON_CHARS = 32_768;

const PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const REMOVE_OPS = new Set(["remove", "delete"]);

export function isCustomCompatibleProvider(provider) {
  return typeof provider === "string"
    && (provider.startsWith("openai-compatible-") || provider.startsWith("anthropic-compatible-"));
}

function splitPath(path) {
  return path.split(".").filter(Boolean);
}

function getParent(obj, parts) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cur[key];
    if (isPlainObject(next)) {
      cur = next;
      continue;
    }
    if (next != null) {
      // Path crosses a non-object (array, primitive) — cannot descend safely.
      return cur;
    }
    const created = {};
    cur[key] = created;
    cur = created;
  }
  return cur;
}

function assignAtPath(obj, path, value, { mergeObjects }) {
  const parts = splitPath(path);
  if (!parts.length) return;
  const parent = getParent(obj, parts);
  const leaf = parts[parts.length - 1];
  const existing = parent[leaf];
  if (mergeObjects && isPlainObject(existing) && isPlainObject(value)) {
    parent[leaf] = deepMerge(existing, value);
  } else {
    parent[leaf] = value;
  }
}

function setAtPath(obj, path, value) {
  // Partial object `set` patches the subtree so sibling/nested fields are kept.
  assignAtPath(obj, path, value, { mergeObjects: true });
}

function removeAtPath(obj, path) {
  const parts = splitPath(path);
  if (!parts.length) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cur == null || typeof cur !== "object") return;
    cur = cur[key];
  }
  if (cur && typeof cur === "object") delete cur[parts[parts.length - 1]];
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function mergeAtPath(obj, path, value) {
  assignAtPath(obj, path, value, { mergeObjects: true });
}

/**
 * @param {object} body
 * @param {Array<{ path: string, op?: string, value?: unknown }>} rules
 */
export function applyBodyRules(body, rules) {
  if (!body || typeof body !== "object" || !rules?.length) return body;
  let out = body;
  for (const rule of rules) {
    const path = rule?.path?.trim();
    if (!path || !PATH_RE.test(path)) continue;
    let op = rule.op || "set";
    if (op === "delete") op = "remove";
    if (op === "remove") {
      removeAtPath(out, path);
      continue;
    }
    if (op === "merge") {
      mergeAtPath(out, path, rule.value);
      continue;
    }
    if (op === "set") {
      setAtPath(out, path, rule.value);
    }
  }
  return out;
}

/**
 * @param {object} body
 * @param {{ body?: Array, options?: { jsonSchemaFallback?: boolean } }} override
 * @param {string} provider
 */
export function applyProviderBodyOverrides(body, override, provider) {
  if (!isCustomCompatibleProvider(provider)) return body;
  const rules = override?.body;
  if (!rules?.length) return body;
  const cloned = structuredClone(body);
  return applyBodyRules(cloned, rules);
}

/**
 * @param {unknown} rules
 * @returns {{ rules: Array|null, error?: string }}
 */
export function normalizeBodyRuleList(rules) {
  if (rules === undefined || rules === null) return { rules: null };
  if (!Array.isArray(rules)) return { error: "body must be an array" };
  if (rules.length > MAX_BODY_RULES) {
    return { error: `Too many body rules (max ${MAX_BODY_RULES})` };
  }

  const clean = [];
  const seen = new Set();
  for (const raw of rules) {
    if (!raw || typeof raw !== "object") return { error: "invalid body rule entry" };
    const path = String(raw.path || "").trim();
    if (!path) return { error: "rule path is required" };
    if (!PATH_RE.test(path)) return { error: `Invalid path: ${path}` };
    if (seen.has(path)) return { error: `Duplicate path: ${path}` };
    seen.add(path);

    let op = raw.op || "set";
    if (op === "delete") op = "remove";
    if (!["set", "remove", "merge"].includes(op)) return { error: `Invalid operation for ${path}` };

    if (REMOVE_OPS.has(op)) {
      clean.push({ path, op: "remove" });
      continue;
    }

    if (raw.value === undefined) {
      return { error: `Value required for ${path}` };
    }
    const coerced = coerceBodyRuleValue(raw.value);
    if (!coerced.ok) return { error: `${path}: ${coerced.error}` };
    const normalizedValue = coerced.value;
    let serialized;
    try {
      serialized = JSON.stringify(normalizedValue);
    } catch {
      return { error: `Value for ${path} is not JSON-serializable` };
    }
    if (serialized.length > MAX_BODY_VALUE_JSON_CHARS) {
      return { error: `Value for ${path} too large (max ${MAX_BODY_VALUE_JSON_CHARS} chars)` };
    }
    clean.push({ path, op, value: normalizedValue });
  }

  return { rules: clean.length ? clean : [] };
}

/**
 * @param {unknown} options
 * @returns {{ options: object|null, error?: string }}
 */
export function normalizeBodyOptions(options) {
  if (options === undefined || options === null) return { options: null };
  if (typeof options !== "object" || Array.isArray(options)) {
    return { error: "options must be an object" };
  }
  const out = {};
  if (options.jsonSchemaFallback !== undefined) {
    if (typeof options.jsonSchemaFallback !== "boolean") {
      return { error: "options.jsonSchemaFallback must be a boolean" };
    }
    out.jsonSchemaFallback = options.jsonSchemaFallback;
  }
  return { options: Object.keys(out).length ? out : null };
}
