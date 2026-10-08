import { runInContext, createContext } from "node:vm";
import { createBodyTransformHelpers } from "./bodyTransformHelpers.js";
import { dbg } from "./debugLog.js";
import { MAX_BODY_TRANSFORM_SCRIPT_CHARS } from "./providerBodyTransform.shared.js";

function isCustomCompatibleProvider(provider) {
  return typeof provider === "string"
    && (provider.startsWith("openai-compatible-") || provider.startsWith("anthropic-compatible-"));
}

export { MAX_BODY_TRANSFORM_SCRIPT_CHARS, DEFAULT_BODY_TRANSFORM_EXAMPLE, DEFAULT_BODY_TRANSFORM_SAMPLE } from "./providerBodyTransform.shared.js";

export const BODY_TRANSFORM_TIMEOUT_MS = 50;

const FORBIDDEN_SCRIPT_PATTERNS = [
  { re: /\brequire\s*\(/, msg: "require() is not allowed" },
  { re: /\bimport\s*[\s(]/, msg: "import is not allowed" },
  { re: /\bprocess\b/, msg: "process is not allowed" },
  { re: /\beval\s*\(/, msg: "eval() is not allowed" },
  { re: /\bFunction\s*\(/, msg: "Function constructor is not allowed" },
  { re: /\bchild_process\b/, msg: "child_process is not allowed" },
  { re: /\bfetch\s*\(/, msg: "fetch() is not allowed" },
  { re: /\bglobalThis\b/, msg: "globalThis is not allowed" },
];

/**
 * @param {unknown} raw
 * @returns {{ bodyTransform: object|null, error?: string }}
 */
export function normalizeBodyTransform(raw) {
  if (raw === undefined || raw === null) return { bodyTransform: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "bodyTransform must be an object" };
  }
  const enabled = raw.enabled !== false;
  const script = String(raw.script ?? "").trim();
  if (!script) return { bodyTransform: null };
  if (script.length > MAX_BODY_TRANSFORM_SCRIPT_CHARS) {
    return { error: `bodyTransform.script too large (max ${MAX_BODY_TRANSFORM_SCRIPT_CHARS} chars)` };
  }
  for (const { re, msg } of FORBIDDEN_SCRIPT_PATTERNS) {
    if (re.test(script)) return { error: msg };
  }
  return { bodyTransform: { enabled, script } };
}

/**
 * @param {object} body
 * @param {string} script
 * @returns {object}
 */
export function applyBodyTransformScript(body, script) {
  const trimmed = String(script || "").trim();
  if (!trimmed || !body || typeof body !== "object") return body;

  const input = structuredClone(body);
  const helpers = createBodyTransformHelpers();
  const sandbox = {
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    helpers,
    __input: input,
    __output: input,
  };

  const code = `
"use strict";
${trimmed}
if (typeof transform !== "function") {
  throw new Error("Define function transform(body) { ... return body; }");
}
__output = transform(__input);
`;

  try {
    const ctx = createContext(sandbox);
    runInContext(code, ctx, {
      timeout: BODY_TRANSFORM_TIMEOUT_MS,
      filename: "provider-body-transform.js",
    });
    const out = sandbox.__output;
    if (!out || typeof out !== "object" || Array.isArray(out)) {
      dbg?.("BODY_TRANSFORM", "transform must return a plain object; keeping input");
      return input;
    }
    return out;
  } catch (err) {
    dbg?.("BODY_TRANSFORM", err?.message || String(err));
    return input;
  }
}

/**
 * @param {object} body
 * @param {{ bodyTransform?: { enabled?: boolean, script?: string } }} override
 * @param {string} provider
 */
export function applyProviderBodyTransform(body, override, provider) {
  if (!isCustomCompatibleProvider(provider)) return body;
  const bt = override?.bodyTransform;
  if (!bt || bt.enabled === false) return body;
  const script = bt.script?.trim();
  if (!script) return body;
  return applyBodyTransformScript(body, script);
}
