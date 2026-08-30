import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createPostgresAdapter } from "@/lib/db/adapters/postgresAdapter.js";
import { runMigrationOnce } from "@/lib/db/migrate.js";
import { stringifyJson, parseJson } from "@/lib/db/helpers/jsonCol.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let pglite;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pg-"));
  process.env.DATA_DIR = tempDir;
  pglite = new PGlite();
  await pglite.waitReady;
  db = await createPostgresAdapter({
    query: async (sql, params = []) => pglite.query(sql, params),
  });
  await runMigrationOnce(db);
});

afterAll(async () => {
  try { await db.close?.(); } catch {}
  try { await pglite?.close?.(); } catch {}
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Postgres adapter (PGlite)", () => {
  it("creates camelCase tables and stamps schemaVersion", async () => {
    const row = await db.get(`SELECT value FROM _meta WHERE key = ?`, ["schemaVersion"]);
    expect(parseInt(row.value, 10)).toBeGreaterThanOrEqual(1);
    const tables = await db.all(`SELECT name FROM sqlite_master WHERE type='table'`);
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      "_meta", "settings", "providerConnections", "usageHistory", "requestDetails",
    ]));
  });

  it("upserts settings and reads JSON data", async () => {
    await db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson({ cloudEnabled: true })],
    );
    const row = await db.get(`SELECT data FROM settings WHERE id = 1`);
    expect(parseJson(row.data, {})).toEqual({ cloudEnabled: true });
  });

  it("round-trips camelCase connection columns", async () => {
    await db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["c1", "openai", "apikey", "n", null, 1, 1, stringifyJson({ apiKey: "k" }), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    );
    const row = await db.get(`SELECT * FROM providerConnections WHERE id = ?`, ["c1"]);
    expect(row.id).toBe("c1");
    expect(row.authType).toBe("apikey");
    expect(row.isActive).toBe(1);
    expect(row.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("inserts usageHistory and upserts usageDaily in a transaction", async () => {
    await db.transaction(async () => {
      await db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ["2026-01-02T00:00:00.000Z", "openai", "gpt-4", "c1", null, "/v1/chat", 3, 4, 0.1, "ok", stringifyJson({}), stringifyJson({})],
      );
      await db.run(
        `INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`,
        ["2026-01-02", stringifyJson({ requests: 1 })],
      );
    });
    const days = await db.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey = ?`, ["2026-01-02"]);
    expect(days).toHaveLength(1);
    expect(parseJson(days[0].data).requests).toBe(1);
    const hist = await db.all(`SELECT promptTokens, completionTokens FROM usageHistory`);
    expect(hist[0].promptTokens).toBe(3);
    expect(hist[0].completionTokens).toBe(4);
  });

  it("returns COUNT(*) as a number", async () => {
    const row = await db.get(`SELECT COUNT(*) as c FROM requestDetails`);
    expect(typeof row.c).toBe("number");
  });

  it("paginates requestDetails via json_extract list columns", async () => {
    await db.run(
      `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
      ["d1", "2026-01-03T00:00:00.000Z", "openai", "gpt-4", "c1", "ok", stringifyJson({ tokens: { prompt_tokens: 9 }, latency: { total: 12 } })],
    );
    const rows = await db.all(
      `SELECT id, timestamp, provider, model, connectionId, status,
              json_extract(data, '$.tokens') AS tokens,
              json_extract(data, '$.latency') AS latency
       FROM requestDetails ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [10, 0],
    );
    expect(rows[0].id).toBe("d1");
    const tokens = typeof rows[0].tokens === "string" ? JSON.parse(rows[0].tokens) : rows[0].tokens;
    expect(tokens.prompt_tokens).toBe(9);
  });
});
