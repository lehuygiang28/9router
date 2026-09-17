/** OpenCode desktop client identity for free-tier upstream validation. */

/** Used when GitHub release lookup fails or cache is cold (sync header path). */
export const OPENCODE_CLIENT_FALLBACK_VERSION = "1.18.31";

/** Upstream rejects User-Agent versions below opencode/1.17.x (426 / 403). */
export const OPENCODE_MIN_CLIENT_MAJOR = 1;
export const OPENCODE_MIN_CLIENT_MINOR = 17;

export const OPENCODE_GITHUB_RELEASES_URL =
  "https://api.github.com/repos/anomalyco/opencode/releases/latest";

/** Refresh at most once per interval (override via OPENCODE_VERSION_CACHE_TTL_MS). */
export const OPENCODE_VERSION_CACHE_TTL_MS = (() => {
  const raw = process.env.OPENCODE_VERSION_CACHE_TTL_MS;
  if (raw === undefined || raw === "") return 6 * 60 * 60 * 1000;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 6 * 60 * 60 * 1000;
})();
