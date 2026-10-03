import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  withUsageReadCache,
  _resetUsageReadCacheForTests,
} from "@/lib/db/usageStatsCache.js";

describe("usageStatsCache", () => {
  beforeEach(() => {
    _resetUsageReadCacheForTests();
    vi.useRealTimers();
  });

  it("reuses loader result within TTL", async () => {
    const loader = vi.fn(async () => ({ n: 1 }));
    const a = await withUsageReadCache("stats", "7d", "UTC", loader);
    const b = await withUsageReadCache("stats", "7d", "UTC", loader);
    expect(a).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expires", async () => {
    vi.useFakeTimers();
    const loader = vi.fn()
      .mockResolvedValueOnce({ n: 1 })
      .mockResolvedValueOnce({ n: 2 });
    await withUsageReadCache("stats", "30d", "UTC", loader);
    vi.advanceTimersByTime(6000);
    const second = await withUsageReadCache("stats", "30d", "UTC", loader);
    expect(second).toEqual({ n: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
