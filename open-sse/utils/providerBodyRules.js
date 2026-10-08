/**
 * Per-custom-provider request body transforms (set / merge / remove by dot path).
 * Applied after translation and executor transformRequest (incl. json_schema fallback).
 *
 * Stored rule `value` is always a JSON value (string | number | boolean | null | object | array)
 * after API normalization — not a stringified JSON blob. The dashboard edits values as text and
 * parses with parseRuleJsonText (JSON) before PUT.
 */
import { coerceBodyRuleValue, coerceBodyRuleEqualsValue } from "./coerceBodyRuleValue.server.js";
import { applyBodyTransformScript } from "./providerBodyTransform.js";

export const MAX_BODY_RULES = 30;
export const MAX_BODY_VALUE_JSON_CHARS = 32_768;
/** Max numeric path segment (e.g. messages.64); no auto-padding past array length. */
export const MAX_ARRAY_INDEX = 64;

const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

// Dot path: object keys (foo_bar) or non-negative array indices (0, 1, …)
const PATH_SEGMENT = "(?:[a-zA-Z_][a-zA-Z0-9_]*|\\d+)";
const PATH_RE = new RegExp(`^${PATH_SEGMENT}(?:\\.${PATH_SEGMENT})*$`);
const REMOVE_OPS = new Set(["remove", "delete"]);

function parsePath(path) {
  return path.split(".").filter(Boolean);
}

function isArrayIndex(segment) {
  return /^\d+$/.test(segment);
}

/**
 * Validate and canonicalize a rule path (strip leading zeros on indices).
 * @returns {{ path: string } | { error: string }}
 */
export function canonicalizeBodyRulePath(path) {
  const parts = parsePath(String(path || "").trim());
  if (!parts.length) return { error: "rule path is required" };
  const out = [];
  for (const seg of parts) {
    if (FORBIDDEN_PATH_SEGMENTS.has(seg)) {
      return { error: `Invalid path segment: ${seg}` };
    }
    if (isArrayIndex(seg)) {
      if (/^0\d+$/.test(seg)) return { error: `Invalid array index: ${seg}` };
      const idx = Number(seg);
      if (idx > MAX_ARRAY_INDEX) {
        return { error: `Array index too large (max ${MAX_ARRAY_INDEX}): ${seg}` };
      }
      out.push(String(idx));
      continue;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(seg)) {
      return { error: `Invalid path segment: ${seg}` };
    }
    out.push(seg);
  }
  const canonical = out.join(".");
  if (!PATH_RE.test(canonical)) return { error: `Invalid path: ${path}` };
  return { path: canonical };
}

/** Walk to parent of the leaf segment; create missing object keys only (never grow arrays). */
function walkToParent(root, parts, create) {
  if (parts.length < 1) return null;
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    const nextSeg = parts[i + 1];
    const nextIsIndex = isArrayIndex(nextSeg);

    if (isArrayIndex(seg)) {
      const idx = Number(seg);
      if (!Array.isArray(cur) || idx < 0 || idx >= cur.length) return null;
      cur = cur[idx];
      continue;
    }

    if (!isPlainObject(cur)) return null;
    let child = cur[seg];
    if (child == null) {
      if (!create || nextIsIndex) return null;
      cur[seg] = {};
      child = cur[seg];
    } else if (nextIsIndex && !Array.isArray(child)) {
      return null;
    }
    cur = child;
  }
  return cur;
}

function readLeaf(parent, leaf) {
  if (isArrayIndex(leaf)) {
    const idx = Number(leaf);
    if (!Array.isArray(parent) || idx < 0 || idx >= parent.length) return undefined;
    return parent[idx];
  }
  if (parent == null || typeof parent !== "object") return undefined;
  return parent[leaf];
}

function writeLeaf(parent, leaf, value) {
  if (isArrayIndex(leaf)) {
    const idx = Number(leaf);
    if (!Array.isArray(parent) || idx < 0 || idx >= parent.length) return false;
    parent[idx] = value;
    return true;
  }
  if (!isPlainObject(parent)) return false;
  if (FORBIDDEN_PATH_SEGMENTS.has(leaf)) return false;
  parent[leaf] = value;
  return true;
}

/** Read a value at a dot path (no mutation). */
export function readValueAtPath(body, path) {
  if (!body || typeof body !== "object") return undefined;
  const canon = canonicalizeBodyRulePath(path);
  if (!canon.path) return undefined;
  const parts = parsePath(canon.path);
  if (!parts.length) return undefined;
  const leaf = parts[parts.length - 1];
  const parent = parts.length === 1 ? body : walkToParent(body, parts, false);
  if (parent == null) return undefined;
  return readLeaf(parent, leaf);
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a !== null && typeof a === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** @param {object} body @param {{ path: string, equals: unknown } | null | undefined} when */
export function bodyRuleWhenMatches(body, when) {
  if (!when) return true;
  const actual = readValueAtPath(body, when.path);
  return valuesEqual(actual, when.equals);
}

function normalizeBodyRuleWhen(raw, rulePath) {
  if (raw === undefined || raw === null) return { when: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "when must be an object" };
  }
  const whenPathCanon = canonicalizeBodyRulePath(raw.path);
  if (whenPathCanon.error) return { error: whenPathCanon.error };
  if (raw.equals === undefined) {
    return { error: `when.equals is required for rule ${rulePath}` };
  }
  const coerced = coerceBodyRuleEqualsValue(raw.equals);
  if (!coerced.ok) return { error: `${rulePath}: when.equals: ${coerced.error}` };
  return { when: { path: whenPathCanon.path, equals: coerced.value } };
}

function ruleIdentityKey(path, when) {
  if (!when) return path;
  return `${path}\0${when.path}\0${JSON.stringify(when.equals)}`;
}

function deleteLeaf(parent, leaf) {
  if (isArrayIndex(leaf)) {
    const idx = Number(leaf);
    if (!Array.isArray(parent) || idx < 0 || idx >= parent.length) return;
    parent.splice(idx, 1);
    return;
  }
  if (parent && typeof parent === "object") delete parent[leaf];
}

export function isCustomCompatibleProvider(provider) {
  return typeof provider === "string"
    && (provider.startsWith("openai-compatible-") || provider.startsWith("anthropic-compatible-"));
}

function assignAtPath(obj, path, value, { mergeObjects }) {
  const parts = parsePath(path);
  if (!parts.length) return;
  const leaf = parts[parts.length - 1];
  const parent = parts.length === 1 ? obj : walkToParent(obj, parts, true);
  if (parent == null) return;
  const existing = readLeaf(parent, leaf);
  let next = value;
  if (mergeObjects && isPlainObject(existing) && isPlainObject(value)) {
    next = deepMerge(existing, value);
  }
  writeLeaf(parent, leaf, next);
}

function setAtPath(obj, path, value) {
  assignAtPath(obj, path, value, { mergeObjects: false });
}

function mergeAtPath(obj, path, value) {
  assignAtPath(obj, path, value, { mergeObjects: true });
}

function removeAtPath(obj, path) {
  const parts = parsePath(path);
  if (!parts.length) return;
  const leaf = parts[parts.length - 1];
  const parent = parts.length === 1 ? obj : walkToParent(obj, parts, false);
  if (parent == null) return;
  deleteLeaf(parent, leaf);
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

/**
 * @param {object} body
 * @param {Array<{ path: string, op?: string, value?: unknown }>} rules
 */
export function applyBodyRules(body, rules) {
  if (!body || typeof body !== "object" || !rules?.length) return body;
  let out = body;
  for (const rule of rules) {
    const rawPath = rule?.path?.trim();
    if (!rawPath) continue;
    const canon = canonicalizeBodyRulePath(rawPath);
    if (!canon.path) continue;
    const path = canon.path;
    if (!bodyRuleWhenMatches(out, rule.when)) continue;
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
  const bt = override?.bodyTransform;
  const hasRules = rules?.length;
  const hasTransform = bt && bt.enabled !== false && String(bt.script || "").trim();
  if (!hasRules && !hasTransform) return body;
  let out = structuredClone(body);
  if (hasRules) out = applyBodyRules(out, rules);
  // Per-request VM + structuredClone; misbehaving scripts add latency on this provider.
  if (hasTransform) out = applyBodyTransformScript(out, bt.script.trim());
  return out;
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
    const rawPath = String(raw.path || "").trim();
    const canon = canonicalizeBodyRulePath(rawPath);
    if (canon.error) return { error: canon.error };
    const path = canon.path;
    const { when, error: whenError } = normalizeBodyRuleWhen(raw.when, path);
    if (whenError) return { error: whenError };
    const idKey = ruleIdentityKey(path, when);
    if (seen.has(idKey)) return { error: `Duplicate rule: ${path}` };
    seen.add(idKey);

    let op = raw.op || "set";
    if (op === "delete") op = "remove";
    if (!["set", "remove", "merge"].includes(op)) return { error: `Invalid operation for ${path}` };

    if (REMOVE_OPS.has(op)) {
      const entry = { path, op: "remove" };
      if (when) entry.when = when;
      clean.push(entry);
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
    const entry = { path, op, value: normalizedValue };
    if (when) entry.when = when;
    clean.push(entry);
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
