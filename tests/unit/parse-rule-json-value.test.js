import { describe, it, expect } from "vitest";
import { parseRuleJsonText } from "open-sse/utils/parseRuleJsonValue.js";
import { coerceBodyRuleValue } from "open-sse/utils/coerceBodyRuleValue.server.js";
import { normalizeBodyRuleList } from "open-sse/utils/providerBodyRules.js";

describe("parseRuleJsonText (client-safe strict JSON)", () => {
  it("parses JSON scalars and objects from dashboard text", () => {
    expect(parseRuleJsonText('"json_schema"').value).toBe("json_schema");
    expect(parseRuleJsonText("true").value).toBe(true);
    expect(parseRuleJsonText('{"type": "json_schema"}').value).toEqual({ type: "json_schema" });
  });

  it("rejects JSON5 syntax so the client bundle stays confbox-free", () => {
    expect(parseRuleJsonText("{type: 'json_schema'}").ok).toBe(false);
    expect(parseRuleJsonText('{"a":1,}').ok).toBe(false);
  });
});

describe("coerceBodyRuleValue (server API)", () => {
  it("coerces strict JSON and JSON5 string payloads", () => {
    const { rules } = normalizeBodyRuleList([
      { path: "response_format.type", op: "set", value: '"json_schema"' },
    ]);
    expect(rules[0].value).toBe("json_schema");
    expect(coerceBodyRuleValue({ x: 1 }).value).toEqual({ x: 1 });
    expect(coerceBodyRuleValue("{type: 'json_schema'}").value).toEqual({ type: "json_schema" });
  });
});
