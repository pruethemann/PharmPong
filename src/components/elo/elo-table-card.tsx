"use client";

import Link from "next/link";
import { ArrowRight, Ban, Coffee, Handshake, Hourglass, Plus } from "lucide-react";
import type { EloLiveMatch, EloLiveTable } from "@/lib/elo-live-types";
import { ClientOnly } from "@/components/live/client-only";
import { TableBadge } from "@/components/pp/table-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EloStatusPill, eloPillKey } from "./elo-status-pill";
import { EloTeamLine, VersusDivider } from "./elo-team";
import { Stopwatch } from "./stopwatch";

function draftHint(m: EloLiveMatch): string {
  if (m.consentA && m.consentB) return "Beide Teams sind bereit: gleich geht's los";
  if (!m.consentA && !m.consentB) return "Beide Teams müssen die Aufstellung bestätigen";
  return `Wartet auf die Zustimmung von Team ${m.consentA ? "B" : "A"}`;
}

/** Arena card for one table: free (with a "play here" CTA), lining up, or running with its stopwatch. */
export function EloTableCard({
  table,
  match,
  clockOffsetMs,
  reminderMinutes,
  canCreate,
}: {
  table: EloLiveTable;
  match: EloLiveMatch | null;
  clockOffsetMs: number;
  reminderMinutes: number | null;
  /** The viewer may start a match here right now (signed in, session open, not playing). */
  canCreate: boolean;
}) {
  if (!match) {
    const disabled = table.state === "DISABLED";
    return (
      <div className="bg-card/60 flex flex-col gap-3 rounded-2xl border border-dashed p-4">
        <div className="flex items-center justify-between gap-2">
          <TableBadge number={table.number} muted={disabled} size="lg" />
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm font-semibold">
            {disabled ? (
              <Ban className="size-4" aria-hidden="true" />
            ) : (
              <Coffee className="size-4" aria-hidden="true" />
            )}
            {disabled ? "Gesperrt" : "Frei"}
          </span>
        </div>
        {disabled ? (
          <p className="text-muted-foreground">Dieser Tisch ist vorübergehend nicht in Betrieb.</p>
        ) : canCreate ? (
          <Link
            href={`/elo/play?table=${table.number}`}
            className={cn(buttonVariants({ size: "lg", variant: "outline" }), "w-full")}
          >
            <Plus aria-hidden="true" /> Hier ein Match starten
          </Link>
        ) : (
          <p className="text-muted-foreground">Der Tisch ist frei. Wer spielt als Nächstes?</p>
        )}
      </div>
    );
  }

  const status = eloPillKey(match);
  const running = match.status === "IN_PROGRESS";
  return (
    <Link
      href={`/elo/matches/${match.id}`}
      // No aria-label: the name comes from the visible content (axe label-content-name-mismatch).
      className="group block rounded-2xl focus-visible:outline-offset-4"
    >
      <article
        className={cn(
          "bg-card group-hover:border-primary/60 flex h-full flex-col gap-3 rounded-2xl border p-4 transition-colors",
          status === "IN_PROGRESS" && "border-status-live/70 shadow-[0_0_0_1px_var(--live)]",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TableBadge number={table.number} size="lg" />
          <div className="flex flex-wrap items-center gap-2">
            {!match.rated && (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-semibold">
                <Handshake className="size-3.5" aria-hidden="true" /> Freundschaftsspiel
              </span>
            )}
            <EloStatusPill status={status} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <EloTeamLine side="A" players={match.sideA} />
          <VersusDivider />
          <EloTeamLine side="B" players={match.sideB} />
        </div>
        {running && match.timer ? (
          <ClientOnly fallback={<div className="h-12" aria-hidden="true" />}>
            <Stopwatch
              timer={match.timer}
              clockOffsetMs={clockOffsetMs}
              reminderMinutes={reminderMinutes}
              size="md"
              className="py-1"
            />
          </ClientOnly>
        ) : match.status === "DRAFT" ? (
          <p className="text-status-assigned flex items-center gap-2 text-sm font-semibold">
            <Hourglass className="size-4 shrink-0" aria-hidden="true" />
            {draftHint(match)}
          </p>
        ) : null}
        <span className="text-primary mt-auto inline-flex items-center gap-1 text-sm font-semibold">
          Zum Match{" "}
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </article>
    </Link>
  );
}
