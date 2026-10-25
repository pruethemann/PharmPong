<!-- Verbatim product-owner instruction for PharmaPong 2.0 Elo Mode (received 2026-10-25).
     Kept unformatted on purpose (listed in .prettierignore). Plan: docs/elo-mode/implementation-plan.md -->

# CODEX MASTER INSTRUCTION
# PharmaPong 2.0 — Social Elo Mode

## 0. Mission

Extend the existing PharmaPong application with a second, independent game mode called **Elo Mode**.

Repository:

`/Users/husedo15/code/PharmaPong`

PharmaPong currently implements a competitive Beer Pong tournament with fixed two-player teams, four groups, a knockout bracket, referees, timers, and administrative controls.

The application already works. **Preserving the existing functionality is a strict requirement.**

The new mode should support a social apéro environment where participants:

- Play spontaneously, whenever they want.
- Form temporary teams of 1–4 players.
- Choose different teammates for every match.
- Play without scheduling or tournament brackets.
- Have no hard match time limit.
- Earn or lose individual Elo points based on match outcomes.
- Compete on a live individual leaderboard.
- Continue socializing without being forced to participate.

All players begin with an individual rating of **100 Elo**.

The experience should be fun, intuitive, mobile-friendly, and reliable.

Do not rebuild PharmaPong from scratch. Extend the existing architecture and reuse existing UI components, authentication, user profiles, table management, and infrastructure wherever sensible.

---

# PHASE 0 — Repository inspection and implementation planning

Before modifying code:

1. Inspect the complete repository.
2. Read `README.md`, package manifests, Prisma schema, migrations, and existing documentation.
3. Identify the application framework, authentication implementation, UI components, API architecture, and deployment configuration.
4. Understand the existing competitive tournament engine.
5. Identify existing administrator, referee, and player permissions.
6. Identify how physical tables, timers, results, and tournaments are represented.
7. Check whether the project already uses tests, fixtures, and a demo-data generator.
8. Inspect Railway-related configuration without modifying production services.
9. Inspect Git status and preserve existing uncommitted changes.

Create:

`docs/elo-mode/implementation-plan.md`

Document:

- Existing architecture
- Components that can be reused
- Components that must be extended
- New database entities
- Required migrations
- Authorization changes
- Rating calculation design
- Potential regressions
- Testing strategy
- Implementation phases

Prefer the existing technology stack. Do not introduce new frameworks merely for Elo Mode.

If a repository-level `AGENTS.md` or other project instructions exist, follow them.

Do not proceed with destructive database changes.

---

# PHASE 1 — Game mode architecture

## 1.1 Introduce two independent modes

Define a game mode identifier:

```typescript
enum GameMode {
  COMPETITIVE = "COMPETITIVE",
  ELO = "ELO",
}
```

Adapt this to the project's existing naming conventions and persistence layer.

### Competitive Mode

Preserve all existing behavior:

- Fixed two-player teams
- Group stage
- Knockout bracket
- Scheduled matches
- Existing scoring
- Existing countdown
- Existing referee workflow
- Existing tournament history

### Elo Mode

Introduce:

- Individual ratings
- Temporary teams
- Unscheduled matches
- Variable team sizes
- Stopwatch without a time limit
- Live leaderboard
- Independent rating history

Do not reuse persistent competitive teams as temporary Elo teams.

## 1.2 Administrator mode selector

Implement a game mode selector in the administrator dashboard.

Requirements:

- Only administrators can change the active mode.
- The active mode must be persisted in the database.
- All clients must receive the updated mode.
- Navigation and dashboards adapt to the selected mode.
- Mode switching must not delete results, player data, or ratings.
- Switching back to Elo Mode restores its previous leaderboard.
- Existing competitive results remain accessible when switching back.

Use an existing event/tournament configuration model if suitable. Otherwise, introduce an explicit event settings model.

Do not implement mode selection as an unpersisted frontend variable.

### Safe transitions

Block switching while the current mode has active matches or results awaiting confirmation.

Show the administrator what must be resolved before switching.

Allow pending match drafts to be cancelled through an explicit administrative workflow.

Never silently abandon or modify active matches.

## 1.3 Session-scoped Elo

Ratings should belong to an Elo event/session, not be permanently attached as a global numerical field on the user.

Introduce an `EloSession` or equivalent model associated with the event.

This allows future PharmaPong events to have independent rankings.

Each Elo session should have:

- ID
- Event reference
- Status
- Initial rating
- Elo configuration
- Creation timestamp
- Optional closing timestamp
- Active rating calculation revision

Default initial rating: 100.

Do not reset ratings when switching between Competitive and Elo Mode.

---

# PHASE 2 — Data model

Design the schema to separate persistent player identity from temporary team composition.

Use the existing User model and extend it only where necessary.

Suggested entities follow. Adapt names and relationships to the current schema.

## 2.1 PlayerRating

```typescript
PlayerRating {
  id
  eloSessionId
  userId
  rating
  gamesPlayed
  wins
  losses
  createdAt
  updatedAt
}
```

Requirements:

- Unique constraint on `(eloSessionId, userId)`.
- Initial rating of 100.
- Numeric precision retained internally.
- Display rounded ratings in the UI.
- Match history determines rating calculations.
- Derived statistics must stay consistent with completed rated matches.

Avoid creating a second independent player identity system.

## 2.2 EloMatch

```typescript
EloMatch {
  id
  eloSessionId
  tableId
  status
  createdById
  startedAt
  finishedAt
  accumulatedPausedMs
  winnerSide
  resultType
  rated
  resultVersion
  confirmedSequence
  createdAt
  updatedAt
}
```

Suggested match statuses:

- DRAFT
- READY
- IN_PROGRESS
- PAUSED
- RESULT_PENDING
- COMPLETED
- DISPUTED
- CANCELLED

Distinguish physical match status from result-confirmation status if that better fits the existing architecture.

## 2.3 EloMatchParticipant

```typescript
EloMatchParticipant {
  id
  matchId
  userId
  teamSide
  rosterPosition
  ratingAtStart
  createdAt
}
```

`teamSide` is A or B.

Requirements:

- Each side contains 1–4 players.
- No duplicate players within one match.
- A player cannot belong to both sides.
- Each active user can participate in only one active match at a time.
- Match rosters become immutable after starting.
- Historical matches retain their original participants even after teams change.

Avoid adding fixed team IDs to this model.

## 2.4 Rating history

Implement an auditable rating history.

Suggested entities:

- `EloRatingRun`
- `EloRatingChange`
- `EloMatchResultRevision`

Each rating-change record should capture:

- Match
- Player
- Previous rating
- Rating change
- New rating
- Expected win probability
- Team size
- Rating algorithm version
- Calculation revision
- Timestamp

Preserve historical result corrections in an immutable audit history.

Rating projections may be rebuilt, but earlier audit records must remain accessible.

## 2.5 Constraints and transactions

Use relational constraints and database transactions to protect:

- Match rosters
- Active table allocation
- Active player allocation
- Duplicate result confirmation
- Rating updates
- Rating recalculation
- Mode transitions

Implement server-side validation for all team-size and authorization restrictions.

Consider PostgreSQL partial unique indexes or explicit transactional locking where appropriate.

Avoid unnecessary database duplication.

---

# PHASE 3 — PharmaElo mathematical engine

This is the most important part of the implementation.

Implement the rating logic as an isolated, deterministic, well-tested TypeScript module.

Suggested location:

`src/lib/elo/`

Adapt to existing folder conventions.

Keep the mathematical engine independent of React components and database APIs.

## 3.1 Initial rating

Every player starts with:

\[
R_0=100
\]

Store the full rating precision.

Do not round intermediate calculations.

## 3.2 Team rating

For a temporary team containing \(n\) players, calculate:

\[
R_T=\frac{1}{n}\sum_{i=1}^{n}R_i
\]

Use the arithmetic mean of individual player ratings.

Do not sum player ratings.

This prevents larger teams automatically receiving a higher expected skill rating simply because they contain more players.

Both teams independently support between one and four participants.

Examples:

- One player at 120 → team rating 120.
- Two players at 100 and 140 → team rating 120.
- Four players at 80, 100, 120, and 140 → team rating 110.

## 3.3 Expected winning probability

Use the Elo logistic expectation function:

\[
E_A=\frac{1}{1+10^{(R_B-R_A)/D}}
\]

with:

\[
D=100
\]

and:

\[
E_B=1-E_A
\]

The conventional chess Elo scaling parameter is 400. PharmaPong intentionally uses 100 because its ratings start at 100 and are expected to span a smaller range.

Make this parameter configurable at the session level, but default it to 100.

Clearly document that this is a custom Elo-inspired rating system, not calibrated chess Elo.

## 3.4 Match outcome

Use binary match outcomes:

\[
S_A=
\begin{cases}
1 & \text{if Team A wins}\\
0 & \text{if Team A loses}
\end{cases}
\]

And:

\[
S_B=1-S_A
\]

There are no draws.

If a match cannot be completed, administrators may cancel it without rating changes.

Do not automatically award points when a match is abandoned.

## 3.5 Elo change

Define a total match rating pool parameter:

\[
K=24
\]

Calculate the winning or losing team's total change:

\[
\Delta_A=K(S_A-E_A)
\]

\[
\Delta_B=-\Delta_A
\]

Distribute the change equally among all players in the respective team:

\[
\boxed{
\Delta R_{i\in A}=\frac{\Delta_A}{n_A}
}
\]

\[
\boxed{
\Delta R_{j\in B}=\frac{-\Delta_A}{n_B}
}
\]

Apply changes to individual ratings.

### Important mathematical properties

1. The sum of all rating changes in a rated match must equal zero, within numerical precision.
2. Players on the same team receive identical numerical rating changes.
3. Underdog victories receive larger positive changes than expected victories.
4. Team size changes the individual share of the rating transfer.
5. Rating calculations must use authoritative server-side values.
6. No frontend-provided rating values may be trusted.
7. Do not round rating values after every match.
8. Do not introduce arbitrary rating floors or ceilings that silently violate conservation of rating points.

Store the rating algorithm version with each calculation.

## 3.6 Example calculations

Implement unit tests for the following cases.

### Example A — Equal 2v2

Team A:
- Player A1: 100
- Player A2: 100

Team B:
- Player B1: 100
- Player B2: 100

Team A wins.

Expected:

- Team A winning probability: 0.5
- Team A total change: +12
- A1: +6
- A2: +6
- B1: −6
- B2: −6

### Example B — Equal 1v4

Team A:
- One player at 100

Team B:
- Four players, each at 100

Team A wins.

Expected:

- Solo player: +12
- Each losing player: −3
- Total rating change: 0

If Team B wins:

- Solo player: −12
- Each winning player: +3

### Example C — Upset victory

Team A average: 80

Team B average: 120

Each team has two players.

Team A wins.

Expected:

- Team A winning probability: approximately 0.2847
- Total rating transfer: approximately 17.17
- Each winning player: approximately +8.58
- Each losing player: approximately −8.58

### Example D — Mixed team sizes

Test every combination of player counts from 1 through 4 on both sides.

Verify:

- Valid expected probability
- Correct sign of rating changes
- Correct distribution
- Zero-sum conservation
- No duplicate players
- No dependency on roster ordering

Also test extreme rating differences, decimal precision, and invalid inputs.

## 3.7 Rating preview

Before a match starts, display:

- Average Team A rating
- Average Team B rating
- Predicted winning probabilities
- Estimated rating gain or loss for each side

The preview must be computed from the current authoritative ratings.

Do not persist preview values as final outcomes.

At match confirmation, calculate the final changes from the authoritative rating state.

## 3.8 Rating corrections and deterministic replay

This is critical.

If a previously confirmed result is corrected, simply reversing the original rating change is insufficient.

Every later confirmed match may have depended on the previous ratings.

Implement deterministic rating replay.

Requirements:

1. Store an authoritative, stable confirmation sequence for rated matches.
2. When a historical result changes, record the correction as an immutable result revision.
3. Recalculate the affected Elo session from its initial ratings, processing matches in confirmation order.
4. Rebuild the current rating projection and rating-change history.
5. Preserve past calculation runs or equivalent audit information.
6. Make the recalculation atomic.
7. Prevent concurrent rating confirmations from interleaving with replay.
8. Validate zero-sum conservation and replay reproducibility.

Use a session-level transactional lock or equivalent serialization mechanism for rating-affecting writes.

Do not silently reorder historical matches based on mutable timestamps.

For this small event, replaying the full session is preferable to complex incremental correction algorithms.

## 3.9 Algorithm limitations and future extension

Document the assumptions:

- Team strength is approximated by average player rating.
- Each team receives the same number of throwing opportunities.
- Team members share rating changes equally.
- Uncertainty is not explicitly modeled.
- The rating is intended for a recreational social event.

Create an interface allowing alternative algorithms in the future.

For example:

```typescript
interface RatingEngine {
  calculate(input: RatingInput): RatingResult;
}
```

Do not implement TrueSkill or Glicko-2 in this release.

Add an architecture note referencing:

- Elo expected-score formulation
- Microsoft TrueSkill
- Glicko-2
- Bayesian team-rating approaches

Keep the documented distinction between research-based concepts and PharmaPong-specific heuristics.

---

# PHASE 4 — Spontaneous matches and temporary teams

## 4.1 Match creation

In Elo Mode, players should be able to start matches without a tournament schedule.

The workflow:

1. Choose an available table.
2. Add players to Team A.
3. Add players to Team B.
4. Preview the matchup and Elo expectations.
5. Obtain confirmation from both sides.
6. Start the match.
7. Play.
8. Submit and confirm the result.
9. Apply Elo updates.
10. Release the table.

Team names are optional. For the default UI, derive a friendly label from player names.

Do not force participants to create a new persistent team for every match.

## 4.2 Player selection

Implement a mobile-friendly player picker.

Requirements:

- Search registered players by display name.
- Show avatar, name, and rating.
- Support 1–4 players per team.
- Make adding and removing players fast.
- Display clear Team A and Team B sections.
- Disable unavailable players.
- Prevent duplicates.
- Ensure there is at least one player on each side.
- Exclude competitors currently participating in another active match.

Do not expose email addresses in the player picker.

Include a clear indication when a selected user must confirm participation.

## 4.3 Consent and match readiness

Do not allow someone to assign arbitrary people to rated matches without their knowledge.

For the MVP, use lightweight confirmation by one designated representative from each team.

- The match creator can confirm only their own side.
- A representative from the opposing side must independently confirm the opposing roster.
- A representative must be an authenticated participant on that side.
- Both sides must acknowledge the final roster before starting.
- A referee or administrator may record in-person consent and override readiness, with an audit entry.
- Changing the roster invalidates prior confirmations.

Avoid requiring all eight possible participants to perform a complex onboarding workflow.

Keep the process short enough for an apéro.

## 4.4 Team flexibility

Teams are snapshots attached to matches.

After the game:

- Players retain individual Elo.
- Temporary teams dissolve logically.
- Players become available again.
- New combinations can form immediately.

A player's match history should display previous teammates and opponents.

Do not overwrite past match rosters.

## 4.5 Physical tables

Reuse the two existing Beer Pong tables.

Implement table states appropriate for spontaneous matches:

- AVAILABLE
- RESERVED
- IN_PROGRESS
- DISABLED

Ensure:

- A table cannot host two active matches.
- A player cannot participate in simultaneous matches.
- A referee can start and complete a match.
- The next group can use a table immediately after the previous match is completed.
- An administrator can free a table if a match is abandoned.
- Cancelling a match does not affect player ratings.

Use transactions to enforce resource ownership when starting games.

Unstarted match drafts should not permanently occupy physical tables.

Provide a way to expire or cancel abandoned drafts.

## 4.6 QR-code support

Add support for identifying a physical table through a QR code.

Example routes:

- `/elo/table/1`
- `/elo/table/2`

Use the project's actual table identifiers if different.

Scanning should open a mobile-friendly table page.

If the table is available, allow match creation.

If occupied, show the current match and its elapsed time.

QR codes must not grant special authorization. Authentication and result-confirmation rules still apply.

Generate printable QR codes for the administrator.

---

# PHASE 5 — Stopwatch and match rules

## 5.1 Remove the hard time limit in Elo Mode

Competitive Mode retains its current countdown behavior.

Elo Mode uses a **count-up stopwatch**.

Example:

`00:00 → 04:32 → 13:48 → 27:16`

There is no mandatory time limit.

There is no automatic match termination.

The referee or authorized participant explicitly finishes the match.

## 5.2 Timer implementation

Use authoritative server timestamps.

The clock must:

- Continue after browser refresh.
- Remain synchronized across devices.
- Support pause/resume if the existing timer infrastructure allows it.
- Correctly account for paused duration.
- Handle network interruptions.
- Avoid client-side timer drift becoming authoritative.

Display elapsed minutes and seconds prominently.

Optionally display a non-blocking reminder after 20 minutes.

The reminder must not end the game.

Allow the administrator to disable or configure the reminder.

## 5.3 Rules for variable team size

Teams may contain 1–4 players.

To prevent larger teams from having an automatic advantage:

**Each team receives exactly two throws per normal turn, independent of player count.**

For one-player teams, the player takes both throws.

For teams with multiple members, players rotate through the available throws.

This rule must be prominently documented in the Elo Mode rules screen.

Adapt any existing rules that explicitly assume exactly two players per team.

Do not modify Competitive Mode rules.

## 5.4 Match result

Record:

- Winner
- Participating players
- Table
- Duration
- Ending type
- Optional remaining cup counts
- Confirmation information

Cup counts should not influence the Elo formula in version 1.

The result must never be accepted as a draw.

Support cancellation without a winner or rating change.

---

# PHASE 6 — Results and authorization

## 6.1 Result confirmation

Support two configurable confirmation policies:

### DUAL_TEAM_CONFIRMATION

Recommended default for Elo Mode.

One representative submits the result.

A representative from the opposing team must independently confirm the same winner.

The result becomes final only after matching confirmations.

A user must never confirm on behalf of both teams.

If representatives disagree:

- Mark the result as DISPUTED.
- Do not award Elo.
- Keep the match history.
- Allow referee/admin resolution.

### REFEREE_ONLY

Only referees and administrators can confirm the final result.

Reuse existing permissions where possible.

The admin selects the desired policy.

## 6.2 Safety and consistency

All result confirmation logic must execute server-side.

Use:

- Authorization checks
- Input validation
- Optimistic concurrency control
- Idempotent result submission
- Database transactions
- Immutable audit events

Prevent duplicate Elo awards when the same confirmation request is retried.

Do not apply ratings until the match is fully confirmed.

A disputed match must never influence the leaderboard.

## 6.3 Administrative correction

Administrators can:

- Correct the winner.
- Correct participation or cup data using an audited workflow.
- Void a fraudulent or mistakenly confirmed match.
- Resolve disputes.
- Trigger rating replay.

Changing participants in an already completed rated match requires a controlled correction and replay, not a direct database edit.

Every correction records actor, timestamp, reason, and previous/new values.

---

# PHASE 7 — Leaderboard and social features

## 7.1 Individual leaderboard

Replace the competitive bracket as the primary view while Elo Mode is active.

Display:

- Rank
- Avatar
- Player name
- Current Elo
- Games played
- Wins
- Losses
- Optional win rate
- Rating change since the start of the event

Example:

| Rank | Player | Elo | Games |
|---|---|---:|---:|
| 1 | Sandra | 138 | 6 |
| 2 | Fabian | 125 | 5 |
| 3 | Anna | 119 | 4 |
| 4 | Peter | 113 | 7 |

These are illustrative values.

The leaderboard must update after confirmed rated matches.

Use the application's existing live-update infrastructure.

Do not expose private account details.

## 7.2 Provisional ratings

A single lucky match should not necessarily determine the winner of the evening.

Introduce:

`MIN_GAMES_FOR_CHAMPION = 3`

Players with fewer than three rated games:

- Still appear in the leaderboard.
- Still receive Elo updates.
- Have a visible provisional indicator.
- Are not eligible for the final Elo champion title.

The minimum is configurable by administrators.

Ranking position and champion eligibility are separate concepts.

## 7.3 Player details

Allow users to open a player profile showing:

- Avatar
- Display name
- Current Elo
- Games played
- Wins/losses
- Historical rating progression
- Recent matches
- Previous teammates
- Previous opponents

Use a simple line chart for rating progression.

Do not overcomplicate the interface.

## 7.4 Social achievements

Implement three lightweight achievements:

### Most Active Player

Most completed matches.

### Biggest Upset

Victory with the lowest predicted winning probability.

### Best Comeback

Largest positive Elo recovery from a player's lowest earlier rating to a later rating within the session.

Use deterministic definitions and document tie-breaking behavior.

Achievements do not affect Elo calculations.

Avoid random or alcohol-consumption-based achievements.

## 7.5 Anti-farming safeguards

Allow repeated matches, but reduce rating exploitation.

Implement a simple, configurable repeated-match safeguard based on identical opposing rosters within the same Elo session.

Normalize the roster pair so swapping Team A and Team B does not bypass the rule.

Suggested defaults:

- First matchup: 100% Elo impact
- Second matchup: 100%
- Third matchup: 50%
- Fourth and subsequent matchup: 0% (unrated)

Apply the multiplier to the total match Elo transfer before distributing it among players.

This preserves zero-sum behavior.

Do not prevent participants from playing an unrated friendly match.

Before a repeated match starts, clearly display whether it will be fully rated, partially rated, or unrated.

Persist the applicable multiplier in the match history.

Use the confirmed matchmaking history to determine repeated-match counts; define consistent behavior for corrected or voided matches.

These thresholds are PharmaPong house rules, not established chess-Elo standards.

Allow an administrator to configure or disable the safeguard.

## 7.6 Optional friendly matches

Support a non-rated match option.

Friendly matches:

- Occupy a physical table.
- Use the same stopwatch.
- Support temporary teams.
- Can be recorded in match history.
- Do not change Elo.

Clearly label friendly matches before they start.

Only authorized administrators should be able to change whether a completed match was rated, using audited correction and replay.

---

# PHASE 8 — User interface and experience

## 8.1 Preserve existing design quality

The current PharmaPong implementation already has a working UI.

Inspect the existing design system and reuse its components.

The original design was intended to use the `ui-ux-pro-max` Claude Code plugin.

If that plugin or its generated design assets are available, use them as the design reference.

Do not invent plugin commands or claim to have run a plugin that is not available in the Codex environment.

If necessary, extend the existing design system directly and document any plugin-dependent design work that remains.

## 8.2 Design philosophy

This application will be used during a social event.

Assume users are:

- Standing
- Talking
- Distracted
- Using phones with one hand
- Sometimes intoxicated
- Unwilling to complete long forms

Optimize for:

- Minimal interactions
- Large buttons
- Clear visual hierarchy
- Excellent mobile readability
- Strong contrast
- Few steps per action
- Obvious confirmation feedback
- Clear error states
- Accessible touch controls

Do not overuse animations.

No important operation should depend exclusively on a gesture.

## 8.3 Elo dashboard

Suggested structure:

**Header**
- PharmaPong branding
- Active mode: Social Elo
- Current player profile

**Live Arena**
- Table 1: current match or available
- Table 2: current match or available
- Elapsed duration for active games

**Primary action**
- Create Match

**Leaderboard**
- Top players
- Current user's position
- Link to full ranking

**Recent activity**
- Latest results
- Biggest upset
- New personal bests

## 8.4 Mobile navigation

When Elo Mode is active, provide approximately four primary destinations:

- Home
- Play
- Rankings
- Profile

Referee and administrator actions should remain accessible according to role.

Do not show competitive-specific bracket navigation as the main Elo Mode experience.

## 8.5 Match creation UI

Design a highly efficient workflow.

Target interaction:

1. Select table.
2. Select players.
3. Confirm matchup.
4. Start.

Use:

- Searchable player selection
- Avatars
- Clearly separated Team A and Team B
- Elo averages
- Predicted win probabilities
- Team confirmation states
- Large start button

Prevent invalid input immediately, not only after submission.

## 8.6 Active match UI

Display:

- Table name
- Team compositions
- Team avatars
- Elapsed time
- Pause/resume control if enabled
- End match button
- Optional cup information

A phone should show the essential game state without requiring scrolling.

## 8.7 Result animation

After a confirmed result:

- Display winning team.
- Display each participant's Elo change.
- Show new individual ratings.
- Update leaderboard positions.
- Show a short celebratory animation.

Example:

"Team A wins!"

"Peter: +8.6 Elo"

"Fabian: +8.6 Elo"

"New ranking positions!"

Keep animations optional and respect reduced-motion settings.

## 8.8 Public display

Adapt the existing public display according to the active mode.

Competitive Mode retains its current visualization.

Elo Mode shows:

- Two active tables
- Match durations
- Top leaderboard players
- Latest completed result
- Optional achievements
- PharmaPong branding

Avoid exposing personal email addresses.

Provide a champion announcement when an Elo session is closed.

---

# PHASE 9 — Administrator controls

Extend the existing administrator dashboard.

Add an Elo Mode section with:

- Mode selection
- Elo session status
- Player count
- Active matches
- Table availability
- Result disputes
- Individual ratings
- Rating history
- Session settings
- Rating recalculation tools

## 9.1 Configurable defaults

Use the following initial configuration:

```typescript
const DEFAULT_ELO_CONFIG = {
  initialRating: 100,
  kFactor: 24,
  ratingScale: 100,
  minTeamSize: 1,
  maxTeamSize: 4,
  minGamesForChampion: 3,
  hardTimeLimit: null,
  softTimeReminderMinutes: 20,
  resultConfirmation: "DUAL_TEAM_CONFIRMATION",
  repeatMatchMultipliers: [1, 1, 0.5, 0],
};
```

The last multiplier applies to the fourth and all later matches between identical opposing rosters.

Validate settings server-side.

Rating parameters must not be silently changed after rated matches exist.

Require an explicit administrator recalculation procedure with an audit record when modifying parameters that affect existing results.

## 9.2 Elo session controls

Administrators should be able to:

- Open a session.
- Pause new match creation.
- Close a session.
- View final standings.
- Announce an eligible champion.
- Reopen a session through an audited action if necessary.
- Export match results and rankings.

Closing an Elo session must not delete rating history.

The champion should be determined from eligible players using deterministic ranking rules.

Ties in the displayed rounded Elo must be resolved using full-precision ratings; define an explicit rule for genuine numerical ties.

---

# PHASE 10 — Migration and compatibility

This is an existing production-capable application.

Database migrations must be non-destructive.

Do not:

- Drop existing competitive tables.
- Delete existing users.
- Replace the old match schema without a necessary migration strategy.
- Convert persistent two-player teams into dynamic Elo teams.
- Reset existing tournament data.
- Reinitialize the production database.

Prefer additive migrations.

Reuse authentication and table entities where safe.

Verify that existing competitive matches still work after migration.

Ensure the original competitive timer behavior is unchanged.

Mode-specific behavior must be explicit and testable.

Provide a migration rollback strategy and production backup instructions.

---

# PHASE 11 — Testing and simulations

Use the repository's existing test framework.

Introduce Vitest and Playwright only if suitable testing tools do not already exist.

## 11.1 Rating unit tests

Test:

- Initial Elo = 100
- Equal rating probabilities = 50%
- Different rating probabilities
- Underdog victories
- Favorites winning
- All team-size combinations from 1 to 4
- Decimal precision
- Zero-sum rating conservation
- No influence from roster order
- No influence from cup margins
- Repeat-match multipliers
- Friendly matches
- Invalid inputs
- Duplicate participants
- Extreme rating differences
- Nonfinite numeric input rejection

## 11.2 Rating replay tests

Simulate a history of multiple matches.

Then:

1. Correct an early winner.
2. Recalculate ratings.
3. Verify all downstream changes.
4. Verify the final rating state.
5. Run replay a second time.
6. Confirm identical results.

Test concurrent correction and confirmation attempts.

Do not allow partial replay to leave inconsistent ratings.

## 11.3 Concurrent match tests

Verify:

- Two independent matches can run simultaneously.
- A player cannot join two active matches.
- A table cannot host two active matches.
- Two requests cannot confirm the same result twice.
- Retry requests do not award duplicate Elo.
- Stale client state produces a clear conflict response.
- Mode switching cannot interrupt an active match.

## 11.4 Authentication tests

Verify:

- A player cannot switch game modes.
- A player cannot confirm both sides of a match.
- One side cannot impersonate the other side.
- Referees can use authorized result controls.
- Administrators can resolve disputes.
- Unauthorized users cannot modify ratings directly.
- Users cannot bypass team-size limits.

## 11.5 Full social event simulation

Create a realistic simulation involving:

- 24 players
- 2 physical tables
- Temporary teams with 1–4 participants
- At least 40 completed matches
- Players switching teams repeatedly
- Players joining and leaving the activity
- Multiple different skill levels
- Unexpected victories
- Repeated opponents
- Disputed results
- Cancelled matches
- A corrected historical result
- Concurrent games

Simulate different player participation patterns:

1. Casual: 1–2 matches per player
2. Moderate: 3–5 matches per player
3. Highly active: 6–10 matches per player
4. Mixed: some players never participate, others play frequently

Evaluate:

- Rating distribution
- Leaderboard stability
- Effect of team size
- Influence of participation frequency
- Rate of repeated matches
- Maximum and minimum ratings
- Accuracy of zero-sum conservation
- Number of provisional players
- Champion eligibility

Produce a concise simulation report in:

`docs/elo-mode/rating-validation.md`

Include actual computed results, not invented statistics.

Highlight any serious mathematical or incentive problems before declaring the system ready.

## 11.6 Regression tests

All existing Competitive Mode tests must continue passing.

Add explicit tests for:

- Group stage generation
- Knockout advancement
- Existing fixed team size
- Existing result recording
- Existing countdown
- Existing administration
- Existing public display

Elo Mode must not break the original event format.

---

# PHASE 12 — Railway deployment

Inspect the existing Railway configuration.

Use the connected Railway MCP if available and appropriate.

Do not create a second Railway project unnecessarily.

Prepare the existing application for the new database migrations.

Tasks:

1. Verify build configuration.
2. Verify production environment variables.
3. Create additive Prisma migrations or equivalent.
4. Test migrations against a development database.
5. Verify the new routes compile.
6. Verify authentication.
7. Verify both game modes.
8. Verify table management.
9. Verify rating calculations.
10. Verify persistence across application restarts.
11. Document deployment and rollback procedures.

Use a staging environment if available.

Do not modify production services or apply production migrations without explicit authorization.

Do not invent Railway MCP operations. Discover the available commands before using them.

---

# PHASE 13 — Documentation, changelog, and versioning

Update:

- `README.md`
- `CHANGELOG.md`
- Architecture documentation
- Database documentation
- Deployment instructions
- Tournament rules documentation

Create:

- `docs/elo-mode/implementation-plan.md`
- `docs/elo-mode/rating-system.md`
- `docs/elo-mode/rating-validation.md`
- `docs/elo-mode/user-guide.md`
- `docs/elo-mode/admin-guide.md`

Explain the PharmaElo formula with numerical examples.

Clearly distinguish standard Elo mathematics from custom rules such as K-factor, rating scale, team averaging, and anti-farming multipliers.

Use meaningful Git commits organized by implementation phase, respecting existing repository conventions and uncommitted changes.

Update the application version to reflect a backward-compatible feature release, following its current versioning scheme.

Do not overwrite the existing changelog.

Do not push to a remote repository unless authorized.

---

# PHASE 14 — Implementation order

Implement in this order:

**Step 1 — Inspection and plan**
- Repository audit
- Architecture mapping
- Migration plan

**Step 2 — Mathematical engine**
- Rating formulas
- Rating engine interface
- Unit tests
- Simulation
- Rating validation report

**Step 3 — Database**
- Elo session
- Temporary match rosters
- Rating storage
- Rating history
- Additive migrations

**Step 4 — Backend workflows**
- Game mode switching
- Match creation
- Table allocation
- Player availability
- Match lifecycle
- Result confirmation
- Rating updates
- Deterministic replay

**Step 5 — User interface**
- Elo dashboard
- Dynamic player selection
- Match creation
- Stopwatch
- Match results
- Individual leaderboard

**Step 6 — Social features**
- QR table access
- Rating preview
- Achievements
- Rating history
- Friendly matches
- Repeat-match safeguards

**Step 7 — Administration**
- Mode selection
- Session controls
- Settings
- Corrections
- Dispute resolution

**Step 8 — Final validation**
- End-to-end tests
- Full social event simulation
- Competitive Mode regression tests
- Railway staging verification
- Documentation and version bump

Complete each step with working code and tests before moving to the next.

Do not stop after creating an implementation plan or UI mockups.

Continue through implementation and local validation, unless blocked by missing permissions, unavailable credentials, or a destructive production action requiring approval.

---

# Definition of Done

The implementation is complete when:

- [ ] Existing Competitive Mode works unchanged.
- [ ] Admin can switch between Competitive and Elo Mode.
- [ ] Switching modes preserves all historical data.
- [ ] All Elo players start at 100.
- [ ] Temporary teams support 1–4 players.
- [ ] Players can choose new teammates every match.
- [ ] Matches can be started spontaneously.
- [ ] Two tables can operate simultaneously.
- [ ] Players cannot participate in two active matches.
- [ ] Elo Mode has a stopwatch without a hard time limit.
- [ ] Match results require authorized confirmation.
- [ ] Individual ratings update correctly.
- [ ] Rating transfers satisfy zero-sum conservation.
- [ ] Corrections correctly replay subsequent ratings.
- [ ] Leaderboards update automatically.
- [ ] Provisional rating and champion eligibility work.
- [ ] Repeated-match safeguards are implemented.
- [ ] Friendly games do not change Elo.
- [ ] Mobile UX is intuitive.
- [ ] Public display adapts to Elo Mode.
- [ ] Existing competitive tests still pass.
- [ ] Mathematical simulations have been executed and documented.
- [ ] Database migrations are safe.
- [ ] README, changelog, and version are updated.
- [ ] Deployment preparation is validated.

## Final instruction

Prioritize correctness, simplicity, and social usability over architectural sophistication.

PharmaPong Elo Mode should feel like a spontaneous social game, not a tournament-management system.

Preserve the working application. Avoid unnecessary rewrites.

**Start by inspecting the real repository, then implement PharmaPong Elo Mode phase by phase, with the rating engine and its tests as the first major deliverable.**
