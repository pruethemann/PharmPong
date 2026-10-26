# PharmaElo: the rating system of Elo Mode

PharmaElo (`pharmaelo-v1`) rates individual players in spontaneous matches between temporary teams of 1–4
players. It is an **Elo-inspired PharmaPong house system**, not calibrated chess Elo: the expectation formula
is standard Elo; the scale, the K-factor, team averaging, the equal split and the repeat-match multipliers are
PharmaPong choices for one social evening. Validation: [rating-validation.md](rating-validation.md).

Code: `src/server/domain/elo/` (pure TypeScript, no database or framework, ≥95% test coverage):

| File                | Responsibility                                                                     |
| ------------------- | ---------------------------------------------------------------------------------- |
| `engine.ts`         | the formula; `RatingEngine` interface; `PHARMA_ELO_V1`                             |
| `preview.ts`        | pre-match preview of both outcomes                                                 |
| `repeat.ts`         | normalized pairing key, repeat-match multipliers                                   |
| `replay.ts`         | deterministic replay in confirmation order, projections, digests                   |
| `ranking.ts`        | leaderboard ranks, provisional flag, champion(s)                                   |
| `achievements.ts`   | Most Active, Biggest Upset, Best Comeback                                          |
| `config.ts`         | spec defaults and validation of parameters and session settings                    |
| `roster.ts`, others | temporary-team validation, match state machine, permissions, results, table states |

## 1. The formula

Every player starts the session with **R₀ = 100** (the run's initial rating). For a match between side A
(n_A players) and side B (n_B players):

| Step                | Formula                                             | Default                       |
| ------------------- | --------------------------------------------------- | ----------------------------- |
| Team rating         | R_T = (R₁ + … + R_n) / n (arithmetic mean)          |                               |
| Expected score of A | E_A = 1 / (1 + 10^((R_B − R_A) / D)), E_B = 1 − E_A | D = 100                       |
| Outcome             | S_A = 1 if A wins, 0 if A loses; no draws           |                               |
| Total transfer      | Δ_A = K · (S_A − E_A) · m, Δ_B = −Δ_A               | K = 24, m = repeat multiplier |
| Per player          | each A player: Δ_A / n_A; each B player: −Δ_A / n_B |                               |

Properties (all covered by unit and property tests):

1. **Zero-sum.** n_A · (Δ_A / n_A) + n_B · (−Δ_A / n_B) = 0. In floating point the sum is 0 within about
   1e-13; over thousands of simulated events the rating total stays at N · 100 within 2.4e-13.
2. **Teammates get identical changes**, computed once per side.
3. **Upsets pay more** than expected wins: the winner gains K · (1 − E_winner).
4. **Team size changes the individual share**, not the total: a solo player carries the full transfer,
   a member of a team of four a quarter.
5. **Averaging, not summing**, so a bigger team is not "stronger" on paper just because it is bigger.
6. **Server-authoritative.** The server always recalculates from its own history; ratings sent by a
   client are never used.
7. **No rounding** anywhere (doubles with full precision), **no floors or ceilings** (ratings may in
   theory go below 0; the simulation never saw that).
8. **Deterministic.** Team means are summed in ascending order, so the roster order cannot change a single
   bit; the algorithm version (`pharmaelo-v1`) is stored with every calculation.

Cup counts are recorded but are **not** an input of the formula (v1).

### Why D = 100 instead of 400

Chess uses D = 400 for ratings around 1500. PharmaPong ratings start at 100 and are expected to span tens,
not hundreds, of points, so the same rating difference should mean more:

| Rating difference | Win probability (D = 100) | Win probability (D = 400, chess) |
| ----------------: | ------------------------: | -------------------------------: |
|                 0 |                     50.0% |                            50.0% |
|                10 |                     55.7% |                            51.4% |
|                25 |                     64.0% |                            53.6% |
|                50 |                     76.0% |                            57.2% |
|               100 |                     90.9% |                            64.0% |
|               200 |                     99.0% |                            76.0% |

## 2. Worked examples (spec §3.6, all are unit tests)

**A: equal 2v2.** All four players at 100, A wins. E_A = 0.5, Δ_A = 24 · 0.5 = **+12**: A1 and A2 **+6**,
B1 and B2 **−6**.

**B: equal 1v4.** One player at 100 against four at 100. If the solo player wins: **+12**, each loser **−3**.
If the four win: solo **−12**, each winner **+3**. Sum 0 in both cases.

**C: upset 2v2.** Team A averages 80 (e.g. 70 and 90), team B 120 (110 and 130).
E_A = 1 / (1 + 10^(40/100)) = **0.2847**. A wins: Δ_A = 24 · (1 − 0.2847) = **+17.17**, each A player
**+8.58**, each B player **−8.58**. Had the favourites won, they would have gained only +3.42 each.

**D: uneven 2v3.** A = 112 and 96 (mean 104), B = 104, 101 and 88 (mean 97.67). E_A = 0.5364.

| Outcome | Each A player | Each B player | Check                       |
| ------- | ------------: | ------------: | --------------------------- |
| A wins  |         +5.56 |         −3.71 | 2 · 5.56 = 3 · 3.71 = 11.13 |
| B wins  |         −6.44 |         +4.29 | 2 · 6.44 = 3 · 4.29 = 12.87 |

**Repeat multiplier.** The third meeting of identical rosters counts 50%: example A becomes +3 / −3.

**Per-player swing at even odds** (equal team ratings): 12 / n for a team of n, i.e. 12, 6, 4 and 3 points.

## 3. Standard Elo vs. PharmaPong heuristics

| Element                                  | Source                                                           |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Logistic expected score, zero-sum update | standard Elo (Elo 1978)                                          |
| D = 100                                  | PharmaPong choice (chess: 400)                                   |
| K = 24                                   | PharmaPong choice (chess federations use roughly 10–40)          |
| Team rating = mean of members            | PharmaPong heuristic (common simplification)                     |
| Equal split of the transfer              | PharmaPong heuristic                                             |
| Repeat-match multipliers [1, 1, 0.5, 0]  | PharmaPong house rule (anti-farming)                             |
| Provisional below 3 rated games          | PharmaPong house rule, inspired by provisional ratings elsewhere |
| Session-scoped ratings (start at 100)    | PharmaPong house rule: every event is independent                |

## 4. Repeat-match safeguard (spec §7.5)

- **Pairing key.** Both sides as sorted id lists, the two lists sorted again: player order and swapping
  A/B give the same key; moving one player to the other side gives a different pairing.
- **Counting.** For a match at confirmation sequence s, the prior count is the number of earlier-sequence
  **COMPLETED, rated** matches with the same key. Multiplier = `repeatMultipliers[min(count, len − 1)]`.
- **What counts.** Friendlies, pending, disputed, cancelled and voided matches do **not** count. A rated match
  at multiplier 0 **does** count as an occurrence (so the fifth meeting is also unrated).
- **Corrections.** A roster or rated-flag correction changes the keys; the full replay recounts everything
  after it. Voiding a match removes it from the count.
- **Effect.** The multiplier scales the total transfer before it is split, so ratings stay zero-sum.
- **Disabling.** Set the multipliers to `[1]`.
- **Display.** Before a match, the builder shows the multiplier that the confirmed history implies right now
  (pending results can still change it); the confirmation persists the applied multiplier.

A match at multiplier 0 is shown as "nicht gewertet (Wiederholung)": it moves nobody and is not a rated game.

## 5. Friendly matches

Friendlies occupy a table, use the stopwatch and appear in the history and in "Most Active", but are never
rated and never count as repeat occurrences. Only an admin can change whether a completed match was rated,
through an audited correction that replays the session.

## 6. Confirmation order and deterministic replay (spec §3.8)

- **Sequence.** When a match becomes COMPLETED for the first time it receives the next **confirmation
  sequence** number of the session (under the tournament row lock). A resolved dispute is numbered when it
  is resolved. Corrections and voids never renumber. Timestamps are never used for ordering.
- **Why a replay.** Every later match depended on the ratings that a corrected result produced. Reversing
  only the corrected match is wrong: in the simulation the error of such a naive fix is about 11 points on
  average. PharmaPong therefore replays the whole session (a few hundred matches at most, milliseconds).
- **One code path.** The ratings are a pure fold (`replaySession`) over the COMPLETED matches in sequence
  order, starting from the run's initial rating:
  - a normal confirmation replays history plus the new match and persists only the new step. A resolved
    dispute is confirmed the same way: it receives the next sequence number at resolution, so appending
    it is exactly what a full replay would compute;
  - a correction (winner, roster, cups, rated flag, void, parameter change, manual recalculation) writes an
    immutable result revision, replays everything into a **new calculation run**, rebuilds the projection
    and supersedes the old run. Old runs and their change rows remain as audit history.
- **Atomic and serialized.** Everything happens in one database transaction holding the event's row lock, so
  a replay can never interleave with a confirmation.
- **Reproducible.** Replay starts from the run parameters and never reads stored floats back as inputs;
  replaying twice yields a bit-identical `projectionDigest`. Across JavaScript runtimes the last bit of
  `10 ** x` may differ, so the admin "Prüfen" dry run compares with a tolerance of 1e-9 and reports the
  largest deviation.
- **Parameters.** K, D, the initial rating and the multipliers belong to a run. Changing them after rated
  matches exist requires the explicit, audited recalculation procedure (typed confirmation).

## 7. Leaderboard and champion

- **Ranking** by full-precision rating; exactly equal ratings share a rank (1, 2, 2, 4).
- **Display.** Integers; one decimal when neighbours would otherwise look equal; changes with one decimal.
- **Rated games** count only effective-rated matches (rated, multiplier > 0); wins + losses = games.
- **Provisional.** Fewer than `minGamesForChampion` (default 3) rated games: shown, rated, but not eligible.
- **Champion.** The eligible player(s) with the highest full-precision rating. An exact numerical tie (e.g. two
  teammates who played every game together) produces **co-champions**; nothing is decided arbitrarily.

## 8. Achievements (never affect Elo)

| Achievement   | Definition                                                                                                      | Tie-break                        |
| ------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Most Active   | most COMPLETED matches (friendlies and unrated repeats included)                                                | reached the count first, then id |
| Biggest Upset | win with the lowest predicted probability (< 50%) among effective-rated matches; held by the whole winning side | earlier match                    |
| Best Comeback | largest rise r_j − min(r₀ … r_{j−1}) of one player, only if that minimum was below the start rating             | earlier sequence, then id        |

## 9. Assumptions and limitations (spec §3.9)

- Team strength is approximated by the **average** player rating.
- Each team gets the **same number of throws** per turn (two, regardless of size: house rule).
- Team members **share** the rating change equally.
- **Uncertainty is not modelled** (no rating deviation as in Glicko, no σ as in TrueSkill).
- Built for **one recreational social evening**: few games per player, so the leaderboard is noisy.
- **Solo play is high variance:** a solo player carries the full transfer, and a strong player alone is
  not averaged down. The simulation shows that solo-loving players win the champion title clearly more
  often than their share; see [rating-validation.md](rating-validation.md) for numbers and options.

## 10. Extension point and background

`interface RatingEngine { version; calculate(input: RatingInput): RatingResult }` (`engine.ts`) is the
seam for future algorithms; replay and preview accept any engine. **Not implemented in this release**:

- **Glicko / Glicko-2** add a rating deviation (and volatility) per player, so new or rarely seen players move
  faster and the leaderboard can show uncertainty. Glickman, M. E. (1999), _Parameter estimation in large
  dynamic paired comparison experiments_, Applied Statistics 48(3); Glickman (2001), _Dynamic paired
  comparison models with stochastic variances_, Journal of Applied Statistics 28(6).
- **TrueSkill** is a Bayesian model for teams: a team's performance is the sum of noisy player performances,
  updates are distributed by each player's uncertainty, and a conservative estimate (μ − 3σ) can rank
  players. Herbrich, Minka & Graepel (2007), _TrueSkill™: A Bayesian Skill Rating System_, NeurIPS 19;
  Minka, Cleven & Zaykov (2018), _TrueSkill 2_, Microsoft Research MSR-TR-2018-8.
- **Bayesian team-rating approaches** in general (e.g. Bradley–Terry models with team effects; Bradley &
  Terry 1952, Biometrika 39) estimate all strengths jointly from the whole match history instead of
  updating sequentially.
- **Elo** itself: Elo, A. E. (1978), _The Rating of Chessplayers, Past and Present_, Arco.

The distinction matters: the expected-score formula is established research; the team mean, the equal
split, D = 100, K = 24 and the repeat multipliers are PharmaPong heuristics chosen for simplicity and
transparency at a party, not results of calibration.
