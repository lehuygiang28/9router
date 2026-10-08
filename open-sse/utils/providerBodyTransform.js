import { runInContext, createContext } from "node:vm";
import { dbg } from "./debugLog.js";
import { BODY_TRANSFORM_VM_HELPERS_SRC } from "./bodyTransformVmHelpers.js";
import {
  MAX_BODY_TRANSFORM_SCRIPT_CHARS,
  BODY_TRANSFORM_TIMEOUT_MS,
} from "./providerBodyTransform.shared.js";
import { lintBodyTransformScript } from "./providerBodyTransformLint.js";

export {
  MAX_BODY_TRANSFORM_SCRIPT_CHARS,
  BODY_TRANSFORM_TIMEOUT_MS,
} from "./providerBodyTransform.shared.js";
export { lintBodyTransformScript, FORBIDDEN_BODY_TRANSFORM_PATTERNS } from "./providerBodyTransformLint.js";

function isCustomCompatibleProvider(provider) {
  return typeof provider === "string"
    && (provider.startsWith("openai-compatible-") || provider.startsWith("anthropic-compatible-"));
}

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
  const lint = lintBodyTransformScript(script);
  if (lint) return { error: lint };
  return { bodyTransform: { enabled, script } };
}

function buildTransformCode(userScript) {
  return `"use strict";
${BODY_TRANSFORM_VM_HELPERS_SRC}
var helpers = Object.freeze({
  anthropicSystemToFirstUser: anthropicSystemToFirstUser,
  normalizeBlockCacheControl: normalizeBlockCacheControl,
});
${userScript}
if (typeof transform !== "function") {
  throw new Error("Define function transform(body) { ... return body; }");
}
var __raw = transform(__input);
if (__raw !== null && typeof __raw === "object" && typeof __raw.then === "function") {
  throw new Error("transform must not return a Promise");
}
__output = JSON.parse(JSON.stringify(__raw));
`;
}

/**
 * @param {object} body
 * @param {string} script
 * @returns {{ ok: boolean, body: object, error?: string, unchanged?: boolean }}
 */
export function runBodyTransform(body, script) {
  const trimmed = String(script || "").trim();
  if (!trimmed || !body || typeof body !== "object") {
    return { ok: true, body, unchanged: true };
  }
  const pristine = structuredClone(body);
  const lint = lintBodyTransformScript(trimmed);
  if (lint) {
    return { ok: false, error: lint, body: pristine, unchanged: true };
  }

  const working = structuredClone(body);
  const sandbox = Object.create(null);
  sandbox.__input = working;
  sandbox.__output = working;
  sandbox.JSON = JSON;

  try {
    const ctx = createContext(sandbox);
    runInContext(buildTransformCode(trimmed), ctx, {
      timeout: BODY_TRANSFORM_TIMEOUT_MS,
      filename: "provider-body-transform.js",
    });
    const out = sandbox.__output;
    if (!out || typeof out !== "object" || Array.isArray(out)) {
      return {
        ok: false,
        error: "transform must return a plain JSON-serializable object",
        body: pristine,
        unchanged: true,
      };
    }
    return { ok: true, body: out, unchanged: false };
  } catch (err) {
    const message = err?.message || String(err);
    dbg?.("BODY_TRANSFORM", message);
    return { ok: false, error: message, body: pristine, unchanged: true };
  }
}

/**
 * Fail-open: returns pristine body on error (production hot path).
 * @param {object} body
 * @param {string} script
 * @returns {object}
 */
export function applyBodyTransformScript(body, script) {
  return runBodyTransform(body, script).body;
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
