"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Ban, Check, Info, Plus, Swords, UserPlus, X } from "lucide-react";
import { createEloMatchAction, updateEloRosterAction } from "@/server/actions/elo";
import { previewMatchup } from "@/server/domain/elo/preview";
import { rosterPairKey } from "@/server/domain/elo/repeat";
import { rosterIssueMessage, rosterIssues } from "@/server/domain/elo/roster";
import { formatRating, teamLabel } from "@/lib/elo-format";
import type { EloLiveMatch, EloLiveTable, EloSideKey } from "@/lib/elo-live-types";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { TableBadge } from "@/components/pp/table-badge";
import { useMatchAction } from "@/components/referee/use-match-action";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { EloLiveProvider, useEloLive, type EloSnapshot } from "./elo-live";
import { SideTag } from "./elo-team";
import { MatchupPreviewPanel, prospectiveRepeat } from "./matchup-preview";
import { PlayerAvatar } from "./player-avatar";
import { PlayerPicker } from "./player-picker";

type Step = "table" | "teams" | "preview";
const STEPS: { key: Step; label: string }[] = [
  { key: "table", label: "Tisch" },
  { key: "teams", label: "Teams" },
  { key: "preview", label: "Vorschau" },
];

function Stepper({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-center gap-2" aria-label="Schritte">
      {STEPS.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === at ? "step" : undefined}
          className={cn(
            "flex flex-1 flex-col gap-1.5 text-xs font-semibold",
            i <= at ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span
            className={cn("h-1.5 rounded-full", i < at ? "bg-primary" : i === at ? "bg-accent" : "bg-muted")}
          />
          <span>
            {i + 1}. {s.label}
            {i < at && <span className="sr-only"> (erledigt)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TableChoice({
  tables,
  occupant,
  value,
  onChange,
}: {
  tables: readonly EloLiveTable[];
  occupant: (tableId: string) => EloLiveMatch | null;
  value: string | null;
  onChange: (tableId: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Tisch wählen" className="grid gap-3 sm:grid-cols-2">
      {tables.map((t) => {
        const busy = occupant(t.id);
        const disabled = t.state === "DISABLED" || !!busy;
        const checked = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(t.id)}
            className={cn(
              "bg-card flex min-h-24 flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition-colors",
              checked ? "border-accent bg-accent/10" : "hover:border-primary/60",
              disabled && "cursor-not-allowed border-dashed opacity-70",
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <TableBadge number={t.number} size="lg" muted={disabled} />
              {checked && <Check className="text-accent size-7" aria-hidden="true" />}
            </span>
            <span
              className={cn("text-sm font-semibold", disabled ? "text-muted-foreground" : "text-success")}
            >
              {t.state === "DISABLED" ? (
                <>
                  <Ban className="mr-1 inline size-4" aria-hidden="true" /> Gesperrt
                </>
              ) : busy ? (
                `Besetzt: ${teamLabel(busy.sideA.map((p) => p.displayName))} vs ${teamLabel(
                  busy.sideB.map((p) => p.displayName),
                )}`
              ) : (
                "Frei"
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TeamPanel({
  side,
  ids,
  nameOf,
  ratingOf,
  meId,
  maxTeamSize,
  onAdd,
  onRemove,
}: {
  side: EloSideKey;
  ids: readonly string[];
  nameOf: (id: string) => string;
  ratingOf: (id: string) => number;
  meId: string;
  maxTeamSize: number;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section
      aria-label={`Team ${side}`}
      className={cn(
        "bg-card flex flex-col gap-3 rounded-2xl border-2 p-4",
        side === "A" ? "border-team-home/50" : "border-team-away/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-2xl leading-none">
          <SideTag side={side} decorative /> Team {side}
        </h3>
        <span className="text-muted-foreground tabular text-sm">
          {ids.length}/{maxTeamSize}
        </span>
      </div>
      {ids.length === 0 ? (
        <p className="text-muted-foreground">Noch niemand. 1 bis {maxTeamSize} Personen.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ids.map((id) => (
            <li key={id} className="flex items-center gap-3">
              <PlayerAvatar userId={id} name={nameOf(id)} side={side} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {nameOf(id)}
                  {id === meId && <span className="text-primary"> (du)</span>}
                </span>
                <span className="text-muted-foreground text-sm">{formatRating(ratingOf(id))} Elo</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemove(id)}
                aria-label={`${nameOf(id)} entfernen`}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {ids.length < maxTeamSize && (
        <Button variant="outline" size="lg" onClick={onAdd} className="w-full">
          <UserPlus aria-hidden="true" /> {ids.length === 0 ? "Spieler:innen wählen" : "Hinzufügen"}
        </Button>
      )}
    </section>
  );
}

function Builder({ initialTable, editMatchId }: { initialTable: number | null; editMatchId: string | null }) {
  const { data, refresh } = useEloLive();
  const router = useRouter();
  const { pending, run } = useMatchAction({ refresh });
  const me = data.me!;
  const session = data.session!;
  const limits = { minTeamSize: session.settings.minTeamSize, maxTeamSize: session.settings.maxTeamSize };
  const edited = editMatchId ? (data.liveMatches.find((m) => m.id === editMatchId) ?? null) : null;
  const editOps = edited ? data.matchOps?.[edited.id] : undefined;

  const occupant = (tableId: string) =>
    data.liveMatches.find((m) => m.tableId === tableId && m.id !== editMatchId) ?? null;
  const freeTable = (t: EloLiveTable | undefined) => !!t && t.state !== "DISABLED" && !occupant(t.id);

  const [tableId, setTableId] = useState<string | null>(() => {
    if (edited) return edited.tableId;
    const t = data.tables.find((x) => x.number === initialTable);
    return t && freeTable(t) ? t.id : null;
  });
  const [sideA, setSideA] = useState<string[]>(() =>
    edited ? edited.sideA.map((p) => p.userId) : me.liveMatchId ? [] : [me.userId],
  );
  const [sideB, setSideB] = useState<string[]>(() => (edited ? edited.sideB.map((p) => p.userId) : []));
  const [rated, setRated] = useState(edited ? edited.rated : true);
  const [step, setStep] = useState<Step>(edited || tableId ? "teams" : "table");
  const [picker, setPicker] = useState<EloSideKey | null>(null);

  // Moving to another step: focus its heading (screen readers, keyboard) and scroll up.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  const rosterById = useMemo(() => new Map((data.roster ?? []).map((r) => [r.userId, r])), [data.roster]);
  const participants = useMemo(
    () => new Map([...(edited?.sideA ?? []), ...(edited?.sideB ?? [])].map((p) => [p.userId, p])),
    [edited],
  );
  const nameOf = (id: string) => rosterById.get(id)?.displayName ?? participants.get(id)?.displayName ?? "?";
  const ratingOf = (id: string) =>
    rosterById.get(id)?.rating ?? participants.get(id)?.rating ?? session.params.initialRating;

  const issues = rosterIssues(sideA, sideB, limits);
  const table = data.tables.find((t) => t.id === tableId);
  const tableOk = !!table && freeTable(table);
  const repeat = prospectiveRepeat(sideA, sideB, data.pairCounts, session.params.repeatMultipliers);
  const pendingSamePairing = data.pendingMatches.some(
    (m) =>
      rosterPairKey(
        m.sideA.map((p) => p.userId),
        m.sideB.map((p) => p.userId),
      ) === repeat.pairKey,
  );

  if (editMatchId && (!edited || edited.status !== "DRAFT" || !editOps?.can.editRoster)) {
    return (
      <BuilderUnavailable
        title="Aufstellung nicht mehr änderbar"
        href={`/elo/matches/${editMatchId}`}
        cta="Zum Match"
      >
        <p>Das Match hat schon begonnen, ist abgelaufen oder du darfst es nicht bearbeiten.</p>
      </BuilderUnavailable>
    );
  }
  if (!edited && data.gameMode !== "ELO") {
    return (
      <BuilderUnavailable title="Elo-Modus nicht aktiv">
        <p>Gerade läuft das Turnier. Matches für die Elo-Rangliste gibt es erst wieder im Elo-Modus.</p>
      </BuilderUnavailable>
    );
  }
  if (!edited && session.status !== "OPEN") {
    return (
      <BuilderUnavailable title={session.status === "PAUSED" ? "Elo-Runde pausiert" : "Elo-Runde beendet"}>
        <p>
          {session.status === "PAUSED"
            ? "Neue Matches starten, sobald die Turnierleitung fortsetzt."
            : "Diese Runde ist abgeschlossen. Danke fürs Mitspielen!"}
        </p>
      </BuilderUnavailable>
    );
  }
  if (!edited && me.liveMatchId && me.role === "PLAYER") {
    return (
      <BuilderUnavailable
        title="Du bist schon in einem Match"
        href={`/elo/matches/${me.liveMatchId}`}
        cta="Zu deinem Match"
      >
        <p>Spiel es fertig oder steig aus der Aufstellung aus, dann kannst du ein neues Match erstellen.</p>
      </BuilderUnavailable>
    );
  }

  const toggle = (side: EloSideKey, id: string) => {
    const set = side === "A" ? setSideA : setSideB;
    set((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const submit = async () => {
    if (!tableId) return;
    if (edited && editOps) {
      const out = await run(
        "save",
        () =>
          updateEloRosterAction({
            matchId: edited.id,
            expectedVersion: editOps.version,
            sideA,
            sideB,
            rated,
            tableId: tableId === edited.tableId ? undefined : tableId,
          }),
        { successToast: "Aufstellung gespeichert. Die anderen müssen sie neu bestätigen." },
      );
      if (out.kind === "ok") router.push(`/elo/matches/${edited.id}`);
      return;
    }
    const out = await run("create", () => createEloMatchAction({ tableId, sideA, sideB, rated }), {
      successToast: "Match erstellt",
    });
    if (out.kind === "ok") router.push(`/elo/matches/${out.data.matchId}`);
  };

  const preview =
    issues.length === 0
      ? previewMatchup(
          sideA.map((id) => ({ userId: id, rating: ratingOf(id) })),
          sideB.map((id) => ({ userId: id, rating: ratingOf(id) })),
          session.params,
          rated ? repeat.multiplier : 0,
        )
      : null;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle kicker="Elo-Match" title={edited ? "Aufstellung ändern" : "Match erstellen"} />
      <Stepper step={step} />

      {step === "table" && (
        <section className="flex flex-col gap-4" aria-labelledby="step-heading">
          <h2 id="step-heading" ref={headingRef} tabIndex={-1} className="text-2xl leading-none outline-none">
            Wo spielt ihr?
          </h2>
          <TableChoice tables={data.tables} occupant={occupant} value={tableId} onChange={setTableId} />
          {data.tables.every((t) => !freeTable(t)) && (
            <p className="text-muted-foreground">
              Gerade sind alle Tische besetzt. Schau gleich wieder rein.
            </p>
          )}
          <Button size="lg" className="w-full" disabled={!tableOk} onClick={() => setStep("teams")}>
            Weiter zu den Teams <ArrowRight aria-hidden="true" />
          </Button>
        </section>
      )}

      {step === "teams" && (
        <section className="flex flex-col gap-4" aria-labelledby="step-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              id="step-heading"
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl leading-none outline-none"
            >
              Wer spielt?
            </h2>
            {table && (
              <button
                type="button"
                onClick={() => setStep("table")}
                className="text-primary inline-flex min-h-12 items-center gap-2 text-sm font-semibold"
              >
                <TableBadge number={table.number} size="sm" /> ändern
              </button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {(["A", "B"] as const).map((side) => (
              <TeamPanel
                key={side}
                side={side}
                ids={side === "A" ? sideA : sideB}
                nameOf={nameOf}
                ratingOf={ratingOf}
                meId={me.userId}
                maxTeamSize={limits.maxTeamSize}
                onAdd={() => setPicker(side)}
                onRemove={(id) => toggle(side, id)}
              />
            ))}
          </div>
          {issues.length > 0 && (sideA.length > 0 || sideB.length > 0) && (
            <ul className="text-muted-foreground flex flex-col gap-1 text-sm" aria-live="polite">
              {issues.map((issue) => (
                <li key={issue.code + ("side" in issue ? issue.side : "")} className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {rosterIssueMessage(issue)}
                </li>
              ))}
            </ul>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={issues.length > 0}
            onClick={() => setStep("preview")}
          >
            Weiter zur Vorschau <ArrowRight aria-hidden="true" />
          </Button>
        </section>
      )}

      {step === "preview" && preview && table && (
        <section className="flex flex-col gap-4" aria-labelledby="step-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              id="step-heading"
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl leading-none outline-none"
            >
              Was steht auf dem Spiel?
            </h2>
            <TableBadge number={table.number} />
          </div>
          <div className="bg-card flex flex-col gap-2 rounded-2xl border p-4">
            {(["A", "B"] as const).map((side) => (
              <p key={side} className="flex items-center gap-2 font-semibold">
                <SideTag side={side} />
                <span className="min-w-0 break-words">
                  {teamLabel((side === "A" ? sideA : sideB).map(nameOf))}
                </span>
              </p>
            ))}
          </div>
          <div className="bg-muted/30 flex min-h-14 items-center justify-between gap-4 rounded-xl border px-4 py-3">
            <div className="min-w-0">
              <label htmlFor="elo-rated" id="elo-rated-label" className="cursor-pointer font-semibold">
                Um Elo spielen
              </label>
              <p id="elo-rated-hint" className="text-muted-foreground text-sm">
                Aus: Freundschaftsspiel, niemandes Elo ändert sich.
              </p>
            </div>
            <Switch
              id="elo-rated"
              checked={rated}
              onCheckedChange={setRated}
              aria-labelledby="elo-rated-label"
              aria-describedby="elo-rated-hint"
            />
          </div>
          <div className="bg-card rounded-2xl border p-4">
            <MatchupPreviewPanel
              preview={preview}
              sizeA={sideA.length}
              sizeB={sideB.length}
              rated={rated}
              priorCount={repeat.priorCount}
              pendingSamePairing={pendingSamePairing}
            />
          </div>
          {!edited && (
            <p className="text-muted-foreground flex items-start gap-2 text-sm">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Danach bestätigt das andere Team die Aufstellung auf dem eigenen Handy, dann startet ihr das
              Spiel.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" size="lg" onClick={() => setStep("teams")} className="sm:flex-1">
              <ArrowLeft aria-hidden="true" /> Zurück
            </Button>
            <Button
              size="lg"
              variant="accent"
              className="sm:flex-[2]"
              disabled={!tableOk || pending != null}
              onClick={submit}
            >
              {edited ? <Check aria-hidden="true" /> : <Swords aria-hidden="true" />}
              {pending ? "Speichere …" : edited ? "Aufstellung speichern" : "Match erstellen"}
            </Button>
          </div>
          {!tableOk && (
            <p role="alert" className="text-destructive text-sm font-semibold">
              Der Tisch ist inzwischen besetzt. Bitte wähle einen anderen.{" "}
              <button type="button" className="underline" onClick={() => setStep("table")}>
                Tisch wählen
              </button>
            </p>
          )}
        </section>
      )}

      <PlayerPicker
        side={picker}
        onClose={() => setPicker(null)}
        roster={data.roster ?? []}
        sideA={sideA}
        sideB={sideB}
        maxTeamSize={limits.maxTeamSize}
        meId={me.userId}
        editMatchId={editMatchId}
        tableOfMatch={(id) => data.liveMatches.find((m) => m.id === id)?.tableNumber ?? null}
        onToggle={toggle}
      />
    </div>
  );
}

/** /elo/play: table → teams → preview → create (or edit a draft's roster). */
export function MatchBuilder({
  initial,
  initialTable,
  editMatchId,
}: {
  initial: EloSnapshot;
  initialTable: number | null;
  editMatchId: string | null;
}) {
  return (
    <EloLiveProvider mode="authed" initial={initial}>
      <Builder initialTable={initialTable} editMatchId={editMatchId} />
    </EloLiveProvider>
  );
}

export function BuilderUnavailable({
  title,
  href = "/",
  cta = "Zur Startseite",
  children,
}: {
  title: string;
  href?: string;
  cta?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageTitle kicker="Elo-Match" title="Match erstellen" />
      <EmptyState icon={<Plus />} title={title}>
        {children}
        <Link href={href} className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>
          {cta}
        </Link>
      </EmptyState>
    </>
  );
}
