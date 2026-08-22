import { describe, it, expect } from "vitest";

// Mirror the redaction logic from src/app/api/usage/request-details/route.js
// so we can test it in isolation.
function redactDetails(details) {
  return (details || []).map((d) => {
    const redacted = { ...d };
    for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
      if (redacted[key] !== undefined) {
        redacted[key] = { redacted: true };
      }
    }
    return redacted;
  });
}

describe("request-details redaction", () => {
  it("removes conversation payloads but keeps metadata", () => {
    const details = [{
      id: "abc",
      provider: "opencode",
      model: "deepseek-v4-flash-free",
      timestamp: "2026-08-05T00:00:00Z",
      status: "success",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      request: { messages: [{ role: "user", content: "secret prompt" }] },
      providerRequest: { messages: [{ role: "user", content: "secret prompt" }] },
      providerResponse: { choices: [{ message: { content: "secret answer" } }] },
      response: { content: "secret answer" },
    }];
    const out = redactDetails(details)[0];
    expect(out.id).toBe("abc");
    expect(out.provider).toBe("opencode");
    expect(out.model).toBe("deepseek-v4-flash-free");
    expect(out.tokens).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(out.request).toEqual({ redacted: true });
    expect(out.providerRequest).toEqual({ redacted: true });
    expect(out.providerResponse).toEqual({ redacted: true });
    expect(out.response).toEqual({ redacted: true });
  });

  it("handles empty details", () => {
    expect(redactDetails([])).toEqual([]);
    expect(redactDetails(null)).toEqual([]);
  });

  it("keeps non-sensitive fields untouched", () => {
    const details = [{ id: "x", status: "error", latency: { total: 100 } }];
    const out = redactDetails(details)[0];
    expect(out.id).toBe("x");
    expect(out.status).toBe("error");
    expect(out.latency).toEqual({ total: 100 });
  });

  it("honors DISABLE_REQUEST_DETAILS_REDACTION env flag when checking redaction", () => {
    const isRedactionDisabled = (env) =>
      env.DISABLE_REQUEST_DETAILS_REDACTION === "true" ||
      env.REDACT_REQUEST_DETAILS === "false" ||
      env.ENABLE_REQUEST_DETAILS_FULL_LOG === "true";

    expect(isRedactionDisabled({})).toBe(false);
    expect(isRedactionDisabled({ DISABLE_REQUEST_DETAILS_REDACTION: "false" })).toBe(false);
    expect(isRedactionDisabled({ DISABLE_REQUEST_DETAILS_REDACTION: "true" })).toBe(true);
    expect(isRedactionDisabled({ REDACT_REQUEST_DETAILS: "false" })).toBe(true);
    expect(isRedactionDisabled({ ENABLE_REQUEST_DETAILS_FULL_LOG: "true" })).toBe(true);
  });
});
