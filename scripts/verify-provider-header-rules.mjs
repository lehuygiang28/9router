#!/usr/bin/env node
/**
 * Deterministic regression check for per-provider header rules.
 *
 *   node scripts/verify-provider-header-rules.mjs              # current implementation (must pass)
 *   node scripts/verify-provider-header-rules.mjs --legacy     # pre-feature behavior (must fail)
 */
import assert from "node:assert/strict";
import {
  applyHeaderRules,
  applyProviderRequestOverrides,
  buildClientResponseHeaders,
  collectRequestRules,
  normalizeHeaderRuleList,
  BLOCKED_REQUEST_HEADERS,
  BLOCKED_RESPONSE_HEADERS,
} from "../open-sse/utils/providerHeaderRules.js";
import { upstreamResponseHeaders } from "../open-sse/utils/upstreamHeaders.js";

const legacy = process.argv.includes("--legacy");

function applyRequest(headers, override) {
  if (legacy) {
    if (override?.headers) Object.assign(headers, override.headers);
    return headers;
  }
  return applyProviderRequestOverrides(headers, override);
}

function buildResponse(upstream, override, base) {
  if (legacy) {
    return { ...base, ...upstreamResponseHeaders(upstream) };
  }
  return buildClientResponseHeaders(upstream, override, base);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(`     ${err.message}`);
  }
}

test("request: set / add / remove (case-insensitive)", () => {
  const headers = { "User-Agent": "default", "X-Keep": "1" };
  if (legacy) {
    applyRequest(headers, {
      headers: { "user-agent": "custom", "X-Trace": "a" },
      request: [{ name: "X-Keep", op: "remove" }],
    });
  } else {
    applyHeaderRules(headers, [
      { name: "user-agent", op: "set", value: "custom" },
      { name: "X-Trace", op: "add", value: "a" },
      { name: "X-Trace", op: "add", value: "b" },
      { name: "X-Keep", op: "remove" },
    ], BLOCKED_REQUEST_HEADERS);
  }
  assert.equal(headers["User-Agent"], undefined);
  assert.equal(headers["user-agent"], "custom");
  assert.equal(headers["X-Trace"], legacy ? "a" : "a, b");
  assert.equal(headers["X-Keep"], undefined);
});

test("request: explicit rule overrides legacy header map", () => {
  const headers = {};
  applyRequest(headers, {
    headers: { "X-Legacy": "yes" },
    request: [{ name: "X-Legacy", op: "set", value: "overridden" }],
  });
  assert.equal(headers["X-Legacy"], "overridden");
});

test("response: custom rules on rate-limit passthrough", () => {
  const upstream = new Headers({
    "retry-after": "5",
    "x-should-retry": "true",
    "anthropic-ratelimit-unified-status": "ok",
  });
  const out = buildResponse(upstream, {
    response: [
      { name: "X-Gateway", op: "set", value: "9router" },
      { name: "retry-after", op: "set", value: "99" },
      { name: "set-cookie", op: "set", value: "ignored" },
    ],
  }, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  assert.equal(out["X-Gateway"], "9router");
  assert.equal(out["retry-after"], "99");
  assert.equal(out["set-cookie"], undefined);
  assert.equal(out["anthropic-ratelimit-unified-status"], "ok");
});

test("hop-by-hop headers are rejected at the API boundary", () => {
  const { error } = normalizeHeaderRuleList([{ name: "Upgrade", op: "set", value: "h2" }], BLOCKED_REQUEST_HEADERS);
  if (!error?.includes("cannot be overridden")) throw new Error(`expected Upgrade block, got ${error}`);
});

test("API boundary validation", () => {
  assert.deepEqual(
    normalizeHeaderRuleList([{ name: "X-Ok", op: "set", value: "v" }], BLOCKED_REQUEST_HEADERS).rules,
    [{ name: "X-Ok", op: "set", value: "v" }],
  );
  assert.match(
    normalizeHeaderRuleList([{ name: "Authorization", op: "set", value: "x" }], BLOCKED_REQUEST_HEADERS).error,
    /cannot be overridden/,
  );
});

test("collectRequestRules merges legacy + request arrays", () => {
  const rules = collectRequestRules({
    headers: { "X-Legacy": "yes" },
    request: [{ name: "X-Legacy", op: "set", value: "overridden" }],
  });
  assert.equal(rules.length, 2);
});

console.log(`\n${passed} passed, ${failed} failed${legacy ? " (legacy / pre-feature shim)" : ""}`);
process.exit(failed > 0 ? 1 : 0);
