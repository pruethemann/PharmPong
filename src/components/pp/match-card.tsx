import Link from "next/link";
import { Trophy } from "lucide-react";
import type { MatchStatusKey } from "@/lib/i18n/de";
import { cn } from "@/lib/utils";
import { StatusPill } from "./status-pill";
import { TableBadge } from "./table-badge";
import { TeamAvatar } from "./team-avatar";

export type MatchCardTeam = { id: string; name: string; logoUrl?: string | null } | null;

export type MatchCardData = {
  id: string;
  code: string;
  label?: string;
  status: MatchStatusKey;
  home: MatchCardTeam;
  away: MatchCardTeam;
  homeSource?: string | null;
  awaySource?: string | null;
  tableNumber?: number | null;
  winnerTeamId?: string | null;
  homeCupsRemaining?: number | null;
  awayCupsRemaining?: number | null;
};

function sourceLabel(src?: string | null): string {
  if (!src) return "Noch offen";
  if (src.startsWith("W:")) return `Sieger ${src.slice(2)}`;
  return `${src.slice(1)}. Gruppe ${src[0]}`;
}

function TeamRow({
  team,
  source,
  side,
  cups,
  isWinner,
  decided,
}: {
  team: MatchCardTeam;
  source?: string | null;
  side: "home" | "away";
  cups?: number | null;
  isWinner: boolean;
  decided: boolean;
}) {
  return (
    <div className={cn("flex min-h-12 items-center gap-3", decided && !isWinner && "opacity-55")}>
      {team ? (
        <TeamAvatar name={team.name} logoUrl={team.logoUrl} side={side} size="sm" />
      ) : (
        <span
          className="border-border size-8 shrink-0 rounded-2xl border-2 border-dashed"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-base",
          team ? "font-semibold" : "text-muted-foreground italic",
        )}
      >
        {team ? team.name : sourceLabel(source)}
      </span>
      {isWinner && <Trophy className="text-gold size-4" aria-label="Sieger" />}
      {cups != null && (
        <span className="font-display tabular w-8 text-right text-xl" aria-label={`${cups} Becher übrig`}>
          {cups}
        </span>
      )}
    </div>
  );
}

export function MatchCard({
  match,
  href,
  className,
}: {
  match: MatchCardData;
  href?: string;
  className?: string;
}) {
  const decided = match.status === "COMPLETED" || match.status === "FORFEITED";
  const live = match.status === "IN_PROGRESS";
  const body = (
    <div
      className={cn(
        "bg-card flex flex-col gap-2 rounded-2xl border p-4 transition-colors",
        live && "border-status-live/70 shadow-[0_0_0_1px_var(--live)]",
        href && "hover:border-primary/60",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-muted-foreground text-sm tracking-widest">
          {match.label ?? match.code}
        </span>
        <div className="flex items-center gap-2">
          {match.tableNumber != null && <TableBadge number={match.tableNumber} size="sm" />}
          <StatusPill status={match.status} size="sm" />
        </div>
      </div>
      <TeamRow
        team={match.home}
        source={match.homeSource}
        side="home"
        cups={decided ? match.homeCupsRemaining : null}
        isWinner={decided && !!match.home && match.winnerTeamId === match.home.id}
        decided={decided}
      />
      <TeamRow
        team={match.away}
        source={match.awaySource}
        side="away"
        cups={decided ? match.awayCupsRemaining : null}
        isWinner={decided && !!match.away && match.winnerTeamId === match.away.id}
        decided={decided}
      />
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:outline-offset-4">
      {body}
    </Link>
  ) : (
    body
  );
}
