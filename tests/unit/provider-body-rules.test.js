import { describe, it, expect } from "vitest";
import {
  applyBodyRules,
  applyProviderBodyOverrides,
  normalizeBodyRuleList,
  normalizeBodyOptions,
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
