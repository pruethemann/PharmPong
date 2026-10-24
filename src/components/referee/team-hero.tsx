import { TeamAvatar } from "@/components/pp/team-avatar";
import type { LiveTeam } from "@/lib/live-types";
import { cn } from "@/lib/utils";

const SIDE = {
  home: { label: "Team A", text: "text-team-home", border: "border-team-home/60", bg: "bg-team-home/10" },
  away: { label: "Team B", text: "text-team-away", border: "border-team-away/60", bg: "bg-team-away/10" },
} as const;

export function sideLabel(side: "home" | "away"): string {
  return SIDE[side].label;
}

/** One team, very large: side label + avatar + name (+ members). */
export function TeamBlock({
  team,
  side,
  placeholder,
  size = "xl",
  showMembers = true,
}: {
  team: LiveTeam | null;
  side: "home" | "away";
  placeholder?: string;
  size?: "lg" | "xl";
  showMembers?: boolean;
}) {
  const s = SIDE[side];
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-3 rounded-2xl border-2 px-3 py-2.5 sm:flex-col sm:p-5 sm:text-center",
        s.border,
        s.bg,
        side === "away" && "flex-row-reverse text-right sm:flex-col",
      )}
    >
      <TeamAvatar
        name={team?.name ?? "?"}
        logoUrl={team?.logoUrl}
        side={side}
        size={size === "xl" ? "lg" : "md"}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn("font-display text-sm tracking-widest", s.text)}>{s.label}</span>
        <span
          className={cn(
            "font-display line-clamp-2 leading-[0.95] break-words",
            size === "xl" ? "text-[2.5rem] sm:text-5xl" : "text-3xl",
            !team && "text-muted-foreground italic",
          )}
        >
          {team?.name ?? placeholder ?? "Offen"}
        </span>
        {showMembers && team && team.members.length > 0 && (
          <span className="text-muted-foreground truncate text-sm">{team.members.join(" · ")}</span>
        )}
      </div>
    </div>
  );
}

/** Both teams: home cyan left/top, away magenta right/bottom. */
export function TeamHero({
  home,
  away,
  size = "xl",
  homePlaceholder,
  awayPlaceholder,
  showMembers,
}: {
  home: LiveTeam | null;
  away: LiveTeam | null;
  size?: "lg" | "xl";
  homePlaceholder?: string;
  awayPlaceholder?: string;
  showMembers?: boolean;
}) {
  return (
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
      <TeamBlock
        team={home}
        side="home"
        size={size}
        placeholder={homePlaceholder}
        showMembers={showMembers}
      />
      <span
        className="font-display text-muted-foreground self-center text-xl tracking-widest"
        aria-label="gegen"
      >
        vs
      </span>
      <TeamBlock
        team={away}
        side="away"
        size={size}
        placeholder={awayPlaceholder}
        showMembers={showMembers}
      />
    </div>
  );
}

/** Compact one-row "A vs B" for running matches: home left (cyan), away right (magenta). */
export function TeamVersus({ home, away }: { home: LiveTeam | null; away: LiveTeam | null }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <div className="border-team-home bg-team-home/10 flex min-w-0 flex-col rounded-xl border-l-4 px-3 py-2">
        <span className="font-display text-team-home text-xs tracking-widest">{SIDE.home.label}</span>
        <span className="font-display line-clamp-2 text-2xl leading-none break-words sm:text-3xl">
          {home?.name ?? "Offen"}
        </span>
      </div>
      <span className="font-display text-muted-foreground text-base" aria-label="gegen">
        vs
      </span>
      <div className="border-team-away bg-team-away/10 flex min-w-0 flex-col rounded-xl border-r-4 px-3 py-2 text-right">
        <span className="font-display text-team-away text-xs tracking-widest">{SIDE.away.label}</span>
        <span className="font-display line-clamp-2 text-2xl leading-none break-words sm:text-3xl">
          {away?.name ?? "Offen"}
        </span>
      </div>
    </div>
  );
}
