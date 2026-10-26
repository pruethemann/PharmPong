"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Ban, Loader2, Shuffle, Trophy } from "lucide-react";
import { cancelEloDraftsAction, setGameModeAction } from "@/server/actions/elo-admin";
import type { ModeBlocker } from "@/server/services/game-mode";
import { eloMatchStatusLabel } from "@/lib/i18n/de-elo";
import { matchStatusLabel, type MatchStatusKey } from "@/lib/i18n/de";
import type { EloMatchStatusKey } from "@/lib/elo-live-types";
import { AdminDialog } from "@/components/admin/admin-dialog";
import { ReasonField, reasonOk } from "@/components/admin/fields";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Mode = "COMPETITIVE" | "ELO";

function blockerLabel(b: ModeBlocker): string {
  if (b.kind === "ELO_MATCH") {
    return `Elo-Match an Tisch ${b.tableNumber}: ${eloMatchStatusLabel[b.status as EloMatchStatusKey] ?? b.status}`;
  }
  const status = matchStatusLabel[b.status as MatchStatusKey] ?? b.status;
  return `${b.code}${b.tableNumber != null ? ` an Tisch ${b.tableNumber}` : ""}: ${status}`;
}

function BlockerList({ blockers }: { blockers: ModeBlocker[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {blockers.map((b) => (
        <li key={b.matchId}>
          <Link
            href={b.kind === "ELO_MATCH" ? `/elo/matches/${b.matchId}` : `/admin/matches`}
            className="text-primary inline-flex min-h-10 items-center gap-1.5 font-semibold underline-offset-4 hover:underline"
          >
            {blockerLabel(b)} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Spielmodus": the event runs either the tournament or Elo Mode. Switching is refused while the
 * current mode has open matches (they are listed); data of the other mode is never touched.
 */
export function ModeCard({
  gameMode,
  blockers: initialBlockers,
  showManageLink = true,
}: {
  gameMode: Mode;
  blockers: ModeBlocker[];
  /** Off on /admin/elo itself. */
  showManageLink?: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useAdminAction(() => router.refresh());
  const [open, setOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<ModeBlocker[] | null>(null);
  const blockers = failed ?? initialBlockers;
  const target: Mode = gameMode === "ELO" ? "COMPETITIVE" : "ELO";
  const drafts = blockers.filter((b) => b.kind === "ELO_MATCH" && b.draft).length;
  const elo = gameMode === "ELO";

  return (
    <section
      aria-labelledby="mode-title"
      className={cn(
        "bg-card flex flex-col gap-3 rounded-2xl border-2 p-4",
        elo ? "border-accent/60" : "border-primary/40",
      )}
    >
      <h3 id="mode-title" className="flex items-center gap-2 text-xl leading-none">
        {elo ? (
          <Shuffle className="text-accent size-5" aria-hidden="true" />
        ) : (
          <Trophy className="text-primary size-5" aria-hidden="true" />
        )}
        Spielmodus: {elo ? "Elo-Modus" : "Turnier"}
      </h3>
      <p className="text-muted-foreground text-sm">
        {elo
          ? "Freies Spiel mit Elo-Rangliste. Die Turnierdaten bleiben unverändert."
          : "Gruppen, K.-o. und Schiri-Ablauf. Die Elo-Daten bleiben unverändert."}{" "}
        Alle Geräte folgen einem Wechsel innerhalb von etwa 10 Sekunden.
      </p>
      {blockers.length > 0 && (
        // Collapsed while the mode just runs; open after a refused switch.
        <details
          open={failed != null}
          className="border-warning/60 bg-warning/5 flex flex-col gap-2 rounded-xl border p-3"
        >
          <summary className="text-warning min-h-10 cursor-pointer text-sm font-semibold">
            {blockers.length === 1 ? "1 offenes Match" : `${blockers.length} offene Matches`} blockieren den
            Wechsel
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <BlockerList blockers={blockers} />
            {drafts > 0 && (
              <Button
                variant="outline"
                className="self-start"
                onClick={() => setDraftsOpen(true)}
                disabled={pending !== null}
              >
                <Ban aria-hidden="true" />{" "}
                {drafts === 1 ? "Offene Aufstellung" : `${drafts} offene Aufstellungen`} abbrechen
              </Button>
            )}
          </div>
        </details>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          size="lg"
          variant={target === "ELO" ? "accent" : "outline"}
          disabled={pending !== null}
          onClick={() => setOpen(true)}
        >
          {target === "ELO" ? <Shuffle aria-hidden="true" /> : <Trophy aria-hidden="true" />}
          {target === "ELO" ? "Zum Elo-Modus wechseln" : "Zurück zum Turnier"}
        </Button>
        {elo && showManageLink && (
          <Link
            href="/admin/elo"
            className="text-primary inline-flex min-h-12 items-center justify-center gap-1.5 font-semibold underline-offset-4 hover:underline"
          >
            Elo verwalten <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      <AdminDialog
        open={open}
        onOpenChange={setOpen}
        title={target === "ELO" ? "In den Elo-Modus wechseln?" : "Zurück zum Turnier wechseln?"}
        description={
          target === "ELO"
            ? "Die Tische werden für freie Elo-Matches frei. Beim ersten Wechsel startet eine Elo-Runde, alle mit 100 Elo."
            : "Die Elo-Rangliste bleibt erhalten und geht beim nächsten Wechsel weiter."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Zurück
            </Button>
            <Button
              variant={target === "ELO" ? "accent" : "default"}
              disabled={pending !== null}
              onClick={async () => {
                const res = await run("mode", () => setGameModeAction({ mode: target }), {
                  success: target === "ELO" ? "Elo-Modus aktiv." : "Turniermodus aktiv.",
                  onError: (f) => {
                    const list = (f.details?.blockers as ModeBlocker[] | undefined) ?? null;
                    if (list) {
                      // Close the dialog: the card now lists the blockers with their actions.
                      setFailed(list);
                      setOpen(false);
                    }
                  },
                });
                if (res?.ok) {
                  setFailed(null);
                  setOpen(false);
                }
              }}
            >
              {pending === "mode" && <Loader2 className="animate-spin" aria-hidden="true" />}
              Jetzt wechseln
            </Button>
          </>
        }
      ></AdminDialog>

      <AdminDialog
        open={draftsOpen}
        onOpenChange={setDraftsOpen}
        title="Offene Aufstellungen abbrechen?"
        description="Noch nicht gestartete Elo-Matches werden abgebrochen, Tische und Spieler:innen sind sofort frei."
        tone="destructive"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraftsOpen(false)}>
              Zurück
            </Button>
            <Button
              variant="destructive-solid"
              disabled={pending !== null || !reasonOk(reason)}
              onClick={async () => {
                const res = await run("drafts", () => cancelEloDraftsAction({ reason }), {
                  success: (d) => `${d.cancelled} Aufstellung(en) abgebrochen.`,
                });
                if (res?.ok) {
                  setFailed(null);
                  setDraftsOpen(false);
                  setReason("");
                }
              }}
            >
              Abbrechen bestätigen
            </Button>
          </>
        }
      >
        <ReasonField
          id="drafts-reason"
          value={reason}
          onChange={setReason}
          placeholder="z. B. Turnier geht weiter"
        />
      </AdminDialog>
    </section>
  );
}
