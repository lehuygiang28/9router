import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached = null;

function examplesDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "../body-transform-examples");
}

/**
 * @returns {Array<{ id: string, label: string, description: string, afterHint?: string, script: string, sample: object }>}
 */
export function loadBodyTransformExamples() {
  if (cached) return cached;
  const dir = examplesDir();
  const manifest = JSON.parse(readFileSync(join(dir, "examples.json"), "utf8"));
  cached = manifest.map((entry) => {
    const script = readFileSync(join(dir, entry.scriptFile), "utf8").trim();
    const sample = JSON.parse(readFileSync(join(dir, entry.sampleFile), "utf8"));
    return {
      id: entry.id,
      label: entry.label,
      description: entry.description,
      afterHint: entry.afterHint,
      script,
      sample,
    };
  });
  return cached;
}

export function getBodyTransformExampleById(id) {
  return loadBodyTransformExamples().find((e) => e.id === id) || null;
}
