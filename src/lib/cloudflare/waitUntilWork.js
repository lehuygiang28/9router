import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Tie async work to the current Worker invocation so it can finish after the
 * HTTP response is returned. Without this, floating promises and setTimeout
 * callbacks are often dropped when the isolate goes idle (usage / request logs
 * never hit D1).
 *
 * No-op on Node/local: the promise still runs; errors are logged.
 *
 * @param {Promise<unknown>} promise
 */
export function waitUntilWork(promise) {
  if (typeof process === "undefined" || process.env.CLOUDFLARE_WORKER !== "1") {
    void promise.catch((e) => console.error("[waitUntilWork]", e));
    return;
  }
  try {
    const { ctx } = getCloudflareContext();
    if (ctx?.waitUntil) {
      ctx.waitUntil(promise);
      return;
    }
  } catch (e) {
    console.warn("[waitUntilWork] no Cloudflare ctx:", e?.message);
  }
  void promise.catch((e) => console.error("[waitUntilWork] fallback", e));
}
