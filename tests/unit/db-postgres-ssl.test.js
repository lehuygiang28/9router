import { describe, it, expect } from "vitest";
import {
  extractConnectionHost,
  extractSslMode,
  resolvePostgresSsl,
  buildPostgresPoolConfig,
} from "@/lib/db/adapters/postgresSsl.js";

const RENDER_EXTERNAL = "postgres://u:p@dpg-xxx-a.oregon-postgres.render.com/9router";
const RENDER_EXTERNAL_SSL = "postgres://u:p@dpg-xxx-a.oregon-postgres.render.com/9router?sslmode=require";
const RENDER_INTERNAL = "postgres://u:p@dpg-xxx-a/9router";
const LOCAL = "postgres://u:p@localhost:5432/9router";
const DOCKER = "postgres://u:p@postgres:5432/9router";

describe("postgres SSL helper", () => {
  it("parses host and sslmode from a connection string", () => {
    expect(extractConnectionHost(RENDER_EXTERNAL_SSL)).toBe("dpg-xxx-a.oregon-postgres.render.com");
    expect(extractSslMode(RENDER_EXTERNAL_SSL)).toBe("require");
    expect(extractSslMode(LOCAL)).toBe("");
  });

  it("enables TLS for Render public hostnames without verifying the CA", () => {
    expect(resolvePostgresSsl(RENDER_EXTERNAL, {})).toEqual({ rejectUnauthorized: false });
    expect(resolvePostgresSsl(RENDER_EXTERNAL_SSL, {})).toEqual({ rejectUnauthorized: false });
  });

  it("leaves Render internal hostnames and docker service names alone", () => {
    expect(resolvePostgresSsl(RENDER_INTERNAL, {})).toBeUndefined();
    expect(resolvePostgresSsl(DOCKER, {})).toBeUndefined();
  });

  it("does not enable TLS for localhost unless sslmode says so", () => {
    expect(resolvePostgresSsl(LOCAL, {})).toBeUndefined();
    expect(resolvePostgresSsl(`${LOCAL}?sslmode=require`, {})).toEqual({ rejectUnauthorized: false });
  });

  it("honors PGSSLMODE=disable even on a public host", () => {
    expect(resolvePostgresSsl(RENDER_EXTERNAL, { PGSSLMODE: "disable" })).toBe(false);
  });

  it("honors verify-full and PGSSL_REJECT_UNAUTHORIZED", () => {
    expect(resolvePostgresSsl(RENDER_EXTERNAL, { PGSSLMODE: "verify-full" }))
      .toEqual({ rejectUnauthorized: true });
    expect(resolvePostgresSsl(RENDER_EXTERNAL, { PGSSL_REJECT_UNAUTHORIZED: "true" }))
      .toEqual({ rejectUnauthorized: true });
  });

  it("puts ssl onto the pool config for a Render URL", () => {
    const cfg = buildPostgresPoolConfig(RENDER_EXTERNAL, { PG_POOL_MAX: "4" });
    expect(cfg.connectionString).toBe(RENDER_EXTERNAL);
    expect(cfg.max).toBe(4);
    expect(cfg.ssl).toEqual({ rejectUnauthorized: false });
    expect(cfg.allowExitOnIdle).toBe(true);
  });

  it("omits ssl on local URLs", () => {
    const cfg = buildPostgresPoolConfig(LOCAL, {});
    expect(cfg.ssl).toBeUndefined();
    expect(cfg.max).toBe(10);
  });
});
