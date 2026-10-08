import { MAX_BODY_TRANSFORM_SCRIPT_CHARS } from "./providerBodyTransform.shared.js";

/** @returns {string|null} error message */
export const FORBIDDEN_BODY_TRANSFORM_PATTERNS = [
  { re: /\brequire\s*\(/, msg: "require() is not allowed" },
  { re: /\bimport\s*[\s(]/, msg: "import is not allowed" },
  { re: /\bimport\s*\(/, msg: "import() is not allowed" },
  { re: /\bprocess\s*[\.\[]/, msg: "process is not allowed" },
  { re: /\beval\s*\(/, msg: "eval() is not allowed" },
  { re: /\bFunction\s*\(/, msg: "Function constructor is not allowed" },
  { re: /\bchild_process\b/, msg: "child_process is not allowed" },
  { re: /\bfetch\s*\(/, msg: "fetch() is not allowed" },
  { re: /\bglobalThis\b/, msg: "globalThis is not allowed" },
  { re: /\b__proto__\b/, msg: "__proto__ is not allowed" },
  { re: /\.constructor\b/, msg: ".constructor is not allowed" },
];

export function lintBodyTransformScript(script) {
  const trimmed = String(script || "").trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_BODY_TRANSFORM_SCRIPT_CHARS) {
    return `Script too large (max ${MAX_BODY_TRANSFORM_SCRIPT_CHARS} chars)`;
  }
  for (const { re, msg } of FORBIDDEN_BODY_TRANSFORM_PATTERNS) {
    if (re.test(trimmed)) return msg;
  }
  return null;
}
