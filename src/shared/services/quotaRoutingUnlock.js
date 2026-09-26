import { updateProviderConnection } from "@/lib/localDb";
import { getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";

function toFiniteNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isQuotaRowAvailable(quota) {
  if (!quota || quota.unlimited === true) return true;
  const remaining = toFiniteNumber(quota.remaining);
  if (remaining !== null) return remaining > 0;
  const remainingPercentage = toFiniteNumber(quota.remainingPercentage);
  if (remainingPercentage !== null) return remainingPercentage > 0;
  const used = toFiniteNumber(quota.used);
  const total = toFiniteNumber(quota.total);
  return total !== null && total > 0 && used !== null && used < total;
}

function codexQuotaAvailable(usage) {
  if (usage.limitReached === true) return false;
  const session = usage.quotas?.session;
  if (session) return isQuotaRowAvailable(session);
  return usage.limitReached === false;
}

export function connectionHasActiveRoutingLock(connection) {
  if (!connection) return false;
  if (getEarliestModelLockUntil(connection)) return true;
  if (connection.testStatus === "unavailable") return true;
  if (connection.rateLimitedUntil) {
    const until = new Date(connection.rateLimitedUntil).getTime();
    if (Number.isFinite(until) && until > Date.now()) return true;
  }
  return false;
}

export function usageIndicatesQuotaAvailable(provider, usage) {
  if (!usage || usage.error) return false;
  if (!usage.quotas && usage.message) return false;

  if (provider === "codex") {
    return codexQuotaAvailable(usage);
  }

  if (usage.limitReached === true) return false;

  const quotas = usage.quotas;
  if (!quotas || typeof quotas !== "object") return false;
  const entries = Object.entries(quotas);
  if (entries.length === 0) return false;

  const sessionLike = quotas.session || quotas["session (5h)"] || entries[0]?.[1];
  if (sessionLike) return isQuotaRowAvailable(sessionLike);

  return entries.some(([, quota]) => isQuotaRowAvailable(quota));
}

export async function unlockConnectionIfQuotaRecovered(connection, usage, updateFn = updateProviderConnection) {
  if (!connection?.id) return { unlocked: false };
  if (!connectionHasActiveRoutingLock(connection)) return { unlocked: false };
  if (!usageIndicatesQuotaAvailable(connection.provider, usage)) return { unlocked: false };

  await updateFn(connection.id, { testStatus: "active" });
  return { unlocked: true };
}
