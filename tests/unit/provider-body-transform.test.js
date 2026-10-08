import { describe, it, expect } from "vitest";
import { anthropicSystemToFirstUser } from "open-sse/utils/bodyTransformHelpers.js";
import {
  applyBodyTransformScript,
  applyProviderBodyTransform,
  normalizeBodyTransform,
} from "open-sse/utils/providerBodyTransform.js";
import { applyProviderBodyOverrides } from "open-sse/utils/providerBodyRules.js";
import { DEFAULT_BODY_TRANSFORM_SAMPLE } from "open-sse/utils/providerBodyTransform.shared.js";

describe("provider body transform script", () => {
  it("moves anthropic system to first user message via helper", () => {
    const body = structuredClone(DEFAULT_BODY_TRANSFORM_SAMPLE);
    const out = anthropicSystemToFirstUser(body);
    expect(out.system).toBeUndefined();
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe("user");
    expect(out.messages[0].content[0].text).toContain("Claude Code");
    expect(out.messages[1].role).toBe("user");
    expect(out.messages[1].content[0].text).toBe("hi");
  });

  it("runs transform(body) in sandbox", () => {
    const script = `function transform(body) {
      return helpers.anthropicSystemToFirstUser(body);
    }`;
    const out = applyBodyTransformScript(DEFAULT_BODY_TRANSFORM_SAMPLE, script);
    expect(out.system).toBeUndefined();
    expect(out.messages[0].role).toBe("user");
  });

  it("rejects dangerous script patterns at normalize time", () => {
    expect(normalizeBodyTransform({ script: "require('fs')" }).error).toMatch(/require/);
    expect(normalizeBodyTransform({
      script: "function transform(b){ return b; }",
    }).bodyTransform.script).toContain("transform");
  });

  it("integrates after body rules in applyProviderBodyOverrides", () => {
    const body = structuredClone(DEFAULT_BODY_TRANSFORM_SAMPLE);
    const override = {
      body: [{ path: "max_tokens", op: "set", value: 1024 }],
      bodyTransform: {
        enabled: true,
        script: "function transform(body) { return helpers.anthropicSystemToFirstUser(body); }",
      },
    };
    const out = applyProviderBodyOverrides(body, override, "anthropic-compatible-x");
    expect(out.max_tokens).toBe(1024);
    expect(out.system).toBeUndefined();
    expect(out.messages[0].role).toBe("user");
  });

  it("skips transform when disabled", () => {
    const body = { system: "x", messages: [] };
    const out = applyProviderBodyTransform(body, {
      bodyTransform: { enabled: false, script: "function transform(b){ delete b.system; return b; }" },
    }, "anthropic-compatible-x");
    expect(out.system).toBe("x");
  });
});
