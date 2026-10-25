# Deployment (Railway)

> **Status (2026-10-25): deployed.** Project **PharmaPong** (workspace "Peter Rüthemann's Projects", account
> peter.ruethemann@stud.unibas.ch), environment `production`, service `web` → **https://web-production-13b1f.up.railway.app**.
> Postgres and bucket `pharmapong-logos` (ams) provisioned; migrations applied; health, routes and bucket round trip verified.
> **Open:** `ADMIN_INITIAL_PASSWORD` is not set yet. Set it in the dashboard (web → Variables), then redeploy so
> `seed:admin` creates the admin `ADMIN_EMAIL`.
>
> **Note:** a `railway up` upload did **not** pick up `railway.json` (deployment meta `configFile: null`), and
> `railway environment edit --service-config` reported "No changes". The build/start/pre-deploy/healthcheck settings were
> therefore set on the service instance via the GraphQL API (`serviceInstanceUpdate`, see below). `railway.json` is
> kept as documentation; Railway deprecates config-as-code files on 2026-12-01 (`railway config migrate` → `.railway/railway.ts`).

## Topology

One Railway project **PharmaPong**, environment `production`:

| Resource           | Type                                       | Notes                                                |
| ------------------ | ------------------------------------------ | ---------------------------------------------------- |
| `web`              | Service from this directory (`railway up`) | Next.js, built by Railpack, config in `railway.json` |
| `Postgres`         | Railway Postgres template                  | enable backups                                       |
| `pharmapong-logos` | Railway Bucket (S3-compatible, private)    | team logos                                           |

`railway.json` (config as code):

- **build:** Railpack, `pnpm build`. That runs `prisma generate && next build`; `postinstall` also generates the client.
- **pre-deploy:** `pnpm prisma migrate deploy && pnpm seed:admin`. Migrations are non-destructive, and `seed:admin` is idempotent (it creates the tournament and the initial admin only if they are missing). A failed migration stops the release, so the old version keeps serving.
- **start:** `pnpm start` (`next start`, honours `$PORT`).
- **healthcheck:** `/api/health`. It runs `SELECT 1` and returns 503 when the database is unreachable.
- **replicas:** 1. Correctness does not depend on this, but it keeps the per-process snapshot memo simple.

## Step by step

```bash
# 0. CLI login (the MCP is OAuth-authenticated separately)
railway login

# 1. Project + database + bucket
railway init --name PharmaPong
railway add --database postgres --json
railway bucket create pharmapong-logos --region ams --json    # Europe, close to Basel

# 2. App service from this directory
railway add --service web --json

# 3. Variables on "web" (reference variables; no secrets are copied by hand)
railway variable set --service web \
  'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  'RAILPACK_NODE_VERSION=24' \
  'NODE_ENV=production' \
  'STORAGE_DRIVER=s3' \
  'S3_ENDPOINT=${{pharmapong-logos.ENDPOINT}}' \
  'S3_BUCKET=${{pharmapong-logos.BUCKET}}' \
  'S3_REGION=${{pharmapong-logos.REGION}}' \
  'S3_ACCESS_KEY_ID=${{pharmapong-logos.ACCESS_KEY_ID}}' \
  'S3_SECRET_ACCESS_KEY=${{pharmapong-logos.SECRET_ACCESS_KEY}}' \
  'S3_FORCE_PATH_STYLE=false' \
  'ADMIN_EMAIL=<organizer e-mail>' \
  'EVENT_CODE='                       # optional registration gate
# The initial admin password: set it yourself in the dashboard (Variables → New → ADMIN_INITIAL_PASSWORD,
# at least 10 characters). It is only used once; the admin must change it at first login.

# 4. Public domain, then APP_URL (used for invite links, reset links, secure cookies, Origin checks)
railway domain --service web --json
railway variable set --service web 'APP_URL=https://<generated-domain>'

# 5. Deploy
railway up --service web --detach -m "PharmaPong initial deploy"
railway deployment list --service web --json   # wait for SUCCESS
```

`S3_FORCE_PATH_STYLE`: `railway bucket credentials --bucket pharmapong-logos --json` reports `urlStyle`.
Use `true` if it says `path`.

### Service settings applied via API

```bash
railway api 'mutation u($s: String!, $e: String!, $i: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $i) }' \
  --variables '{"s":"<web service id>","e":"<production env id>","i":{"buildCommand":"pnpm build","startCommand":"pnpm start",
  "preDeployCommand":["pnpm prisma migrate deploy && pnpm seed:admin"],"healthcheckPath":"/api/health","healthcheckTimeout":120,
  "restartPolicyType":"ON_FAILURE","restartPolicyMaxRetries":5}}'
```

Verify with `railway environment config --json` (look at `services.<id>.deploy`).

## Smoke test after deploy

1. `curl https://<domain>/api/health` returns `{"ok":true,"db":"ok",…}`.
2. Log in as `ADMIN_EMAIL` and set a new password (forced).
3. `/admin/tournament`: open registration, enable the public display, upload a team logo on `/team` (checks the bucket).
4. Redeploy (`railway redeploy --service web`), then check that the logo and data persist.
5. Optional rehearsal on a separate environment: `railway run --service web pnpm simulate --fresh` with `ALLOW_DEMO_SEED=true` **on a staging environment only**. It plays a full 19-match tournament.
6. Do **not** point the Playwright suite at production: it resets its database through `pnpm scenario`. Run it locally against the `pharmapong_e2e` DB (see `tests/e2e/README.md`). In production, check `/display` and `/tournament` manually on a phone and on the projector.

## Environment variables

| Variable                                | Required      | Purpose                                                |
| --------------------------------------- | ------------- | ------------------------------------------------------ |
| `DATABASE_URL`                          | yes           | `${{Postgres.DATABASE_URL}}` (private network)         |
| `APP_URL`                               | yes           | public https URL                                       |
| `ADMIN_EMAIL`, `ADMIN_INITIAL_PASSWORD` | first deploy  | initial admin (idempotent)                             |
| `STORAGE_DRIVER`                        | yes           | must be `s3` in production (memory storage is refused) |
| `S3_*`                                  | yes           | bucket reference variables                             |
| `RAILPACK_NODE_VERSION`                 | yes           | `24` (Prisma 7 supports Node 20/22/24)                 |
| `EVENT_CODE`                            | no            | registration gate shared at the event                  |
| `ALLOW_DEMO_SEED`                       | never in prod | enables demo/simulation scripts                        |

Secrets are never committed (`.env*` is git-ignored except `.env.example`) and never printed by scripts.

## Backups and recovery

- **Postgres backups:** enable them in the Postgres service ("Backups" tab: daily schedule, plus a manual backup right before the event and before the knockout stage). Point-in-time restore is available on paid plans.
- **Application-level export:** admins download JSON/CSV at `/admin` (export links), or run `railway run --service web pnpm export` to write `data/pharmapong-export-*.{json,csv}` locally. Do this between stages.
- **Restore:** restore the Postgres backup in the dashboard (creates a new volume or service), point `DATABASE_URL` at it if needed, and redeploy `web`. The app is stateless apart from Postgres and the bucket.
- **Draw reset / result recovery** happen inside the app (audited, see `docs/tournament-rules.md` §7). No database surgery is needed.

## Operations runbook

| Situation                           | Action                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App unhealthy                       | `railway logs --service web --lines 200`; `railway redeploy --service web` (or `railway restart`)                                                              |
| Bad release                         | roll back in the dashboard (Deployments → previous → Redeploy)                                                                                                 |
| Admin locked out / forgot password  | another admin creates a reset link at `/admin/users`; break glass: `NEW_PASSWORD=… railway run --service web pnpm tsx scripts/reset-admin-password.ts <email>` |
| Login throttled for the whole venue | `/admin/users` → "Login-Sperre aufheben"                                                                                                                       |
| Table broken                        | `/admin/tournament` → disable the table (the scheduler skips it)                                                                                               |
| Wrong result confirmed              | `/admin/matches` → correct, or use the recovery wizard if downstream matches started                                                                           |
| Database slow                       | `railway metrics --service Postgres --since 1h`                                                                                                                |

## Local production check

```bash
pnpm build && NEXT_DIST_DIR=.next STORAGE_DRIVER=memory ALLOW_MEMORY_STORAGE=true pnpm start
```
