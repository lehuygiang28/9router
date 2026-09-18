import { afterEach, describe, expect, it } from "vitest";
import {
  formatDisplayDateTime,
  formatDisplayTime,
  getDateKeyInZone,
  parseTimestamp,
  resetDisplayTimeZoneCache,
  toUtcIso,
} from "@/lib/time.js";

afterEach(() => {
  delete process.env.DISPLAY_TIMEZONE;
  delete process.env.APP_TIMEZONE;
  resetDisplayTimeZoneCache();
});

describe("time helpers", () => {
  it("parseTimestamp treats naive ISO as UTC (missing Z)", () => {
    process.env.DISPLAY_TIMEZONE = "Asia/Ho_Chi_Minh";
    resetDisplayTimeZoneCache();

    const d = parseTimestamp("2026-09-18T04:59:00");
    expect(d).not.toBeNull();
    expect(d.toISOString()).toBe("2026-09-18T04:59:00.000Z");
    expect(formatDisplayTime(d)).toBe("11:59:00");
  });

  it("parseTimestamp keeps explicit Z as UTC", () => {
    process.env.DISPLAY_TIMEZONE = "Asia/Ho_Chi_Minh";
    resetDisplayTimeZoneCache();

    const d = parseTimestamp("2026-09-18T04:59:00.000Z");
    expect(formatDisplayTime(d)).toBe("11:59:00");
  });

  it("toUtcIso always returns Z suffix", () => {
    expect(toUtcIso("2026-09-18T04:59:00")).toMatch(/Z$/);
    expect(toUtcIso("2026-09-18 04:59:00")).toBe("2026-09-18T04:59:00.000Z");
  });

  it("formatDisplayDateTime uses display zone not process TZ", () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "UTC";
    process.env.DISPLAY_TIMEZONE = "Asia/Ho_Chi_Minh";
    resetDisplayTimeZoneCache();

    const out = formatDisplayDateTime("2026-09-18T04:59:00.000Z");
    expect(out).toContain("11:59");

    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it("getDateKeyInZone uses Vietnam calendar day across UTC midnight", () => {
    process.env.DISPLAY_TIMEZONE = "Asia/Ho_Chi_Minh";
    resetDisplayTimeZoneCache();

    // 2026-09-17 17:30 UTC = 2026-09-18 00:30 ICT
    expect(getDateKeyInZone("2026-09-17T17:30:00.000Z")).toBe("2026-09-18");
    // Still previous VN day
    expect(getDateKeyInZone("2026-09-17T16:59:59.000Z")).toBe("2026-09-17");
  });
});
