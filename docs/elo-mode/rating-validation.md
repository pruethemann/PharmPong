# PharmaElo: rating validation (simulation report)

This report validates the PharmaElo rating engine (`pharmaelo-v1`, see [rating-system.md](rating-system.md))
with a Monte Carlo simulation of social events, as required by spec §11.5. All numbers in the tables are
**computed**, not estimated. Regenerate them with:

```bash
pnpm elo:validate              # 500 seeds per scenario, about 5 s, no database needed
pnpm elo:validate --seeds=2000 # more seeds, narrower intervals
```

The run also writes the raw aggregates to `data/elo-validation/elo-validation-<timestamp>.json` (git-ignored).
Code: `src/server/sim/elo-montecarlo.ts` (simulation), `src/server/sim/elo-report.ts` (aggregation),
`scripts/elo-validation.ts` (entry point).

## How the simulation works

- **Players.** 24 players with a hidden _true skill_ on the Elo scale: 100 + 30 · N(0, 1). The rating system
  never sees it; it only sees results, exactly like the real app.
- **Outcomes.** A match is won by side A with probability `1 / (1 + 10^((S̄_B − S̄_A) / 100))`, where `S̄` is
  the mean true skill of the side. This is the same logistic model the ratings use, so the rating model is
  well specified (a separate scenario adds more luck, another a real advantage for larger teams).
- **Temporary teams.** Team sizes 1/2/3/4 with probabilities 15/50/20/15%, both sides drawn independently,
  so 1v4 matches happen. 20% of the players like to play alone: as captain they play solo 80% of the time.
- **Tables and time.** Two tables; a match lasts 6–18 minutes; players rest 2–10 minutes between matches,
  so both tables run concurrently.
- **Irregularities.** 8% friendlies, 25% chance that a pairing immediately asks for a revenge game
  (identical rosters, possibly swapped sides), 5% disputes (30% of them voided, the rest resolved 15–40
  minutes later, i.e. confirmed out of order), 3% cancelled matches.
- **Participation patterns (spec §11.5).** _Casual_ 1–2 matches per player, _moderate_ 3–5, _highly active_
  6–10, _mixed_ (25% never play, 25% casual, 25% moderate, 25% very active), and the **apéro** scenario: a
  6-hour event where players arrive during the first 90 minutes, casual guests leave after 1–2.5 hours,
  and 15% never play.
- **Replay check.** In every run the earliest rated result is flipped (an admin correction), the session is
  replayed from 100, and the replay is repeated to check that it is bit-identical.
- **Confirmation order.** As in the app, ratings are applied in confirmation order (the sequence), never in
  start order.

## Findings

Values below refer to the generated tables (500 seeds per scenario).

### Verified mathematical properties

- **Zero-sum conservation holds.** Over 3,500 simulated events the largest deviation of the rating sum from
  `N · 100` is about 2.4e-13, which is floating-point noise.
- **Replay is deterministic and necessary.**
  - Every replay was reproducible (100%).
  - Flipping one early result changes about 34 of the roughly 44 later calculations in an apéro.
  - It moves some final rating by about 17 points on average.
  - Simply reversing and re-applying that one match would leave an error of about 11 points on average
    (up to 17 at the 95th percentile). A full replay, as implemented, is therefore required.
- **The repeat-match safeguard works.** A strong duo farming the same weak duo gains +24 per player over ten
  meetings without the safeguard. With the default multipliers `[1, 1, 0.5, 0]` the gain stops at about +9
  after the third meeting.
- **Team size is neutral in expectation.**
  - The per-player change shrinks with team size as designed: on average 11.2 / 5.8 / 3.9 / 2.9 points for
    teams of 1 / 2 / 3 / 4.
  - Larger teams win 49% of uneven matches.
  - Even if larger teams were really stronger (+10 per extra player; they then win 56%), players who prefer
    big teams end up only negligibly higher rated (correlation 0.05).
- **Ratings stay in a sensible range.** With K = 24 and D = 100, ratings end between about 30 and 170 over
  all simulated events. The typical spread is a standard deviation of 12–18 points (about 8 when everybody
  plays only 1–2 matches), and no rating went negative.

### ⚠️ Incentive problem: playing alone pays off for the champion title

- **Effect.** Solo-loving players are about 19% of the champion-eligible players, but they win the title in
  about 32% of apéro events and in about 55% of the moderate and highly active patterns, independent of
  their skill.
- **Two mechanisms, both direct consequences of the specified formula:**
  1. **Variance.** A solo player receives the whole transfer: ±12 at even odds, while a duo member gets ±6
     and a member of a team of four ±3. Their rating therefore swings twice as much, and the top (and the
     bottom) of a leaderboard is dominated by high-variance players.
  2. **No dilution.** A strong player alone is not averaged down by a weaker teammate, so they win more
     often, and then take the full transfer.
- **What does and does not help** (what-if table):
  - Changing K or D does **not** help, because it scales every player equally.
  - Halving the transfer of matches with a solo side reduces the share to about 24% (apéro) and 38%
    (moderate), but would break spec example B (+12 / −3).
  - Requiring 5 rated games for the title helps only slightly in the apéro (30% solo champions vs. 18%
    eligible).
- **Decision (2026-10-26, product owner):** keep the specified rules (option a). The Elo rules page states
  openly that solo play is "high risk, high reward", and the admin sees the number of eligible players
  before closing a session. The alternatives remain documented: raising the champion minimum is an admin
  setting; a "solo factor" house rule (halving transfers of matches with a one-player side) was rejected
  because it would deviate from spec example B.

### ⚠️ One evening is noisy: the title rewards tonight's results more than skill

- **Accuracy.** Among champion-eligible players, the Spearman correlation between rating and true skill is
  about 0.3–0.45.
- **The champion.** It is the truly best eligible player only 12–27% of the time, and one of the true top
  three 29–57% of the time.
- **Stability.** The leader after 75% of the matches is still champion in about half of the events.
- **More luck makes it worse.** If the game involves more luck than the model assumes (true scale 200), the
  accuracy drops further (0.26).
- **Why.** This is inherent to about 5 games per player in random temporary teams, not a defect of the
  formula: K and D do not change it.
- **Communication.** It should be framed as a fun evening title, not a skill certificate.

### ⚠️ Low participation means no champion

- **Casual pattern.** If guests play only 1–2 matches each, nobody reaches the default minimum of 3 rated
  games, so there is no eligible champion.
- **What the admin needs.** The admin must see the number of eligible players before closing a session.
  They can lower `minGamesForChampion` (an audited setting) or accept that no champion is crowned.

### Further observations

- **Active players.** They are over-represented among champions (about 1.3–1.4× their share of eligible
  players) and have more extreme ratings in both directions. Their mean rating does not drift (correlation
  between games and rating ≈ 0). This is natural and arguably wanted for an evening title.
- **The provisional rule.** It rarely changes the title in these patterns: the top-rated player is
  provisional in at most 6% of events, because a single game can move a rating by at most 12 points. It
  matters mostly at low participation.
- **Repeated pairings.** They are common: about 24% of rated apéro matches repeat an earlier pairing, and
  about 2.5 per event are only half or not at all rated. The banner before the match is therefore relevant.

## Limitations of the simulation

- True skill is constant during the evening (no warm-up, fatigue or drinks), and games are independent.
- Team strength is modelled as the mean true skill, the same assumption the rating makes, so the results
  show the system at its best on that point.
- Participation tiers, solo preference, rematch and dispute rates are plausible guesses, not measurements.
- The simulation tests the rating mathematics (`replaySession`), not the database workflow. The DB-level
  event simulation through the real services follows in Step 8 and will be appended here.

## Generated results

<!-- BEGIN GENERATED: pnpm elo:validate -->

_Generated 2026-10-25 23:10 (Europe/Zurich) by `pnpm elo:validate`: 500 seeds per scenario, engine `pharmaelo-v1`, K = 24, D = 100, start 100, repeat multipliers [1, 1, 0.5, 0], champion minimum 3 rated games. Values are mean (5th–95th percentile) over the seeds._

### Volume and participation

| Scenario                           | Completed matches | Players with a rated game | Eligible (≥ min games) | Provisional | Never played | Repeat pairings | ½-rated / unrated repeats per event |
| ---------------------------------- | ----------------- | ------------------------- | ---------------------- | ----------- | ------------ | --------------- | ----------------------------------- |
| Apéro (realistic event)            | 45 (40–50)        | 20 (19–20)                | 17 (15–20)             | 2 (0–5)     | 4 (4–5)      | 24%             | 1.91 / 0.63                         |
| Casual: 1–2 matches each           | 9 (7–11)          | 22 (18–24)                | 0 (0–0)                | 22 (18–24)  | 1 (0–3)      | 2%              | 0.00 / 0.00                         |
| Moderate: 3–5 matches each         | 24 (20–28)        | 24 (24–24)                | 21 (16–24)             | 3 (0–8)     | 0 (0–0)      | 13%             | 0.35 / 0.01                         |
| Highly active: 6–10 matches each   | 48 (41–56)        | 24 (24–24)                | 24 (24–24)             | 0 (0–0)     | 0 (0–0)      | 19%             | 1.30 / 0.27                         |
| Mixed: 25% never … 25% very active | 24 (20–28)        | 18 (16–18)                | 11 (9–12)              | 6 (5–8)     | 6 (6–7)      | 19%             | 0.68 / 0.18                         |

### Event realism (apéro scenario)

| Metric                                          | Value                         |
| ----------------------------------------------- | ----------------------------- |
| Matches started / completed                     | 47 (42–52) / 45 (40–50)       |
| Friendlies                                      | 3.5 (1.0–6.0)                 |
| Disputes resolved later (out of order) / voided | 1.7 (0.0–4.0) / 0.8 (0.0–2.0) |
| Cancelled matches                               | 1.4 (0.0–4.0)                 |
| Confirmed in a different order than started     | 7.0 (4.0–11.0)                |
| Max. tables in use at the same time             | 2–2                           |

### Rating distribution and conservation

| Scenario                                                   | Lowest rating    | Highest rating      | SD of ratings    | Extremes over all seeds | Max. conservation error |
| ---------------------------------------------------------- | ---------------- | ------------------- | ---------------- | ----------------------- | ----------------------- |
| Apéro (realistic event)                                    | 62.0 (43.9–76.6) | 136.5 (121.8–154.2) | 18.4 (13.4–23.0) | 29.5 … 167.0            | 1.8e-13                 |
| Casual: 1–2 matches each                                   | 84.1 (77.3–89.7) | 116.3 (111.6–122.7) | 8.3 (6.3–10.3)   | 75.4 … 125.4            | 8.5e-14                 |
| Moderate: 3–5 matches each                                 | 74.0 (62.3–84.7) | 126.0 (116.5–140.1) | 12.4 (9.3–15.6)  | 50.3 … 147.8            | 1.7e-13                 |
| Highly active: 6–10 matches each                           | 65.2 (47.0–78.3) | 135.0 (122.5–153.9) | 16.6 (12.7–20.9) | 30.1 … 162.0            | 2.4e-13                 |
| Mixed: 25% never … 25% very active                         | 69.2 (51.2–82.5) | 130.3 (117.9–147.2) | 14.9 (10.5–19.5) | 35.5 … 162.3            | 1.4e-13                 |
| Apéro, larger teams really stronger (+10 per extra player) | 61.9 (44.7–76.7) | 136.2 (121.6–153.8) | 18.3 (13.5–23.3) | 29.5 … 168.5            | 1.9e-13                 |
| Apéro, more luck than the model assumes (true scale 200)   | 65.8 (49.8–79.1) | 133.4 (120.4–148.6) | 16.9 (12.1–21.1) | 28.7 … 164.1            | 1.7e-13                 |

### Accuracy, stability and the champion

| Scenario                                                   | Spearman rating vs. true skill (eligible) | Ranking at 75% vs. final | Leader at 75% still champion | No champion | Champion = truly best | Champion in true top 3 | Top rated player is provisional |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------ | ---------------------------- | ----------- | --------------------- | ---------------------- | ------------------------------- |
| Apéro (realistic event)                                    | 0.44 (0.08–0.73)                          | 0.81 (0.58–0.95)         | 54%                          | 0%          | 20%                   | 47%                    | 0%                              |
| Casual: 1–2 matches each                                   | –                                         | 0.88 (0.71–0.99)         | –                            | 100%        | –                     | –                      | 100%                            |
| Moderate: 3–5 matches each                                 | 0.30 (-0.07–0.61)                         | 0.81 (0.64–0.94)         | 41%                          | 0%          | 12%                   | 29%                    | 6%                              |
| Highly active: 6–10 matches each                           | 0.37 (0.09–0.63)                          | 0.80 (0.60–0.93)         | 46%                          | 0%          | 18%                   | 38%                    | 0%                              |
| Mixed: 25% never … 25% very active                         | 0.38 (-0.15–0.78)                         | 0.82 (0.54–0.98)         | 54%                          | 0%          | 27%                   | 57%                    | 3%                              |
| Apéro, larger teams really stronger (+10 per extra player) | 0.43 (0.10–0.73)                          | 0.81 (0.59–0.95)         | 57%                          | 0%          | 20%                   | 44%                    | 0%                              |
| Apéro, more luck than the model assumes (true scale 200)   | 0.26 (-0.15–0.61)                         | 0.77 (0.54–0.94)         | 48%                          | 0%          | 13%                   | 31%                    | 0%                              |

### Team size

| Scenario                                                   | Mean abs(Δ) per player at team size 1 / 2 / 3 / 4 | Larger team wins (uneven matches) | Corr. avg team size vs. rating |
| ---------------------------------------------------------- | ------------------------------------------------- | --------------------------------- | ------------------------------ |
| Apéro (realistic event)                                    | 11.17 / 5.78 / 3.87 / 2.92                        | 49%                               | -0.01                          |
| Apéro, larger teams really stronger (+10 per extra player) | 11.18 / 5.79 / 3.87 / 2.92                        | 56%                               | 0.05                           |
| Apéro, more luck than the model assumes (true scale 200)   | 11.49 / 5.87 / 3.92 / 2.94                        | 48%                               | -0.02                          |

### Participation frequency and play style

| Scenario                                                   | Corr. games vs. rating | Corr. games vs. abs(rating − 100) | Champion plays solo | Solo players among eligible |
| ---------------------------------------------------------- | ---------------------- | --------------------------------- | ------------------- | --------------------------- |
| Apéro (realistic event)                                    | -0.01                  | 0.35                              | 32%                 | 19%                         |
| Casual: 1–2 matches each                                   | 0.01                   | 0.16                              | –                   | –                           |
| Moderate: 3–5 matches each                                 | 0.01                   | 0.16                              | 55%                 | 19%                         |
| Highly active: 6–10 matches each                           | 0.00                   | 0.13                              | 55%                 | 20%                         |
| Mixed: 25% never … 25% very active                         | 0.01                   | 0.48                              | 28%                 | 20%                         |
| Apéro, larger teams really stronger (+10 per extra player) | -0.01                  | 0.35                              | 28%                 | 19%                         |
| Apéro, more luck than the model assumes (true scale 200)   | -0.00                  | 0.32                              | 31%                 | 19%                         |

Champion by participation tier, Apéro (realistic event):

| Tier     | Share of champions | Share of eligible players |
| -------- | ------------------ | ------------------------- |
| casual   | 7%                 | 20%                       |
| moderate | 49%                | 46%                       |
| active   | 44%                | 34%                       |

Champion by participation tier, Mixed: 25% never … 25% very active:

| Tier     | Share of champions | Share of eligible players |
| -------- | ------------------ | ------------------------- |
| casual   | 0%                 | 0%                        |
| moderate | 22%                | 46%                       |
| active   | 78%                | 54%                       |

### Corrections and replay (earliest rated result flipped, full replay)

| Scenario                           | Later matches whose calculation changed | Largest final rating shift | Error of a naive one-match fix | Replay reproducible |
| ---------------------------------- | --------------------------------------- | -------------------------- | ------------------------------ | ------------------- |
| Apéro (realistic event)            | 34.0 (26.0–41.0)                        | 17.34 (10.63–23.18)        | 11.31 (3.90–17.23)             | 100%                |
| Casual: 1–2 matches each           | 2.4 (0.0–5.0)                           | 16.77 (8.00–24.00)         | 1.15 (0.00–3.32)               | 100%                |
| Moderate: 3–5 matches each         | 14.7 (9.0–20.0)                         | 14.43 (7.50–23.10)         | 3.75 (0.87–9.65)               | 100%                |
| Highly active: 6–10 matches each   | 36.9 (29.0–44.0)                        | 12.24 (7.18–21.22)         | 6.47 (1.86–14.95)              | 100%                |
| Mixed: 25% never … 25% very active | 16.6 (11.0–21.0)                        | 13.58 (7.71–23.50)         | 6.75 (1.95–14.23)              | 100%                |

### What-if variants (same seeds; input for tuning, not the product rules)

| Variant                                                         | Pattern  | Eligible players | Spearman (eligible) | Champion = truly best | Champion in true top 3 | No champion | Champion plays solo / solo among eligible | Lowest … highest rating (p5 … p95) |
| --------------------------------------------------------------- | -------- | ---------------- | ------------------- | --------------------- | ---------------------- | ----------- | ----------------------------------------- | ---------------------------------- |
| Spec rules (K 24, D 100, champion ≥ 3 games)                    | event    | 17 (15–20)       | 0.44 (0.08–0.73)    | 20%                   | 47%                    | 0%          | 32% / 19%                                 | 43.9 … 154.2                       |
| Spec rules (K 24, D 100, champion ≥ 3 games)                    | moderate | 21 (16–24)       | 0.30 (-0.07–0.61)   | 12%                   | 29%                    | 0%          | 55% / 19%                                 | 62.3 … 140.1                       |
| Champion needs ≥ 5 rated games                                  | event    | 14 (11–16)       | 0.47 (0.07–0.78)    | 25%                   | 53%                    | 0%          | 30% / 18%                                 | 43.9 … 154.2                       |
| Champion needs ≥ 5 rated games                                  | moderate | 4 (1–8)          | 0.26 (-0.50–1.00)   | 45%                   | 83%                    | 4%          | 22% / 19%                                 | 62.3 … 140.1                       |
| K = 16                                                          | event    | 17 (15–20)       | 0.44 (0.08–0.73)    | 20%                   | 47%                    | 0%          | 33% / 19%                                 | 58.4 … 140.0                       |
| K = 16                                                          | moderate | 21 (16–24)       | 0.30 (-0.07–0.60)   | 12%                   | 29%                    | 0%          | 56% / 19%                                 | 72.9 … 128.4                       |
| K = 32                                                          | event    | 17 (15–20)       | 0.43 (0.07–0.73)    | 20%                   | 46%                    | 0%          | 30% / 19%                                 | 31.4 … 166.9                       |
| K = 32                                                          | moderate | 21 (16–24)       | 0.30 (-0.08–0.60)   | 12%                   | 30%                    | 0%          | 54% / 19%                                 | 52.6 … 150.4                       |
| D = 200                                                         | event    | 17 (15–20)       | 0.45 (0.09–0.73)    | 20%                   | 47%                    | 0%          | 34% / 19%                                 | 33.6 … 164.8                       |
| D = 200                                                         | moderate | 21 (16–24)       | 0.30 (-0.08–0.61)   | 12%                   | 29%                    | 0%          | 57% / 19%                                 | 57.7 … 143.9                       |
| What-if only: solo matches transfer 50% (breaks spec example B) | event    | 17 (15–20)       | 0.43 (0.08–0.72)    | 20%                   | 47%                    | 0%          | 24% / 19%                                 | 61.8 … 137.0                       |
| What-if only: solo matches transfer 50% (breaks spec example B) | moderate | 21 (16–24)       | 0.29 (-0.06–0.60)   | 14%                   | 33%                    | 0%          | 38% / 19%                                 | 77.5 … 123.0                       |

### Anti-farming safeguard (strong duo, true skill 140, vs. the same weak duo, 70)

| Meeting | Multiplier | Cumulative gain per strong player, with safeguard | Without safeguard |
| ------- | ---------- | ------------------------------------------------- | ----------------- |
| 1       | 1          | 4.08                                              | 4.08              |
| 2       | 1          | 7.36                                              | 7.36              |
| 3       | 0.5        | 9.09                                              | 10.83             |
| 4       | 0          | 9.09                                              | 13.42             |
| 5       | 0          | 9.09                                              | 15.40             |
| 6       | 0          | 9.09                                              | 17.51             |
| 7       | 0          | 9.09                                              | 19.59             |
| 8       | 0          | 9.09                                              | 21.25             |
| 9       | 0          | 9.09                                              | 22.71             |
| 10      | 0          | 9.09                                              | 24.06             |

### Showcase: one simulated apéro (seed 7, 47 confirmed matches)

| Rank | Player | Elo   | Δ     | Rated games | W–L | Status   | True-skill rank | Style |
| ---- | ------ | ----- | ----- | ----------- | --- | -------- | --------------- | ----- |
| 1    | p12    | 137.3 | +37.3 | 10          | 8–2 | eligible | 2               | team  |
| 2    | p24    | 128.0 | +28.0 | 7           | 6–1 | eligible | 5               | team  |
| 3    | p09    | 119.1 | +19.1 | 4           | 3–1 | eligible | 10              | solo  |
| 4    | p14    | 111.5 | +11.5 | 6           | 3–3 | eligible | 17              | team  |
| 5    | p20    | 110.9 | +10.9 | 11          | 6–5 | eligible | 8               | team  |
| 6    | p19    | 110.1 | +10.1 | 8           | 5–3 | eligible | 15              | solo  |
| 7    | p08    | 109.3 | +9.3  | 6           | 4–2 | eligible | 13              | team  |
| 8    | p18    | 109.1 | +9.1  | 13          | 6–7 | eligible | 4               | team  |
| 9    | p16    | 109.1 | +9.1  | 8           | 5–3 | eligible | 6               | team  |
| 10   | p11    | 105.2 | +5.2  | 12          | 6–6 | eligible | 3               | team  |
| 11   | p22    | 105.0 | +5.0  | 11          | 6–5 | eligible | 11              | team  |
| 12   | p15    | 102.7 | +2.7  | 13          | 6–7 | eligible | 12              | team  |

| Achievement   | Holder   | Value               |
| ------------- | -------- | ------------------- |
| Most Active   | p18      | 14 matches          |
| Biggest Upset | p11, p13 | 33% win probability |
| Best Comeback | p24      | +36.5 Elo           |

<!-- END GENERATED -->

## Database-level event simulation

The Monte Carlo study above checks the rating _math_. This run checks the _system_: a complete Elo evening is
played through the real services against a PostgreSQL database (both tables in parallel, consent, start,
report, confirm, disputes, cancellations, a voided result, an abandoned match, a double-sent confirmation, an
early correction and a manual recalculation), then the database is verified independently. The same scenario
runs in CI as `tests/integration/elo-full-event.int.test.ts`. Regenerate the numbers with (scratch database
only, it replaces the open event):

```bash
DATABASE_URL=postgresql://…/scratch pnpm simulate:elo --fresh
```

<!-- BEGIN GENERATED: pnpm simulate:elo -->

_Generated 2026-10-26 11:39 (Europe/Zurich) with seed 7: 24 players, two tables, real services and database._

| Check                                    | Result                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Matches created / confirmed              | 46 / 43 (40 rated, 3 friendlies)                                                                         |
| Repeat rule applied (multiplier < 1)     | 2 matches                                                                                                |
| Special cases                            | 1 cancelled draft, 1 dispute resolved by the referee, 1 pending result voided, 1 running match abandoned |
| Team sizes                               | 1v1 3×, 1v2 3×, 1v3 3×, 1v4 2×, 2v1 2×, 2v2 18×, 2v3 3×, 3v2 2×, 3v3 3×, 3v4 2×, 4v3 2×, 4v4 3×          |
| Matches running at the same time         | 2                                                                                                        |
| Same confirmation sent twice in parallel | rated once (1 idempotent replay)                                                                         |
| Early correction                         | new calculation run 2, everything after it replayed                                                      |
| Manual recalculation                     | identical digest                                                                                         |
| Dry run ("Prüfen")                       | max. deviation 0, 0 mismatches                                                                           |
| Zero sum                                 | Σ ratings 2400.000000 = 2400.000000 expected (error 5.7e-14)                                             |
| Locks left after the evening             | 0 player locks, 0 live matches                                                                           |
| Calculation runs                         | 3 (initial, correction, manual recalculation)                                                            |
| Champion(s)                              | Gast 20 (24 eligible)                                                                                    |

| Rank | Player  | Elo   | Matches | Wins |
| ---- | ------- | ----- | ------- | ---- |
| 1    | Gast 20 | 136.8 | 11      | 9    |
| 2    | Gast 10 | 132.6 | 7       | 6    |
| 3    | Gast 04 | 126.2 | 9       | 8    |
| 4    | Gast 03 | 121.4 | 10      | 8    |
| 5    | Gast 11 | 109.5 | 6       | 4    |

<!-- END GENERATED: pnpm simulate:elo -->
