import {
  Ban,
  ClipboardList,
  FlaskConical,
  Lock,
  Pause,
  Swords,
  Trophy,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { tournamentStatusLabel, type TournamentStatusKey } from "@/lib/i18n/de";
import type { LiveTeam } from "@/lib/live-types";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { cn } from "@/lib/utils";

const phase: Record<TournamentStatusKey, { icon: LucideIcon; className: string }> = {
  DRAFT: { icon: FlaskConical, className: "border-status-pending/70 text-muted-foreground" },
  REGISTRATION_OPEN: { icon: UsersRound, className: "border-primary/70 bg-primary/10 text-primary" },
  REGISTRATION_LOCKED: {
    icon: Lock,
    className: "border-status-assigned/70 bg-status-assigned/10 text-status-assigned",
  },
  GROUP_STAGE: { icon: ClipboardList, className: "border-live/70 bg-live/10 text-live" },
  KNOCKOUT_STAGE: { icon: Swords, className: "border-team-away/70 bg-team-away/10 text-team-away" },
  COMPLETED: { icon: Trophy, className: "border-gold/70 bg-gold/10 text-gold" },
  CANCELLED: { icon: Ban, className: "border-destructive/70 bg-destructive/10 text-destructive" },
};

/** Big phase chip: icon + German label + colour. */
export function PhaseChip({
  status,
  size = "lg",
  className,
}: {
  status: TournamentStatusKey;
  size?: "md" | "lg" | "display";
  className?: string;
}) {
  const { icon: Icon, className: tone } = phase[status];
  return (
    <span
      className={cn(
        "font-display inline-flex items-center gap-2 rounded-full border-2 leading-none whitespace-nowrap",
        size === "md" && "px-3 py-1.5 text-base",
        size === "lg" && "px-4 py-2 text-xl sm:text-2xl",
        size === "display" && "gap-[0.4em] px-[0.8em] py-[0.35em] text-[clamp(1.25rem,1.6vw,3.5rem)]",
        tone,
        className,
      )}
    >
      <Icon className="size-[1em]" aria-hidden="true" />
      {tournamentStatusLabel[status]}
    </span>
  );
}

export function PauseBanner({ className }: { className?: string }) {
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
        <p className="font-display text-xl leading-tight">Turnier pausiert</p>
        <p className="text-foreground/85 text-sm">
          Die Turnierleitung hat eine Pause eingelegt. Gleich geht&apos;s weiter.
        </p>
      </div>
    </div>
  );
}

export function ChampionBanner({ team, className }: { team: LiveTeam; className?: string }) {
  return (
    <section
      aria-label="Turniersieger"
      className={cn(
        "border-gold/70 animate-glow relative isolate flex flex-col items-center gap-4 overflow-hidden rounded-3xl border-2 p-6 text-center sm:flex-row sm:text-left",
        "bg-[radial-gradient(30rem_14rem_at_50%_0%,color-mix(in_oklch,var(--gold)_22%,transparent),transparent_70%)]",
        className,
      )}
    >
      <div className="relative shrink-0">
        <TeamAvatar name={team.name} logoUrl={team.logoUrl} size="xl" className="ring-gold ring-4" />
        <span className="bg-gold text-gold-foreground absolute -right-3 -bottom-3 flex size-12 items-center justify-center rounded-2xl shadow-lg">
          <Trophy className="size-7" aria-hidden="true" />
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-display text-gold text-base tracking-widest">PharmaPong Champion</p>
        <p className="font-display text-4xl leading-none break-words sm:text-5xl">{team.name}</p>
        {team.motto && <p className="text-muted-foreground text-lg italic">«{team.motto}»</p>}
        {team.members.length > 0 && <p className="text-foreground/85 text-sm">{team.members.join(" & ")}</p>}
      </div>
    </section>
  );
}
