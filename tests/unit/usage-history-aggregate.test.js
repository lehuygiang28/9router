import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { aggregateUsageStatsSince } from "@/lib/db/usageHistoryAggregate.js";
import { viewerPeriodStartMs, toUtcIso } from "@/lib/time.js";

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-uh-agg-"));
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

describe("usageHistoryAggregate", () => {
  it("respects viewer-local period cutoff for multi-day stats", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES (?, 'openai', 'gpt-4', 10, 5, 0.01, 'ok', '{}', '{}')`,
      ["2026-01-01T12:00:00.000Z"],
    );
    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES (?, 'openai', 'gpt-4', 20, 10, 0.02, 'ok', '{}', '{}')`,
      [new Date().toISOString()],
    );

    const cutoff = toUtcIso(viewerPeriodStartMs(7, Date.now(), "Asia/Ho_Chi_Minh"));
    const stats = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCachedTokens: 0,
      totalCost: 0,
      byProvider: {},
      byModel: {},
      byAccount: {},
      byApiKey: {},
      byEndpoint: {},
    };

    await aggregateUsageStatsSince(db, cutoff, {
      stats,
      connectionMap: {},
      providerNodeNameMap: {},
      apiKeyMap: {},
    });

    expect(stats.byProvider.openai.requests).toBe(1);
    expect(stats.byProvider.openai.promptTokens).toBe(20);
  });

  it("sums cached tokens from tokens JSON in SQL aggregates", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const cutoff = toUtcIso(viewerPeriodStartMs(7, Date.now(), "UTC"));
    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES (?, 'openai', 'gpt-4', 100, 50, 0, 'ok', ?, '{}')`,
      [new Date().toISOString(), JSON.stringify({ cached_tokens: 40 })],
    );

    const stats = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCachedTokens: 0,
      totalCost: 0,
      byProvider: {},
      byModel: {},
      byAccount: {},
      byApiKey: {},
      byEndpoint: {},
    };

    await aggregateUsageStatsSince(db, cutoff, {
      stats,
      connectionMap: {},
      providerNodeNameMap: {},
      apiKeyMap: {},
    });

    expect(stats.totalCachedTokens).toBe(40);
    expect(stats.byProvider.openai.cachedTokens).toBe(40);
  });

  it("does not double-count empty-string apiKey as both keyed and local-no-key", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const cutoff = toUtcIso(viewerPeriodStartMs(7, Date.now(), "UTC"));
    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, apiKey, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES (?, 'openai', 'gpt-4', '', 10, 5, 0, 'ok', '{}', '{}')`,
      [new Date().toISOString()],
    );

    const stats = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCachedTokens: 0,
      totalCost: 0,
      byProvider: {},
      byModel: {},
      byAccount: {},
      byApiKey: {},
      byEndpoint: {},
    };

    await aggregateUsageStatsSince(db, cutoff, {
      stats,
      connectionMap: {},
      providerNodeNameMap: {},
      apiKeyMap: {},
    });

    const keyed = Object.keys(stats.byApiKey).filter((k) => k !== "local-no-key");
    expect(keyed).toHaveLength(0);
    expect(stats.byProvider.openai.requests).toBe(1);
    expect(stats.byApiKey["local-no-key"].requests).toBe(1);
  });
});
