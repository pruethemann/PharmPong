# Elo Mode: guide for organizers and referees

Everything an admin or referee needs during the apéro. Labels are quoted exactly as they appear in the
German UI. Technical background: [implementation plan](implementation-plan.md),
[rating system](rating-system.md), [deployment runbook](../deployment.md#releasing-elo-mode-v020).

## Before the event

- Print the table QR codes: `/admin/elo` → **"QR-Codes drucken"** (opens `/print/elo-qr`, one A4 page per
  table). The codes point to `APP_URL/elo/table/N`; they open a public page and grant nothing.
- Optional rehearsal on staging: `pnpm scenario elo` gives a realistic evening (24 matches, a running match,
  a draft, a pending result and a dispute; logins in the README).

## Switching to Elo Mode

1. After the final, open `/admin`. The **"Spielmodus"** card shows the current mode.
2. **"Zum Elo-Modus wechseln"** → **"Jetzt wechseln"**. The first switch opens an Elo round ("Social Elo",
   everybody at 100). All phones and the projector follow within about 10 seconds.
3. The switch is refused while the current mode still has open matches: the card lists them with links.
   Finish, confirm or cancel them; open Elo drafts can be cancelled with **"Offene Aufstellung abbrechen"**
   (or "N offene Aufstellungen abbrechen", reason required).
4. Turn on the public display (card on `/admin/elo` or `/admin`) and open `/display` on the projector.

Switching back to the tournament keeps the Elo round; the next switch to Elo continues it. Tournament data
is never touched by Elo Mode and vice versa.

## During the evening

**Referees** work from `/elo/referee` (the referee menu item; `/referee` redirects there). It lists disputes,
pending results and the two tables. All decisions happen on the match page, in the **"Schiri"** panel.
Nobody can decide a match they play in, admins included.

| Situation                           | Who                | Where / action                                                                           |
| ----------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| A team has no phone                 | referee            | match → **"Zustimmung vor Ort erfassen"**                                                |
| Dispute ("Einspruch")               | referee            | match → **"Einspruch entscheiden"**: pick the real winner, reason required               |
| Result reported, other team gone    | referee            | match → **"Gemeldetes Resultat bestätigen"** or **"Anderes Resultat festlegen"**         |
| Result reported by mistake          | referee            | match → **"Annullieren"** (reason; never rated)                                          |
| Running match must stop             | referee            | match → **"Match abbrechen"** (reason; never rated)                                      |
| Draft blocks a table                | creator or referee | match → **"Match abbrechen"**; unused drafts also expire after 10 minutes                |
| Wrong confirmed result              | admin              | `/admin/elo` → Matches → **"Korrigieren"** (winner, end type, rated, roster; reason ≥ 5) |
| Confirmed match must not count      | admin              | `/admin/elo` → Matches → **"Annullieren"** (reason ≥ 5)                                  |
| Pause new matches (speeches, pizza) | admin              | `/admin/elo` → **"Runde pausieren"** (running matches finish normally)                   |

A correction or annulment recalculates every rating after the match in confirmation order. The previous
calculation stays in **"Verlauf der Berechnungen"**, and every admin and referee action is in the audit log
(filter "Elo-Modus").

## Settings and parameters

- **"Einstellungen"** (never change existing ratings): team size limits, rated games needed for the title
  (default 3), stopwatch reminder (default 20 minutes, empty = off) and who confirms results ("Beide Teams
  bestätigen" or "Nur die Schiri bestätigt").
- **"Wertungsparameter ändern"**: K-factor (24), scale D (100), start value (100) and the repeat multipliers
  (`1, 1, 0.5, 0`; `1` switches the rule off). Once rated matches exist, a change needs a reason and the typed
  confirmation `ELO NEU BERECHNEN`, and the whole round is recalculated into a new calculation.
- **"Prüfen (ohne Änderung)"** replays the round and compares it with the stored ratings. "Alles stimmt" is the
  normal answer; on a deviation, **"Neu berechnen"** (reason + `ELO NEU BERECHNEN`) restores the correct state.

## Closing the round

1. All matches must be finished (the dialog says how many are still open).
2. `/admin/elo` → **"Runde beenden"**: the dialog shows how many players are eligible and who would be champion.
   Type `ELO-RUNDE BEENDEN` to confirm.
3. The projector shows the champion finale; the home page and the ranking show the champion banner.
4. **"Wieder öffnen"** (reason required) withdraws the title until the next close, for example to add a
   forgotten match. **"Neue Runde eröffnen"** starts an independent round with everybody at 100.

## Export

`/admin/elo` → Export: **"Komplett-Export (JSON)"** (round, parameters, rankings, matches, rating changes,
calculations), **"Rangliste (CSV)"** and **"Matches (CSV)"**. Take one at the end of the evening.

## If something goes wrong

- **Phones show "Offline" / "Verbinde neu …":** network trouble; nothing is lost. Result steps are idempotent:
  a repeated tap after a network loss is replayed, never counted twice.
- **"Jemand anderes hat das gerade geändert":** someone else changed the match a moment earlier. The view
  reloads; check it and repeat the step if it is still needed.
- **Projector shows "Anzeige ist deaktiviert":** turn the public display on again; the projector picks it up
  within 30 seconds.
