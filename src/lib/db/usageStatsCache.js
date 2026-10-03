/** Short TTL cache for expensive usage dashboard reads (stats + chart). */

const STATS_TTL_MS = 5000;
const statsCache = new Map();

function cacheKey(kind, period, viewerTimeZone) {
  return `${kind}|${period}|${viewerTimeZone || "UTC"}`;
}

export async function withUsageReadCache(kind, period, viewerTimeZone, loader) {
  const key = cacheKey(kind, period, viewerTimeZone);
  const now = Date.now();
  const hit = statsCache.get(key);
  if (hit && now - hit.at < STATS_TTL_MS) {
    return hit.value;
  }
  const value = await loader();
  statsCache.set(key, { value, at: now });
  return value;
}

export function invalidateUsageReadCache() {
  statsCache.clear();
}

/** @internal */
export function _resetUsageReadCacheForTests() {
  statsCache.clear();
}
