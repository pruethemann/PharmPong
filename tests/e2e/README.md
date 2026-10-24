# End-to-end tests (Playwright)

Browser tests against a **production build** of the app with its own database.

## Prerequisites

- Postgres from `docker compose up -d postgres` (port 54329). The `pharmapong_e2e` database is
  created by `docker/postgres-init.sql`. Override it with `DATABASE_URL_E2E` if needed.
- Chromium for Playwright: `pnpm exec playwright install chromium`. WebKit/Firefox are not needed:
  the iPhone project runs Chromium with the iPhone 14 viewport and user agent.

## Run

```bash
pnpm test:e2e                                  # all projects (desktop, mobile, iphone)
pnpm test:e2e --project=desktop                # one project
pnpm test:e2e tests/e2e/referee-flow.spec.ts   # one spec
pnpm test:e2e --headed --project=desktop -g "recovery"
pnpm exec playwright show-trace test-results/<test>/trace.zip   # after a failure
```

What happens:

1. `webServer` runs `pnpm build && pnpm start -p 3100` with `NEXT_DIST_DIR=.next-e2e`,
   `DATABASE_URL=…/pharmapong_e2e`, `APP_URL=http://localhost:3100`, `STORAGE_DRIVER=memory`,
   `ALLOW_MEMORY_STORAGE=true`, `ALLOW_DEMO_SEED=true`. The build takes a few minutes.
   Locally (no `CI`), a server already listening on 3100 is reused, which makes reruns fast:

   ```bash
   NEXT_DIST_DIR=.next-e2e DATABASE_URL=postgresql://pharmapong:pharmapong@localhost:54329/pharmapong_e2e \
   APP_URL=http://localhost:3100 STORAGE_DRIVER=memory ALLOW_MEMORY_STORAGE=true ALLOW_DEMO_SEED=true \
   sh -c 'pnpm build && pnpm start -p 3100'
   ```

   Rebuild after changing app code; a reused server serves the old build.

2. `global-setup.ts` runs `prisma migrate deploy` on the e2e database, clears the login/registration
   throttles, runs `pnpm scenario registration` and logs in admin, referee and player through the
   real `/login` form. Sessions are stored in `tests/e2e/.auth/*.json` (git-ignored).
3. Specs that need a particular tournament state call `scenario("groups" | "knockout" | "completed")`
   from `support/db.ts` in `beforeAll` (it runs `pnpm scenario <mode>` against the e2e database).
   All tests share one database, so the suite runs with `workers: 1`.

Demo logins (password `pharmapong-demo`): `dev-admin@pharmapong.test`, `schiri@pharmapong.test`,
`demo01..24@pharmapong.test`.

## Projects and tags

| Project   | Device                                           | Skips           |
| --------- | ------------------------------------------------ | --------------- |
| `desktop` | Desktop Chrome, 1280×800                         | `@mobile-only`  |
| `mobile`  | Pixel 7                                          | `@desktop-only` |
| `iphone`  | iPhone 14 viewport + UA, `browserName: chromium` | `@desktop-only` |

## Specs

| Spec                   | Covers                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-team.spec.ts`    | Register, found a team, copy the invite link, second context registers and joins via `/join/<code>`; German login error; guest redirects to `/login`; player turned away from `/admin` and `/referee`.                                       |
| `referee-flow.spec.ts` | Scenario `groups`: confirm the pending result, assign the suggested match, start, timer ticks, enter result, review shows the stored proposal, hold-to-confirm, success. A player on `/tournament` sees each step within 6 s without reload. |
| `display.spec.ts`      | `@desktop-only`. `/display` logged out: both tables, no e-mail data; admin switches the public display off → disabled screen and `/api/live/public` 404; champion takeover (also with reduced motion).                                       |
| `reconnect.spec.ts`    | `/api/live*` aborted with `page.route` → "Verbinde neu …" / "Offline", referee buttons disabled; unrouted → "Live" and enabled again.                                                                                                        |
| `admin.spec.ts`        | `@desktop-only`. Scenario `knockout` + `support/start-semifinal.ts` (SF1 running): correct the QF feeding SF1 → recovery wizard → typed confirmation → done; API and bracket show the new winner.                                            |
| `mobile.spec.ts`       | `@mobile-only`. Key pages: no horizontal overflow, every visible button/tab ≥ 44 px tall.                                                                                                                                                    |
| `a11y.spec.ts`         | axe-core (WCAG 2.x A/AA) on public, player, referee and admin pages in the `groups` and `completed` states: no critical/serious violations. Only Sonner's toast container is excluded (third party, empty without a toast).                  |

Notes:

- The "no `@`" check on `/display` is strict for the visible text and the live API JSON. The raw HTML
  is checked for e-mail addresses instead, because React's flight payload (`"$@…"`) and an inline
  `@media` rule contain a bare `@`.
- Hold-to-confirm is pressed with `mouse.down()`, 1.6 s wait, `mouse.up()` (`support/ui.ts`).
- Live updates poll every 2.5 s; after a failure the client backs off up to 15 s, so the reconnect
  test waits up to 25 s for "Live".
