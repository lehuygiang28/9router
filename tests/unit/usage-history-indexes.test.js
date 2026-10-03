import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-uh-idx-"));
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

describe("usageHistory indexes (SQLite)", () => {
  it("includes timestamp range and retention composite indexes", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const indexes = await db.all(`PRAGMA index_list(usageHistory)`);
    const names = indexes.map((r) => r.name);
    expect(names).toContain("idx_uh_ts");
    expect(names).toContain("idx_uh_ts_id");
  });
});
