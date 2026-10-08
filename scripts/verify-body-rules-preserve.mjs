#!/usr/bin/env node
/**
 * Re-runnable proof: body rules patch only selected paths; full request shape preserved.
 * Usage: node scripts/verify-body-rules-preserve.mjs
 */
import { applyProviderBodyOverrides } from "../open-sse/utils/providerBodyRules.js";

const request = {
  messages: [
    { role: "system", content: "" },
    { role: "user", content: "<post>40m salary...</post>" },
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
        additionalProperties: false,
        properties: { is_education: { type: "boolean" } },
        required: ["is_education"],
      },
    },
  },
};

const out = applyProviderBodyOverrides(
  request,
  { body: [{ path: "response_format.type", op: "set", value: "json_schema" }] },
  "openai-compatible-proof",
);

const checks = [
  ["messages preserved", JSON.stringify(out.messages) === JSON.stringify(request.messages)],
  ["model preserved", out.model === request.model],
  ["stream preserved", out.stream === true],
  ["type patched", out.response_format?.type === "json_schema"],
  ["json_schema preserved", JSON.stringify(out.response_format?.json_schema) === JSON.stringify(request.response_format.json_schema)],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
