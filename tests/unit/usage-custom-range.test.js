import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseUsagePeriodFromSearchParams } from "@/lib/api/usageQuery.js";

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

describe("usage custom date range", () => {
  describe("parseUsagePeriodFromSearchParams", () => {
    it("accepts custom range with startDate and endDate", () => {
      const params = new URLSearchParams({
        period: "custom",
        startDate: "2025-03-01",
        endDate: "2025-03-07",
      });
      const parsed = parseUsagePeriodFromSearchParams(params, "UTC");
      expect(parsed.ok).toBe(true);
      expect(parsed.period).toBe("custom");
      expect(parsed.customRange.startDate).toBe("2025-03-01");
      expect(parsed.customRange.endExclusiveMs).toBeGreaterThan(parsed.customRange.startMs);
    });

    it("rejects inverted range", () => {
      const params = new URLSearchParams({
        period: "custom",
        startDate: "2025-03-10",
        endDate: "2025-03-01",
      });
      const parsed = parseUsagePeriodFromSearchParams(params, "UTC");
      expect(parsed.ok).toBe(false);
    });
  });

  let usageRepo;

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
  });

  afterEach(() => {
    vi.doUnmock("@/lib/db/driver.js");
    vi.resetModules();
  });

  it("getUsageStats custom uses bounded timestamp SQL aggregates", async () => {
    const customRange = parseUsagePeriodFromSearchParams(
      new URLSearchParams({ period: "custom", startDate: "2025-01-01", endDate: "2025-01-31" }),
      "UTC",
    ).customRange;
    await usageRepo.getUsageStats("custom", "UTC", customRange);
    const bounded = sqlLog.find((s) => /timestamp >=/i.test(s) && /timestamp </i.test(s) && /GROUP BY provider/i.test(s));
    expect(bounded).toBeTruthy();
  });

  it("getChartData custom queries history with upper bound", async () => {
    sqlLog.length = 0;
    const customRange = parseUsagePeriodFromSearchParams(
      new URLSearchParams({ period: "custom", startDate: "2025-02-01", endDate: "2025-02-05" }),
      "UTC",
    ).customRange;
    await usageRepo.getChartData("custom", "UTC", customRange);
    const chart = sqlLog.find((s) => /minute_key/i.test(s) && /timestamp </i.test(s));
    expect(chart).toBeTruthy();
  });
});
