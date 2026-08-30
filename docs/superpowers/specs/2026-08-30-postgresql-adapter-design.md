# PostgreSQL Adapter + Usage Read-Path Design

## Goal

Add a PostgreSQL persistence backend that:

1. Does not change 9router business logic (routing, auth, translators, dashboard
   contracts).
2. Stays cheap to rebase from upstream `master` onto this fork's `main`.
3. Makes durable state usable on a cloud host that cannot keep a local SQLite
   file (Fly, Railway, Render, a VPS, Docker). SQLite remains the local default.
4. Fixes the dashboard lag on logs / request details / usage after prolonged
   use — which is primarily a read-path problem, not a SQLite-vs-Postgres
   problem.

## Locked assumptions

These were not answered in-thread; they are the defaults this spec proceeds
with. Change them before implementation if they are wrong.

- **Deploy shape:** one always-on Node process (`custom-server.js`) plus a
  managed Postgres when `DATABASE_URL` is set. Local CLI keeps SQLite.
- **Vercel is not a host for the gateway.** The process needs long-lived SSE,
  OAuth refresh, in-memory pending-request state, and a custom HTTP server.
  Postgres removes the "local file" blocker; it does not make 9router a
  serverless app. A later split (Vercel dashboard + always-on gateway) is out
  of scope.
- **Default backend stays SQLite.** Postgres is opt-in via `DATABASE_URL`.
- **Lag fixes are in scope.** Shipping only a dialect adapter would still scan
  unbounded `usageHistory` on every SSE tick.

## Current persistence (evidence)

The adapter boundary already exists:

- `src/lib/db/driver.js` picks `bun:sqlite` → `better-sqlite3` → `node:sqlite`
  → `sql.js`.
- Repos talk to `{ run, get, all, exec, transaction, close }` with SQLite
  dialect (`?` placeholders, `INSERT OR REPLACE`, camelCase identifiers,
  `INTEGER` 0/1 flags, `AUTOINCREMENT`, `PRAGMA`).
- Schema lives in `src/lib/db/schema.js` (`TABLES` + additive `syncSchemaFromTables`).
- Config tables are small. `usageHistory` is **never pruned**. `requestDetails`
  is capped (`observabilityMaxRecords`, default 200) but each row stores a fat
  JSON blob in `data`.

Hot read path today:

- Dashboard `UsageStats` loads filtered stats via `GET /api/usage/stats?period=…`
  (fine) and opens `EventSource("/api/usage/stream")`.
- The SSE handler calls `getUsageStats()` with default `period = "all"`.
- For `period = "all"`, `getUsageStats` loads every `usageDaily` row, then
  overlays **the entire `usageHistory` table** to refresh `lastUsed`.
- The SSE client then **discards** almost all of that payload and keeps only
  `activeRequests`, `recentRequests`, `errorProvider`, `pending`.
- Request-details list does `SELECT data FROM requestDetails …` (full JSON
  including bodies) and the API route redacts bodies afterward.

That is why the UI gets slower the longer the process has been recording
traffic. Switching the file to Postgres without changing these queries would
reproduce the same lag at slightly larger scale.

## Approaches considered

### A. Dialect-translating Postgres adapter (recommended)

Add `postgresAdapter.js` plus a SQLite→Postgres SQL translator. Repos keep
emitting SQLite SQL. `driver.js` selects Postgres when `DATABASE_URL` is set.

| | |
| --- | --- |
| Upstream merge | New files never exist upstream. `driver.js` is a tiny patch. Repos need mechanical `await` (see Async contract). SQL in repos stays upstream-shaped. |
| Performance | Same query plans as today unless we also fix the read path (section below). Connection pooling via `pg.Pool`. |
| Cloud | Any host with a TCP (or pooled) Postgres URL: Neon, RDS, Supabase, Railway, Fly. |
| Risk | Translator must cover the dialect surface in `src/lib/db/**`. Untested SQL from a future upstream commit fails at runtime until the translator is extended. |

### B. Dual SQL in every repo

`if (driver === "postgres")` branches (or a query builder) inside each repo.

Rejected: every upstream repo edit becomes a conflict. Violates "adapt well
when syncing from remote".

### C. Remote SQLite (Turso / libSQL) instead of Postgres

Wire-compatible SQL, no dialect translator.

Rejected as the primary design: the request is PostgreSQL; Turso is another
vendor lock and still has an async client. Keep as a non-goal / future option,
not this work.

**Recommendation: A**, plus the lag read-path fixes. Do not rewrite repos into
an ORM.

## Design

### 1. Backend selection

`initAdapter()` in `src/lib/db/driver.js`:

1. If `process.env.DATABASE_URL` is non-empty, construct the Postgres adapter
   and run `runMigrationOnce`. On failure, throw (do not silently fall back to
   a local SQLite file — that would split state across two databases).
2. Else keep the existing SQLite fallback chain unchanged.

`DATABASE_URL` is the only switch. No `DB_DRIVER` flag.

`pg` lives in `optionalDependencies` (same rationale as `better-sqlite3`):
install must not fail when Postgres is unused. The Postgres adapter imports
`pg` dynamically.

### 2. Adapter contract

Postgres implements the same methods as SQLite adapters:

- `driver: "postgres"`
- `run(sql, params)`, `get(sql, params)`, `all(sql, params)`, `exec(sql)`
- `transaction(fn)`
- `close()`, optional `checkpoint()` (no-op)

All of those methods are **async** once they leave `getAdapter()`. SQLite
adapters themselves stay sync (upstream files untouched). `driver.js` wraps
them with a thin promisify layer:

- `run/get/all/exec` → `async (...args) => adapter.method(...args)`
- `transaction(fn)` → `BEGIN` / `await fn()` / `COMMIT`, rollback on throw,
  using `SAVEPOINT` so today's non-nested repo transactions still work.

Call sites (`repos/*`, `helpers/*`, `migrate.js`, `index.js`, `backup.js`)
use `await db.all(...)`, `await db.transaction(async () => { ... })`.

Why not keep a sync Postgres API: `pg` is async. Faking sync (worker +
`Atomics.wait`, `deasync`) blocks the gateway event loop during usage writes
and does not belong on a streaming proxy.

Merge playbook for the await tax:

- After an upstream pull, run `scripts/ensure-await-adapter.mjs` (new) which
  fails if `db.(run|get|all|exec|transaction)(` is not awaited.
- Existing unit tests then fail the same way on both backends if a call is
  left unawaited (`Promise` has no `.map`).

### 3. SQL dialect translator

New module `src/lib/db/dialect/sqliteToPg.js`, used only by the Postgres
adapter. It rewrites each statement before `pg` sees it.

Required translations (the SQLite surface used by `src/lib/db` today, plus
`json_extract` for the details list projection):

| SQLite | Postgres |
| --- | --- |
| `?` placeholders | `$1`, `$2`, … |
| Unquoted camelCase identifiers (`providerConnections`, `createdAt`, `promptTokens`) | Quoted `"providerConnections"` so PG does not fold to lowercase |
| `INSERT OR REPLACE INTO t(…)` | `INSERT INTO t(…) ON CONFLICT (<pk>) DO UPDATE SET … = EXCLUDED.…` |
| `INSERT OR IGNORE` | `ON CONFLICT DO NOTHING` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` |
| `REAL` | `DOUBLE PRECISION` |
| `PRAGMA …` | no-op `SELECT 1` except `PRAGMA table_info(t)` |
| `PRAGMA table_info(t)` | `information_schema` / `pg_catalog` rows shaped as SQLite `{cid,name,type,notnull,dflt_value,pk}` so `syncSchemaFromTables` stays unchanged |
| `sqlite_master` | `pg_catalog.pg_tables` / `pg_class` with `{name, sql}` best-effort; backup path is special-cased (below) |
| `ON CONFLICT(id) DO UPDATE SET … excluded.x` | already valid in Postgres (`EXCLUDED`) |
| `json_extract(data, '$.tokens')` | `("data"::json -> 'tokens')` (needed for the details list projection; fail loud on other JSON functions) |
| `SELECT last_insert_rowid()` | not used by repos; `run()` on `INSERT INTO usageHistory` without an `id` appends `RETURNING "id"` and exposes it as `lastInsertRowid` |

`INSERT OR REPLACE` primary keys are taken from `TABLES` in `schema.js` (including composite `kv(scope, key)`), not guessed from the INSERT column list. If a table is missing from `TABLES`, throw `UnsupportedSqliteSql`.

Keep JSON as `TEXT` (not `jsonb`) so repos keep `stringifyJson` / `parseJson`.
Do not convert `isActive` from `INTEGER` 0/1 to boolean — `row.isActive === 1`
must keep working. Coerce Postgres `int8` (`COUNT(*)`) to JS number in the
adapter (`pg.types.setTypeParser` for OID 20).

DDL from `buildCreateTableSql` goes through the same translator, so
`migrate.js` / `schema.js` stay declarative and additive.

Unsupported SQLite that we do **not** implement unless a repo starts using it:
`datetime()`, `strftime`, `json_each`, `LIKE` escape quirks, `WITHOUT ROWID`,
triggers. If a future upstream commit introduces one, the translator throws a
clear `UnsupportedSqliteSql` error with the statement — fail loud, do not
guess. `json_extract` is supported because the details list projection uses it.

### 4. Schema sync and backups on Postgres

`runMigrationOnce` still runs. Versioned migrations + `syncSchemaFromTables`
are the schema source of truth on both backends.

`backupDbLite` uses `ATTACH DATABASE` and `sqlite_master`. That cannot run on
Postgres. When `adapter.driver === "postgres"`:

- Skip the file-level SQLite backup.
- Log that durability is the managed database's responsibility.
- Do not invent a `pg_dump` shell-out in v1.

Legacy JSON import (`db.json` → SQLite) is SQLite-only. A fresh Postgres
database starts empty; operators import via the existing dashboard
export/import (`exportDb` / `importDb`) if they need to move a local install.

### 5. Connection pooling and process model

Use `pg.Pool` with:

- `connectionString: process.env.DATABASE_URL`
- `max` from `PG_POOL_MAX` defaulting to 10
- `idleTimeoutMillis` 30s
- `allowExitOnIdle: true` so tests can exit

One pool per process, stored on `global._dbAdapter` like today's adapter
(survives Next.dev HMR).

For Neon / Supabase: operators pass the **pooled** URL in `DATABASE_URL`.
We do not add `@neondatabase/serverless` in v1. The always-on process can
hold TCP connections.

`transaction(fn)` checks out one client from the pool for the duration of
`fn`, so all statements in the transaction share a connection (required for
`BEGIN`).

### 6. Lag read-path (required, independent of backend)

These are the actual lag fixes. They slightly touch repo/API code but not
routing logic.

**6a. SSE must not recompute all-time stats.**

`GET /api/usage/stream` currently calls `getUsageStats()` (period `"all"`) on
every `update` event, then the client throws the heavy fields away.

Change the stream to push only what the client merges: `getActiveRequests()`
plus `pending` / `errorProvider`. Stop calling `getUsageStats()` from the
stream. Period-scoped totals stay on `GET /api/usage/stats?period=`.

**6b. `lastUsed` overlay must not scan `usageHistory`.**

Replace the unbounded

```sql
SELECT timestamp, provider, model, connectionId, apiKey, endpoint
FROM usageHistory WHERE timestamp >= ?
```

with a grouped query:

```sql
SELECT provider, model, connectionId, apiKey, endpoint, MAX(timestamp) AS timestamp
FROM usageHistory WHERE timestamp >= ?
GROUP BY provider, model, connectionId, apiKey, endpoint
```

When `period === "all"`, skip the history overlay entirely and keep `lastUsed`
as the daily key already stored on `usageDaily` blobs. For `7d` / `30d` /
`60d`, use the grouped `MAX(timestamp)` query bounded by the period cutoff.
`24h` / `today` already read a bounded window and do not use this overlay.

**6c. Request-details list must not return conversation bodies.**

The list UI needs `tokens` and `latency`. The API already redacts
`request` / `response` bodies. The list query still reads `data` (fail-open
`parseJson` so a corrupt row cannot break the page) but maps only
`{ id, timestamp, provider, model, connectionId, status, tokens, latency }`.
`getRequestDetailById` still `SELECT data` for any full-record reader.

**6d. Bound `getUsageHistory`.**

`getUsageHistory` currently selects the whole table with no `LIMIT`. It is
not used by a dashboard route today, but it is exported. Add
`filter.limit` default 1000, max 5000, `ORDER BY id DESC`.

**6e. No automatic prune of `usageHistory` in v1.**

Pruning is a product decision (users expect all-time cost). 6a–6d remove the
unbounded reads. A retention setting can be a later spec.

### 7. Files expected to change vs stay upstream-clean

**New (no upstream conflict):**

- `src/lib/db/adapters/postgresAdapter.js`
- `src/lib/db/dialect/sqliteToPg.js`
- `scripts/ensure-await-adapter.mjs`
- `tests/unit/db-dialect-sqlite-to-pg.test.js`
- `tests/unit/db-postgres-adapter.test.js` (PGlite or `DATABASE_URL`)
- this spec / the follow-up plan

**Tiny / mechanical patches (rebase cost, acceptable):**

- `src/lib/db/driver.js` — `DATABASE_URL` branch + promisify wrapper
- `src/lib/db/repos/*.js`, `helpers/*.js`, `migrate.js`, `index.js`, `backup.js`
  — `await` on adapter calls
- `package.json` — optional `pg`
- `.env.example` — `DATABASE_URL`, `PG_POOL_MAX`

**Semantic patches (rebase cost, required for lag):**

- `src/lib/db/repos/usageRepo.js` — 6b, 6d
- `src/lib/db/repos/requestDetailsRepo.js` — 6c
- `src/app/api/usage/stream/route.js` — 6a

Do **not** rewrite `schema.js` `TABLES` into Postgres types; the translator
owns that.

### 8. Cloud deploy (what this enables)

Supported after this work:

- Local: unset `DATABASE_URL` → SQLite as today.
- Cloud always-on (Fly / Railway / Render / Docker / VPS): set `DATABASE_URL`
  to a managed Postgres, `DATA_DIR` still used for usage file logs that have
  not moved (`log.txt` is already unused for request logs; `appendRequestLog`
  is a no-op).

Not supported, and not claimed:

- Hosting the gateway on Vercel / Cloudflare Workers / Lambda. SSE, token
  refresh, and `custom-server.js` need a process. Postgres does not change
  that.
- Multi-instance active-active without extra work: in-memory
  `pendingRequests`, request-details write buffer, and `statsEmitter` are
  per-process. Durable rows are shared via Postgres; live "active requests"
  badges are not. v1 documents "run one gateway replica" (same as SQLite).

### 9. Error handling

- Missing `pg` when `DATABASE_URL` is set: throw at init with "install pg or
  unset DATABASE_URL".
- Translator miss: throw `UnsupportedSqliteSql`, do not execute partial SQL.
- Pool exhaustion: let `pg` time out; do not open unbounded clients.
- Migration failure on Postgres: abort boot; do not create a sidecar SQLite.
- Read-path failures stay fail-open where they already are (`getRecentLogs`
  returns `[]`, `saveRequestUsage` logs and swallows).

### 10. Testing

1. **Dialect unit tests** (no database): placeholder rewrite, identifier
   quoting, `INSERT OR REPLACE`, `AUTOINCREMENT` DDL, `PRAGMA table_info`
   shape, rejection of unknown functions.
2. **Adapter contract tests** against PGlite (`@electric-sql/pglite` in
   `tests/package.json`) in CI so we do not need a network Postgres. Cover:
   settings upsert, connections CRUD, usage insert + daily conflict,
   request-details pagination, COUNT returned as number, camelCase column
   names round-trip.
3. **Existing SQLite tests** (`tests/unit/db-sqlite-vs-lowdb.test.js` and
   related) must still pass with `DATABASE_URL` unset.
4. **Lag tests:** stream route does not call `getUsageStats`; list
   `getRequestDetails` does not parse full `data`; `getUsageStats("all")`
   does not select every `usageHistory` row (assert via a stub adapter that
   records SQL).
5. Optional live `DATABASE_URL` test file, skipped unless the env is set
   (same pattern as `*.real.test.js`).

Lint the touched JS with the repo ESLint config. Do not require the full
vitest suite to be green; compare against `tests/__baseline__/known-fails.txt`.

## Non-goals

- ORM (Drizzle, Prisma, Kysely).
- Hosting 9router on Vercel as a serverless app.
- Splitting dashboard and gateway into two deploys.
- Changing translators, executors, or provider registry.
- Migrating `usage.json` / `log.txt` leftover files (already superseded).
- Automatic `usageHistory` retention/TTL.
- Multi-replica in-memory state (Redis) for pending requests.
- Turso / libSQL.
- Changing the public dashboard JSON shapes except dropping unused heavy
  fields from the SSE stream (the client already ignores them).

## Success criteria

- Unset `DATABASE_URL`: behavior matches current SQLite path, including
  existing DB unit tests.
- Set `DATABASE_URL`: the same repo functions persist and read equivalent
  rows in Postgres; dashboard usage/details APIs work.
- Opening the usage page after N large history rows does not scan
  `usageHistory` on the SSE tick.
- Rebase from upstream `master`: conflicts concentrated in `driver.js` plus
  mechanical awaits in files upstream actually touched; no forked copy of
  `TABLES` or per-repo SQL.
