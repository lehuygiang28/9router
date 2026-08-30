/**
 * Pool SSL options for managed Postgres (Render, Neon, RDS, …).
 *
 * Defaults:
 * - loopback / docker service names: no ssl (local compose stays easy)
 * - public hostnames (contain a dot) or sslmode=require: ssl with
 *   rejectUnauthorized=false (Render's certs fail Node's default CA check)
 * - PGSSLMODE=disable / verify-full override the heuristic
 */

function toHttpUrl(connectionString) {
  return String(connectionString || "").replace(/^postgres(ql)?:/i, "http:");
}

export function extractConnectionHost(connectionString) {
  try {
    return new URL(toHttpUrl(connectionString)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function extractSslMode(connectionString) {
  try {
    return (new URL(toHttpUrl(connectionString)).searchParams.get("sslmode") || "").toLowerCase();
  } catch {
    return "";
  }
}

function isLoopbackHost(host) {
  const h = String(host || "").replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
}

function looksPublicHost(host) {
  return String(host || "").includes(".");
}

function truthy(v) {
  return ["1", "true", "yes"].includes(String(v || "").toLowerCase());
}

/**
 * @returns {undefined | false | { rejectUnauthorized: boolean }}
 *   undefined — omit `ssl` and let `pg` use its URL defaults
 *   false — force TLS off (PGSSLMODE=disable)
 *   object — pass through to `pg.Pool`
 */
export function resolvePostgresSsl(connectionString, env = process.env) {
  const mode = String(env.PGSSLMODE || extractSslMode(connectionString) || "").toLowerCase();
  const host = extractConnectionHost(connectionString);

  if (mode === "disable") return false;
  if (mode === "verify-full" || mode === "verify-ca") {
    return { rejectUnauthorized: true };
  }

  const rejectUnauthorized = truthy(env.PGSSL_REJECT_UNAUTHORIZED);

  if (mode === "require" || mode === "prefer") {
    return { rejectUnauthorized };
  }

  if (isLoopbackHost(host)) return undefined;
  if (looksPublicHost(host)) return { rejectUnauthorized };
  return undefined;
}

export function buildPostgresPoolConfig(connectionString, env = process.env) {
  const config = {
    connectionString,
    max: parseInt(env.PG_POOL_MAX || "10", 10) || 10,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  };
  const ssl = resolvePostgresSsl(connectionString, env);
  if (ssl !== undefined) config.ssl = ssl;
  return config;
}
