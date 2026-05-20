// Public API barrel — all DB functions
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";

// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
} from "./repos/usageRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById,
} from "./repos/requestDetailsRepo.js";

// Export/import full DB
export async function exportDb() {
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");

  const [
    settings,
    connectionsRows,
    nodesRows,
    poolsRows,
    keysRows,
    combosRows,
    aliasRows,
    customRows,
    mitmRows,
    pricingRows,
  ] = await Promise.all([
    exportSettings(),
    db.all(`SELECT * FROM providerConnections`),
    db.all(`SELECT * FROM providerNodes`),
    db.all(`SELECT * FROM proxyPools`),
    db.all(`SELECT * FROM apiKeys`),
    db.all(`SELECT * FROM combos`),
    db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`),
    db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`),
    db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`),
    db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`),
  ]);

  const out = {
    settings,
    providerConnections: connectionsRows.map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: nodesRows.map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: poolsRows.map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: keysRows.map((r) => ({ id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt })),
    combos: combosRows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    modelAliases: {},
    customModels: [],
    mitmAlias: {},
    pricing: {},
  };

  for (const r of aliasRows) out.modelAliases[r.key] = parseJson(r.value);
  for (const r of customRows) out.customModels.push(parseJson(r.value));
  for (const r of mitmRows) out.mitmAlias[r.key] = parseJson(r.value);
  for (const r of pricingRows) out.pricing[r.key] = parseJson(r.value);

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  // Build a single atomic batch — all wipes + inserts commit together or roll back.
  const stmts = [
    { sql: `DELETE FROM settings` },
    { sql: `DELETE FROM providerConnections` },
    { sql: `DELETE FROM providerNodes` },
    { sql: `DELETE FROM proxyPools` },
    { sql: `DELETE FROM apiKeys` },
    { sql: `DELETE FROM combos` },
    { sql: `DELETE FROM kv WHERE scope IN ('modelAliases', 'customModels', 'mitmAlias', 'pricing')` },
  ];

  if (payload.settings) {
    stmts.push({
      sql: `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      params: [stringifyJson(payload.settings)],
    });
  }

  for (const c of payload.providerConnections || []) {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    stmts.push({
      sql: `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()],
    });
  }
  for (const n of payload.providerNodes || []) {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    stmts.push({
      sql: `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      params: [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()],
    });
  }
  for (const p of payload.proxyPools || []) {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    stmts.push({
      sql: `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      params: [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()],
    });
  }
  for (const k of payload.apiKeys || []) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      params: [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()],
    });
  }
  for (const c of payload.combos || []) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
      params: [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()],
    });
  }
  for (const [a, m] of Object.entries(payload.modelAliases || {})) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`,
      params: [a, stringifyJson(m)],
    });
  }
  for (const m of payload.customModels || []) {
    const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
    stmts.push({
      sql: `INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`,
      params: [k, stringifyJson(m)],
    });
  }
  for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`,
      params: [tool, stringifyJson(mappings || {})],
    });
  }
  for (const [provider, models] of Object.entries(payload.pricing || {})) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`,
      params: [provider, stringifyJson(models || {})],
    });
  }

  await db.batch(stmts);

  return await exportDb();
}

// Eager init helper (optional)
export async function initDb() {
  await getAdapter();
}
