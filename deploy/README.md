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

The older tag-only workflow (`.github/workflows/docker-publish.yml`) still exists for `v*` tags. On this fork it publishes **GHCR only**; Docker Hub `decolua/9router` is upstream-only.

## First GHCR package

The first push creates a private GHCR package even if the git repo is public. Either:

1. GitHub → **Packages** → **9router** → Package settings → **Change visibility → Public**, or
2. In Coolify, add a Docker registry: host `ghcr.io`, username = your GitHub user, password = a PAT with `read:packages`.

## Coolify

1. Merge to `main` and wait until **Build and Push GHCR** is green.
2. Coolify → New Resource → **Docker Compose** → this repository (compose file `docker-compose.yml`).
3. Set environment variables (see below). Coolify interpolates them into compose.
4. Deploy. Coolify pulls `ghcr.io/lehuygiang28/9router:latest` (or pin `IMAGE_TAG=0.5.75`). Enable “force pull” / `pull_policy: always` so `latest` updates.

Do **not** point Coolify at a `build:` context. The app service has `image:` only.

## Required environment

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Dashboard session cookie |
| `INITIAL_PASSWORD` | First-login password |
| `POSTGRES_PASSWORD` | Postgres 18 password; also interpolated into `DATABASE_URL`. Use URL-safe characters (`A-Za-z0-9._-`) so the URI stays valid. |

Optional: `POSTGRES_USER` / `POSTGRES_DB` (default `9router`), `IMAGE_TAG` (default `latest`), `AUTH_COOKIE_SECURE=true` behind HTTPS, `BASE_URL` / `NEXT_PUBLIC_BASE_URL` = the public Coolify URL.

Compose sets `DATABASE_URL=postgres://…@postgres:5432/…` and `PGSSLMODE=disable`. The hostname `postgres` has no dot, so the app’s SSL helper does not enable TLS (same as local Docker). Do not set `PGSSLMODE=require` against this bundled Postgres.

If you use a **managed** Postgres instead, drop the `postgres` service and set `DATABASE_URL` yourself. Public hosts (a hostname with a dot) get TLS automatically; `PGSSLMODE=require` / `verify-full` still work.

## Local check

```bash
export JWT_SECRET=dev-secret INITIAL_PASSWORD=changeme POSTGRES_PASSWORD=changeme
docker compose pull
docker compose up -d
# dashboard: http://localhost:20128
```
