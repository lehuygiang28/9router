#!/usr/bin/env node
/**
 * Merge helper: fail if adapter call sites under src/lib/db are missing await.
 * Skip adapters/ and dialect/ (sync sqlite drivers + SQL rewriter).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbRoot = path.join(root, "src/lib/db");
const skip = new Set(["adapters", "dialect"]);
const CALL = /\b(db|adapter)\.(run|get|all|exec|transaction)\(/;
const DEF = /^\s*(async\s+)?function\s+(run|get|all|exec|transaction)\b/;

const failures = [];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (skip.has(ent.name)) continue;
      walk(path.join(dir, ent.name));
      continue;
    }
    if (!ent.name.endsWith(".js")) continue;
    const file = path.join(dir, ent.name);
    const lines = fs.readFileSync(file, "utf8").split(/\n/);
    lines.forEach((line, i) => {
      if (!CALL.test(line)) return;
      if (DEF.test(line)) return;
      if (/\bawait\b/.test(line)) return;
      failures.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
    });
  }
}

walk(dbRoot);
if (failures.length) {
  console.error("Missing await on adapter calls:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("ensure-await-adapter: ok");
