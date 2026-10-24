import type { Metadata } from "next";
import { Beaker } from "lucide-react";
import { ConnectionBadge } from "@/components/pp/connection-badge";
import { Logo } from "@/components/pp/logo";
import { MatchCard } from "@/components/pp/match-card";
import { EmptyState, PageTitle, Section } from "@/components/pp/section";
import { StatusPill } from "@/components/pp/status-pill";
import { TableBadge } from "@/components/pp/table-badge";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HoldDemo, TimerDemo } from "./demos";

export const metadata: Metadata = { title: "Styleguide", robots: { index: false } };

const statuses = [
  "PENDING",
  "READY",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_CONFIRMATION",
  "COMPLETED",
  "CANCELLED",
  "FORFEITED",
] as const;

const swatches = [
  ["background", "bg-background"],
  ["card", "bg-card"],
  ["muted", "bg-muted"],
  ["primary", "bg-primary"],
  ["accent", "bg-accent"],
  ["team-home", "bg-team-home"],
  ["team-away", "bg-team-away"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["destructive", "bg-destructive"],
  ["gold", "bg-gold"],
] as const;

export default function StyleguidePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8">
      <Logo size="xl" />
      <PageTitle kicker="Design System" title="PharmaPong Styleguide" />

      <Section title="Farben">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {swatches.map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-1">
              <div className={`h-16 rounded-xl border ${cls}`} />
              <span className="text-muted-foreground text-xs">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typografie">
        <p className="font-display text-7xl">Display 72</p>
        <h1 className="text-5xl">Heading 1</h1>
        <h2 className="text-3xl">Heading 2</h2>
        <p className="text-lg">Body Large: Barlow 18px für wichtige Hinweise.</p>
        <p>Body: Barlow 16px, Zeilenhöhe 1.5. Gut lesbar auch nach dem dritten Becher (Wasser).</p>
        <p className="text-muted-foreground text-sm">Muted 14px: Sekundäre Informationen.</p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Primär</Button>
          <Button variant="accent">Akzent</Button>
          <Button variant="success">Bestätigen</Button>
          <Button variant="warning">Warnung</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destruktiv</Button>
          <Button disabled>Deaktiviert</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Klein</Button>
          <Button size="lg">Gross</Button>
          <Button size="xl">Spiel starten</Button>
          <Button size="icon" aria-label="Labor">
            <Beaker />
          </Button>
        </div>
        <HoldDemo />
      </Section>

      <Section title="Status">
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ConnectionBadge state="online" />
          <ConnectionBadge state="reconnecting" />
          <ConnectionBadge state="offline" />
        </div>
      </Section>

      <Section title="Teams & Tische">
        <div className="flex flex-wrap items-center gap-4">
          <TeamAvatar name="Die Pipettierer" side="home" size="lg" />
          <TeamAvatar name="Zentrifugal Kräfte" side="away" size="lg" />
          <TeamAvatar name="Placebo" size="lg" />
          <TableBadge number={1} />
          <TableBadge number={2} size="lg" />
          <TableBadge number={1} size="xl" />
        </div>
      </Section>

      <Section title="Spiele">
        <div className="grid gap-3 sm:grid-cols-2">
          <MatchCard
            match={{
              id: "1",
              code: "A-1",
              label: "Gruppe A · Runde 1",
              status: "IN_PROGRESS",
              tableNumber: 1,
              home: { id: "h", name: "Die Pipettierer" },
              away: { id: "a", name: "Zentrifugal Kräfte" },
            }}
          />
          <MatchCard
            match={{
              id: "2",
              code: "QF1",
              label: "Viertelfinal 1",
              status: "COMPLETED",
              home: { id: "h", name: "Die Pipettierer" },
              away: { id: "a", name: "Placebo-Effekt" },
              winnerTeamId: "h",
              homeCupsRemaining: 3,
              awayCupsRemaining: 0,
            }}
          />
          <MatchCard
            match={{
              id: "3",
              code: "SF1",
              label: "Halbfinal 1",
              status: "PENDING",
              home: null,
              away: null,
              homeSource: "W:QF1",
              awaySource: "W:QF3",
            }}
          />
        </div>
      </Section>

      <Section title="Timer">
        <TimerDemo />
      </Section>

      <Section title="Formular">
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="sg-email">E-Mail</Label>
          <Input id="sg-email" type="email" placeholder="vorname@unibas.ch" />
        </div>
      </Section>

      <EmptyState icon={<Beaker />} title="Noch keine Spiele">
        Sobald die Gruppen ausgelost sind, erscheinen hier die Partien.
      </EmptyState>
    </main>
  );
}
