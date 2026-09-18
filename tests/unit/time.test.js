import { afterEach, describe, expect, it } from "vitest";
import {
  formatInTimeZone,
  formatLocalDateTime,
  getDateKeyForAggregation,
  getDateKeyInZone,
  getUtcDateKey,
  parseTimestamp,
  resetServerTimeZoneCache,
  toUtcIso,
} from "@/lib/time.js";

afterEach(() => {
  delete process.env.DISPLAY_TIMEZONE;
  delete process.env.APP_TIMEZONE;
  resetServerTimeZoneCache();
});

describe("time helpers", () => {
  it("parseTimestamp treats naive ISO as UTC (missing Z)", () => {
    const d = parseTimestamp("2026-09-18T04:59:00");
    expect(d).not.toBeNull();
    expect(d.toISOString()).toBe("2026-09-18T04:59:00.000Z");
  });

  it("parseTimestamp keeps explicit Z as UTC", () => {
    const d = parseTimestamp("2026-09-18T04:59:00.000Z");
    expect(d.toISOString()).toBe("2026-09-18T04:59:00.000Z");
  });

  it("toUtcIso always returns Z suffix", () => {
    expect(toUtcIso("2026-09-18T04:59:00")).toMatch(/Z$/);
    expect(toUtcIso("2026-09-18 04:59:00")).toBe("2026-09-18T04:59:00.000Z");
  });

  it("formatInTimeZone respects explicit timeZone argument", () => {
    expect(formatInTimeZone("2026-09-18T04:59:00.000Z", "Asia/Ho_Chi_Minh")).toBe("11:59:00");
    expect(formatInTimeZone("2026-09-18T04:59:00.000Z", "UTC")).toBe("04:59:00");
  });

  it("getDateKeyForAggregation uses UTC when no server TZ override", () => {
    expect(getDateKeyForAggregation("2026-09-17T17:30:00.000Z")).toBe("2026-09-17");
    expect(getUtcDateKey("2026-09-17T17:30:00.000Z")).toBe("2026-09-17");
  });

  it("getDateKeyForAggregation uses DISPLAY_TIMEZONE when set", () => {
    process.env.DISPLAY_TIMEZONE = "Asia/Ho_Chi_Minh";
    resetServerTimeZoneCache();
    expect(getDateKeyForAggregation("2026-09-17T17:30:00.000Z")).toBe("2026-09-18");
    expect(getDateKeyInZone("2026-09-17T16:59:59.000Z", "Asia/Ho_Chi_Minh")).toBe("2026-09-17");
  });

  it("formatLocalDateTime does not require a fixed IANA zone", () => {
    const out = formatLocalDateTime("2026-09-18T04:59:00.000Z");
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
