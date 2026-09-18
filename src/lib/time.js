/**
 * Display timezone + UTC-safe timestamp parsing for dashboard, logs, and aggregates.
 * Server: DISPLAY_TIMEZONE or APP_TIMEZONE. Client bundle: NEXT_PUBLIC_DISPLAY_TIMEZONE.
 */

const DEFAULT_DISPLAY_TIME_ZONE = "Asia/Ho_Chi_Minh";

const TZ_SUFFIX_RE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

let cachedDisplayTz;

export function getDisplayTimeZone() {
  if (cachedDisplayTz) return cachedDisplayTz;
  const fromEnv =
    (typeof process !== "undefined" && process.env
      ? process.env.DISPLAY_TIMEZONE ||
        process.env.APP_TIMEZONE ||
        process.env.DISPLAY_TIME_ZONE ||
        process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE
      : undefined) || DEFAULT_DISPLAY_TIME_ZONE;
  cachedDisplayTz = fromEnv;
  return cachedDisplayTz;
}

/** Reset cached TZ (tests). */
export function resetDisplayTimeZoneCache() {
  cachedDisplayTz = undefined;
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

export function getDateKeyInZone(value = new Date()) {
  const d = parseTimestamp(value) ?? new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getDisplayTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** First millisecond of the calendar day containing `reference` in the display zone. */
export function startOfDayInZoneMs(reference = new Date()) {
  const ref = parseTimestamp(reference) ?? new Date();
  const key = getDateKeyInZone(ref);
  let lo = ref.getTime() - 26 * 3600000;
  let hi = ref.getTime();
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (getDateKeyInZone(new Date(mid)) === key) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function formatDisplayDateTime(value, options = {}) {
  const d = parseTimestamp(value);
  if (!d) return "";
  return new Intl.DateTimeFormat(options.locale || "en-GB", {
    timeZone: getDisplayTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...options.intl,
  }).format(d);
}

export function formatDisplayTime(value) {
  const d = parseTimestamp(value);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: getDisplayTimeZone(),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

/** DD-MM-YYYY HH:mm:ss in display zone (request log lines). */
export function formatDisplayLogDate(value = new Date()) {
  const d = parseTimestamp(value) ?? new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: getDisplayTimeZone(),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${pick("day")}-${pick("month")}-${pick("year")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

export function formatDisplayChartTime(ms) {
  const d = new Date(ms);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: getDisplayTimeZone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatDisplayChartDate(ms) {
  const d = new Date(ms);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: getDisplayTimeZone(),
    month: "short",
    day: "numeric",
  }).format(d);
}
