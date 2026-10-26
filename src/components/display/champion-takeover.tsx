"use client";

import { Trophy } from "lucide-react";
import type { LiveMatch, LiveTeam } from "@/lib/live-types";
import { TeamAvatar } from "@/components/pp/team-avatar";

// Bubble positions are fixed (no Math.random): stable server/client render.
const BUBBLES = [
  { left: 18, size: 1.2, delay: 0, dur: 3.2 },
  { left: 30, size: 0.8, delay: 0.7, dur: 2.6 },
  { left: 42, size: 1.6, delay: 1.3, dur: 3.6 },
  { left: 55, size: 1, delay: 0.3, dur: 2.9 },
  { left: 64, size: 1.4, delay: 1.9, dur: 3.3 },
  { left: 75, size: 0.9, delay: 1.1, dur: 2.7 },
  { left: 48, size: 0.7, delay: 2.4, dur: 2.4 },
  { left: 36, size: 1.1, delay: 2.9, dur: 3.1 },
];

/** Erlenmeyer flask with rising bubbles (hidden for reduced motion). */
export function BubblingFlask() {
  return (
    <div className="relative h-[16em] w-[13em]" aria-hidden="true">
      <div className="absolute inset-x-[2.5em] -top-[3em] bottom-[9em] overflow-visible motion-reduce:hidden">
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            className="bg-gold/70 animate-bubble absolute bottom-0 rounded-full"
            style={{
              left: `${b.left}%`,
              width: `${b.size}em`,
              height: `${b.size}em`,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.dur}s`,
            }}
          />
        ))}
      </div>
      <svg viewBox="0 0 64 80" className="absolute inset-x-0 bottom-0 h-[13em] w-full">
        <defs>
          <linearGradient id="pp-champ-liquid" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--gold)" />
            <stop offset="1" stopColor="var(--warning)" />
          </linearGradient>
        </defs>
        <path
          d="M24 4h16M27 4v24L10 66a7 7 0 0 0 6.3 10h31.4A7 7 0 0 0 54 66L37 28V4"
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M16.5 52h31l5.3 12.2A4.5 4.5 0 0 1 48.6 70H15.4a4.5 4.5 0 0 1-4.2-5.8Z"
          fill="url(#pp-champ-liquid)"
        />
      </svg>
    </div>
  );
}

/** Full-screen finale for the projector. */
export function ChampionTakeover({
  team,
  final,
  opponent,
  year,
}: {
  team: LiveTeam;
  final: LiveMatch | null;
  opponent: LiveTeam | null;
  year: string;
}) {
  const r = final?.result;
  const champHome = final?.homeTeamId === team.id;
  const score = r
    ? champHome
      ? `${r.homeCupsRemaining} : ${r.awayCupsRemaining}`
      : `${r.awayCupsRemaining} : ${r.homeCupsRemaining}`
    : null;
  return (
    <section
      aria-label="Turniersieger"
      className="animate-pop-in bg-background absolute inset-0 z-40 flex items-center justify-center overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(60em_35em_at_50%_40%,color-mix(in_oklch,var(--gold)_22%,transparent),transparent_70%)]"
      />
      <div className="relative flex items-center gap-[5em]">
        <BubblingFlask />
        <div className="flex max-w-[60em] flex-col items-center gap-[1.2em] text-center">
          <p className="font-display text-gold flex items-center gap-[0.4em] text-[3em] tracking-widest">
            <Trophy className="size-[1em]" aria-hidden="true" /> PharmaPong Champion {year}
          </p>
          <div className="animate-glow rounded-[2.2em]">
            <TeamAvatar
              name={team.name}
              logoUrl={team.logoUrl}
              className="ring-gold size-[2.6em] rounded-[0.35em] text-[5em] ring-[0.06em]"
            />
          </div>
          <h1 className="text-[7em] leading-[0.95] break-words">{team.name}</h1>
          {team.motto && <p className="text-foreground/85 text-[2.4em] italic">«{team.motto}»</p>}
          {team.members.length > 0 && (
            <p className="text-muted-foreground text-[2em]">{team.members.join(" & ")}</p>
          )}
          {score && opponent && (
            <p className="text-muted-foreground mt-[0.5em] text-[1.7em]">
              Final gegen <span className="text-foreground font-semibold">{opponent.name}</span> ·{" "}
              <span className="font-display tabular text-foreground">{score}</span> Becher übrig
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
