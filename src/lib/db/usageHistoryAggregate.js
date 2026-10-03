import {
  getDateKeyInZone,
  isNewerTimestamp,
  normalizeTimestampForApi,
} from "@/lib/time.js";

/** Portable cached-token sum from usageHistory.tokens JSON (SQLite + PG via dialect). */
const CACHED_TOKENS_SUM = `(
  COALESCE(CAST(json_extract(tokens, '$.cached_tokens') AS INTEGER), 0) +
  COALESCE(CAST(json_extract(tokens, '$.cache_read_input_tokens') AS INTEGER), 0)
)`;

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 12) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***" + key.slice(-4);
}

function minuteKeyToIso(minuteKey) {
  if (!minuteKey || minuteKey.length < 16) return null;
  return `${minuteKey}:00.000Z`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function addCachedTotals(stats, cached) {
  const c = num(cached);
  stats.totalCachedTokens += c;
  return c;
}

/**
 * Viewer-local multi-day stats without loading every usageHistory row.
 * Cutoff must be viewerPeriodStartMs(...) as UTC ISO.
 */
export async function aggregateUsageStatsSince(db, cutoffIso, ctx, endExclusiveIso = null) {
  const { stats, connectionMap, providerNodeNameMap, apiKeyMap } = ctx;
  const params = endExclusiveIso ? [cutoffIso, endExclusiveIso] : [cutoffIso];
  const tsWhere = endExclusiveIso ? "timestamp >= ? AND timestamp < ?" : "timestamp >= ?";

  const byProvider = await db.all(
    `SELECT provider,
            COUNT(*) AS requests,
            SUM(COALESCE(promptTokens, 0)) AS promptTokens,
            SUM(COALESCE(completionTokens, 0)) AS completionTokens,
            SUM(${CACHED_TOKENS_SUM}) AS cachedTokens,
            SUM(COALESCE(cost, 0)) AS cost
     FROM usageHistory WHERE ${tsWhere}
     GROUP BY provider`,
    params,
  );
  for (const r of byProvider) {
    const prov = r.provider || "";
    const cachedTokens = addCachedTotals(stats, r.cachedTokens);
    stats.totalPromptTokens += num(r.promptTokens);
    stats.totalCompletionTokens += num(r.completionTokens);
    stats.totalCost += num(r.cost);
    stats.byProvider[prov] = {
      requests: num(r.requests),
      promptTokens: num(r.promptTokens),
      completionTokens: num(r.completionTokens),
      cachedTokens,
      cost: num(r.cost),
    };
  }

  const byModel = await db.all(
    `SELECT provider, model,
            COUNT(*) AS requests,
            SUM(COALESCE(promptTokens, 0)) AS promptTokens,
            SUM(COALESCE(completionTokens, 0)) AS completionTokens,
            SUM(${CACHED_TOKENS_SUM}) AS cachedTokens,
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE ${tsWhere}
     GROUP BY provider, model`,
    params,
  );
  for (const r of byModel) {
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;
    const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
    stats.byModel[modelKey] = {
      requests: num(r.requests),
      promptTokens: num(r.promptTokens),
      completionTokens: num(r.completionTokens),
      cachedTokens: num(r.cachedTokens),
      cost: num(r.cost),
      rawModel: r.model,
      provider: providerDisplayName,
      lastUsed: normalizeTimestampForApi(r.timestamp),
    };
  }

  const byAccount = await db.all(
    `SELECT connectionId, provider, model,
            COUNT(*) AS requests,
            SUM(COALESCE(promptTokens, 0)) AS promptTokens,
            SUM(COALESCE(completionTokens, 0)) AS completionTokens,
            SUM(${CACHED_TOKENS_SUM}) AS cachedTokens,
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE ${tsWhere} AND connectionId IS NOT NULL
     GROUP BY connectionId, provider, model`,
    params,
  );
  for (const r of byAccount) {
    const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;
    const accountKey = `${r.model} (${r.provider} - ${accountName})`;
    stats.byAccount[accountKey] = {
      requests: num(r.requests),
      promptTokens: num(r.promptTokens),
      completionTokens: num(r.completionTokens),
      cachedTokens: num(r.cachedTokens),
      cost: num(r.cost),
      rawModel: r.model,
      provider: providerDisplayName,
      connectionId: r.connectionId,
      accountName,
      lastUsed: normalizeTimestampForApi(r.timestamp),
    };
  }

  const byApiKey = await db.all(
    `SELECT apiKey, provider, model,
            COUNT(*) AS requests,
            SUM(COALESCE(promptTokens, 0)) AS promptTokens,
            SUM(COALESCE(completionTokens, 0)) AS completionTokens,
            SUM(${CACHED_TOKENS_SUM}) AS cachedTokens,
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE ${tsWhere} AND apiKey IS NOT NULL AND apiKey <> ''
     GROUP BY apiKey, provider, model`,
    params,
  );
  for (const r of byApiKey) {
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;
    const keyInfo = apiKeyMap[r.apiKey];
    const keyName = keyInfo?.name || r.apiKey.slice(0, 8) + "...";
    const apiKeyMasked = maskApiKey(r.apiKey);
    const akKey = `${r.apiKey}|${r.model}|${r.provider || "unknown"}`;
    stats.byApiKey[akKey] = {
      requests: num(r.requests),
      promptTokens: num(r.promptTokens),
      completionTokens: num(r.completionTokens),
      cachedTokens: num(r.cachedTokens),
      cost: num(r.cost),
      rawModel: r.model,
      provider: providerDisplayName,
      apiKeyMasked,
      keyName,
      apiKeyKey: apiKeyMasked,
      lastUsed: normalizeTimestampForApi(r.timestamp),
    };
  }

  const byEndpoint = await db.all(
    `SELECT endpoint, provider, model,
            COUNT(*) AS requests,
            SUM(COALESCE(promptTokens, 0)) AS promptTokens,
            SUM(COALESCE(completionTokens, 0)) AS completionTokens,
            SUM(${CACHED_TOKENS_SUM}) AS cachedTokens,
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE ${tsWhere}
     GROUP BY endpoint, provider, model`,
    params,
  );
  for (const r of byEndpoint) {
    const endpoint = r.endpoint || "Unknown";
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;
    const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
    stats.byEndpoint[epKey] = {
      requests: num(r.requests),
      promptTokens: num(r.promptTokens),
      completionTokens: num(r.completionTokens),
      cachedTokens: num(r.cachedTokens),
      cost: num(r.cost),
      endpoint,
      rawModel: r.model,
      provider: providerDisplayName,
      lastUsed: normalizeTimestampForApi(r.timestamp),
    };
  }

  const localRows = await db.all(
    `SELECT provider, model,
            COUNT(*) AS requests,
            SUM(COALESCE(promptTokens, 0)) AS promptTokens,
            SUM(COALESCE(completionTokens, 0)) AS completionTokens,
            SUM(${CACHED_TOKENS_SUM}) AS cachedTokens,
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE ${tsWhere} AND (apiKey IS NULL OR apiKey = '')
     GROUP BY provider, model`,
    params,
  );
  for (const r of localRows) {
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;
    const akKey = "local-no-key";
    if (!stats.byApiKey[akKey]) {
      stats.byApiKey[akKey] = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        cost: 0,
        rawModel: r.model,
        provider: providerDisplayName,
        apiKeyMasked: null,
        keyName: "Local (No API Key)",
        apiKeyKey: "local-no-key",
        lastUsed: normalizeTimestampForApi(r.timestamp),
      };
    }
    const ake = stats.byApiKey[akKey];
    ake.requests += num(r.requests);
    ake.promptTokens += num(r.promptTokens);
    ake.completionTokens += num(r.completionTokens);
    ake.cachedTokens += num(r.cachedTokens);
    ake.cost += num(r.cost);
    if (isNewerTimestamp(r.timestamp, ake.lastUsed)) ake.lastUsed = normalizeTimestampForApi(r.timestamp);
  }
}

/**
 * Chart buckets aligned to viewer calendar days via minute-level SQL rollup (portable SQLite + PG).
 */
export async function fillChartBucketsFromHistory(db, cutoffIso, tz, buckets, endExclusiveIso = null) {
  const keyToIdx = {};
  buckets.forEach((b, i) => { keyToIdx[b.dateKey] = i; });

  const params = endExclusiveIso ? [cutoffIso, endExclusiveIso] : [cutoffIso];
  const tsWhere = endExclusiveIso ? "timestamp >= ? AND timestamp < ?" : "timestamp >= ?";

  const minuteRows = await db.all(
    `SELECT substr(timestamp, 1, 16) AS minute_key,
            SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)) AS tokens,
            SUM(COALESCE(cost, 0)) AS cost,
            COUNT(*) AS requests
     FROM usageHistory WHERE ${tsWhere}
     GROUP BY minute_key`,
    params,
  );

  for (const r of minuteRows) {
    const iso = minuteKeyToIso(r.minute_key);
    if (!iso) continue;
    const viewerKey = getDateKeyInZone(iso, tz);
    const idx = keyToIdx[viewerKey];
    if (idx === undefined) continue;
    buckets[idx].tokens += num(r.tokens);
    buckets[idx].cost += num(r.cost);
    buckets[idx].requests += num(r.requests);
  }
}
