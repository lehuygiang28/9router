// Bun runtime adapter — uses built-in bun:sqlite (native, fastest under Bun).
// Loaded only when process.versions.bun is present.
import { PRAGMA_SQL } from "../schema.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createBunSqliteAdapter(filePath) {
  // Runtime-built specifier so esbuild (OpenNext Workers build) doesn't try to
  // resolve "bun:sqlite" on disk. Bun resolves this at import time; on Node /
  // Workers this code path is never reached (driver.js gates on process.versions.bun).
  const mod = ["bun", "sqlite"].join(":");
  const { Database } = await import(/* @vite-ignore */ mod);
  const db = new Database(filePath, { create: true });
  db.exec(PRAGMA_SQL);

  const stmtCache = new Map();
  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  const checkpointTimer = setInterval(() => {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
  }, CHECKPOINT_INTERVAL_MS);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

  function gracefulClose() {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }
  const onShutdown = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: "bun:sqlite",
    run(sql, params = []) {
      const r = prepare(sql).run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    get(sql, params = []) {
      return prepare(sql).get(...params);
    },
    all(sql, params = []) {
      return prepare(sql).all(...params);
    },
    exec(sql) { return db.exec(sql); },
    // Sequential to match D1 adapter contract (callers `await` fn body).
    // Loses bun:sqlite's BEGIN/COMMIT wrapping for atomicity but keeps API uniform.
    async transaction(fn) {
      return await fn();
    },
    // Atomic write-only batch via bun:sqlite's db.transaction wrapper.
    async batch(statements) {
      if (!Array.isArray(statements) || statements.length === 0) return [];
      const tx = db.transaction((stmts) => {
        const results = [];
        for (const { sql, params = [] } of stmts) {
          results.push(prepare(sql).run(...params));
        }
        return results;
      });
      return tx(statements);
    },
    checkpoint() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db,
  };
}
