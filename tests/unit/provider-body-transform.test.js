import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anthropicSystemToFirstUser } from "open-sse/utils/bodyTransformHelpers.js";
import {
  applyBodyTransformScript,
  applyProviderBodyTransform,
  normalizeBodyTransform,
} from "open-sse/utils/providerBodyTransform.js";
import { applyProviderBodyOverrides } from "open-sse/utils/providerBodyRules.js";
import {
  loadBodyTransformExamples,
  getBodyTransformExampleById,
} from "open-sse/utils/providerBodyTransformExamples.server.js";

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../open-sse/body-transform-examples");

function loadSample() {
  return JSON.parse(readFileSync(join(EXAMPLES_DIR, "anthropic-system-to-user.sample.json"), "utf8"));
}

describe("provider body transform script", () => {
  it("moves anthropic system to first user message via helper", () => {
    const body = structuredClone(loadSample());
    const out = anthropicSystemToFirstUser(body);
    expect(out.system).toBeUndefined();
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe("user");
    expect(out.messages[0].content[0].text).toContain("Claude Code");
    expect(out.messages[1].role).toBe("user");
    expect(out.messages[1].content[0].text).toBe("hi");
  });

  it("loads examples from open-sse/body-transform-examples/*.js", () => {
    const examples = loadBodyTransformExamples();
    expect(examples.length).toBeGreaterThanOrEqual(2);
    const ex = getBodyTransformExampleById("anthropic-system-to-user");
    expect(ex.script).toContain("function transform");
    expect(ex.sample.messages).toBeDefined();
    const onDisk = readFileSync(join(EXAMPLES_DIR, "anthropic-system-to-user.js"), "utf8");
    expect(ex.script).toBe(onDisk.trim());
  });

  it("runs transform(body) from example file in sandbox", () => {
    const ex = getBodyTransformExampleById("anthropic-system-to-user");
    const out = applyBodyTransformScript(loadSample(), ex.script);
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
    const body = structuredClone(loadSample());
    const ex = getBodyTransformExampleById("anthropic-system-to-user");
    const override = {
      body: [{ path: "max_tokens", op: "set", value: 1024 }],
      bodyTransform: { enabled: true, script: ex.script },
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
