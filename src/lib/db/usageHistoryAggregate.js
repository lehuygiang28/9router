import {
  getDateKeyInZone,
  isNewerTimestamp,
  normalizeTimestampForApi,
} from "@/lib/time.js";

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 12) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***" + key.slice(-4);
}

function hourKeyToIso(hourKey) {
  if (!hourKey || hourKey.length < 13) return null;
  return `${hourKey}:00:00.000Z`;
}

/**
 * Viewer-local multi-day stats without loading every usageHistory row.
 * Cutoff must be viewerPeriodStartMs(...) as UTC ISO.
 */
export async function aggregateUsageStatsSince(db, cutoffIso, ctx) {
  const { stats, connectionMap, providerNodeNameMap, apiKeyMap } = ctx;
  const params = [cutoffIso];

  const byProvider = await db.all(
    `SELECT provider,
            COUNT(*) AS requests,
            SUM(COALESCE(promptTokens, 0)) AS promptTokens,
            SUM(COALESCE(completionTokens, 0)) AS completionTokens,
            SUM(COALESCE(cost, 0)) AS cost
     FROM usageHistory WHERE timestamp >= ?
     GROUP BY provider`,
    params,
  );
  for (const r of byProvider) {
    const prov = r.provider || "";
    stats.totalPromptTokens += Number(r.promptTokens) || 0;
    stats.totalCompletionTokens += Number(r.completionTokens) || 0;
    stats.totalCost += Number(r.cost) || 0;
    stats.byProvider[prov] = {
      requests: Number(r.requests) || 0,
      promptTokens: Number(r.promptTokens) || 0,
      completionTokens: Number(r.completionTokens) || 0,
      cachedTokens: 0,
      cost: Number(r.cost) || 0,
    };
  }

  const byModel = await db.all(
    `SELECT provider, model,
            COUNT(*) AS requests,
            SUM(COALESCE(promptTokens, 0)) AS promptTokens,
            SUM(COALESCE(completionTokens, 0)) AS completionTokens,
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE timestamp >= ?
     GROUP BY provider, model`,
    params,
  );
  for (const r of byModel) {
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;
    const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
    stats.byModel[modelKey] = {
      requests: Number(r.requests) || 0,
      promptTokens: Number(r.promptTokens) || 0,
      completionTokens: Number(r.completionTokens) || 0,
      cachedTokens: 0,
      cost: Number(r.cost) || 0,
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
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE timestamp >= ? AND connectionId IS NOT NULL
     GROUP BY connectionId, provider, model`,
    params,
  );
  for (const r of byAccount) {
    const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;
    const accountKey = `${r.model} (${r.provider} - ${accountName})`;
    stats.byAccount[accountKey] = {
      requests: Number(r.requests) || 0,
      promptTokens: Number(r.promptTokens) || 0,
      completionTokens: Number(r.completionTokens) || 0,
      cachedTokens: 0,
      cost: Number(r.cost) || 0,
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
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE timestamp >= ? AND apiKey IS NOT NULL
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
      requests: Number(r.requests) || 0,
      promptTokens: Number(r.promptTokens) || 0,
      completionTokens: Number(r.completionTokens) || 0,
      cachedTokens: 0,
      cost: Number(r.cost) || 0,
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
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE timestamp >= ?
     GROUP BY endpoint, provider, model`,
    params,
  );
  for (const r of byEndpoint) {
    const endpoint = r.endpoint || "Unknown";
    const providerDisplayName = providerNodeNameMap[r.provider] || r.provider;
    const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
    stats.byEndpoint[epKey] = {
      requests: Number(r.requests) || 0,
      promptTokens: Number(r.promptTokens) || 0,
      completionTokens: Number(r.completionTokens) || 0,
      cachedTokens: 0,
      cost: Number(r.cost) || 0,
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
            SUM(COALESCE(cost, 0)) AS cost,
            MAX(timestamp) AS timestamp
     FROM usageHistory WHERE timestamp >= ? AND (apiKey IS NULL OR apiKey = '')
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
    ake.requests += Number(r.requests) || 0;
    ake.promptTokens += Number(r.promptTokens) || 0;
    ake.completionTokens += Number(r.completionTokens) || 0;
    ake.cost += Number(r.cost) || 0;
    if (isNewerTimestamp(r.timestamp, ake.lastUsed)) ake.lastUsed = normalizeTimestampForApi(r.timestamp);
  }
}

/**
 * Chart buckets aligned to viewer calendar days via hourly SQL rollup (portable SQLite + PG).
 */
export async function fillChartBucketsFromHistory(db, cutoffIso, tz, buckets) {
  const keyToIdx = {};
  buckets.forEach((b, i) => { keyToIdx[b.dateKey] = i; });

  const hourRows = await db.all(
    `SELECT substr(timestamp, 1, 13) AS hour_key,
            SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)) AS tokens,
            SUM(COALESCE(cost, 0)) AS cost,
            COUNT(*) AS requests
     FROM usageHistory WHERE timestamp >= ?
     GROUP BY hour_key`,
    [cutoffIso],
  );

  for (const r of hourRows) {
    const iso = hourKeyToIso(r.hour_key);
    if (!iso) continue;
    const viewerKey = getDateKeyInZone(iso, tz);
    const idx = keyToIdx[viewerKey];
    if (idx === undefined) continue;
    buckets[idx].tokens += Number(r.tokens) || 0;
    buckets[idx].cost += Number(r.cost) || 0;
    buckets[idx].requests += Number(r.requests) || 0;
  }
}
