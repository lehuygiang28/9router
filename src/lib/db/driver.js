// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter)
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

// On Cloudflare: only D1, skip all local adapters and fs-based paths
async function initCloudflare() {
  const { createD1Adapter } = await import("./adapters/d1Adapter.js");
  const adapter = await createD1Adapter();

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver}`);
    state.logged = true;
  }

  // Run D1-only migrations (no fs needed)
  const { runMigrationOnce } = await import("./migrateD1.js");
  await runMigrationOnce(adapter);
  return adapter;
}

// On local (Node.js/Bun): try all SQLite adapters
async function initLocal() {
  const { ensureDirs, DATA_FILE } = await import("./paths.js");
  ensureDirs();

  async function tryBunSqlite() {
    if (!process.versions.bun) return null;
    try {
      const { createBunSqliteAdapter } =
        await import("./adapters/bunSqliteAdapter.js");
      return await createBunSqliteAdapter(DATA_FILE);
    } catch (e) {
      console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
      return null;
    }
  }

  async function tryBetterSqlite() {
    if (process.versions.bun) return null;
    try {
      const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
      return await createBetterSqliteAdapter(DATA_FILE);
    } catch (e) {
      console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
      return null;
    }
  }

  async function tryNodeSqlite() {
    if (process.versions.bun) return null;
    const [maj, min] = process.versions.node.split(".").map(Number);
    if (maj < 22 || (maj === 22 && min < 5)) return null;
    try {
      const { createNodeSqliteAdapter } =
        await import("./adapters/nodeSqliteAdapter.js");
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

  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();

  // During build (webpack), native modules are ignored — return stub
  if (!adapter) {
    if (process.env.NEXT_PRIVATE_BUILD_WORKER || !process.stdout.isTTY) {
      console.warn("[DB] No driver available during build — using stub");
      return createBuildStub();
    }
    throw new Error(
      "[DB] No SQLite driver available (bun/better/node/sql.js all failed)",
    );
  }

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

// Stub adapter for build phase — returns empty results, no-ops writes
function createBuildStub() {
  const stub = async () => undefined;
  return {
    driver: "build-stub",
    run: async () => ({ changes: 0, lastInsertRowid: null }),
    get: stub,
    all: async () => [],
    exec: stub,
    transaction: async (fn) => await fn(),
    batch: async () => [],
    close: () => {},
    raw: null,
  };
}

async function initAdapter() {
  if (process.env.CLOUDFLARE_WORKER) {
    return initCloudflare();
  }
  return initLocal();
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise)
    state.initPromise = initAdapter().then((a) => {
      state.instance = a;
      return a;
    });
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance)
    throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
