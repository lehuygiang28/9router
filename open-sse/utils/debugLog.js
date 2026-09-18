// Debug logging utility — only active in dev mode (NODE_ENV !== "production")
// Outputs are tagged with [DBG:tag] for easy grep/filter
import { formatDisplayTime } from "@/lib/time.js";

const isDev = process.env.NODE_ENV !== "production";

function ts() {
  return formatDisplayTime(new Date());
}

export function dbg(tag, msg) {
  if (!isDev) return;
  console.log(`[${ts()}] 🐛 [DBG:${tag}] ${msg}`);
}

export const isDebugEnabled = isDev;
