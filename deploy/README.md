# Coolify / Docker deploy (this fork)

Published image (GitHub Actions on `main`, not built on the Coolify host):

| | |
|---|---|
| **Image** | `ghcr.io/lehuygiang28/9router` |
| **Tags** | `latest` and the version in root `package.json` (currently `0.5.75`) |
| **Workflow** | `.github/workflows/docker-ghcr.yml` (`Build and Push GHCR`) |
| **Trigger** | push to `main`, or **Actions → Build and Push GHCR → Run workflow** |
| **Permissions** | `packages: write` on the default `GITHUB_TOKEN` — no extra Actions secrets |
| **Platforms** | `linux/amd64`, `linux/arm64` |

Two workflows can publish the same GHCR tag string:

| Workflow | When | Tags |
|---|---|---|
| `docker-ghcr.yml` | every push to `main` (and manual run) | `latest` + `package.json` version |
| `docker-publish.yml` | git tags `v*` (and manual run) | semver from the tag; Docker Hub only for `decolua/9router` |

If both run for the same version, the **later successful push wins**. On this fork, day-to-day Coolify deploys follow `docker-ghcr.yml`. Use `v*` tags when you want a release commit distinct from `main` HEAD.

## First GHCR package

The first push creates a private GHCR package even if the git repo is public. Either:

1. GitHub → **Packages** → **9router** → Package settings → **Change visibility → Public**, or
2. In Coolify, add a Docker registry: host `ghcr.io`, username = your GitHub user, password = a PAT with `read:packages`.

## Coolify

1. Merge to `main` and wait until **Build and Push GHCR** is green.
2. Coolify → New Resource → **Docker Compose** → this repository (compose file `docker-compose.yml`).
3. Set environment variables (see below). Coolify interpolates them into compose.
4. Deploy. Coolify pulls `ghcr.io/lehuygiang28/9router:${IMAGE_TAG:-latest}`. Enable “force pull” / `pull_policy: always` so `latest` updates.

Do **not** point Coolify at a `build:` context. The app service has `image:` only.

**Production:** pin `IMAGE_TAG` to the `package.json` version (for example `0.5.75`) so a later `main` push cannot roll the instance when `latest` moves. Treat `latest` as the Coolify/dev convenience tag.

## Required environment

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Dashboard session cookie |
| `INITIAL_PASSWORD` | First-login password. **Must set.** If Coolify leaves it blank, Compose still injects an empty string and the app falls back to `123456` until a password hash is stored. Remote access then requires a password change; local/LAN login does not. |
| `POSTGRES_PASSWORD` | Postgres 18 password. Also interpolated into the default `DATABASE_URL`. Use URL-safe characters (`A-Za-z0-9._-`) so the URI stays valid. Characters like `@`, `:`, `/`, `#`, `%`, or space break parsing. |

### Hardening (internet-facing Coolify)

Compose defaults match upstream (`REQUIRE_API_KEY=false`). Port `20128` is published, so a public URL leaves `/v1/*` open unless you lock it down.

| Variable | Purpose |
|---|---|
| `REQUIRE_API_KEY` | Set `true` so `/v1/*` requires a Bearer API key |
| `API_KEY_SECRET` | HMAC secret for generated API keys (see `.env.example`). Override the well-known default. |
| `AUTH_COOKIE_SECURE` | Set `true` behind Coolify HTTPS |
| `IMAGE_TAG` | Pin to a semver tag instead of `latest` |

Optional: `POSTGRES_USER` / `POSTGRES_DB` (default `9router`), `BASE_URL` / `NEXT_PUBLIC_BASE_URL` = the public Coolify URL.

### `DATABASE_URL`

Compose always sets a constructed URL (no nested `${DATABASE_URL:-…}` default — Coolify’s interpolator stops at the first `}`):

```text
DATABASE_URL=postgres://USER:PASSWORD@postgres:5432/DB
PGSSLMODE=disable
```

To use a custom URL (managed Postgres, or a password that is not URL-safe):

1. Set `DATABASE_URL` in Coolify.
2. Change the app service line to `DATABASE_URL: ${DATABASE_URL}` (commented in `docker-compose.yml`).
3. Encode the user and password with `encodeURIComponent` (Node) / `urllib.parse.quote` (Python) if they contain `@`, `:`, `/`, `#`, `%`, or space:

```js
const user = encodeURIComponent("9router");
const pass = encodeURIComponent("p@ss:word");
const DATABASE_URL = `postgres://${user}:${pass}@postgres:5432/9router`;
```

The hostname `postgres` has no dot, so the app’s SSL helper does not enable TLS (same as local Docker). Do not set `PGSSLMODE=require` against this bundled Postgres.

If you use a **managed** Postgres instead, drop the `postgres` service and set `DATABASE_URL` yourself. Public hosts (a hostname with a dot) get TLS automatically; `PGSSLMODE=require` / `verify-full` still work.

## Not an in-place upgrade from SQLite compose

This file replaces the upstream SQLite + Headroom compose. It is a **new stack**, not a data-preserving upgrade:

- Old volume name `9router-data` (SQLite `data.sqlite`) is **not** mounted.
- New volumes are `app-data` (`DATA_DIR` / SQLite fallback files) and `app-home` (`~/.9router` usage/logs).
- The app always gets `DATABASE_URL`, so it talks to empty Postgres, not the old SQLite file.
- `src/lib/db/migrate.js` imports legacy JSON, not `data.sqlite` → Postgres.

Keep the old Compose project running if you still need that SQLite data. There is no bundled migrator in this PR.

## Local check

```bash
export JWT_SECRET=dev-secret INITIAL_PASSWORD=changeme POSTGRES_PASSWORD=changeme
docker compose pull
docker compose up -d
# dashboard: http://localhost:20128
```
