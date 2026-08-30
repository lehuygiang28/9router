import { getAdapter } from "./driver.js";
import { getMeta, setMeta } from "./helpers/metaStore.js";

export const DEFAULT_RETENTION_DAYS = 90;
export const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const META_LAST_PRUNE = "usageHistoryLastPruneAt";
const DELETE_BATCH_SIZE = 5000;

let scheduled = false;

/** Resolve retention days: env wins, then settings, then default. 0 = disabled. */
export function resolveUsageHistoryRetentionDays(rawSettings = {}) {
  const env = process.env.USAGE_HISTORY_RETENTION_DAYS;
  if (env !== undefined && env !== "") {
    const n = parseInt(env, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RETENTION_DAYS;
  }
  const fromSettings = rawSettings?.usageHistoryRetentionDays;
  if (typeof fromSettings === "number" && fromSettings >= 0) return fromSettings;
  return DEFAULT_RETENTION_DAYS;
}

async function loadRetentionDays() {
  try {
    const { getSettings } = await import("./repos/settingsRepo.js");
    const settings = await getSettings();
    return resolveUsageHistoryRetentionDays(settings);
  } catch {
    return resolveUsageHistoryRetentionDays({});
  }
}

function retentionCutoffIso(retentionDays) {
  const d = new Date();
  d.setDate(d.getDate() - retentionDays);
  return d.toISOString();
}

/**
 * Delete raw usageHistory rows older than the retention window.
 * usageDaily aggregates are untouched — long-range metrics stay correct.
 */
export async function pruneUsageHistory(options = {}) {
  const { force = false, adapter: adapterIn } = options;
  const retentionDays = options.retentionDays ?? await loadRetentionDays();
  if (!retentionDays || retentionDays <= 0) {
    return { deleted: 0, skipped: true, reason: "disabled", retentionDays: 0 };
  }

  const adapter = adapterIn ?? await getAdapter();

  if (!force) {
    const last = await getMeta(META_LAST_PRUNE, null);
    if (last) {
      const elapsed = Date.now() - new Date(last).getTime();
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < PRUNE_INTERVAL_MS) {
        return { deleted: 0, skipped: true, reason: "interval", retentionDays };
      }
    }
  }

  const cutoff = retentionCutoffIso(retentionDays);
  let totalDeleted = 0;

  while (true) {
    const result = await adapter.run(
      `DELETE FROM usageHistory WHERE id IN (
        SELECT id FROM usageHistory WHERE timestamp < ? ORDER BY id ASC LIMIT ?
      )`,
      [cutoff, DELETE_BATCH_SIZE],
    );
    const changes = Number(result?.changes ?? 0);
    totalDeleted += changes;
    if (changes < DELETE_BATCH_SIZE) break;
  }

  await setMeta(META_LAST_PRUNE, new Date().toISOString());

  if (totalDeleted > 0) {
    console.log(
      `[DB] Pruned ${totalDeleted} usageHistory row(s) older than ${retentionDays}d (before ${cutoff})`,
    );
  }

  return { deleted: totalDeleted, skipped: false, retentionDays, cutoff };
}

/** Run retention prune on boot and at most once per PRUNE_INTERVAL_MS. */
export function scheduleUsageHistoryRetention(adapter) {
  if (scheduled) return;
  scheduled = true;

  const run = () => {
    pruneUsageHistory({ adapter }).catch((e) => {
      console.warn(`[DB] usageHistory retention prune failed: ${e.message}`);
    });
  };

  run();

  const timer = setInterval(run, PRUNE_INTERVAL_MS);
  timer.unref?.();
}

/** Test helper — reset module schedule guard between vitest cases. */
export function _resetUsageHistoryRetentionScheduleForTests() {
  scheduled = false;
}
