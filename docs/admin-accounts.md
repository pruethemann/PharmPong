# Admin accounts

How to create an admin account, locally and on Railway, and how to give an existing account admin rights.
Admins run the event: tournament, results, Elo Mode, users and the game mode. Labels are quoted exactly as
they appear in the German UI.

## Which way?

| Situation                                                   | Way                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| No admin exists yet, or no admin can log in                 | `pnpm admin:create`: [locally](#1-create-an-admin-locally) or [on Railway](#2-create-an-admin-on-railway) |
| A co-organizer needs admin rights and an admin is available | [promote the account in the app](#3-make-an-existing-account-an-admin)                                    |
| The admin should exist right after the first deploy         | [`ADMIN_INITIAL_PASSWORD`](#4-alternative-initial-admin-from-environment-variables)                       |

## The command

```bash
pnpm admin:create --email <e-mail> [--name "<display name>"] [--promote]
```

| Option      | Meaning                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| `--email`   | login e-mail (required, stored in lower case)                                                               |
| `--name`    | display name of a new account; default "Turnierleitung", changeable later in the profile ("Anzeigename")    |
| `--promote` | the e-mail already has an account: make it an admin (see [section 3](#3-make-an-existing-account-an-admin)) |
| `--help`    | usage                                                                                                       |

What it does:

- **New e-mail:** creates an admin account with a generated **one-time password** (four groups of five
  characters, for example `k7m2q-xp4rt-9wbzc-h3fna`). The password is printed once and stored only as an
  Argon2id hash. At the first login the app asks for a new password.
- **Existing e-mail:** changes nothing unless you add `--promote`, so a typo cannot silently turn someone
  else's account into an admin. With `--promote` the account becomes an admin and keeps its password.
- It never changes a password and never touches tournaments, matches or ratings.
- Every change is in the audit log: **"Admin per Kommandozeile angelegt"** or **"Rolle geändert"**, actor
  "System", reason "CLI".

## 1. Create an admin locally

Prerequisite: the [local setup](../README.md#local-development) up to `pnpm seed:admin` (Postgres running,
`.env` with `DATABASE_URL`, migrations applied, an open tournament).

```bash
pnpm admin:create --email you@example.com --name "Your Name"
```

```text
[admin:create] Created the admin account "Your Name" <you@example.com>.

  One-time password: k7m2q-xp4rt-9wbzc-h3fna

Log in at http://localhost:3000/login with this e-mail and password; the app then asks for a new password.
The one-time password is shown only now and is not stored in plain text.
```

Then log in:

1. `pnpm dev`, open http://localhost:3000/login, enter the e-mail and the one-time password, **"Anmelden"**.
2. The app opens your profile with **"Neues Passwort erforderlich"**. Under **"Passwort festlegen"**, enter the
   one-time password as **"Aktuelles Passwort"**, choose a **"Neues Passwort"** (10 to 128 characters) and
   press **"Passwort ändern"**.
3. The navigation now shows **"Admin"** (`/admin`).

For quick local testing, `pnpm scenario <mode>` already creates `dev-admin@pharmapong.test` with the
password `pharmapong-demo` (see the [README](../README.md#local-development); never in production).

## 2. Create an admin on Railway

The command has to run **inside** the `web` service: the database is only reachable on Railway's private
network (`postgres.railway.internal`). `railway ssh` runs a command in the running container.
`railway run` does not work here: it runs the command on your computer, which cannot reach that database.

Prerequisites:

- Railway CLI logged in with the account that owns the project (`railway whoami`), run from this repository
  (linked to the project, check with `railway status`).
- The deployed version contains the command. Check:
  `railway ssh --service web --environment production -- ls scripts/create-admin.ts`. If the file is missing,
  deploy first ([deployment](deployment.md)) or use [section 4](#4-alternative-initial-admin-from-environment-variables).

Create the admin:

```bash
railway ssh --service web --environment production -- pnpm admin:create --email you@example.com
```

`--` separates Railway's options from the command that runs in the container. The output shows the login
URL (from `APP_URL`) and the one-time password. Log in right away, as in [section 1](#1-create-an-admin-locally):
https://web-production-13b1f.up.railway.app/login.

For a display name with spaces, open a shell in the container instead (quoting through `railway ssh` is
easy to get wrong), or leave out `--name` and change the name in the profile later:

```bash
railway ssh --service web --environment production
# inside the container:
pnpm admin:create --email you@example.com --name "Your Name"
exit
```

Never add `pnpm admin:create` to the pre-deploy command or to CI: their output, including the password,
ends up in the deploy logs.

## 3. Make an existing account an admin

Typical case: a co-organizer registers like a player and gets admin rights afterwards.

**In the app** (an admin is available):

1. The person registers at `/register` (**"Konto erstellen"**, with the **"Event-Code"** if one is set).
2. An admin opens **Admin → "Benutzer"** (`/admin/users`), finds the person ("Name oder E-Mail suchen"), sets
   **"Rolle"** to **"Admin"** and confirms with **"Rolle ändern"**.
3. The person is signed out, logs in again with their own password and sees **"Admin"** in the navigation.

**From the command line** (no admin can log in):

```bash
pnpm admin:create --email person@example.com --promote
# on Railway:
railway ssh --service web --environment production -- pnpm admin:create --email person@example.com --promote
```

The account keeps its password and name, a deactivated account is reactivated, and all its sessions are
signed out so that the next login has the admin role.

Admin rights are removed the same way: **"Benutzer" → "Rolle"**. The app never demotes or deactivates the
last active admin.

## 4. Alternative: initial admin from environment variables

`pnpm seed:admin`, which also runs in Railway's pre-deploy command, creates the admin `ADMIN_EMAIL` with the
password `ADMIN_INITIAL_PASSWORD` (at least 10 characters) if that account does not exist yet; the password
must be changed at the first login. If the address already belongs to an account, that account becomes an
admin and keeps its password.

- **Locally:** set both variables in `.env` and run `pnpm seed:admin`.
- **Railway:** `ADMIN_EMAIL` is set on the `web` service. Add `ADMIN_INITIAL_PASSWORD` under web →
  Variables and redeploy. After the first login, delete the variable again: it is no longer needed and
  stays readable for everyone with access to the project.

`pnpm admin:create` is usually simpler: no password in the project variables and no redeploy.

## 5. Check the result

- The navigation shows **"Admin"**, and `/admin` opens the overview.
- **Admin → "Benutzer"**: the account has the role **"Admin"**.
- **Admin → "Audit"**: the entry "Admin per Kommandozeile angelegt" or "Rolle geändert" by "System".

## 6. Troubleshooting

| Message or problem                                                          | What to do                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `An account with this e-mail already exists: …`                             | The address is registered. Run it again with `--promote` ([section 3](#3-make-an-existing-account-an-admin)); the password stays unchanged.                                   |
| `… is already an admin. Nothing changed.`                                   | Log in with the existing password. Forgotten: see the last row.                                                                                                               |
| `DATABASE_URL is not set`                                                   | Run it in the project folder (it reads `.env`), or on Railway through `railway ssh`.                                                                                          |
| `Can't reach database server at postgres.railway.internal (P1001)`          | You used `railway run`. Use `railway ssh` ([section 2](#2-create-an-admin-on-railway)).                                                                                       |
| `Can't reach the database server (ECONNREFUSED)` locally                    | Start Postgres: `pnpm db:up`.                                                                                                                                                 |
| `Command "admin:create" not found` on Railway                               | The deployed version is older than the command: deploy first, or use [section 4](#4-alternative-initial-admin-from-environment-variables).                                    |
| `Not a valid e-mail address` / `The display name needs 2 to 40 characters.` | Fix the option; nothing was written.                                                                                                                                          |
| Login says **"E-Mail oder Passwort ist falsch."**                           | Type the one-time password exactly (lower case, with dashes). Repeated failures lock the login for a while; another admin can lift it under **"Benutzer" → "Login-Sperren"**. |
| One-time password lost before the first login, or password forgotten        | Another admin: **"Benutzer" → "Reset-Link erstellen"** (single use, 30 minutes). No admin can log in: break-glass reset in the [runbook](deployment.md#operations-runbook).   |

## Security notes

- Admins can change results, ratings, users and the game mode. Give the role to as few people as needed and
  remove it after the event.
- The one-time password has about 99 bits of randomness and is shown only once. Do not paste it into chats
  or tickets; log in right away and choose your own password.
- Run `pnpm admin:create` interactively only, never in pre-deploy or CI, whose output is logged.
- `--promote` never changes a password, and every change is recorded in the audit log.
