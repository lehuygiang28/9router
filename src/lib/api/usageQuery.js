import {
  buildViewerDayStartsBetween,
  getDateKeyInZone,
  parseViewerFilterEndMs,
  parseViewerFilterStartMs,
  resolveViewerTimeZone,
  viewerDayEndExclusiveMs,
} from "@/lib/time.js";

export const PRESET_USAGE_PERIODS = ["today", "24h", "7d", "30d", "60d", "all"];
export const MAX_CUSTOM_USAGE_RANGE_DAYS = 366;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reject impossible dates (e.g. 2025-02-30) that would normalize silently. */
function isStrictViewerDateOnly(value, timeZone) {
  const trimmed = value?.trim() || "";
  if (!DATE_ONLY_RE.test(trimmed)) return false;
  const startMs = parseViewerFilterStartMs(trimmed, timeZone);
  if (startMs == null) return false;
  return getDateKeyInZone(startMs, timeZone) === trimmed;
}

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
    if (!isStrictViewerDateOnly(startDate, tz) || !isStrictViewerDateOnly(endDate, tz)) {
      return { ok: false, error: "Invalid custom date range" };
    }
    const startMs = parseViewerFilterStartMs(startDate, tz);
    const endMs = parseViewerFilterEndMs(endDate, tz);
    if (!startMs || !endMs || startMs > endMs) {
      return { ok: false, error: "Invalid custom date range" };
    }
    const endExclusiveMs = viewerDayEndExclusiveMs(endMs, tz);
    const calendarDays = buildViewerDayStartsBetween(startMs, endMs, tz).length;
    if (calendarDays > MAX_CUSTOM_USAGE_RANGE_DAYS) {
      return { ok: false, error: `Date range cannot exceed ${MAX_CUSTOM_USAGE_RANGE_DAYS} days` };
    }
    return {
      ok: true,
      period: "custom",
      cacheKey: `custom|${startDate}|${endDate}`,
      customRange: { startDate, endDate, startMs, endMs, endExclusiveMs },
    };
  }

  if (!PRESET_USAGE_PERIODS.includes(period)) {
    return { ok: false, error: "Invalid period" };
  }

  return { ok: true, period, cacheKey: period, customRange: null };
}
