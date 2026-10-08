import { describe, it, expect } from "vitest";
import {
  applyBodyRules,
  applyProviderBodyOverrides,
  normalizeBodyRuleList,
  normalizeBodyOptions,
} from "open-sse/utils/providerBodyRules.js";
import { DefaultExecutor } from "open-sse/executors/default.js";

describe("provider body rules", () => {
  it("sets, merges, and removes dot paths", () => {
    const body = { model: "x", response_format: { type: "json_object" } };
    applyBodyRules(body, [
      { path: "chat_template_kwargs", op: "merge", value: { enable_thinking: true } },
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

  it("validates rule lists at the API boundary", () => {
    expect(normalizeBodyRuleList([{ path: "ok", op: "set", value: 1 }]).rules).toEqual([
      { path: "ok", op: "set", value: 1 },
    ]);
    expect(normalizeBodyRuleList([{ path: "bad.path!", op: "set", value: 1 }]).error).toMatch(/Invalid path/);
    expect(normalizeBodyOptions({ jsonSchemaFallback: false }).options).toEqual({ jsonSchemaFallback: false });
  });

  it("set on response_format.type preserves json_schema and the rest of the request", () => {
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

  it("set with a partial object at response_format deep-merges instead of replacing siblings", () => {
    const body = {
      model: "m",
      response_format: {
        type: "json_object",
        json_schema: { name: "n", strict: true, schema: { type: "object" } },
      },
    };
    applyBodyRules(body, [{ path: "response_format", op: "set", value: { type: "json_schema" } }]);
    expect(body.model).toBe("m");
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
