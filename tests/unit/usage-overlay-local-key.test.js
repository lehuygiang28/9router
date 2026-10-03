import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stringifyJson } from "@/lib/db/helpers/jsonCol.js";

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-overlay-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.DATABASE_URL;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

describe("usageDaily lastUsed overlay for local traffic", () => {
  it("refines lastUsed on local-no-key|model|provider buckets from usageDaily", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { getUsageStats } = await import("@/lib/db/repos/usageRepo.js");
    const db = await getAdapter();

    const todayKey = new Date().toISOString().slice(0, 10);
    const day = {
      requests: 1,
      promptTokens: 10,
      completionTokens: 5,
      cachedTokens: 0,
      cost: 0,
      byProvider: { openai: { requests: 1, promptTokens: 10, completionTokens: 5, cost: 0 } },
      byModel: {},
      byAccount: {},
      byApiKey: {
        "local-no-key|gpt-4|openai": {
          requests: 1,
          promptTokens: 10,
          completionTokens: 5,
          cost: 0,
          rawModel: "gpt-4",
          provider: "openai",
          apiKey: null,
        },
      },
      byEndpoint: {},
    };
    await db.run(
      `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`,
      [todayKey, stringifyJson(day)],
    );

    const preciseTs = new Date().toISOString();
    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES (?, 'openai', 'gpt-4', NULL, 10, 5, 0, 'ok', '{}', '{}')`,
      [preciseTs],
    );

    const stats = await getUsageStats("7d", "UTC");
    const entry = stats.byApiKey["local-no-key|gpt-4|openai"];
    expect(entry).toBeDefined();
    expect(entry.lastUsed).toBe(preciseTs);
  });
});
