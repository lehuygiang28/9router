import { describe, it, expect } from "vitest";
import {
  applyHeaderRules,
  applyProviderRequestOverrides,
  buildClientResponseHeaders,
  collectRequestRules,
  normalizeHeaderRuleList,
  BLOCKED_REQUEST_HEADERS,
  BLOCKED_RESPONSE_HEADERS,
} from "open-sse/utils/providerHeaderRules.js";
import { upstreamResponseHeaders } from "open-sse/utils/upstreamHeaders.js";

describe("provider header rules", () => {
  it("sets, adds, and removes request headers case-insensitively", () => {
    const headers = { "User-Agent": "default", "X-Keep": "1" };
    applyHeaderRules(headers, [
      { name: "user-agent", op: "set", value: "custom" },
      { name: "X-Trace", op: "add", value: "a" },
      { name: "X-Trace", op: "add", value: "b" },
      { name: "X-Keep", op: "remove" },
    ], BLOCKED_REQUEST_HEADERS);
    expect(headers["User-Agent"]).toBeUndefined();
    expect(headers["user-agent"]).toBe("custom");
    expect(headers["X-Trace"]).toBe("a, b");
    expect(headers["X-Keep"]).toBeUndefined();
  });

  it("merges legacy headers map with request rules", () => {
    const rules = collectRequestRules({
      headers: { "X-Legacy": "yes" },
      request: [{ name: "X-Legacy", op: "set", value: "overridden" }],
    });
    expect(rules).toHaveLength(2);
    const headers = {};
    applyProviderRequestOverrides(headers, {
      headers: { "X-Legacy": "yes" },
      request: [{ name: "X-Legacy", op: "set", value: "overridden" }],
    });
    expect(headers["X-Legacy"]).toBe("overridden");
  });

  it("applies response rules on top of upstream passthrough", () => {
    const upstream = new Headers({
      "retry-after": "5",
      "x-should-retry": "true",
      "anthropic-ratelimit-unified-status": "ok",
    });
    const base = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    const forwarded = upstreamResponseHeaders(upstream);
    const out = buildClientResponseHeaders(upstream, {
      response: [
        { name: "X-Gateway", op: "set", value: "9router" },
        { name: "retry-after", op: "set", value: "99" },
        { name: "set-cookie", op: "set", value: "ignored" },
      ],
    }, { ...base, ...forwarded });
    expect(out["X-Gateway"]).toBe("9router");
    expect(out["retry-after"]).toBe("99");
    expect(out["set-cookie"]).toBeUndefined();
    expect(out["anthropic-ratelimit-unified-status"]).toBe("ok");
  });

  it("validates rule lists at the API boundary", () => {
    expect(normalizeHeaderRuleList([{ name: "X-Ok", op: "set", value: "v" }], BLOCKED_REQUEST_HEADERS).rules).toEqual([
      { name: "X-Ok", op: "set", value: "v" },
    ]);
    expect(normalizeHeaderRuleList([{ name: "Authorization", op: "set", value: "x" }], BLOCKED_REQUEST_HEADERS).error).toMatch(/cannot be overridden/);
    expect(normalizeHeaderRuleList([{ name: "X-Dup", op: "set", value: "a" }, { name: "x-dup", op: "set", value: "b" }], BLOCKED_RESPONSE_HEADERS).error).toMatch(/Duplicate/);
  });
});
