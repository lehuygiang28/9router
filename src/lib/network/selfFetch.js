// Internal self-call helper.
//
// Node.js / local dev: opens a TCP socket back to the same process via 127.0.0.1.
// Cloudflare Workers: no localhost reachable (and `global_fetch_strictly_public`
// blocks private IPs). Must dispatch through the WORKER_SELF_REFERENCE service
// binding declared in wrangler.jsonc.
//
// Callers pass a path (e.g. "/api/v1/chat/completions") and request init.
// The helper resolves the right transport and returns the Response.

import { UPDATER_CONFIG } from "@/shared/constants/config";

const LOCAL_BASE = () =>
  `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

// On Workers, env.WORKER_SELF_REFERENCE.fetch expects an absolute URL.
// Origin part is ignored by the Service Binding, but URL parser requires one.
const WORKER_SELF_BASE = "http://self.internal";

function isCloudflareWorker() {
  return Boolean(
    typeof process !== "undefined" && process.env && process.env.CLOUDFLARE_WORKER
  );
}

async function getWorkerSelfBinding() {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    let ctx;
    try {
      ctx = getCloudflareContext();
    } catch {
      if (typeof process !== "undefined" && process.env.CLOUDFLARE_WORKER === "1") {
        return null;
      }
      ctx = await getCloudflareContext({ async: true });
    }
    return ctx?.env?.WORKER_SELF_REFERENCE || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} path - Path on the same app, e.g. "/api/v1/chat/completions".
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export async function selfFetch(path, init) {
  if (!path.startsWith("/")) {
    throw new Error(`selfFetch: path must start with "/", got "${path}"`);
  }

  if (isCloudflareWorker()) {
    const binding = await getWorkerSelfBinding();
    if (binding) {
      const url = `${WORKER_SELF_BASE}${path}`;
      return await binding.fetch(url, init);
    }
    // Fallback: throw a clearer error than "Network connection lost"
    throw new Error(
      "[selfFetch] WORKER_SELF_REFERENCE binding missing on Cloudflare Worker"
    );
  }

  return await fetch(`${LOCAL_BASE()}${path}`, init);
}

/** Returns the base URL used by selfFetch (for legacy callers still building URLs). */
export function selfBaseUrl() {
  if (isCloudflareWorker()) return WORKER_SELF_BASE;
  return LOCAL_BASE();
}
