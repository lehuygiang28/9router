import { getCloudflareContext } from "@opennextjs/cloudflare";

function getCfEnvForD1() {
  try {
    return getCloudflareContext().env;
  } catch (e) {
    // Never call getCloudflareContext({ async: true }) on deployed Workers: when
    // __cloudflare-context__ is missing it falls through to getPlatformProxy() /
    // Wrangler and can hang forever (no miniflare). Local `next dev` may need async.
    if (typeof process !== "undefined" && process.env.CLOUDFLARE_WORKER === "1") {
      throw new Error(
        `[D1] Cloudflare context unavailable (sync). ${e?.message || e}`,
      );
    }
    return null;
  }
}

export async function createD1Adapter() {
  let env = getCfEnvForD1();
  if (!env) {
    env = (await getCloudflareContext({ async: true })).env;
  }
  const db = env.DB;

  if (!db) {
    throw new Error("[D1] DB binding not found in Cloudflare environment");
  }

  async function run(sql, params = []) {
    const stmt = db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const result = await bound.run();
    return {
      changes: result.meta?.changes ?? 0,
      lastInsertRowid: result.meta?.last_row_id ?? null,
    };
  }

  async function get(sql, params = []) {
    const stmt = db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const result = await bound.first();
    return result || undefined;
  }

  async function all(sql, params = []) {
    const stmt = db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const result = await bound.all();
    if (Array.isArray(result)) return result;
    return result?.results ?? [];
  }

  async function exec(sql) {
    // D1 db.exec only supports single statements separated by newlines.
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of statements) {
      await db.prepare(s).run();
    }
  }

  // D1 has no BEGIN/COMMIT for sessions; sequential is the only option for
  // read-modify-write. For pure-write groups, prefer `batch()` for atomicity.
  async function transaction(fn) {
    return await fn();
  }

  // Atomic write-only batch. Each item: { sql, params? }.
  // Uses D1's native batch() — all statements commit or rollback together.
  async function batch(statements) {
    if (!Array.isArray(statements) || statements.length === 0) return [];
    const prepared = statements.map(({ sql, params = [] }) => {
      const s = db.prepare(sql);
      return params.length > 0 ? s.bind(...params) : s;
    });
    return await db.batch(prepared);
  }

  function close() {}

  return { driver: "d1", run, get, all, exec, transaction, batch, close, raw: db };
}
