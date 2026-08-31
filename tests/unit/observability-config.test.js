import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalEnableRequestLogs = process.env.ENABLE_REQUEST_LOGS;
const originalObservabilityEnabled = process.env.OBSERVABILITY_ENABLED;
const originalMaxJsonSize = process.env.OBSERVABILITY_MAX_JSON_SIZE;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-obs-"));
  process.env.DATA_DIR = tempDir;
  if (originalDatabaseUrl !== undefined) delete process.env.DATABASE_URL;
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
  if (originalEnableRequestLogs === undefined) delete process.env.ENABLE_REQUEST_LOGS;
  else process.env.ENABLE_REQUEST_LOGS = originalEnableRequestLogs;
  if (originalObservabilityEnabled === undefined) delete process.env.OBSERVABILITY_ENABLED;
  else process.env.OBSERVABILITY_ENABLED = originalObservabilityEnabled;
  if (originalMaxJsonSize === undefined) delete process.env.OBSERVABILITY_MAX_JSON_SIZE;
  else process.env.OBSERVABILITY_MAX_JSON_SIZE = originalMaxJsonSize;
});

describe("observability config priority", () => {
  it("uses Profile enableObservability=true even when ENABLE_REQUEST_LOGS=false", async () => {
    process.env.ENABLE_REQUEST_LOGS = "false";
    process.env.OBSERVABILITY_ENABLED = "false";

    const db = await import("@/lib/db/index.js");
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });

    const { saveRequestDetail, getRequestDetails, __test__ } = await import("@/lib/db/repos/requestDetailsRepo.js");
    await saveRequestDetail({
      id: "obs-ui-on",
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4",
      status: "ok",
      tokens: { prompt_tokens: 1, completion_tokens: 2 },
      latency: { total: 10 },
      request: { body: "hi" },
      response: { content: "hello" },
    });
    await __test__.flushToDatabase();

    const list = await getRequestDetails({ page: 1, pageSize: 5 });
    expect(list.details.some((d) => d.id === "obs-ui-on")).toBe(true);
  });

  it("uses Profile enableObservability=false even when OBSERVABILITY_ENABLED=true", async () => {
    process.env.OBSERVABILITY_ENABLED = "true";
    delete process.env.ENABLE_REQUEST_LOGS;

    const db = await import("@/lib/db/index.js");
    await db.updateSettings({ enableObservability: false, observabilityBatchSize: 1 });

    const { saveRequestDetail, getRequestDetails, __test__ } = await import("@/lib/db/repos/requestDetailsRepo.js");
    await saveRequestDetail({
      id: "obs-ui-off",
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4",
      status: "ok",
      tokens: { prompt_tokens: 1 },
    });
    await __test__.flushToDatabase();

    const list = await getRequestDetails({ page: 1, pageSize: 5 });
    expect(list.details.some((d) => d.id === "obs-ui-off")).toBe(false);
  });

  it("falls back to ENABLE_REQUEST_LOGS before any Profile save", async () => {
    process.env.ENABLE_REQUEST_LOGS = "true";
    delete process.env.OBSERVABILITY_ENABLED;

    const { saveRequestDetail, getRequestDetails, __test__ } = await import("@/lib/db/repos/requestDetailsRepo.js");
    await saveRequestDetail({
      id: "obs-env-on",
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4",
      status: "ok",
      tokens: { prompt_tokens: 1 },
    });
    await __test__.flushToDatabase();

    const list = await getRequestDetails({ page: 1, pageSize: 5 });
    expect(list.details.some((d) => d.id === "obs-env-on")).toBe(true);
  });

  it("stores ~6 KB request bodies without truncation at default 128 KB cap", async () => {
    delete process.env.OBSERVABILITY_MAX_JSON_SIZE;
    const db = await import("@/lib/db/index.js");
    await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });

    const payload = { blob: "x".repeat(6000) };
    const { saveRequestDetail, getRequestDetailById, __test__ } = await import("@/lib/db/repos/requestDetailsRepo.js");
    await saveRequestDetail({
      id: "obs-6k",
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4",
      status: "ok",
      tokens: { prompt_tokens: 1 },
      request: payload,
      response: { content: "ok" },
    });
    await __test__.flushToDatabase();

    const got = await getRequestDetailById("obs-6k");
    expect(got.request.blob).toHaveLength(6000);
    expect(got.request._truncated).toBeUndefined();
  });

  it("bumps persisted observabilityMaxJsonSize 5 → 128 on boot", async () => {
    delete process.env.OBSERVABILITY_MAX_JSON_SIZE;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    await db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ observabilityMaxJsonSize: 5, enableObservability: true })],
    );
    db.close?.();
    delete global._dbAdapter;
    vi.resetModules();

    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const row = await db2.get(`SELECT data FROM settings WHERE id = 1`);
    expect(JSON.parse(row.data).observabilityMaxJsonSize).toBe(128);
  });
});
