import { getSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";

let initialized = false;

export async function ensureOutboundProxyInitialized() {
  if (initialized) return true;

  try {
    const settings = await getSettings();
    applyOutboundProxyEnv(settings);
    initialized = true;
  } catch (error) {
    console.error("[ServerInit] Error initializing outbound proxy:", error);
  }

  return initialized;
}

// Defer init so HTTP server accepts connections first.
// On deployed Workers, do not touch DB from a stray tick — getCloudflareContext can
// be unset briefly and getAdapter() would otherwise call async Wrangler glue and hang.
setImmediate(() => {
  if (typeof process !== "undefined" && process.env.CLOUDFLARE_WORKER === "1") {
    return;
  }
  ensureOutboundProxyInitialized().catch(console.log);
});

export default ensureOutboundProxyInitialized;
