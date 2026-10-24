import type { LiveGroup, LiveMatch } from "@/lib/live-types";
import { MatchCard } from "@/components/pp/match-card";
import { byPlayOrder, isDecided, toCardData, type SnapshotIndex } from "@/components/live/live-view";
import { cn } from "@/lib/utils";
import { GroupStandings, GroupStatusLine } from "./group-standings";

/** One group: standings + its fixtures (with results). */
export function GroupCard({
  group,
  matches,
  idx,
  myTeamId,
  className,
}: {
  group: LiveGroup;
  matches: LiveMatch[];
  idx: SnapshotIndex;
  myTeamId?: string | null;
  className?: string;
}) {
  const fixtures = matches.filter((m) => m.stage === "GROUP" && m.group === group.name).sort(byPlayOrder);
  const played = fixtures.filter(isDecided).length;
  return (
    <section
      aria-labelledby={`gruppe-${group.name}`}
      className={cn("bg-card flex flex-col gap-4 rounded-2xl border p-4", className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`gruppe-${group.name}`} className="flex items-baseline gap-2 text-3xl leading-none">
          <span className="text-muted-foreground text-lg">Gruppe</span>
          <span className="text-primary">{group.name}</span>
        </h2>
        <GroupStatusLine group={group} />
      </header>
      <GroupStandings group={group} teamById={idx.teamById} myTeamId={myTeamId} />
      {fixtures.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-muted-foreground flex items-center justify-between text-base leading-none">
            <span>Spiele</span>
            <span className="tabular font-sans text-sm font-semibold tracking-normal normal-case">
              {played}/{fixtures.length} gespielt
            </span>
          </h3>
          <ul className="flex flex-col gap-2">
            {fixtures.map((m) => (
              <li key={m.id}>
                <MatchCard
                  match={toCardData(m, idx, `Runde ${m.round}`)}
                  href={`/matches/${m.id}`}
                  className="gap-1 p-3"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
