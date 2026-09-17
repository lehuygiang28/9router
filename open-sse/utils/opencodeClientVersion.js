import {
  OPENCODE_CLIENT_FALLBACK_VERSION,
  OPENCODE_GITHUB_RELEASES_URL,
  OPENCODE_VERSION_CACHE_TTL_MS,
} from "../config/opencodeClient.js";

let cachedUserAgent = null;
let cachedAt = 0;
let inflight = null;

export function parseReleaseTagName(tagName) {
  if (typeof tagName !== "string") return null;
  const m = tagName.trim().match(/^v?(\d+\.\d+\.\d+)/i);
  return m ? m[1] : null;
}

function fallbackUserAgent() {
  return `opencode/${OPENCODE_CLIENT_FALLBACK_VERSION}`;
}

export function getCachedOpencodeUserAgent() {
  return cachedUserAgent || fallbackUserAgent();
}

/** @internal test helper */
export function resetOpencodeClientVersionCache() {
  cachedUserAgent = null;
  cachedAt = 0;
  inflight = null;
}

async function fetchLatestReleaseVersion() {
  const res = await fetch(OPENCODE_GITHUB_RELEASES_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "9router-opencode-version-probe",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`GitHub releases API ${res.status}`);
  }
  const json = await res.json();
  const version = parseReleaseTagName(json?.tag_name);
  if (!version) {
    throw new Error("GitHub releases API returned no semver tag_name");
  }
  return version;
}

/**
 * Refresh cached User-Agent from GitHub releases (deduped; TTL-bound).
 * Fail-open: keeps fallback UA on error.
 */
export async function warmOpencodeUserAgentCache(force = false) {
  const now = Date.now();
  if (!force && cachedUserAgent && now - cachedAt < OPENCODE_VERSION_CACHE_TTL_MS) {
    return cachedUserAgent;
  }

  if (!inflight) {
    inflight = (async () => {
      try {
        const version = await fetchLatestReleaseVersion();
        cachedUserAgent = `opencode/${version}`;
        cachedAt = Date.now();
        return cachedUserAgent;
      } catch {
        if (!cachedUserAgent) cachedUserAgent = fallbackUserAgent();
        cachedAt = Date.now();
        return cachedUserAgent;
      } finally {
        inflight = null;
      }
    })();
  }

  return inflight;
}
