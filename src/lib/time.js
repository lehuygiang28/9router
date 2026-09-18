/**
 * UTC-safe timestamps + formatting split by context:
 * - UI: browser/process local zone (no forced IANA default).
 * - Server logs / optional aggregates: DISPLAY_TIMEZONE or APP_TIMEZONE when set; else process TZ for logs, UTC for day buckets.
 */

const TZ_SUFFIX_RE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

let cachedServerTz;

/** Explicit operator override for server logs and server-side day aggregation only. */
export function getOptionalServerTimeZone() {
  if (cachedServerTz !== undefined) return cachedServerTz;
  if (typeof process === "undefined" || !process.env) {
    cachedServerTz = null;
    return null;
  }
  const fromEnv =
    process.env.DISPLAY_TIMEZONE ||
    process.env.APP_TIMEZONE ||
    process.env.DISPLAY_TIME_ZONE ||
    null;
  cachedServerTz = fromEnv || null;
  return cachedServerTz;
}

export function resetServerTimeZoneCache() {
  cachedServerTz = undefined;
}

/** @deprecated use resetServerTimeZoneCache */
export function resetDisplayTimeZoneCache() {
  resetServerTimeZoneCache();
}

/**
 * Parse timestamps from DB/API. Naive ISO / SQL datetimes without offset are treated as UTC.
 */
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

/** Always persist UTC ISO with Z. */
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

export function getDateKeyInZone(value = new Date(), timeZone) {
  const d = parseTimestamp(value) ?? new Date();
  const opts = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  if (timeZone) opts.timeZone = timeZone;
  return new Intl.DateTimeFormat("en-CA", opts).format(d);
}

export function getUtcDateKey(value = new Date()) {
  const d = parseTimestamp(value) ?? new Date();
  return d.toISOString().slice(0, 10);
}

/** Day bucket key: optional server TZ, otherwise UTC calendar day. */
export function getDateKeyForAggregation(value = new Date()) {
  const tz = getOptionalServerTimeZone();
  if (tz) return getDateKeyInZone(value, tz);
  return getUtcDateKey(value);
}

function startOfDayInZoneMs(reference, timeZone) {
  const ref = parseTimestamp(reference) ?? new Date();
  const key = getDateKeyInZone(ref, timeZone);
  let lo = ref.getTime() - 26 * 3600000;
  let hi = ref.getTime();
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (getDateKeyInZone(new Date(mid), timeZone) === key) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function startOfUtcDayMs(reference = new Date()) {
  const d = parseTimestamp(reference) ?? new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Start of calendar day for server-side charts/aggregates (UTC unless DISPLAY_TIMEZONE set). */
export function startOfDayForAggregationMs(reference = new Date()) {
  const tz = getOptionalServerTimeZone();
  if (tz) return startOfDayInZoneMs(reference, tz);
  return startOfUtcDayMs(reference);
}

/** Dashboard / client: user's local timezone (no timeZone option). */
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

function intlWithOptionalServerZone(value, intlOptions) {
  const d = parseTimestamp(value) ?? new Date();
  const tz = getOptionalServerTimeZone();
  const opts = { ...intlOptions };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat("en-GB", opts).format(d);
}

/** Console / server log lines: process TZ, or DISPLAY_TIMEZONE when set. */
export function formatServerLogTime(value = new Date()) {
  const d = parseTimestamp(value) ?? new Date();
  const tz = getOptionalServerTimeZone();
  const opts = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat("en-GB", opts).format(d);
}

/** DD-MM-YYYY HH:mm:ss for usage log text lines. */
export function formatServerLogDate(value = new Date()) {
  const d = parseTimestamp(value) ?? new Date();
  const tz = getOptionalServerTimeZone();
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

export function formatAggregationChartTime(ms) {
  return intlWithOptionalServerZone(ms, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatAggregationChartDate(ms) {
  const tz = getOptionalServerTimeZone();
  const opts = { month: "short", day: "numeric" };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(ms));
}

/** Format in an explicit IANA zone (tests / callers that need a fixed zone). */
export function formatInTimeZone(value, timeZone, intlOptions = {}) {
  const d = parseTimestamp(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...intlOptions,
  }).format(d);
}
