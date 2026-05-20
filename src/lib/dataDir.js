import { nativeRequire } from "@/lib/nodeRequire.js";

const APP_NAME = "9router";

function isCloudflareWorkers() {
  return typeof process === "undefined" || !!process.env.CLOUDFLARE_WORKER;
}

function defaultDir() {
  if (isCloudflareWorkers()) return "/tmp/" + APP_NAME;
  try {
    const path = nativeRequire("node:path");
    const os = nativeRequire("node:os");
    if (process.platform === "win32") {
      return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
    }
    return path.join(os.homedir(), `.${APP_NAME}`);
  } catch {
    return "/tmp/" + APP_NAME;
  }
}

export function getDataDir() {
  if (isCloudflareWorkers()) return "/tmp/" + APP_NAME;
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();
  try {
    const fs = nativeRequire("node:fs");
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
