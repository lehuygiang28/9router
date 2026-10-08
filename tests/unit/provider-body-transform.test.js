import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anthropicSystemToFirstUser } from "open-sse/utils/bodyTransformHelpers.js";
import {
  applyBodyTransformScript,
  applyProviderBodyTransform,
  normalizeBodyTransform,
  runBodyTransform,
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
    expect(out.messages[0].content[0].cache_control).toBeUndefined();
  });

  it("strips cache_control on promoted system (post anchorClaudeCache shape)", () => {
    const body = {
      system: [{ type: "text", text: "sys", cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: "hi" }],
    };
    const out = anthropicSystemToFirstUser(body);
    expect(out.system).toBeUndefined();
    expect(out.messages[0].content[0].cache_control).toBeUndefined();
  });

  it("loads examples from open-sse/body-transform-examples/*.js", () => {
    const ex = getBodyTransformExampleById("anthropic-system-to-user");
    expect(ex.script).toContain("function transform");
    const onDisk = readFileSync(join(EXAMPLES_DIR, "anthropic-system-to-user.js"), "utf8");
    expect(ex.script).toBe(onDisk.trim());
  });

  it("runs transform(body) from example file in sandbox", () => {
    const ex = getBodyTransformExampleById("anthropic-system-to-user");
    const result = runBodyTransform(loadSample(), ex.script);
    expect(result.ok).toBe(true);
    expect(result.body.system).toBeUndefined();
    expect(result.body.messages[0].role).toBe("user");
  });

  it("rejects dangerous script patterns at normalize and runtime", () => {
    expect(normalizeBodyTransform({ script: "require('fs')" }).error).toMatch(/require/);
    const runtime = runBodyTransform({ a: 1 }, "function transform(){ require('x'); return {a:1}; }");
    expect(runtime.ok).toBe(false);
    expect(runtime.body).toEqual({ a: 1 });
  });

  it("returns pristine body when transform throws after mutating input", () => {
    const sample = loadSample();
    const result = runBodyTransform(sample, `function transform(body) {
      delete body.system;
      throw new Error("fail");
    }`);
    expect(result.ok).toBe(false);
    expect(result.body.system).toBeDefined();
  });

  it("applies body rules before transform (order)", () => {
    const body = structuredClone(loadSample());
    const override = {
      body: [{ path: "tags", op: "set", value: ["routed"] }],
      bodyTransform: {
        enabled: true,
        script: `function transform(body) {
          if (!body.tags || body.tags[0] !== "routed") throw new Error("rules must run first");
          return helpers.anthropicSystemToFirstUser(body);
        }`,
      },
    };
    const out = applyProviderBodyOverrides(body, override, "anthropic-compatible-x");
    expect(out.tags).toEqual(["routed"]);
    expect(out.system).toBeUndefined();
  });

  it("skips transform when disabled", () => {
    const body = { system: "x", messages: [] };
    const out = applyProviderBodyTransform(body, {
      bodyTransform: { enabled: false, script: "function transform(b){ delete b.system; return b; }" },
    }, "anthropic-compatible-x");
    expect(out.system).toBe("x");
  });

  it("applyBodyTransformScript matches runBodyTransform success body", () => {
    const ex = loadBodyTransformExamples()[0];
    const sample = loadSample();
    expect(applyBodyTransformScript(sample, ex.script).messages[0].role).toBe("user");
  });
});
