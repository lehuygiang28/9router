import { afterEach, describe, expect, it } from "vitest";
import {
  UTC_TIME_ZONE,
  formatInTimeZone,
  getDateKeyInZone,
  getUtcDateKey,
  isValidIanaTimeZone,
  parseTimestamp,
  parseViewerFilterStartMs,
  resolveViewerTimeZone,
  resetServerTimeZoneCache,
  startOfDayInViewerZoneMs,
  toUtcIso,
  viewerWallClockToUtc,
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

  it("toUtcIso always returns Z suffix", () => {
    expect(toUtcIso("2026-09-18T04:59:00")).toMatch(/Z$/);
    expect(toUtcIso("2026-09-18 04:59:00")).toBe("2026-09-18T04:59:00.000Z");
  });

  it("resolveViewerTimeZone falls back to UTC for invalid zones", () => {
    expect(resolveViewerTimeZone("Not/A/Zone")).toBe(UTC_TIME_ZONE);
    expect(resolveViewerTimeZone("")).toBe(UTC_TIME_ZONE);
    expect(isValidIanaTimeZone("America/Los_Angeles")).toBe(true);
  });

  it("getDateKeyInZone respects explicit zones around UTC midnight", () => {
    const instant = "2026-09-17T17:30:00.000Z";
    expect(getDateKeyInZone(instant, UTC_TIME_ZONE)).toBe("2026-09-17");
    expect(getDateKeyInZone(instant, "Asia/Ho_Chi_Minh")).toBe("2026-09-18");
    expect(getDateKeyInZone(instant, "America/Los_Angeles")).toBe("2026-09-17");
    expect(getUtcDateKey(instant)).toBe("2026-09-17");
  });

  it("startOfDayInViewerZoneMs differs by viewer zone", () => {
    const ref = "2026-09-17T17:30:00.000Z";
    const utcStart = startOfDayInViewerZoneMs(ref, UTC_TIME_ZONE);
    const laStart = startOfDayInViewerZoneMs(ref, "America/Los_Angeles");
    const vnStart = startOfDayInViewerZoneMs(ref, "Asia/Ho_Chi_Minh");
    expect(utcStart).toBe(Date.parse("2026-09-17T00:00:00.000Z"));
    expect(vnStart).toBeGreaterThan(utcStart);
    expect(laStart).toBeLessThan(utcStart);
  });

  it("formatInTimeZone uses passed zone", () => {
    expect(formatInTimeZone("2026-09-18T04:59:00.000Z", "Asia/Ho_Chi_Minh")).toBe("11:59:00");
    expect(formatInTimeZone("2026-09-18T04:59:00.000Z", "UTC")).toBe("04:59:00");
  });

  it("parseViewerFilterStartMs treats date-only as calendar day in viewer zone", () => {
    const laStart = parseViewerFilterStartMs("2026-09-17", "America/Los_Angeles");
    expect(getDateKeyInZone(laStart, "America/Los_Angeles")).toBe("2026-09-17");
  });

  it("viewerWallClockToUtc maps local wall clock to UTC", () => {
    const ms = viewerWallClockToUtc("2026-09-18T11:30", "Asia/Ho_Chi_Minh");
    expect(new Date(ms).toISOString()).toBe("2026-09-18T04:30:00.000Z");
  });
});
