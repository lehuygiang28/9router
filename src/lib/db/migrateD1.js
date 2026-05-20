import { stringifyJson } from "./helpers/jsonCol.js";
import { TABLES, buildCreateTableSql } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaSync, setMetaSync } from "./helpers/metaStore.js";

// D1-only migration — no fs/path/backup, works on Cloudflare Workers.
// All adapter calls are async under the unified adapter contract.

async function runVersionedMigrations(adapter) {
  await adapter.exec(buildCreateTableSql("_meta", TABLES._meta));

  const currentRaw = await getMetaSync(adapter, "schemaVersion", "0");
  const current = parseInt(currentRaw, 10) || 0;
  const target = latestVersion();
  if (current >= target) {
    return { applied: 0, from: current, to: current, upToDate: true };
  }

  const pending = MIGRATIONS.filter((m) => m.version > current);
  let lastApplied = current;
  for (const m of pending) {
    await adapter.transaction(async () => {
      await m.up(adapter);
      await setMetaSync(adapter, "schemaVersion", m.version);
    });
    lastApplied = m.version;
    console.log(`[DB][migrate] applied #${m.version} ${m.name}`);
  }
  return {
    applied: pending.length,
    from: current,
    to: lastApplied,
    upToDate: false,
  };
}

async function syncSchemaFromTables(adapter) {
  for (const [tableName, def] of Object.entries(TABLES)) {
    await adapter.exec(buildCreateTableSql(tableName, def));

    const existing = await adapter.all(`PRAGMA table_info(${tableName})`);
    const existingNames = new Set(existing.map((r) => r.name));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName)) {
        const safeDef = colDef
          .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
          .replace(/UNIQUE/i, "")
          .trim();
        try {
          await adapter.exec(
            `ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`,
          );
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(
            `[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`,
          );
        }
      }
    }

    for (const idx of def.indexes || []) {
      try {
        await adapter.exec(idx);
      } catch {}
    }
  }
}

const _migratedAdapters = new WeakSet();

export async function runMigrationOnce(adapter) {
  if (_migratedAdapters.has(adapter)) return;

  let fresh = false;
  try {
    const row = await adapter.get(`SELECT COUNT(*) as c FROM _meta`);
    fresh = !row || row.c === 0;
  } catch {
    fresh = true;
  }

  const mig = await runVersionedMigrations(adapter);

  // On Workers, when schemaVersion already matches bundled migrations (e.g. after
  // `migrate:cf`), skip syncSchemaFromTables — it issues many sequential D1 + PRAGMA
  // round-trips per cold isolate and can keep requests open so long the client
  // disconnects (Logs: outcome "canceled", high wallTimeMs, tiny cpuTimeMs).
  const onCf =
    typeof process !== "undefined" && process.env.CLOUDFLARE_WORKER === "1";
  if (!(onCf && mig.upToDate === true)) {
    await syncSchemaFromTables(adapter);
  }

  // Ensure row id=1 exists so getSettings() never sees a missing settings row on D1.
  await adapter.run(`INSERT OR IGNORE INTO settings(id, data) VALUES(1, ?)`, [
    stringifyJson({}),
  ]);

  if (fresh) {
    await setMetaSync(adapter, "appVersion", "cloudflare");
  }

  _migratedAdapters.add(adapter);
}
