import { withViewerTimeZoneQuery } from "@/lib/time.js";

export function formatUsageDateInput(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function defaultCustomRangeDates() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return { startDate: formatUsageDateInput(start), endDate: formatUsageDateInput(end) };
}

export function buildUsagePeriodSearchParams(period, customRange) {
  const params = new URLSearchParams();
  params.set("period", period);
  if (period === "custom" && customRange?.startDate && customRange?.endDate) {
    params.set("startDate", customRange.startDate);
    params.set("endDate", customRange.endDate);
  }
  return params;
}

export function usageStatsApiUrl(period, customRange) {
  const qs = buildUsagePeriodSearchParams(period, customRange).toString();
  return withViewerTimeZoneQuery(`/api/usage/stats?${qs}`);
}

export function usageChartApiUrl(period, customRange) {
  const qs = buildUsagePeriodSearchParams(period, customRange).toString();
  return withViewerTimeZoneQuery(`/api/usage/chart?${qs}`);
}
