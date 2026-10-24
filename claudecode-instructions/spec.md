# PharmaPong: Master Implementation Specification (verbatim from the product owner)

Build **PharmaPong**, a production-ready, mobile-first Beer Pong tournament platform for a private event at the Pharmaceutical Center, University of Basel, Switzerland. This is a real event-management application, not a static mockup. The platform must be intuitive, entertaining, highly reliable, and easy to operate in a noisy party environment where users may be distracted or intoxicated.

## 1. Event specifications

- Event name: PharmaPong · 24 participants · teams of exactly 2 · 12 teams
- 4 groups of 3 teams, round robin within each group, top 2 per group qualify
- Knockout: quarterfinals, semifinals, final · Total matches: 19 · Tables: 2 · Match duration: 15 minutes
- Participants create their own teams · Referees enter and confirm results · Hosting: Railway
- Primary UI language: German · Branding: pharmaceutical sciences, lab equipment, molecules, chemistry, scientific humour

## 4. Routes

`/` dashboard · `/register` · `/login` · `/team` · `/tournament` (overview, groups, bracket) · `/matches/[id]` · `/rules` · `/referee` · `/admin` · `/display` (public projector/TV). Spectator info separate from admin functionality. Public display never exposes emails, credentials, admin controls or private data.

## 5. Authentication and authorization

PLAYER: create account, login/logout, edit own profile, create or join a team, edit team metadata according to membership permissions, view matches/groups/results/bracket.
REFEREE: all player viewing permissions; start and finish assigned matches; manage the match timer; record results; confirm outcomes; record a shootout winner; report an issue requiring admin intervention.
ADMIN: manage users and team assignments; manage referee permissions; configure tournament settings; generate groups; start and pause tournament progression; assign matches to tables; correct results using audited workflows; cancel or forfeit matches; operate recovery tools; control the public display state.
Registration with email + password, no mandatory email verification. Argon2id. Reasonable password length. Brute-force protection on all credential endpoints. Secure HTTP-only session cookies. Prevent privilege escalation; never trust client-supplied roles; no self-registration as referee/admin. Admin-controlled account recovery. Initial admin via secure env config. Never commit secrets.

## 6. Team formation

Fields: name, motto, optional logo/image, invitation code, creation timestamp, membership and readiness status.
Workflow: player creates team → system generates secure invitation code → share link/code → second player joins → both see complete team profile → team becomes eligible → admin locks team composition before group allocation.
Prevent: >2 active members; a player in multiple active teams; duplicate invitation redemption; modifying locked membership without admin authorization. Allow leaving before roster lock. Admins can repair incomplete or incorrect teams. Validate image types, sizes and uploads; store images in durable object storage, not the container filesystem. Avatar initials and default team imagery when no image.

## 7. Tournament lifecycle

`DRAFT → REGISTRATION_OPEN → REGISTRATION_LOCKED → GROUP_STAGE → KNOCKOUT_STAGE → COMPLETED`, plus a PAUSED operational condition and administrative cancellation. Transitions validated server-side.
Generation: require exactly 12 eligible teams; shuffle with a secure randomized process; allocate 3 teams to each of groups A–D; generate all round-robin matches; persist groups and fixtures; prevent regeneration after play starts except via explicit audited reset. Demo seeding tool: 24 fake users, 12 fake teams.

## 8. Group stage and standings

Each pair plays once. Win 3 points, loss 0, no draws. Result includes winner, Team A remaining cups, Team B remaining cups, whether it ended by regular elimination / time limit / shootout / forfeit, start and finish timestamps, referee confirmation.
Cups scored = 10 − opponent's remaining cups. Cups conceded = 10 − own remaining cups. Cup differential = scored − conceded. Shootout does not add to regulation cup statistics.
Ranking: 1) points 2) cup differential 3) cups scored 4) head-to-head if exactly two teams remain tied 5) administrator-recorded ranking shootout if unresolved. Never pick a winner arbitrarily for a persistent tie. Admin can open and resolve ranking tiebreakers. Knockout qualification starts only after all group matches and necessary ranking tiebreakers are confirmed.

## 9. Knockout bracket

QF1: A1–B2 · QF2: B1–A2 · QF3: C1–D2 · QF4: D1–C2 · SF1: W QF1 – W QF3 · SF2: W QF2 – W QF4 · Final: W SF1 – W SF2.
Persist explicit advancement relationships. Future matches as placeholders; distinguish pending/active/completed; show winner progression; horizontal scrolling on mobile; select matches for details; works on desktop and large displays. Do not auto-advance until the result is formally confirmed. Keep consistency if an upstream result is corrected. If downstream matches already started, prevent silent corrections and require an explicit admin recovery workflow.

## 10. Rules (RedCupShop-inspired, simplified)

Two players per team; ten cups per side; one ball per player per standard turn; alternating team turns; Balls Back; bounce shots; final-cup redemption; optional Bomb rule; no Island rule by default. Software doesn't track throws; referees record final remaining cups.
Timing: clock starts when referee starts the game; server timestamps authoritative; at 15 minutes show clear timeout indication; allow the current pair of turns to finish (equal opportunities); referee then determines winner by remaining cups; if tied → shootout (teams alternate equal numbers of attempts until a winner emerges after equal attempts; record shootout winner separately from cup stats). The clock must not auto-confirm results. Handle refresh, network disruption and multiple referee devices safely. Document official reference rules vs PharmaPong house rules. Support non-alcoholic beverages; do not reward alcohol consumption or measure drinking.

## 11. Scheduling and tables

Two tables. Table states: Available, Reserved, In progress, Disabled. Match states: Pending, Ready, Assigned, In progress, Awaiting confirmation, Completed, Cancelled, Forfeited.
When a table becomes free: identify eligible matches; exclude matches whose teams are already playing; exclude unresolved dependencies; prioritize earliest eligible round; offer next match for assignment; allow admin override when valid. No team at two tables simultaneously; no table hosts two active matches. Postgres transactions + locking/constraints against races. Admin manual assignment UI. Referee must explicitly start a match. Do not auto-start subsequent matches after confirmation. Show upcoming and current table assignments on relevant dashboards.

## 12. Referee interface

Mobile-optimized. Select/view assigned table; view current match; start match; large countdown; pause/resume if authorized; choose winning team; enter remaining cups; mark shootout or special ending; confirm with a review step; see server confirmation; return to next match. Winner selection visually unmistakable. Two steps: enter result → review and confirm. Prevent duplicate submissions. Optimistic concurrency versioning on match records. Audit every result edit. Never report success before the server persisted the transaction.

## 13. Live sync

Polling every 2–3 s for active views, with a tournament revision to avoid full transfers. Live match states, groups/rankings, bracket, table states, timer sync, next match info. Handle stale clients and reconnection; visible offline/reconnecting indicator; never accept critical writes as successful while offline. No Redis.

## 14. Public display

`/display` for 16:9: branding; both current table matches; remaining times; upcoming matches; standings or bracket; phase; champion when finished. Automatic view rotation only if it doesn't hide urgent match info. Readable from several metres. Read-only, no auth if public sharing enabled by admins. Team names, logos and mottos prominent. Modest animations for new match announcement, semifinal advancement, final advancement, champion. Reduced motion support.

## 15. Data

Confirmed results are authoritative; standings derived deterministically. Transactions for confirming, advancing, assigning, correcting, phase transitions. UTC storage, Europe/Zurich display.

## 16. Admin

Dashboard: player count, team count, incomplete registrations, current phase, teams and groups, current matches, table allocation, match history, audit history, outstanding referee confirmations, pause/resume, backup/export. Actions: replace absent players, rename teams, resolve registration problems, record forfeits, correct results, resolve group-ranking shootouts, disable a broken table, export final standings and results. Dangerous actions need confirmation. Avoid irreversible modifications of history.

## 18. Tests

Tournament logic: 12 group matches; 7 KO matches; group assignments; winner advancement; bracket pairings; cup difference; all ranking tiebreaker scenarios; shootout; forfeit; no premature qualification.
Authorization: player cannot submit results; referee cannot modify admin settings; admin can correct results; unauthorized users cannot access protected data; no privilege escalation.
Concurrency: two referees submit simultaneously; duplicate submissions; two matches assigned to one table; same team assigned twice; rollback on failure.
UI: mobile usability; registration and invitation; tournament display; referee confirmation; public display; network reconnection.
Full simulation: 24 participants, 12 teams, full 19-match tournament with a tied group, a shootout, a corrected result before downstream play, concurrent matches on both tables, final champion. Verify DB, standings, statuses, bracket consistency.
