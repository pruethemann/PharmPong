"use client";

import { useState } from "react";
import { Ban, Check, CircleAlert, Info, Loader2, RotateCcw, Shuffle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminDialog } from "@/components/admin/admin-dialog";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import {
  knockoutBlockReasons,
  LIFECYCLE_STEPS,
  nextAction,
  stepIndex,
  type LifecycleInput,
  type NextActionKind,
} from "@/lib/admin-lifecycle";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import {
  generateDrawAction,
  lockRegistrationAction,
  openRegistrationAction,
  reopenRegistrationAction,
  startGroupStageAction,
  startKnockoutAction,
} from "@/server/actions/tournament";

type Runner = ReturnType<typeof useAdminAction>;

export function LifecycleStepper({ status }: { status: LifecycleInput["status"] }) {
  const current = stepIndex(status);
  if (status === "CANCELLED") {
    return (
      <div
        role="status"
        className="border-destructive/60 bg-destructive/10 text-destructive flex items-center gap-3 rounded-2xl border p-4 font-semibold"
      >
        <Ban className="size-5 shrink-0" aria-hidden="true" />
        Dieses Turnier wurde abgebrochen. Die Historie bleibt im Audit-Log.
      </div>
    );
  }
  return (
    <ol aria-label="Turnierphasen" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {LIFECYCLE_STEPS.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li
            key={s.status}
            aria-current={now ? "step" : undefined}
            className={cn(
              "flex min-h-14 items-center gap-3 rounded-2xl border px-3 py-2",
              now && "border-primary bg-primary/10 text-foreground shadow-[0_0_0_1px_var(--primary)]",
              done && "bg-card text-muted-foreground",
              !now && !done && "text-muted-foreground border-dashed",
            )}
          >
            <span
              className={cn(
                "font-display tabular flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-base",
                now && "border-primary bg-primary text-primary-foreground",
                done && "border-success text-success",
              )}
              aria-hidden="true"
            >
              {done ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn("leading-tight font-semibold", now && "text-primary")}>
              {s.label}
              {done && <span className="sr-only"> (erledigt)</span>}
              {now && <span className="sr-only"> (aktuell)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const ACTIONS: Record<Exclude<NextActionKind, "none">, () => Promise<ActionResult<unknown>>> = {
  openRegistration: () => openRegistrationAction(),
  lockRegistration: () => lockRegistrationAction(),
  generateDraw: () => generateDrawAction(),
  startGroupStage: () => startGroupStageAction(),
  startKnockout: () => startKnockoutAction(),
};

const SUCCESS: Record<Exclude<NextActionKind, "none">, string> = {
  openRegistration: "Anmeldung geöffnet.",
  lockRegistration: "Anmeldung gesperrt.",
  generateDraw: "Gruppen ausgelost.",
  startGroupStage: "Gruppenphase gestartet. Viel Spass!",
  startKnockout: "K.-o.-Phase gestartet.",
};

/** Exactly one primary next action, its preconditions and server block reasons. */
export function NextActionCard({
  input,
  runner,
  online,
}: {
  input: LifecycleInput;
  runner: Runner;
  online: boolean;
}) {
  const next = nextAction(input);
  const [confirm, setConfirm] = useState<null | "next" | "reopen" | "redraw">(null);
  const [blockReasons, setBlockReasons] = useState<string[]>([]);
  const canReopen = input.status === "REGISTRATION_LOCKED" && !input.drawExists;
  const canRedraw = input.status === "REGISTRATION_LOCKED" && input.drawExists;
  const disabled = !online || runner.pending !== null;

  async function runNext() {
    if (next.kind === "none") return;
    const res = await runner.run(next.kind, ACTIONS[next.kind], {
      success: SUCCESS[next.kind],
      onError: (f) => {
        const reasons = knockoutBlockReasons(f.code, f.details);
        setBlockReasons(reasons);
        return false;
      },
    });
    if (res?.ok) setBlockReasons([]);
    setConfirm(null);
  }

  return (
    <section
      aria-labelledby="next-title"
      className="bg-card border-primary/50 flex flex-col gap-4 rounded-2xl border p-5"
    >
      <div className="flex flex-col gap-1">
        <p className="font-display text-primary text-sm tracking-widest">Nächster Schritt</p>
        <h2 id="next-title" className="text-3xl leading-none">
          {next.label}
        </h2>
        <p className="text-muted-foreground">{next.description}</p>
      </div>

      {next.preconditions.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Voraussetzungen">
          {next.preconditions.map((p) => (
            <li key={p.label} className="flex items-center gap-2 font-semibold">
              {p.met ? (
                <Check className="text-success size-5 shrink-0" aria-hidden="true" />
              ) : p.advisory ? (
                <Info className="text-warning size-5 shrink-0" aria-hidden="true" />
              ) : (
                <X className="text-destructive size-5 shrink-0" aria-hidden="true" />
              )}
              <span className={cn(!p.met && (p.advisory ? "text-warning" : "text-destructive"))}>
                {p.label}
              </span>
              <span className="sr-only">{p.met ? "erfüllt" : p.advisory ? "Hinweis" : "nicht erfüllt"}</span>
            </li>
          ))}
        </ul>
      )}

      <div aria-live="polite">
        {blockReasons.length > 0 && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive flex flex-col gap-1 rounded-xl border p-3 text-sm font-semibold">
            {blockReasons.map((r) => (
              <p key={r} className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {r}
              </p>
            ))}
          </div>
        )}
      </div>

      {next.kind !== "none" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="lg" disabled={disabled || next.blocked} onClick={() => setConfirm("next")}>
            {runner.pending === next.kind && <Loader2 className="animate-spin" aria-hidden="true" />}
            {next.label}
          </Button>
          {canReopen && (
            <Button variant="outline" size="lg" disabled={disabled} onClick={() => setConfirm("reopen")}>
              <RotateCcw aria-hidden="true" /> Anmeldung wieder öffnen
            </Button>
          )}
          {canRedraw && (
            <Button variant="outline" size="lg" disabled={disabled} onClick={() => setConfirm("redraw")}>
              <Shuffle aria-hidden="true" /> Neu auslosen
            </Button>
          )}
        </div>
      )}
      {next.blocked && (
        <p className="text-muted-foreground text-sm">Erst möglich, wenn alle Voraussetzungen erfüllt sind.</p>
      )}

      <AdminDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm === "reopen"
            ? "Anmeldung wieder öffnen?"
            : confirm === "redraw"
              ? "Neu auslosen?"
              : `${next.label}?`
        }
        description={
          confirm === "reopen"
            ? "Spieler:innen können wieder Teams gründen, beitreten und verlassen."
            : confirm === "redraw"
              ? "Die bisherige Auslosung wird verworfen (im Audit-Log gesichert) und neu gezogen."
              : next.description
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Zurück
            </Button>
            <Button
              disabled={disabled}
              onClick={async () => {
                if (confirm === "next") return runNext();
                const fn: () => Promise<ActionResult<unknown>> =
                  confirm === "reopen" ? () => reopenRegistrationAction() : () => generateDrawAction();
                const res = await runner.run(confirm ?? "x", fn, {
                  success: confirm === "reopen" ? "Anmeldung wieder geöffnet." : "Neu ausgelost.",
                });
                if (res) setConfirm(null);
              }}
            >
              {runner.pending !== null && <Loader2 className="animate-spin" aria-hidden="true" />}
              Ja, ausführen
            </Button>
          </>
        }
      />
    </section>
  );
}
