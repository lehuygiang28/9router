/**
 * Live PostgreSQL integration tests (local Postgres or Docker).
 * Run: DATABASE_URL=postgres://... npx vitest run unit/db-postgres-live.integration.test.js
 * Skipped when DATABASE_URL is unset.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const describeLive = DATABASE_URL ? describe : describe.skip;

const EXPECTED_TABLES = [
  "_meta", "settings", "providerConnections", "providerNodes",
  "proxyPools", "apiKeys", "combos", "kv", "usageHistory", "usageDaily", "requestDetails",
];

let tempDir;
let adminPool;
const originalDataDir = process.env.DATA_DIR;
const originalDbUrl = process.env.DATABASE_URL;
const originalObs = process.env.OBSERVABILITY_ENABLED;

function resetDbSingleton() {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
}

async function resetPostgresSchema() {
  const client = await adminPool.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO PUBLIC");
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pg-live-"));
  process.env.DATA_DIR = tempDir;
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.OBSERVABILITY_ENABLED = "true";
  adminPool = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  try { await adminPool?.end(); } catch {}
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDbUrl;
  if (originalObs === undefined) delete process.env.OBSERVABILITY_ENABLED;
  else process.env.OBSERVABILITY_ENABLED = originalObs;
});

beforeEach(async () => {
  if (!DATABASE_URL) return;
  resetDbSingleton();
  await resetPostgresSchema();
});

describeLive("PostgreSQL live integration", () => {
  it("connects with driver=postgres and runs migrations", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    expect(db.driver).toBe("postgres");

    const row = await db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());
  });

  it("creates the same core tables as SQLite", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
    const names = tables.map((t) => t.name);
    for (const t of EXPECTED_TABLES) expect(names).toContain(t);
  });

  it("re-applies pending migrations after schemaVersion is rolled back", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    await db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ pg: true })],
    );
    await db.run(`UPDATE _meta SET value = '0' WHERE key = 'schemaVersion'`);
    db.close?.();
    resetDbSingleton();

    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db2 = await getAdapter2();
    const row = await db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());
    const settings = await db2.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ pg: true });
  });

  it("imports legacy db.json on first boot (same as SQLite path)", async () => {
    const legacy = {
      settings: { imported: "from-json" },
      apiKeys: [{ id: "k-pg", key: "sk-pg-test", name: "pg", createdAt: new Date().toISOString() }],
      modelAliases: { "gpt-4": "gpt-4-turbo" },
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const settings = await db.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ imported: "from-json" });
    const keys = await db.all(`SELECT * FROM apiKeys`);
    expect(keys.some((k) => k.key === "sk-pg-test")).toBe(true);
    const aliases = await db.all(`SELECT * FROM kv WHERE scope='modelAliases'`);
    expect(aliases.length).toBeGreaterThanOrEqual(1);
  });

  it("auto-sync re-creates a dropped index via PRAGMA index_list", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    await db.exec(`DROP INDEX IF EXISTS idx_pn_type`);
    expect((await db.all(`PRAGMA index_list(providerNodes)`)).map((i) => i.name)).not.toContain("idx_pn_type");
    db.close?.();
    resetDbSingleton();

    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const idx = (await db2.all(`PRAGMA index_list(providerNodes)`)).map((i) => i.name);
    expect(idx).toContain("idx_pn_type");
  });

  it("round-trips provider connections, combos, and usage", async () => {
    const {
      createProviderConnection,
      getProviderConnections,
      createCombo,
      getCombos,
      saveRequestUsage,
      getUsageStats,
      getUsageHistory,
    } = await import("@/lib/db/index.js");

    const conn = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      name: "PG test",
      priority: 1,
      isActive: true,
      apiKey: "secret",
    });
    const conns = await getProviderConnections();
    expect(conns.find((c) => c.id === conn.id)?.name).toBe("PG test");

    const combo = await createCombo({
      name: `pg-combo-${Date.now()}`,
      models: ["gpt-4|openai"],
    });
    const combos = await getCombos();
    expect(combos.find((c) => c.id === combo.id)?.name).toBe(combo.name);

    await saveRequestUsage({
      provider: "openai",
      model: "gpt-4",
      connectionId: conn.id,
      endpoint: "/v1/chat",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      status: "ok",
    });

    const stats = await getUsageStats("7d");
    expect(stats.totalRequests).toBeGreaterThanOrEqual(0);
    expect(stats.totalPromptTokens + stats.totalCompletionTokens).toBeGreaterThanOrEqual(15);
    const history = await getUsageHistory({ limit: 10 });
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it("stores and lists request details", async () => {
    const { updateSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const { saveRequestDetail, getRequestDetails, getRequestDetailById, __test__ } = await import("@/lib/db/repos/requestDetailsRepo.js");

    await updateSettings({ enableObservability: true });
    await saveRequestDetail({
      id: "req-pg-1",
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4",
      connectionId: "conn-pg-1",
      status: "ok",
      tokens: { prompt_tokens: 3, completion_tokens: 4 },
      latency: { total: 99 },
      request: { body: "secret-req" },
      response: { body: "secret-res" },
    });
    await __test__.flushToDatabase();

    const list = await getRequestDetails({ page: 1, pageSize: 5 });
    const row = list.details.find((r) => r.id === "req-pg-1");
    expect(row).toBeTruthy();
    expect(row.tokens?.prompt_tokens).toBe(3);
    expect(row.latency?.total).toBe(99);
    expect(row.request).toBeUndefined();

    const full = await getRequestDetailById("req-pg-1");
    expect(full?.request?.body).toBe("secret-req");
  });

  it("exportDb/importDb round-trip preserves settings and keys", async () => {
    const dbApi = await import("@/lib/db/index.js");
    await dbApi.createApiKey("export-key", "machine-pg-test");
    const exported = await dbApi.exportDb();
    expect(exported.apiKeys.length).toBeGreaterThanOrEqual(1);

    await dbApi.importDb({
      ...exported,
      settings: { ...exported.settings, roundTrip: true },
    });
    const settings = await dbApi.getSettings();
    expect(settings.roundTrip).toBe(true);
  });
});
