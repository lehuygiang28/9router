import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

const sqlLog = [];

function makeFakeAdapter() {
  return {
    driver: "fake",
    async: true,
    async get(sql) {
      sqlLog.push(sql);
      if (/COUNT\(\*\)/.test(sql)) return { c: 0 };
      if (/FROM settings/.test(sql)) return { data: "{}" };
      if (/FROM _meta/.test(sql)) return { value: "0" };
      return undefined;
    },
    async all(sql) {
      sqlLog.push(sql);
      return [];
    },
    async run(sql) {
      sqlLog.push(sql);
      return { changes: 0 };
    },
    async exec(sql) { sqlLog.push(sql); },
    async transaction(fn) { return fn(); },
  };
}

describe("usage read-path SQL", () => {
  let usageRepo;
  let detailsRepo;

  beforeEach(async () => {
    sqlLog.length = 0;
    vi.resetModules();
    delete global._dbAdapter;
    vi.doMock("@/lib/db/driver.js", () => ({
      getAdapter: async () => makeFakeAdapter(),
      getAdapterSync: () => makeFakeAdapter(),
      promisifyAdapter: (a) => a,
    }));
    usageRepo = await import("@/lib/db/repos/usageRepo.js");
    detailsRepo = await import("@/lib/db/repos/requestDetailsRepo.js");
  });

  afterEach(() => {
    vi.doUnmock("@/lib/db/driver.js");
    vi.resetModules();
  });

  it("getUsageStats('all') does not scan usageHistory for lastUsed overlay", async () => {
    await usageRepo.getUsageStats("all");
    const unboundedOverlay = sqlLog.filter((s) =>
      /FROM usageHistory/i.test(s)
      && /timestamp >=/i.test(s)
      && !/GROUP BY/i.test(s)
      && !/timestamp <=/i.test(s)
    );
    expect(unboundedOverlay).toHaveLength(0);
  });

  it("getUsageStats('7d') overlays lastUsed with GROUP BY MAX(timestamp)", async () => {
    await usageRepo.getUsageStats("7d");
    const overlay = sqlLog.find((s) => /FROM usageHistory/i.test(s) && /GROUP BY/i.test(s));
    expect(overlay).toBeTruthy();
    expect(overlay).toMatch(/MAX\(timestamp\)/i);
  });

  it("getUsageHistory applies a LIMIT", async () => {
    await usageRepo.getUsageHistory({});
    const q = sqlLog.find((s) => /FROM usageHistory/i.test(s) && /LIMIT/i.test(s));
    expect(q).toBeTruthy();
  });

  it("getRequestDetails list projects tokens/latency and does not keep request bodies", async () => {
    await detailsRepo.getRequestDetails({ page: 1, pageSize: 20 });
    const q = sqlLog.find((s) => /FROM requestDetails/i.test(s) && /LIMIT/i.test(s));
    expect(q).toBeTruthy();
    expect(q).toMatch(/SELECT id, timestamp, provider, model, connectionId, status, data/i);
  });
});

describe("usage stream route", () => {
  it("does not call getUsageStats", () => {
    const src = fs.readFileSync(
      new URL("../../src/app/api/usage/stream/route.js", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/getUsageStats/);
    expect(src).toMatch(/getActiveRequests/);
  });
});
