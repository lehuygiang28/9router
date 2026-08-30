import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalRetentionEnv = process.env.USAGE_HISTORY_RETENTION_DAYS;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-uh-ret-"));
  process.env.DATA_DIR = tempDir;
  if (originalDatabaseUrl !== undefined) delete process.env.DATABASE_URL;
  delete process.env.USAGE_HISTORY_RETENTION_DAYS;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalRetentionEnv === undefined) delete process.env.USAGE_HISTORY_RETENTION_DAYS;
  else process.env.USAGE_HISTORY_RETENTION_DAYS = originalRetentionEnv;
});

describe("usageHistory retention", () => {
  it("resolveUsageHistoryRetentionDays prefers env, then settings, then default", async () => {
    const {
      resolveUsageHistoryRetentionDays,
      DEFAULT_RETENTION_DAYS,
    } = await import("@/lib/db/usageHistoryRetention.js");

    expect(resolveUsageHistoryRetentionDays({})).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveUsageHistoryRetentionDays({ usageHistoryRetentionDays: 30 })).toBe(30);

    process.env.USAGE_HISTORY_RETENTION_DAYS = "14";
    expect(resolveUsageHistoryRetentionDays({ usageHistoryRetentionDays: 30 })).toBe(14);

    process.env.USAGE_HISTORY_RETENTION_DAYS = "0";
    expect(resolveUsageHistoryRetentionDays({})).toBe(0);
  });

  it("prunes usageHistory older than retention but keeps usageDaily", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const {
      pruneUsageHistory,
      _resetUsageHistoryRetentionScheduleForTests,
    } = await import("@/lib/db/usageHistoryRetention.js");
    _resetUsageHistoryRetentionScheduleForTests();

    const db = await getAdapter();
    const oldTs = new Date(Date.now() - 120 * 86400000).toISOString();
    const recentTs = new Date().toISOString();

    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, 'openai', 'gpt-4', 10, 5, 0.01, 'ok', '{}', '{}')`,
      [oldTs],
    );
    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, 'openai', 'gpt-4o', 20, 10, 0.02, 'ok', '{}', '{}')`,
      [recentTs],
    );
    await db.run(
      `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`,
      ["2020-01-01", JSON.stringify({ requests: 99, promptTokens: 1, completionTokens: 1, cost: 0.5 })],
    );

    const result = await pruneUsageHistory({ retentionDays: 90, force: true, adapter: db });
    expect(result.deleted).toBe(1);
    expect(result.skipped).toBe(false);

    const rows = await db.all(`SELECT timestamp FROM usageHistory ORDER BY timestamp ASC`);
    expect(rows).toHaveLength(1);
    expect(rows[0].timestamp).toBe(recentTs);

    const daily = await db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, ["2020-01-01"]);
    expect(JSON.parse(daily.data).requests).toBe(99);
  });

  it("skips prune within 24h unless force=true", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { pruneUsageHistory, _resetUsageHistoryRetentionScheduleForTests } = await import("@/lib/db/usageHistoryRetention.js");
    const { setMeta } = await import("@/lib/db/helpers/metaStore.js");
    _resetUsageHistoryRetentionScheduleForTests();

    const db = await getAdapter();
    const oldTs = new Date(Date.now() - 120 * 86400000).toISOString();
    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, 'openai', 'gpt-4', 1, 1, 0, 'ok', '{}', '{}')`,
      [oldTs],
    );

    await setMeta("usageHistoryLastPruneAt", new Date().toISOString());

    const skipped = await pruneUsageHistory({ retentionDays: 90, adapter: db });
    expect(skipped.skipped).toBe(true);
    expect(skipped.reason).toBe("interval");

    const countBeforeForce = await db.get(`SELECT COUNT(*) as c FROM usageHistory`);
    expect(countBeforeForce.c).toBe(1);

    const forced = await pruneUsageHistory({ retentionDays: 90, force: true, adapter: db });
    expect(forced.deleted).toBe(1);

    const countAfter = await db.get(`SELECT COUNT(*) as c FROM usageHistory`);
    expect(countAfter.c).toBe(0);
  });

  it("retentionDays=0 disables pruning", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { pruneUsageHistory, _resetUsageHistoryRetentionScheduleForTests } = await import("@/lib/db/usageHistoryRetention.js");
    _resetUsageHistoryRetentionScheduleForTests();

    const db = await getAdapter();
    const oldTs = new Date(Date.now() - 365 * 86400000).toISOString();
    await db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, 'openai', 'gpt-4', 1, 1, 0, 'ok', '{}', '{}')`,
      [oldTs],
    );

    const result = await pruneUsageHistory({ retentionDays: 0, force: true, adapter: db });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("disabled");

    const count = await db.get(`SELECT COUNT(*) as c FROM usageHistory`);
    expect(count.c).toBe(1);
  });
});
