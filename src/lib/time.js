/**
 * UTC storage + viewer-timezone metrics/display.
 * - Writes / DB: always UTC ISO with Z.
 * - UI: browser local (formatLocal*).
 * - Metrics / charts / day buckets: explicit viewer IANA zone from client (query param).
 * - Server console logs: process TZ, optional DISPLAY_TIMEZONE / APP_TIMEZONE override only.
 */

const TZ_SUFFIX_RE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

export const UTC_TIME_ZONE = "UTC";

let cachedServerLogTz;

/** Server log override only — not used for UI or usage metrics. */
export function getOptionalServerLogTimeZone() {
  if (cachedServerLogTz !== undefined) return cachedServerLogTz;
  if (typeof process === "undefined" || !process.env) {
    cachedServerLogTz = null;
    return null;
  }
  const fromEnv =
    process.env.DISPLAY_TIMEZONE ||
    process.env.APP_TIMEZONE ||
    process.env.DISPLAY_TIME_ZONE ||
    null;
  cachedServerLogTz = fromEnv || null;
  return cachedServerLogTz;
}

export function resetServerTimeZoneCache() {
  cachedServerLogTz = undefined;
}

export function resetDisplayTimeZoneCache() {
  resetServerTimeZoneCache();
}

export function isValidIanaTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timeZone.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Safe viewer zone for metrics/APIs; invalid or missing → UTC. */
export function resolveViewerTimeZone(input) {
  if (isValidIanaTimeZone(input)) return input.trim();
  return UTC_TIME_ZONE;
}

export function getBrowserViewerTimeZone() {
  if (typeof Intl === "undefined") return UTC_TIME_ZONE;
  try {
    return resolveViewerTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return UTC_TIME_ZONE;
  }
}

export function withViewerTimeZoneQuery(url) {
  const tz = encodeURIComponent(getBrowserViewerTimeZone());
  return url.includes("?") ? `${url}&timezone=${tz}` : `${url}?timezone=${tz}`;
}

export function parseTimestamp(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string") return null;

  const s = value.trim();
  if (!s) return null;

  if (TZ_SUFFIX_RE.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(`${normalized}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toUtcIso(value) {
  const d = parseTimestamp(value) ?? new Date();
  return d.toISOString();
}

export function normalizeTimestampForApi(value) {
  if (value == null || value === "") return value;
  const d = parseTimestamp(value);
  if (!d) return value;
  return d.toISOString();
}

export function getDateKeyInZone(value = new Date(), timeZone = UTC_TIME_ZONE) {
  const tz = resolveViewerTimeZone(timeZone);
  const d = parseTimestamp(value) ?? new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function getUtcDateKey(value = new Date()) {
  const d = parseTimestamp(value) ?? new Date();
  return d.toISOString().slice(0, 10);
}

export function startOfDayInViewerZoneMs(reference = new Date(), timeZone = UTC_TIME_ZONE) {
  const tz = resolveViewerTimeZone(timeZone);
  const ref = parseTimestamp(reference) ?? new Date();
  if (tz === UTC_TIME_ZONE) {
    const d = ref;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const key = getDateKeyInZone(ref, tz);
  let lo = ref.getTime() - 26 * 3600000;
  let hi = ref.getTime();
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (getDateKeyInZone(new Date(mid), tz) === key) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** End of viewer calendar day (inclusive), as UTC ms. */
export function endOfDayInViewerZoneMs(reference = new Date(), timeZone = UTC_TIME_ZONE) {
  const start = startOfDayInViewerZoneMs(reference, timeZone);
  const nextDay = startOfDayInViewerZoneMs(start + 36 * 3600000, timeZone);
  if (nextDay <= start) return start + 86400000 - 1;
  return nextDay - 1;
}

export function formatLocalDateTime(value, locale) {
  const d = parseTimestamp(value);
  if (!d) return "";
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatLocalDate(value, locale) {
  const d = parseTimestamp(value);
  if (!d) return "";
  return d.toLocaleDateString(locale);
}

export function formatServerLogTime(value = new Date()) {
  const d = parseTimestamp(value) ?? new Date();
  const tz = getOptionalServerLogTimeZone();
  const opts = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat("en-GB", opts).format(d);
}

export function formatServerLogDate(value = new Date()) {
  const d = parseTimestamp(value) ?? new Date();
  const tz = getOptionalServerLogTimeZone();
  const opts = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  if (tz) opts.timeZone = tz;
  const parts = new Intl.DateTimeFormat("en-GB", opts).formatToParts(d);
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("day")}-${pick("month")}-${pick("year")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

export function formatChartTimeInZone(ms, timeZone = UTC_TIME_ZONE) {
  const tz = resolveViewerTimeZone(timeZone);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function formatChartDateInZone(ms, timeZone = UTC_TIME_ZONE) {
  const tz = resolveViewerTimeZone(timeZone);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

export function formatInTimeZone(value, timeZone, intlOptions = {}) {
  const d = parseTimestamp(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: resolveViewerTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...intlOptions,
  }).format(d);
}
