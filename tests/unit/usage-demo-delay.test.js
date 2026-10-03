import { describe, it, expect, afterEach } from "vitest";
import {
  usageStatsDemoDelayMs,
  USAGE_STATS_DEMO_DELAY_MS_CAP,
} from "@/lib/api/usageDemoDelay.js";

describe("usageStatsDemoDelayMs", () => {
  const prev = process.env.USAGE_STATS_DEMO_DELAY_MS;

  afterEach(() => {
    if (prev === undefined) delete process.env.USAGE_STATS_DEMO_DELAY_MS;
    else process.env.USAGE_STATS_DEMO_DELAY_MS = prev;
  });

  it("returns 0 when unset", () => {
    delete process.env.USAGE_STATS_DEMO_DELAY_MS;
    expect(usageStatsDemoDelayMs()).toBe(0);
  });

  it("caps large values", () => {
    process.env.USAGE_STATS_DEMO_DELAY_MS = "999999";
    expect(usageStatsDemoDelayMs()).toBe(USAGE_STATS_DEMO_DELAY_MS_CAP);
  });
});
