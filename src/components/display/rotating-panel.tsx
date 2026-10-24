"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { CircleCheck, Scale } from "lucide-react";
import { displayPanelLabel, type DisplayPanel } from "@/lib/display-rotation";
import type { LiveMatch, PublicSnapshot } from "@/lib/live-types";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { Bracket } from "@/components/bracket/bracket";
import { signed } from "@/components/standings/group-standings";
import { teamOf, type SnapshotIndex } from "@/components/live/live-view";
import { sourceLabel } from "@/lib/live-labels";
import { cn } from "@/lib/utils";

function GroupsPanel({ data, idx }: { data: PublicSnapshot; idx: SnapshotIndex }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-4 gap-[1em]">
      {data.groups.map((g) => (
        <section
          key={g.name}
          className="bg-card flex min-h-0 flex-col gap-[0.4em] rounded-[1em] border px-[1em] py-[0.8em]"
        >
          <div className="flex items-center justify-between gap-[0.5em]">
            <h3 className="text-[1.7em] leading-none">
              Gruppe <span className="text-primary">{g.name}</span>
            </h3>
            {g.unresolvedTie ? (
              <span className="text-warning inline-flex items-center gap-[0.3em] text-[1.05em] font-semibold">
                <Scale className="size-[1em]" aria-hidden="true" /> Shootout ausstehend
              </span>
            ) : g.complete ? (
              <span className="text-success inline-flex items-center gap-[0.3em] text-[1.05em] font-semibold">
                <CircleCheck className="size-[1em]" aria-hidden="true" /> Abgeschlossen
              </span>
            ) : null}
          </div>
          <div className="text-muted-foreground grid grid-cols-[1.8em_minmax(0,1fr)_2.2em_3em] gap-x-[0.6em] text-[1em] font-semibold tracking-wide uppercase">
            <span>#</span>
            <span>Team</span>
            <span className="text-right">Pkt</span>
            <span className="text-right">Diff</span>
          </div>
          {g.rows.map((r) => {
            const t = idx.teamById.get(r.teamId);
            const q = r.qualified && g.complete && !r.provisional;
            return (
              <div
                key={r.teamId}
                className="grid flex-1 grid-cols-[1.2em_minmax(0,1fr)_1.5em_2em] items-center gap-x-[0.4em] border-t border-dashed text-[1.4em]"
              >
                <span
                  className={cn(
                    "font-display tabular",
                    q ? "text-success" : r.qualified ? "" : "text-muted-foreground",
                  )}
                >
                  {r.rank ?? "–"}
                </span>
                <span className="flex min-w-0 items-center gap-[0.35em]">
                  <span className="truncate font-semibold">{t?.name ?? "?"}</span>
                  {q && (
                    <CircleCheck className="text-success size-[0.8em] shrink-0" aria-label="Qualifiziert" />
                  )}
                </span>
                <span className="font-display tabular text-right">{r.points}</span>
                <span
                  className={cn(
                    "tabular text-right text-[0.85em] font-semibold",
                    r.cupDiff > 0
                      ? "text-success"
                      : r.cupDiff < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  {signed(r.cupDiff)}
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function NextCard({ m, idx, n }: { m: LiveMatch; idx: SnapshotIndex; n: number }) {
  const home = teamOf(idx, m.homeTeamId);
  const away = teamOf(idx, m.awayTeamId);
  const row = (t: typeof home, source: string | null, side: "home" | "away") => (
    <div className="flex min-w-0 items-center gap-[0.5em]">
      {t ? (
        <TeamAvatar name={t.name} logoUrl={t.logoUrl} side={side} className="size-[2em] text-[1em]" />
      ) : (
        <span
          className="border-border size-[2em] shrink-0 rounded-[0.5em] border-2 border-dashed"
          aria-hidden="true"
        />
      )}
      <span
        className={cn("min-w-0 truncate text-[1.7em]", t ? "font-display" : "text-muted-foreground italic")}
      >
        {t?.name ?? sourceLabel(source)}
      </span>
    </div>
  );
  return (
    <article className="bg-card flex min-h-0 flex-col justify-between gap-[0.6em] rounded-[1em] border px-[1.1em] py-[0.9em]">
      <div className="flex items-center justify-between gap-[0.5em]">
        <span className="font-display text-primary text-[1.6em] leading-none">#{n}</span>
        <span className="font-display text-muted-foreground truncate text-[1.1em] tracking-widest">
          {m.label}
        </span>
      </div>
      {row(home, m.homeSource, "home")}
      {row(away, m.awaySource, "away")}
      <div className="flex items-center gap-[0.5em]">
        <StatusPill status={m.status} size="lg" className="px-[0.7em] py-[0.2em] text-[1.1em]" />
        {m.tableNumber != null && <TableBadge number={m.tableNumber} className="text-[1.1em]" />}
      </div>
    </article>
  );
}

function UpNextPanel({ data, idx }: { data: PublicSnapshot; idx: SnapshotIndex }) {
  const items = data.upNext.map((id) => idx.matchById.get(id)).filter((m): m is LiveMatch => !!m);
  return (
    <ol className="grid h-full min-h-0 grid-cols-4 gap-[1em]">
      {items.map((m, i) => (
        <li key={m.id} className="min-h-0">
          <NextCard m={m} idx={idx} n={i + 1} />
        </li>
      ))}
    </ol>
  );
}

function TeamsPanel({ data }: { data: PublicSnapshot }) {
  if (data.teams.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-[2em]">
        Noch keine Teams angemeldet. Jetzt registrieren!
      </div>
    );
  }
  return (
    <ul className="grid h-full min-h-0 auto-rows-fr grid-cols-6 gap-[0.8em]">
      {data.teams.slice(0, 18).map((t) => (
        <li
          key={t.id}
          className="bg-card flex min-h-0 items-center gap-[0.6em] rounded-[0.9em] border px-[0.8em]"
        >
          <TeamAvatar name={t.name} logoUrl={t.logoUrl} className="size-[2.2em] text-[1.2em]" />
          <span className="font-display line-clamp-2 min-w-0 text-[1.5em] leading-tight">{t.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Bracket scaled to fill its panel: the bracket is sized in `em`, so its natural size is
 * linear in the font size. Measure once, then set the font size that makes it fit.
 */
function FitBracket({ data, idx }: { data: PublicSnapshot; idx: SnapshotIndex }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState<number | null>(null);
  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    const fit = () => {
      const fs = parseFloat(getComputedStyle(i).fontSize) || 16;
      const w = i.offsetWidth / fs;
      const h = i.offsetHeight / fs;
      if (!w || !h) return;
      const next = Math.max(8, Math.floor(Math.min(b.clientWidth / w, b.clientHeight / h) * 0.98));
      setPx((p) => (p != null && Math.abs(p - next) < 1 ? p : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, [data.tournament.championTeamId]);
  return (
    <div ref={box} className="relative h-full w-full overflow-hidden">
      <div
        ref={inner}
        className={cn(
          "absolute top-1/2 left-1/2 w-max -translate-x-1/2 -translate-y-1/2",
          px == null && "invisible",
        )}
        style={{ fontSize: px ?? 16 }}
      >
        <Bracket
          matches={data.matches}
          teamById={idx.teamById}
          championTeamId={data.tournament.championTeamId}
          interactive={false}
          variant="display"
          showChampion={false}
          scale="1em"
          className="overflow-visible"
        />
      </div>
    </div>
  );
}

export function RotatingPanel({
  panel,
  data,
  idx,
}: {
  panel: DisplayPanel;
  data: PublicSnapshot;
  idx: SnapshotIndex;
}) {
  return (
    <div
      key={panel}
      className="animate-in fade-in h-full min-h-0 duration-500"
      aria-label={displayPanelLabel[panel]}
    >
      {panel === "groups" && <GroupsPanel data={data} idx={idx} />}
      {panel === "upNext" && <UpNextPanel data={data} idx={idx} />}
      {panel === "teams" && <TeamsPanel data={data} />}
      {panel === "bracket" && <FitBracket data={data} idx={idx} />}
    </div>
  );
}
