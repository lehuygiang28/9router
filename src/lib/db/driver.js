import { ensureDirs, DATA_FILE } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite() {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite() {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

async function tryPostgres() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) return null;
  const { createPostgresAdapter } = await import("./adapters/postgresAdapter.js");
  return createPostgresAdapter({ connectionString: String(url).trim() });
}

async function initAdapter() {
  ensureDirs();

  if (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) {
    let adapter;
    try {
      adapter = await tryPostgres();
    } catch (e) {
      throw new Error(`[DB] Postgres init failed: ${e.message}`);
    }
    adapter = promisifyAdapter(adapter);
    if (!state.logged) {
      console.log(`[DB] Driver: ${adapter.driver} | DATABASE_URL`);
      state.logged = true;
    }
    const { runMigrationOnce } = await import("./migrate.js");
    await runMigrationOnce(adapter);
    return adapter;
  }

  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

  adapter = promisifyAdapter(adapter);

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

/** Wrap a sync SQLite adapter so run/get/all/exec/transaction are always async. */
export function promisifyAdapter(inner) {
  if (!inner || inner.async) return inner;

  async function run(sql, params) { return inner.run(sql, params); }
  async function get(sql, params) { return inner.get(sql, params); }
  async function all(sql, params) { return inner.all(sql, params); }
  async function exec(sql) { return inner.exec(sql); }

  async function transaction(fn) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    inner.exec(`SAVEPOINT ${sp}`);
    try {
      const result = await fn();
      inner.exec(`RELEASE ${sp}`);
      return result;
    } catch (e) {
      try { inner.exec(`ROLLBACK TO ${sp}`); inner.exec(`RELEASE ${sp}`); } catch {}
      throw e;
    }
  }

  return {
    driver: inner.driver,
    raw: inner.raw,
    async: true,
    run,
    get,
    all,
    exec,
    transaction,
    checkpoint: (...a) => inner.checkpoint?.(...a),
    close: (...a) => inner.close?.(...a),
  };
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
