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
  const raw =
    process.env.DISPLAY_TIMEZONE ||
    process.env.APP_TIMEZONE ||
    process.env.DISPLAY_TIME_ZONE ||
    null;
  cachedServerLogTz = raw && isValidIanaTimeZone(raw) ? raw.trim() : null;
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

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Map a wall-clock instant in `timeZone` to UTC epoch ms (for filters / datetime-local). */
export function viewerWallClockToUtc(value, timeZone = UTC_TIME_ZONE) {
  const tz = resolveViewerTimeZone(timeZone);
  const s = String(value).trim();
  const m = WALL_CLOCK_RE.exec(s);
  if (!m) return null;
  const target = {
    y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], sec: m[6] ? +m[6] : 0,
  };
  if (tz === UTC_TIME_ZONE) {
    return Date.UTC(target.y, target.mo - 1, target.d, target.h, target.mi, target.sec);
  }
  let lo = Date.UTC(target.y, target.mo - 1, target.d, target.h - 14, target.mi, target.sec);
  let hi = Date.UTC(target.y, target.mo - 1, target.d, target.h + 14, target.mi, target.sec);
  const matches = (ms) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(new Date(ms));
    const p = (t) => parseInt(parts.find((x) => x.type === t)?.value || "0", 10);
    return p("year") === target.y && p("month") === target.mo && p("day") === target.d
      && p("hour") === target.h && p("minute") === target.mi && p("second") === target.sec;
  };
  for (let i = 0; i < 48; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (matches(mid)) return mid;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(new Date(mid));
    const p = (t) => parseInt(parts.find((x) => x.type === t)?.value || "0", 10);
    const cmp = p("year") - target.y || p("month") - target.mo || p("day") - target.d
      || p("hour") - target.h || p("minute") - target.mi || p("second") - target.sec;
    if (cmp < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function hasWallClockTime(value) {
  return typeof value === "string" && /T\d{2}:\d{2}/.test(value);
}

export function parseViewerFilterStartMs(value, timeZone = UTC_TIME_ZONE) {
  const tz = resolveViewerTimeZone(timeZone);
  if (value == null || value === "") return null;
  if (hasWallClockTime(value)) return viewerWallClockToUtc(value, tz);
  if (typeof value === "string" && DATE_ONLY_RE.test(value.trim())) {
    return viewerWallClockToUtc(`${value.trim()}T00:00:00`, tz);
  }
  const d = parseTimestamp(value);
  return d ? startOfDayInViewerZoneMs(d, tz) : null;
}

export function parseViewerFilterEndMs(value, timeZone = UTC_TIME_ZONE) {
  const tz = resolveViewerTimeZone(timeZone);
  if (value == null || value === "") return null;
  if (hasWallClockTime(value)) return viewerWallClockToUtc(value, tz);
  if (typeof value === "string" && DATE_ONLY_RE.test(value.trim())) {
    return endOfDayInViewerZoneMs(value.trim(), tz);
  }
  const d = parseTimestamp(value);
  return d ? endOfDayInViewerZoneMs(d, tz) : null;
}

export function previousViewerDayStartMs(dayStartMs, timeZone = UTC_TIME_ZONE) {
  const tz = resolveViewerTimeZone(timeZone);
  return startOfDayInViewerZoneMs(dayStartMs - 12 * 3600000, tz);
}

export function viewerPeriodStartMs(dayCount, referenceMs = Date.now(), timeZone = UTC_TIME_ZONE) {
  let cur = startOfDayInViewerZoneMs(referenceMs, timeZone);
  for (let i = 1; i < dayCount; i++) cur = previousViewerDayStartMs(cur, timeZone);
  return cur;
}

export function buildViewerDayStarts(bucketCount, referenceMs = Date.now(), timeZone = UTC_TIME_ZONE) {
  const starts = [];
  let cur = startOfDayInViewerZoneMs(referenceMs, timeZone);
  for (let i = 0; i < bucketCount; i++) {
    starts.unshift(cur);
    if (i < bucketCount - 1) cur = previousViewerDayStartMs(cur, timeZone);
  }
  return starts;
}

export function compareTimestamp(a, b) {
  const ta = parseTimestamp(a)?.getTime();
  const tb = parseTimestamp(b)?.getTime();
  if (ta != null && tb != null) return ta - tb;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export function isNewerTimestamp(a, b) {
  return compareTimestamp(a, b) > 0;
}

export function startOfDayInViewerZoneMs(reference = new Date(), timeZone = UTC_TIME_ZONE) {
  const tz = resolveViewerTimeZone(timeZone);
  if (typeof reference === "string" && DATE_ONLY_RE.test(reference.trim())) {
    const ms = viewerWallClockToUtc(`${reference.trim()}T00:00:00`, tz);
    if (ms != null) return ms;
  }
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
