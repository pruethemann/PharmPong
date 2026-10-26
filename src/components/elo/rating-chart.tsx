import { formatRating } from "@/lib/elo-format";

type Point = { label: string; rating: number };

const W = 360;
const H = 170;
const PAD = { top: 14, right: 40, bottom: 22, left: 34 };

/** "Von 100 auf 112 in 5 gewerteten Matches; Höchstwert 118, Tiefstwert 96." */
export function trendSummary(points: readonly Point[]): string {
  const first = points[0];
  const last = points[points.length - 1];
  const ratings = points.map((p) => p.rating);
  const games = points.length - 1;
  return (
    `Von ${formatRating(first.rating)} auf ${formatRating(last.rating)} Elo in ${games} ` +
    `${games === 1 ? "gewertetem Match" : "gewerteten Matches"}; Höchstwert ${formatRating(Math.max(...ratings))}, ` +
    `Tiefstwert ${formatRating(Math.min(...ratings))}.`
  );
}

/**
 * Rating progression as a hand-drawn SVG line chart (no chart library), with a dashed start-rating
 * baseline. Accessible: role="img" with a text summary, plus the values as a table on request.
 */
export function RatingChart({ points, initialRating }: { points: readonly Point[]; initialRating: number }) {
  const ratings = points.map((p) => p.rating);
  const lo = Math.min(initialRating, ...ratings);
  const hi = Math.max(initialRating, ...ratings);
  const span = Math.max(hi - lo, 10);
  const yMin = lo - span * 0.12;
  const yMax = hi + span * 0.12;
  const x = (i: number) => PAD.left + (i / Math.max(points.length - 1, 1)) * (W - PAD.left - PAD.right);
  const y = (r: number) => PAD.top + (1 - (r - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1];
  const summary = trendSummary(points);
  const up = last.rating >= initialRating;
  // Axis labels for the extremes only when they do not collide with the start label.
  const apart = (r: number) => Math.abs(y(r) - y(initialRating)) >= 12;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby="rating-chart-title rating-chart-desc"
        className="h-auto w-full max-w-xl"
      >
        <title id="rating-chart-title">Elo-Verlauf</title>
        <desc id="rating-chart-desc">{summary}</desc>
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(initialRating)}
          y2={y(initialRating)}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        <text
          x={PAD.left - 6}
          y={y(initialRating) + 3.5}
          textAnchor="end"
          fontSize={10}
          fill="var(--muted-foreground)"
        >
          {formatRating(initialRating)}
        </text>
        <text x={PAD.left - 6} y={y(hi) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
          {apart(hi) ? formatRating(hi) : ""}
        </text>
        <text x={PAD.left - 6} y={y(lo) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
          {apart(lo) ? formatRating(lo) : ""}
        </text>
        <path
          d={path}
          fill="none"
          stroke={up ? "var(--primary)" : "var(--team-away)"}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.rating)}
            r={i === points.length - 1 ? 4.5 : 2.5}
            fill={i === points.length - 1 ? (up ? "var(--primary)" : "var(--team-away)") : "var(--card)"}
            stroke={up ? "var(--primary)" : "var(--team-away)"}
            strokeWidth={1.5}
          />
        ))}
        <text
          x={x(points.length - 1) + 7}
          y={y(last.rating) + 4}
          fontSize={12}
          fontWeight={700}
          fill="var(--foreground)"
        >
          {formatRating(last.rating)}
        </text>
        <text x={PAD.left} y={H - 6} fontSize={10} fill="var(--muted-foreground)">
          Start
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
          Match {points.length - 1}
        </text>
      </svg>
      <figcaption className="text-muted-foreground text-sm">{summary}</figcaption>
      <details className="text-sm">
        <summary className="text-primary min-h-10 cursor-pointer font-semibold">Werte als Tabelle</summary>
        <table className="mt-2 w-full max-w-sm text-left">
          <caption className="sr-only">Elo nach jedem gewerteten Match</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 font-semibold">
                Zeitpunkt
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                Elo
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p, i) => (
              <tr key={i} className="border-t">
                <td className="py-1">{p.label}</td>
                <td className="tabular py-1 text-right">{p.rating.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
