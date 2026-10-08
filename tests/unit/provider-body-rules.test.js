import { describe, it, expect } from "vitest";
import {
  applyBodyRules,
  applyProviderBodyOverrides,
  normalizeBodyRuleList,
  normalizeBodyOptions,
  canonicalizeBodyRulePath,
  MAX_ARRAY_INDEX,
} from "open-sse/utils/providerBodyRules.js";
import { DefaultExecutor } from "open-sse/executors/default.js";

describe("provider body rules", () => {
  it("sets and removes dot paths", () => {
    const body = { model: "x", response_format: { type: "json_object" } };
    applyBodyRules(body, [
      { path: "chat_template_kwargs", op: "set", value: { enable_thinking: true } },
      { path: "response_format", op: "remove" },
      { path: "extra.flag", op: "set", value: 1 },
    ]);
    expect(body.response_format).toBeUndefined();
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(body.extra).toEqual({ flag: 1 });
  });

  it("only applies overrides for custom compatible providers", () => {
    const body = { a: 1 };
    const rules = [{ path: "a", op: "set", value: 2 }];
    expect(applyProviderBodyOverrides(body, { body: rules }, "openai")).toEqual({ a: 1 });
    expect(applyProviderBodyOverrides(body, { body: rules }, "openai-compatible-abc").a).toBe(2);
  });

  it("accepts array index segments in rule paths", () => {
    expect(normalizeBodyRuleList([
      { path: "messages.0.cache_control", op: "merge", value: { type: "ephemeral" } },
    ]).rules).toHaveLength(1);
  });

  it("validates rule lists at the API boundary", () => {
    expect(normalizeBodyRuleList([{ path: "ok", op: "set", value: 1 }]).rules).toEqual([
      { path: "ok", op: "set", value: 1 },
    ]);
    expect(normalizeBodyRuleList([{ path: "bad.path!", op: "set", value: 1 }]).error).toMatch(/Invalid path/);
    expect(normalizeBodyOptions({ jsonSchemaFallback: false }).options).toEqual({ jsonSchemaFallback: false });
  });

  it("sets nested fields on messages[0] via array index paths", () => {
    const body = {
      messages: [
        { role: "system", content: "" },
        { role: "user", content: "hi" },
      ],
      model: "m",
    };
    applyBodyRules(body, [
      {
        path: "messages.0.cache_control",
        op: "merge",
        value: { type: "ephemeral" },
      },
    ]);
    expect(body.messages[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
    expect(body.model).toBe("m");
  });

  it("set on response_format.type replaces only that leaf", () => {
    const body = {
      messages: [
        { role: "system", content: "" },
        { role: "user", content: "<post>example</post>" },
      ],
      model: "codex/gpt-6-luna",
      stream: true,
      response_format: {
        type: "json_object",
        json_schema: {
          name: "education_result",
          strict: true,
          schema: {
            type: "object",
            properties: { is_education: { type: "boolean" } },
            required: ["is_education"],
          },
        },
      },
    };
    const snapshot = structuredClone(body);

    applyBodyRules(body, [{ path: "response_format.type", op: "set", value: "json_schema" }]);

    expect(body.messages).toEqual(snapshot.messages);
    expect(body.model).toBe(snapshot.model);
    expect(body.stream).toBe(true);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema).toEqual(snapshot.response_format.json_schema);
  });

  it("merge deep-merges objects at the path", () => {
    const body = { a: { x: 1, y: 2 } };
    applyBodyRules(body, [{ path: "a", op: "merge", value: { y: 9, z: 3 } }]);
    expect(body.a).toEqual({ x: 1, y: 9, z: 3 });
  });

  it("set on response_format replaces the whole object", () => {
    const body = {
      model: "m",
      response_format: {
        type: "json_object",
        json_schema: { name: "n", strict: true, schema: { type: "object" } },
      },
    };
    applyBodyRules(body, [{ path: "response_format", op: "set", value: { type: "json_schema" } }]);
    expect(body.model).toBe("m");
    expect(body.response_format).toEqual({ type: "json_schema" });
  });

  it("merge on response_format patches without dropping json_schema", () => {
    const body = {
      model: "m",
      response_format: {
        type: "json_object",
        json_schema: { name: "n", strict: true, schema: { type: "object" } },
      },
    };
    applyBodyRules(body, [{ path: "response_format", op: "merge", value: { type: "json_schema" } }]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema).toEqual({
      name: "n",
      strict: true,
      schema: { type: "object" },
    });
  });

  it("rejects unsafe paths at normalize time", () => {
    expect(normalizeBodyRuleList([
      { path: "messages.1000000.x", op: "set", value: 1 },
    ]).error).toMatch(/too large/i);
    expect(normalizeBodyRuleList([
      { path: "__proto__.x", op: "set", value: 1 },
    ]).error).toMatch(/Invalid path segment/);
    expect(normalizeBodyRuleList([
      { path: "messages.01.x", op: "set", value: 1 },
    ]).error).toMatch(/Invalid array index/);
    expect(normalizeBodyRuleList([
      { path: "messages.1.x", op: "set", value: 1 },
      { path: "messages.1.x", op: "set", value: 2 },
    ]).error).toMatch(/Duplicate path/);
  });

  it("does not grow arrays for out-of-range indices", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    applyBodyRules(body, [
      { path: `messages.${MAX_ARRAY_INDEX + 1}.x`, op: "set", value: 1 },
    ]);
    expect(body.messages).toHaveLength(1);
    applyBodyRules(body, [{ path: "messages.5.x", op: "set", value: 1 }]);
    expect(body.messages).toHaveLength(1);
  });

  it("does not create messages when index path does not apply", () => {
    const body = { model: "m" };
    applyBodyRules(body, [{ path: "messages.0.cache_control", op: "merge", value: { type: "ephemeral" } }]);
    expect(body.messages).toBeUndefined();
  });

  it("remove on numeric leaf splices the array element", () => {
    const body = { messages: [{ a: 1 }, { b: 2 }] };
    applyBodyRules(body, [{ path: "messages.0", op: "remove" }]);
    expect(body.messages).toEqual([{ b: 2 }]);
  });

  it("remove on messages.0.field deletes the property", () => {
    const body = { messages: [{ cache_control: { type: "ephemeral" }, role: "system" }] };
    applyBodyRules(body, [{ path: "messages.0.cache_control", op: "remove" }]);
    expect(body.messages[0]).toEqual({ role: "system" });
  });

  it("canonicalizeBodyRulePath normalizes indices", () => {
    expect(canonicalizeBodyRulePath("messages.1.x").path).toBe("messages.1.x");
    expect(canonicalizeBodyRulePath("a.b").path).toBe("a.b");
  });

  it("skips json_schema fallback when disabled in provider overrides", () => {
    const executor = new DefaultExecutor("openai-compatible-test");
    const body = {
      messages: [{ role: "user", content: "hi" }],
      response_format: {
        type: "json_schema",
        json_schema: { schema: { type: "object", properties: { x: { type: "string" } } } },
      },
    };
    const withFallback = executor.applyJsonSchemaFallback(body, null);
    expect(withFallback.response_format.type).toBe("json_object");
    const withoutFallback = executor.applyJsonSchemaFallback(body, { options: { jsonSchemaFallback: false } });
    expect(withoutFallback.response_format.type).toBe("json_schema");
  });
});
