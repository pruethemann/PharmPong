# PharmaPong: Tournament Rules

This document separates **reference rules** (inspired by the RedCupShop beer pong rules) from
**PharmaPong house rules** (event-specific decisions, marked 🏠). The software implements the
house rules exactly; the in-app `/rules` page shows the same content in German.

> PharmaPong welcomes every drink: water, soft drinks, alcohol-free beer. The software never records,
> rewards or ranks drinking. Scoring is based on cups hit, nothing else.

## 1. Format

|                |                                                                |
| -------------- | -------------------------------------------------------------- |
| Players        | 24, in teams of exactly 2                                      |
| Teams          | 12                                                             |
| Group stage 🏠 | 4 groups (A–D) of 3 teams, single round robin → 12 matches     |
| Knockout 🏠    | Top 2 per group → quarterfinals, semifinals, final → 7 matches |
| Total          | **19 matches** on **2 tables**                                 |
| Match time 🏠  | 15 minutes regulation                                          |

### Knockout bracket 🏠

| Match | Pairing                  |
| ----- | ------------------------ |
| QF1   | A1 vs B2                 |
| QF2   | B1 vs A2                 |
| QF3   | C1 vs D2                 |
| QF4   | D1 vs C2                 |
| SF1   | Winner QF1 vs Winner QF3 |
| SF2   | Winner QF2 vs Winner QF4 |
| Final | Winner SF1 vs Winner SF2 |

Teams advance only after the referee has **confirmed** the result.

## 2. Game play (reference rules)

- Ten cups per side in a triangle (4-3-2-1), filled with a drink of the player's choice.
- Teams alternate turns. In a standard turn **each player throws one ball**.
- A ball landing in a cup removes that cup.
- **Balls Back**: if both players of a team hit in the same turn, they get both balls back for another turn.
- **Bounce shots** are allowed. A bounced ball that lands in a cup removes that cup plus one cup of the defending team's choice. The defending team may swat a bounced ball away.
- **Re-racks**: each team may request one re-rack per game (🏠 at 6, 4 or 3 remaining cups).
- **Island rule: off** 🏠 (default).
- **Bomb rule: optional** 🏠. Off by default; the admin can switch it on in the tournament settings, and the rules page then shows it. When on, two balls in the same cup remove that cup and one extra cup.
- **Final-cup redemption**: when a team's last cup is hit, the defending team gets a redemption turn and throws until they miss. If they clear all opponent cups, the game continues (🏠 in the timed format the clock decides; see §3).
- Elbows behind the table edge when throwing.

## 3. Timing 🏠

- The **match clock starts when the referee presses "Spiel starten"**. The server clock is authoritative, so every phone and the projector show the same time.
- The referee may pause the clock (for example a spilled cup or a re-rack dispute). Paused time does not count.
- At **15:00** every screen shows **"Zeit abgelaufen"**. The current pair of turns is completed, so both teams have had the same number of turns.
- The referee then decides the winner on **remaining cups**: the team that has hit **more** opponent cups, i.e. has **more of its own cups still standing**, wins (`TIME_LIMIT`).
- **Tie on remaining cups → shootout** (`SHOOTOUT`):
  - Teams alternate equal numbers of attempts (one ball each, same distance).
  - After both teams have taken the same number of attempts, a team that has hit while the other missed wins.
  - Continue until there is a winner.
  - The shootout winner is recorded separately. **Shootout hits do not count** in cup statistics. The regulation remaining cups (equal on both sides) are stored.
- The clock **never confirms a result by itself**. Only the referee does.

## 4. Recording results

The software does not track individual throws. The referee records:

| Field                       | Meaning                                                                    |
| --------------------------- | -------------------------------------------------------------------------- |
| Winner                      | one of the two teams                                                       |
| Remaining cups (both teams) | 0–10 per team                                                              |
| End type                    | `REGULAR` (all cups hit), `TIME_LIMIT`, `SHOOTOUT`, `FORFEIT` (admin only) |

Validation:

| End type   | Constraint                                                     |
| ---------- | -------------------------------------------------------------- |
| REGULAR    | the loser has **0** cups left and the winner ≥ 1               |
| TIME_LIMIT | both ≥ 1, and the winner has **more** cups left than the loser |
| SHOOTOUT   | both teams have the **same** number (≥ 1) of cups left         |
| FORFEIT 🏠 | admin only; stored as winner 10 / loser 0 remaining cups       |

Submission is two steps (enter → review → confirm). Every edit is audited.

## 5. Group standings 🏠

- **Win = 3 points**, loss = 0, no draws.
- **Cups scored** = 10 − opponent's remaining cups.
- **Cups conceded** = 10 − own remaining cups.
- **Cup difference** = scored − conceded.

Ranking order:

1. Points
2. Cup difference
3. Cups scored
4. Head-to-head result, only if **exactly two** teams are still tied
5. **Ranking shootout** recorded by the administrator if still unresolved (e.g. all three teams equal on every criterion)

The software never picks a winner of a persistent tie by itself. The knockout stage can only start after all group matches **and** all required ranking shootouts are confirmed. If a correction later changes the tied teams' statistics, the recorded shootout becomes invalid and must be redone.

## 6. Scheduling 🏠

- Two tables. A table is _Frei_, _Reserviert_ (match assigned), _Spiel läuft_, or _Gesperrt_.
- When a table is free, the system suggests the earliest eligible match: both teams known, neither team currently playing, earliest round first, then the team that has rested longest.
- Group matches are interleaved across groups so both tables can always play at the same time.
- Referees may put the **suggested** match on their table; the admin may assign any eligible match (override). Referees cannot undo an admin override. The referee must start each match explicitly. Nothing starts automatically.
- Rest criterion as implemented: among equally eligible matches of the same round, the match whose more recently active team has rested longest is preferred.

## 7. Corrections & recovery 🏠

- Admins can correct confirmed results. Every correction requires a reason and is audited.
- If the correction changes who advances and the affected next match has **not started**, the bracket updates automatically.
- If an affected downstream match **has started or finished**, the correction is blocked.
- Recovery voids only the matches that are actually affected (the corrected match's downstream chain). A group correction during the knockout stage voids only the quarterfinals whose qualifiers changed, plus their downstream matches. Only if the correction creates an unresolved group tie is the whole knockout stage voided and the tournament returned to the group stage.
- A full **draw reset** (typed confirmation `AUSLOSUNG ZURÜCKSETZEN`) snapshots all groups, matches and match events into the audit log before deleting the fixtures. The admin must use the **recovery wizard**, which voids the affected downstream matches (with typed confirmation), applies the correction, and re-seeds the bracket. History is never deleted; all voided results remain in the audit log.

## 8. Forfeits 🏠

An admin can record a forfeit (e.g. a team is absent) for a match that is not yet completed. The present team wins 10:0 in cup statistics. Absent players can also be replaced by the admin at any time without affecting fixtures.

## 9. Referee conflicts of interest

A referee who is an active member of one of the two teams cannot start, enter or confirm that match. Admins can.

## 10. Fair play & safety

- Referees' decisions are final at the table. Disputes go to the tournament admin.
- Drink responsibly, or don't drink at all. Non-alcoholic options are explicitly welcome, and a cup of water counts exactly like any other cup.
