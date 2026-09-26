import { updateProviderConnection } from "@/lib/localDb";
import { getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";

const QUOTA_UNLOCK_ERROR_CODES = new Set([402, 403, 429]);
const QUOTA_UNLOCK_ERROR_PATTERNS = [
  "rate limit",
  "too many requests",
  "quota",
  "usage limit",
  "capacity",
  "overloaded",
];

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

function isBlockingQuotaName(name, sessionKey) {
  if (name === sessionKey) return false;
  return !String(name).toLowerCase().includes("session");
}

function hasExhaustedBlockingQuota(quotas, sessionKey) {
  return Object.entries(quotas || {}).some(([name, quota]) => (
    isBlockingQuotaName(name, sessionKey) && !isQuotaRowAvailable(quota)
  ));
}

function codexQuotaAvailable(usage) {
  if (usage.limitReached === true) return false;
  if (usage.reviewLimitReached === true) return false;
  if (usage.sparkLimitReached === true) return false;

  const quotas = usage.quotas || {};
  const session = quotas.session;
  if (session && !isQuotaRowAvailable(session)) return false;

  const reviewSession = quotas.review_session;
  if (reviewSession && !isQuotaRowAvailable(reviewSession)) return false;

  const sparkSession = quotas.spark_session;
  if (sparkSession && !isQuotaRowAvailable(sparkSession)) return false;

  if (session) return true;
  return usage.limitReached === false;
}

function genericQuotaAvailable(usage) {
  if (usage.limitReached === true) return false;

  const quotas = usage.quotas;
  if (!quotas || typeof quotas !== "object") return false;
  const entries = Object.entries(quotas);
  if (entries.length === 0) return false;

  const sessionKey = quotas["session (5h)"] ? "session (5h)" : "session";
  const sessionLike = quotas.session || quotas["session (5h)"];
  if (sessionLike) {
    if (!isQuotaRowAvailable(sessionLike)) return false;
    return !hasExhaustedBlockingQuota(quotas, sessionKey);
  }

  return entries.some(([, quota]) => isQuotaRowAvailable(quota));
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

function lastErrorLooksQuotaRelated(lastError) {
  const err = String(lastError || "").toLowerCase();
  if (!err) return false;
  return QUOTA_UNLOCK_ERROR_PATTERNS.some((pattern) => err.includes(pattern));
}

export function connectionLockEligibleForQuotaUnlock(connection) {
  if (!connectionHasActiveRoutingLock(connection)) return false;

  const errorCode = Number(connection.errorCode);
  if (Number.isFinite(errorCode)) {
    if (QUOTA_UNLOCK_ERROR_CODES.has(errorCode)) return true;
    if (errorCode >= 400 && errorCode < 500) return false;
  }

  if (lastErrorLooksQuotaRelated(connection.lastError)) return true;

  // Model locks without a client error code are usually rate-limit cooldowns.
  return Boolean(getEarliestModelLockUntil(connection)) && !Number.isFinite(errorCode);
}

export function usageIndicatesQuotaAvailable(provider, usage) {
  if (!usage || usage.error) return false;
  if (!usage.quotas && usage.message) return false;

  if (provider === "codex") {
    return codexQuotaAvailable(usage);
  }

  return genericQuotaAvailable(usage);
}

export async function unlockConnectionIfQuotaRecovered(connection, usage, updateFn = updateProviderConnection) {
  if (!connection?.id) return { unlocked: false };
  if (!connectionLockEligibleForQuotaUnlock(connection)) return { unlocked: false };
  if (!usageIndicatesQuotaAvailable(connection.provider, usage)) return { unlocked: false };

  try {
    await updateFn(connection.id, { testStatus: "active" });
    return { unlocked: true };
  } catch (error) {
    console.warn(
      `[QuotaUnlock] ${connection.provider}:${connection.id}: failed to reactivate after quota recovery: ${error.message}`,
    );
    return { unlocked: false };
  }
}

/** Best-effort unlock after upstream confirmed a Codex reset-credit redeem (quota may lag usage API). */
export async function forceUnlockAfterCodexReset(connection, updateFn = updateProviderConnection) {
  if (!connection?.id) return;
  try {
    await updateFn(connection.id, { testStatus: "active" });
  } catch (error) {
    console.warn(
      `[Codex Reset Credits] Failed to mark connection active after reset: ${error.message}`,
    );
  }
}
