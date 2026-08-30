import { AsyncLocalStorage } from "node:async_hooks";
import { translateSqliteToPg } from "../dialect/sqliteToPg.js";

const txStore = new AsyncLocalStorage();

function coerceInt8Parsers(pg) {
  try {
    pg.types.setTypeParser(20, (v) => (v == null ? v : parseInt(v, 10)));
  } catch {}
}

async function loadPg() {
  try {
    const mod = await import("pg");
    const pg = mod.default ?? mod;
    coerceInt8Parsers(pg);
    return pg;
  } catch (e) {
    throw new Error(`install pg or unset DATABASE_URL (${e.message})`);
  }
}

async function pragmaTableInfo(runQuery, table) {
  return runQuery(
    `SELECT
       (c.ordinal_position - 1)::int AS cid,
       c.column_name AS name,
       c.data_type AS type,
       CASE WHEN c.is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
       c.column_default AS dflt_value,
       CASE WHEN pk.column_name IS NULL THEN 0 ELSE 1 END AS pk
     FROM information_schema.columns c
     LEFT JOIN (
       SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_name = $1
     ) pk ON pk.column_name = c.column_name
     WHERE c.table_schema = 'public' AND c.table_name = $1
     ORDER BY c.ordinal_position`,
    [table],
  );
}

function maybeReturning(text) {
  if (!/^INSERT\s+INTO\s+/i.test(text)) return text;
  if (/\bRETURNING\b/i.test(text)) return text;
  if (!/"usageHistory"|usageHistory/i.test(text)) return text;
  const head = text.split(/VALUES/i)[0] || "";
  if (/\bid\b/i.test(head)) return text;
  return `${text} RETURNING "id"`;
}

/**
 * Postgres adapter implementing the promisified { run, get, all, exec, transaction } contract.
 * Pass `query(sql, params)` for tests (PGlite) or `connectionString` / `pool` for production.
 */
export async function createPostgresAdapter({ connectionString, pool, query } = {}) {
  let closeImpl = () => {};
  let connectClient = null;

  let defaultQuery;

  if (typeof query === "function") {
    defaultQuery = async (sql, params = []) => {
      const r = await query(sql, params);
      const rows = Array.isArray(r) ? r : (r.rows || []);
      return {
        rows,
        rowCount: r.rowCount ?? r.affectedRows ?? rows.length,
      };
    };
  } else {
    const pg = await loadPg();
    const Pool = pg.Pool;
    const p = pool || new Pool({
      connectionString,
      max: parseInt(process.env.PG_POOL_MAX || "10", 10) || 10,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: true,
    });
    defaultQuery = async (sql, params = []) => {
      const r = await p.query(sql, params);
      return { rows: r.rows, rowCount: r.rowCount };
    };
    connectClient = () => p.connect();
    closeImpl = () => { try { p.end(); } catch {} };
  }

  async function rawQuery(sql, params = []) {
    const tx = txStore.getStore();
    if (tx?.query) return tx.query(sql, params);
    return defaultQuery(sql, params);
  }

  async function execTranslated(sql, params = []) {
    const t = translateSqliteToPg(sql);
    if (t.kind === "pragma_noop" || t.kind === "skip_backup") {
      return { rows: [], rowCount: 0 };
    }
    if (t.kind === "pragma_table_info") return pragmaTableInfo(rawQuery, t.table);
    if (t.kind === "sqlite_master") {
      return rawQuery(
        `SELECT tablename AS name, NULL AS sql FROM pg_tables WHERE schemaname = 'public'`,
      );
    }
    if (t.kind !== "sql") throw new Error(`[DB][pg] unknown translate kind ${t.kind}`);
    return rawQuery(maybeReturning(t.text), params);
  }

  async function run(sql, params = []) {
    const r = await execTranslated(sql, params);
    const row = r.rows?.[0];
    const lastInsertRowid = row?.id ?? null;
    return { changes: Number(r.rowCount || 0), lastInsertRowid };
  }

  async function get(sql, params = []) {
    const r = await execTranslated(sql, params);
    return r.rows?.[0];
  }

  async function all(sql, params = []) {
    const r = await execTranslated(sql, params);
    return r.rows || [];
  }

  async function exec(sql) {
    const parts = String(sql).split(";").map((s) => s.trim()).filter(Boolean);
    for (const part of parts) await execTranslated(part);
  }

  async function withSavepoint(fn) {
    const sp = `sp_${Math.random().toString(36).slice(2)}`;
    await rawQuery(`SAVEPOINT ${sp}`);
    try {
      const result = await fn();
      await rawQuery(`RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (e) {
      try { await rawQuery(`ROLLBACK TO SAVEPOINT ${sp}`); } catch {}
      throw e;
    }
  }

  async function transaction(fn) {
    if (txStore.getStore()) return withSavepoint(fn);

    if (!connectClient) {
      await rawQuery("BEGIN");
      try {
        const result = await txStore.run({ query: defaultQuery }, fn);
        await rawQuery("COMMIT");
        return result;
      } catch (e) {
        try { await rawQuery("ROLLBACK"); } catch {}
        throw e;
      }
    }

    const client = await connectClient();
    const clientQuery = async (sql, params = []) => {
      const r = await client.query(sql, params);
      return { rows: r.rows, rowCount: r.rowCount };
    };
    try {
      await client.query("BEGIN");
      const result = await txStore.run({ query: clientQuery }, fn);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  return {
    driver: "postgres",
    async: true,
    run,
    get,
    all,
    exec,
    transaction,
    checkpoint() {},
    close: closeImpl,
  };
}
