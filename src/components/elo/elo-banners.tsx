import { Pause, Trophy } from "lucide-react";
import { teamLabel } from "@/lib/elo-format";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";

export function EloPausedBanner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "border-warning/60 bg-warning/10 text-warning flex items-center gap-3 rounded-2xl border-2 p-4",
        className,
      )}
    >
      <span className="bg-warning text-warning-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
        <Pause className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-xl leading-tight">Elo-Runde pausiert</p>
        <p className="text-foreground/85 text-sm">
          Laufende Matches werden fertig gespielt. Neue Matches starten, sobald die Turnierleitung fortsetzt.
        </p>
      </div>
    </div>
  );
}

/** Session closed: the champion (co-champions on an exact tie). */
export function EloChampionBanner({
  champions,
  className,
}: {
  champions: readonly { userId: string; displayName: string }[];
  className?: string;
}) {
  if (champions.length === 0) return null;
  const co = champions.length > 1;
  return (
    <section
      aria-label={co ? "Elo-Champions" : "Elo-Champion"}
      className={cn(
        "border-gold/70 animate-glow relative isolate flex flex-col items-center gap-4 overflow-hidden rounded-3xl border-2 p-6 text-center sm:flex-row sm:text-left",
        "bg-[radial-gradient(30rem_14rem_at_50%_0%,color-mix(in_oklch,var(--gold)_22%,transparent),transparent_70%)]",
        className,
      )}
    >
      <div className="relative flex shrink-0 -space-x-4">
        {champions.map((c) => (
          <PlayerAvatar
            key={c.userId}
            userId={c.userId}
            name={c.displayName}
            size="xl"
            className="ring-gold ring-4"
          />
        ))}
        <span className="bg-gold text-gold-foreground absolute -right-3 -bottom-3 flex size-12 items-center justify-center rounded-2xl shadow-lg">
          <Trophy className="size-7" aria-hidden="true" />
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-display text-gold text-base tracking-widest">
          {co ? "Elo-Champions (punktgleich)" : "Elo-Champion"}
        </p>
        <p className="font-display text-4xl leading-none break-words sm:text-5xl">
          {teamLabel(champions.map((c) => c.displayName))}
        </p>
      </div>
    </section>
  );
}
