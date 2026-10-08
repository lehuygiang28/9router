import { describe, it, expect } from "vitest";
import { parseRuleJsonText, coerceBodyRuleValue } from "open-sse/utils/parseRuleJsonValue.js";
import { normalizeBodyRuleList } from "open-sse/utils/providerBodyRules.js";

describe("parseRuleJsonValue", () => {
  it("parses JSON5 scalars and objects from dashboard text", () => {
    expect(parseRuleJsonText('"json_schema"').value).toBe("json_schema");
    expect(parseRuleJsonText("true").value).toBe(true);
    expect(parseRuleJsonText("{type: 'json_schema'}").value).toEqual({ type: "json_schema" });
  });

  it("coerces API string payloads into typed values", () => {
    const { rules } = normalizeBodyRuleList([
      { path: "response_format.type", op: "set", value: '"json_schema"' },
    ]);
    expect(rules[0].value).toBe("json_schema");
    expect(coerceBodyRuleValue({ x: 1 }).value).toEqual({ x: 1 });
  });
});
