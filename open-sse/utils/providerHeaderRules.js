import { upstreamResponseHeaders } from "./upstreamHeaders.js";

/** @typedef {"set" | "add" | "remove"} HeaderRuleOp */

/**
 * Per-provider header transform rules (Cloudflare-style).
 * Applied after the executor builds default upstream request headers;
 * response rules run on headers returned to the API client.
 */

export const BLOCKED_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
  "authorization",
  "cookie",
]);

export const BLOCKED_RESPONSE_HEADERS = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "content-encoding",
  "set-cookie",
]);

const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;
export const MAX_HEADER_RULES = 20;
export const MAX_HEADER_VALUE_LENGTH = 8192;

const REMOVE_OPS = new Set(["remove", "delete"]);

function findHeaderKey(headers, lowerName) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) return key;
  }
  return null;
}

function deleteHeaderCI(headers, lowerName) {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) delete headers[key];
  }
}

/**
 * @param {Record<string, string>} headers
 * @param {Array<{ name: string, op?: HeaderRuleOp, value?: string }>} rules
 * @param {Set<string>} blocked
 */
export function applyHeaderRules(headers, rules, blocked) {
  if (!rules?.length) return headers;
  for (const rule of rules) {
    const name = rule?.name?.trim();
    if (!name || !HEADER_NAME_RE.test(name)) continue;
    const lower = name.toLowerCase();
    if (blocked.has(lower)) continue;

    const op = rule.op || "set";
    if (REMOVE_OPS.has(op)) {
      deleteHeaderCI(headers, lower);
      continue;
    }

    const value = rule.value ?? "";
    if (typeof value !== "string" || /[\r\n]/.test(value)) continue;
    if (value.length > MAX_HEADER_VALUE_LENGTH) continue;

    if (op === "add") {
      const existingKey = findHeaderKey(headers, lower);
      if (existingKey) {
        headers[existingKey] = `${headers[existingKey]}, ${value}`;
      } else {
        headers[name] = value;
      }
      continue;
    }

    // set (default) — replace any case variant
    deleteHeaderCI(headers, lower);
    headers[name] = value;
  }
  return headers;
}

/**
 * Merge legacy `headers` map + `request` rule list for upstream dispatch.
 * @param {Record<string, string>} headers
 * @param {{ headers?: Record<string, string>, request?: Array }} override
 */
export function applyProviderRequestOverrides(headers, override) {
  if (!override) return headers;
  const rules = collectRequestRules(override);
  return applyHeaderRules(headers, rules, BLOCKED_REQUEST_HEADERS);
}

/**
 * @param {{ headers?: Record<string, string>, request?: Array }} override
 */
export function collectRequestRules(override) {
  const rules = [];
  if (override.headers && typeof override.headers === "object") {
    for (const [name, value] of Object.entries(override.headers)) {
      if (value === "" || value == null) {
        rules.push({ name, op: "remove" });
      } else {
        rules.push({ name, op: "set", value });
      }
    }
  }
  if (Array.isArray(override.request)) rules.push(...override.request);
  return rules;
}

/**
 * Build client-facing response header object from defaults + upstream passthrough + rules.
 * @param {Headers|Record<string,string>|null|undefined} upstreamHeaders
 * @param {{ response?: Array }} override
 * @param {Record<string, string>} baseHeaders
 */
export function buildClientResponseHeaders(upstreamHeaders, override, baseHeaders = {}) {
  // Only rate-limit / retry headers are forwarded from upstream by default.
  const out = { ...baseHeaders, ...upstreamResponseHeaders(upstreamHeaders) };
  if (override?.response?.length) {
    applyHeaderRules(out, override.response, BLOCKED_RESPONSE_HEADERS);
  }
  return out;
}

/**
 * @param {unknown} rules
 * @param {Set<string>} blocked
 * @returns {{ rules: Array|null, error?: string }}
 */
export function normalizeHeaderRuleList(rules, blocked) {
  if (rules === undefined || rules === null) return { rules: null };
  if (!Array.isArray(rules)) return { error: "rules must be an array" };
  if (rules.length > MAX_HEADER_RULES) {
    return { error: `Too many header rules (max ${MAX_HEADER_RULES})` };
  }

  const clean = [];
  const seen = new Set();
  for (const raw of rules) {
    if (!raw || typeof raw !== "object") return { error: "invalid rule entry" };
    const name = String(raw.name || "").trim();
    if (!name) return { error: "rule name is required" };
    if (!HEADER_NAME_RE.test(name)) return { error: `Invalid header name: ${name}` };
    const lower = name.toLowerCase();
    if (blocked.has(lower)) return { error: `Header ${name} cannot be overridden` };
    if (seen.has(lower)) return { error: `Duplicate header name: ${name}` };
    seen.add(lower);

    let op = raw.op || "set";
    if (op === "delete") op = "remove";
    if (!["set", "add", "remove"].includes(op)) return { error: `Invalid operation for ${name}` };

    if (REMOVE_OPS.has(op)) {
      clean.push({ name, op: "remove" });
      continue;
    }

    const value = raw.value;
    if (typeof value !== "string" || /[\r\n]/.test(value)) {
      return { error: `Invalid value for header ${name}` };
    }
    if (value.length > MAX_HEADER_VALUE_LENGTH) {
      return { error: `Header ${name} value too long (max ${MAX_HEADER_VALUE_LENGTH})` };
    }
    clean.push({ name, op, value });
  }

  return { rules: clean.length ? clean : [] };
}
