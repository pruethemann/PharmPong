"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause } from "lucide-react";
import {
  ANNOUNCEMENT_DURATION_MS,
  dismissAnnouncement,
  initAnnouncements,
  receiveEvents,
  type AnnouncementState,
} from "@/lib/announcements";
import {
  advanceRotation,
  displayPanelLabel,
  displayPanels,
  initRotation,
  rotationProgress,
  type DisplayPanel,
  type RotationState,
} from "@/lib/display-rotation";
import type { LiveMatch, PublicSnapshot } from "@/lib/live-types";
import { useLive } from "@/lib/use-live";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { LogoMark } from "@/components/pp/logo";
import { indexSnapshot, tableMatch, teamOf, zurichTime, zurichYear } from "@/components/live/live-view";
import { PhaseChip } from "@/components/live/tournament-status";
import { cn } from "@/lib/utils";
import { AnnouncementOverlay } from "./announcement-overlay";
import { ChampionTakeover } from "./champion-takeover";
import { RotatingPanel } from "./rotating-panel";
import { TablePanel } from "./table-panel";
import { useNow } from "./use-now";

/** 1em ≈ 1 % of the screen width, capped by the height for non-16:9 screens. */
const ROOT_FONT = "min(1vw, 1.7778vh)";

function Clock({ offsetMs }: { offsetMs: number }) {
  const now = useNow();
  return (
    <span className="font-display tabular text-[2.6em] leading-none" aria-label="Uhrzeit">
      {now == null ? "--:--" : zurichTime(now + offsetMs)}
    </span>
  );
}

function useRotation(panels: string, list: Parameters<typeof advanceRotation>[2], paused: boolean) {
  const [rot, setRot] = useState<RotationState>(() => initRotation(list, Date.now()));
  useEffect(() => {
    const tick = () => setRot((s) => advanceRotation(s, Date.now(), list, { paused }));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
    // `panels` is the stable key of `list`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, paused]);
  return rot;
}

function useAnnouncements(data: PublicSnapshot, initial: PublicSnapshot) {
  const [state, setState] = useState<AnnouncementState & { rev: number }>(() => ({
    ...initAnnouncements(initial.recentEvents),
    rev: initial.revision,
  }));
  // Derive from the new snapshot during render (no effect round-trip).
  if (data.revision !== state.rev) {
    setState({ ...receiveEvents(state, data.recentEvents, data), rev: data.revision });
  }
  const head = state.queue[0] ?? null;
  useEffect(() => {
    if (!head) return;
    const id = setTimeout(
      () => setState((s) => ({ ...dismissAnnouncement(s, head.id), rev: s.rev })),
      ANNOUNCEMENT_DURATION_MS,
    );
    return () => clearTimeout(id);
  }, [head]);
  return head;
}

const SHARING_CHECK_MS = 20_000;

/**
 * Public sharing can be switched off while a projector is running: the live endpoint then
 * answers 404 and useLive just reports "offline". Probe the endpoint (cheap with `since`)
 * and re-render the server page on 404, which shows the "Anzeige ist deaktiviert" screen.
 */
function useSharingWatch(revision: number) {
  const router = useRouter();
  const rev = useRef(revision);
  useEffect(() => {
    rev.current = revision;
  }, [revision]);
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/live/public?since=${rev.current}`, { cache: "no-store" });
        if (!stopped && res.status === 404) router.refresh();
      } catch {
        // Network down: useLive already shows the connection state.
      }
    };
    const id = setInterval(check, SHARING_CHECK_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [router]);
}

/**
 * `pinnedPanel` (from ?panel=…) keeps one secondary panel on screen without rotating,
 * e.g. a second screen that should always show the bracket.
 */
export function DisplayScreen({
  initial,
  pinnedPanel = null,
}: {
  initial: PublicSnapshot;
  pinnedPanel?: DisplayPanel | null;
}) {
  const {
    data: live,
    connection,
    clockOffsetMs,
  } = useLive<PublicSnapshot>({
    endpoint: "/api/live/public",
    initial,
  });
  const data = live ?? initial;
  useSharingWatch(data.revision);
  const idx = useMemo(() => indexSnapshot(data), [data]);
  const t = data.tournament;

  const panels = displayPanels({
    status: t.status,
    groupCount: data.groups.length,
    knockoutMatchCount: data.matches.filter((m) => m.stage === "KNOCKOUT").length,
    upNextCount: data.upNext.length,
    teamCount: data.teams.length,
  });
  const rotating = useRotation(panels.join(","), panels, t.isPaused);
  const rot: RotationState =
    pinnedPanel && panels.includes(pinnedPanel) ? { panel: pinnedPanel, since: rotating.since } : rotating;
  const now = useNow();
  const progress = now == null ? 0 : rotationProgress(rot, now);
  const announcement = useAnnouncements(data, initial);

  const champion = t.status === "COMPLETED" ? teamOf(idx, t.championTeamId) : null;
  const final = data.matches.find((m) => m.code === "F") ?? null;
  const opponent =
    champion && final
      ? teamOf(idx, final.homeTeamId === champion.id ? final.awayTeamId : final.homeTeamId)
      : null;

  const tables = [...data.tables].sort((a, b) => a.number - b.number).slice(0, 2);
  const queue = data.upNext
    .map((id) => idx.matchById.get(id))
    .filter((m): m is LiveMatch => !!m && m.status === "READY");
  let q = 0;
  const started = data.matches.length > 0;
  // The bracket needs the full height: tables move into a left column (still full-size type).
  const side = rot.panel === "bracket";

  return (
    <div
      className="bg-background relative flex h-dvh w-full flex-col gap-[1em] overflow-hidden p-[1.2em]"
      style={{ fontSize: ROOT_FONT }}
    >
      <header className="flex items-center justify-between gap-[2em]">
        <div className="flex min-w-0 items-center gap-[1.2em]">
          <LogoMark title="" className="size-[3.6em]" />
          <span className="font-display text-[2.8em] leading-none whitespace-nowrap">
            Pharma<span className="text-primary">Pong</span>
          </span>
          {t.name !== "PharmaPong" && (
            <span className="text-muted-foreground truncate text-[1.8em]">{t.name}</span>
          )}
        </div>
        <div className="flex items-center gap-[1.6em]">
          {t.isPaused && (
            <span className="bg-warning text-warning-foreground font-display inline-flex items-center gap-[0.4em] rounded-full px-[0.8em] py-[0.3em] text-[1.6em]">
              <Pause className="size-[1em]" aria-hidden="true" /> Pausiert
            </span>
          )}
          <PhaseChip status={t.status} size="display" className="text-[1.6em]" />
          <Clock offsetMs={clockOffsetMs} />
          <ConnectionBadge state={connection} className="text-[1.1em] [&_svg]:size-[1.2em]" />
        </div>
      </header>

      <main
        className={cn(
          "relative min-h-0 flex-1 gap-[1em]",
          side ? "grid grid-cols-[36em_minmax(0,1fr)]" : "flex flex-col",
        )}
      >
        <section
          aria-label="Tische"
          className={cn("grid gap-[1em]", side ? "min-h-0 grid-rows-2" : "h-[32em] shrink-0 grid-cols-2")}
        >
          {tables.map((tb) => {
            const m = tableMatch(idx, tb);
            const next = !m && tb.state !== "DISABLED" ? (queue[q++] ?? null) : null;
            return (
              <TablePanel
                key={tb.id}
                table={tb}
                match={m}
                next={next}
                idx={idx}
                clockOffsetMs={clockOffsetMs}
                compact={side}
                started={started}
              />
            );
          })}
        </section>

        <section
          aria-label={displayPanelLabel[rot.panel]}
          className="relative flex min-h-0 flex-1 flex-col gap-[0.6em]"
        >
          <div className="flex items-center justify-between gap-[1em]">
            <h2 className="text-[2em] leading-none">{displayPanelLabel[rot.panel]}</h2>
            {panels.length > 1 && !pinnedPanel && (
              <div className="flex items-center gap-[0.6em]" aria-hidden="true">
                {panels.map((p) => (
                  <span
                    key={p}
                    className={cn(
                      "relative h-[0.5em] overflow-hidden rounded-full",
                      p === rot.panel ? "bg-muted w-[4em]" : "bg-muted w-[1.2em]",
                    )}
                  >
                    {p === rot.panel && !t.isPaused && (
                      <span
                        className="bg-primary absolute inset-y-0 left-0"
                        style={{ width: `${progress * 100}%` }}
                      />
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <RotatingPanel panel={rot.panel} data={data} idx={idx} />
          </div>
          {/* Announcements cover the rotating panel only, never the table panels. */}
          <AnnouncementOverlay announcement={champion ? null : announcement} />
          {t.isPaused && (
            <div
              role="status"
              className="bg-background/85 border-warning absolute inset-0 z-20 flex items-center justify-center gap-[1.5em] rounded-[1.2em] border-[0.2em] backdrop-blur-sm"
            >
              <span className="bg-warning text-warning-foreground flex size-[5em] items-center justify-center rounded-[1.2em]">
                <Pause className="size-[3em]" aria-hidden="true" />
              </span>
              <div>
                <p className="font-display text-warning text-[4em] leading-none">Turnier pausiert</p>
                <p className="text-foreground/85 text-[1.8em]">Kurze Pause. Gleich geht&apos;s weiter!</p>
              </div>
            </div>
          )}
        </section>
      </main>

      {champion && (
        <ChampionTakeover
          team={champion}
          final={final}
          opponent={opponent}
          year={zurichYear(data.serverNow)}
        />
      )}
    </div>
  );
}
