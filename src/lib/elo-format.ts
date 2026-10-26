// Pure display helpers for Elo Mode (client and server). Ratings keep full precision everywhere;
// only what is shown is rounded.

/** Friendly label of a temporary team from its players' names. */
export function teamLabel(names: readonly string[]): string {
  if (names.length === 0) return "–";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** First names only (for compact labels): "Anna M." → "Anna". */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

export const formatRating = (rating: number): string => String(Math.round(rating));

/** Signed change with one decimal and a real minus sign: "+8.6", "−3.0", "±0.0". */
export function formatDelta(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return "±0.0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}`;
}

/** Whole percent with a no-break space (Swiss typography): "28 %". */
export const formatPercent = (p: number): string => `${Math.round(p * 100)} %`;

/**
 * Labels for ratings listed in rank order: integers, but one decimal for neighbours whose rounded
 * values would look equal while the full-precision ratings differ (the ranking uses full precision).
 */
export function ratingLabels(ratings: readonly number[]): string[] {
  const rounded = ratings.map((r) => Math.round(r));
  return ratings.map((r, i) => {
    const clash = [i - 1, i + 1].some(
      (j) => j >= 0 && j < ratings.length && rounded[j] === rounded[i] && ratings[j] !== r,
    );
    return clash ? r.toFixed(1) : String(rounded[i]);
  });
}

/** Stable tone 1–5 for a user's initials avatar (maps to the --chart-N colour tokens). */
export function avatarTone(userId: string): 1 | 2 | 3 | 4 | 5 {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return ((h % 5) + 1) as 1 | 2 | 3 | 4 | 5;
}

/** "3 Spiele" / "1 Spiel". */
export const gamesLabel = (n: number): string => `${n} ${n === 1 ? "Spiel" : "Spiele"}`;

const zurichTime = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  hour: "2-digit",
  minute: "2-digit",
});

/** "14:32" in Europe/Zurich (identical on server and client, so safe to hydrate). */
export const clockTime = (ms: number): string => zurichTime.format(new Date(ms));
