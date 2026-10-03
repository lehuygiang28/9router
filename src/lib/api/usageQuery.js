import {
  parseViewerFilterEndMs,
  parseViewerFilterStartMs,
  resolveViewerTimeZone,
  viewerDayEndExclusiveMs,
} from "@/lib/time.js";

export const PRESET_USAGE_PERIODS = ["today", "24h", "7d", "30d", "60d", "all"];
export const MAX_CUSTOM_USAGE_RANGE_DAYS = 366;

/**
 * @param {URLSearchParams} searchParams
 * @param {string} viewerTimeZone
 * @returns {{ ok: true, period: string, cacheKey: string, customRange: object | null } | { ok: false, error: string }}
 */
export function parseUsagePeriodFromSearchParams(searchParams, viewerTimeZone) {
  const tz = resolveViewerTimeZone(viewerTimeZone);
  const period = (searchParams.get("period") || "7d").trim();

  if (period === "custom") {
    const startDate = searchParams.get("startDate")?.trim() || "";
    const endDate = searchParams.get("endDate")?.trim() || "";
    const startMs = parseViewerFilterStartMs(startDate, tz);
    const endMs = parseViewerFilterEndMs(endDate, tz);
    if (!startMs || !endMs || startMs > endMs) {
      return { ok: false, error: "Invalid custom date range" };
    }
    const endExclusiveMs = viewerDayEndExclusiveMs(endMs, tz);
    const spanDays = Math.ceil((endExclusiveMs - startMs) / 86400000);
    if (spanDays > MAX_CUSTOM_USAGE_RANGE_DAYS) {
      return { ok: false, error: `Date range cannot exceed ${MAX_CUSTOM_USAGE_RANGE_DAYS} days` };
    }
    return {
      ok: true,
      period: "custom",
      cacheKey: `custom|${startDate}|${endDate}`,
      customRange: { startDate, endDate, startMs, endExclusiveMs },
    };
  }

  if (!PRESET_USAGE_PERIODS.includes(period)) {
    return { ok: false, error: "Invalid period" };
  }

  return { ok: true, period, cacheKey: period, customRange: null };
}
