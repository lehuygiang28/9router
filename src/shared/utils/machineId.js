import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";

const IS_CLOUDFLARE = typeof process !== "undefined" && !!process.env.CLOUDFLARE_WORKER;

let machineIdSync = null;
if (!IS_CLOUDFLARE) {
  try {
    const mod = await import('node-machine-id');
    machineIdSync = mod.machineIdSync;
  } catch {
    machineIdSync = null;
  }
}

let cachedRawId = null;

function loadRawMachineId() {
  if (cachedRawId) return cachedRawId;
  if (IS_CLOUDFLARE) {
    cachedRawId = process.env.WORKER_ID || "cloudflare-worker";
    return cachedRawId;
  }
  try {
    const MACHINE_ID_FILE = path.join(DATA_DIR, "machine-id");
    cachedRawId = fs.readFileSync(MACHINE_ID_FILE, "utf8").trim();
    if (cachedRawId) return cachedRawId;
  } catch {}
  try {
    if (machineIdSync) cachedRawId = machineIdSync();
  } catch {}
  if (!cachedRawId) cachedRawId = crypto.randomUUID();
  try {
    const MACHINE_ID_FILE = path.join(DATA_DIR, "machine-id");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MACHINE_ID_FILE, cachedRawId, { mode: 0o600 });
  } catch {}
  return cachedRawId;
}

export async function getConsistentMachineId(salt = null) {
  const saltValue = salt || process.env.MACHINE_ID_SALT || 'endpoint-proxy-salt';
  const raw = loadRawMachineId();
  return crypto.createHash('sha256').update(raw + saltValue).digest('hex').substring(0, 16);
}

export async function getRawMachineId() {
  return loadRawMachineId();
}

/**
 * Check if we're running in browser or server environment
 * @returns {boolean} True if in browser, false if in server
 */
export function isBrowser() {
  return typeof window !== 'undefined';
}
