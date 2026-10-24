import type { Metadata } from "next";
import Link from "next/link";
import { Hourglass, SearchX, Users } from "lucide-react";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { Button } from "@/components/ui/button";
import { formatInviteCode } from "@/components/team/format";
import { JoinButton } from "@/components/team/join-button";
import { clientIp, getCurrentUser } from "@/server/auth/current";
import { normalizeInviteCode } from "@/server/auth/tokens";
import { getMyTeam, lookupTeamPreview } from "@/server/services/teams";

export const metadata: Metadata = { title: "Team beitreten", robots: { index: false } };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeInviteCode(decodeURIComponent(raw)).slice(0, 16);
  const [lookup, user] = await Promise.all([lookupTeamPreview(code, await clientIp()), getCurrentUser()]);

  if (lookup.status === "rate_limited") {
    return (
      <>
        <PageTitle kicker="Einladung" title="Team beitreten" />
        <EmptyState icon={<Hourglass />} title="Zu viele Versuche">
          <p>
            Von diesem Netzwerk wurden zu viele ungültige Codes geprüft. Bitte versuch es in 15 Minuten
            nochmals.
          </p>
        </EmptyState>
      </>
    );
  }

  if (lookup.status === "not_found") {
    return (
      <>
        <PageTitle kicker="Einladung" title="Team beitreten" />
        <EmptyState icon={<SearchX />} title="Einladung nicht gefunden">
          <p>Dieser Code ist ungültig oder wurde erneuert. Frag dein Team nach dem aktuellen Link.</p>
          <Button render={<Link href="/team" />} variant="outline" className="mt-4">
            Zu meinem Team
          </Button>
        </EmptyState>
      </>
    );
  }

  const { preview } = lookup;
  const next = encodeURIComponent(`/join/${code}`);
  const full = preview.memberCount >= 2;
  const myTeam = user ? await getMyTeam(user.id) : null;

  return (
    <>
      <PageTitle kicker="Einladung" title="Team beitreten" />
      <section
        aria-label="Teamvorschau"
        className="bg-card mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border p-6 text-center"
      >
        <TeamAvatar name={preview.name} logoUrl={preview.logoUrl} size="xl" />
        <p className="font-display text-4xl leading-none break-words">{preview.name}</p>
        {preview.motto && <p className="text-muted-foreground text-lg italic">«{preview.motto}»</p>}
        <p className="inline-flex items-center gap-2 font-semibold">
          <Users className="size-5" aria-hidden="true" />
          <span className="tabular">{preview.memberCount}/2 Spieler:innen</span>
        </p>
        <p className="text-muted-foreground text-sm">
          Code <span className="font-display tabular text-foreground">{formatInviteCode(code)}</span>
        </p>

        <div className="flex w-full flex-col gap-3 pt-2">
          {!preview.registrationOpen ? (
            <p role="status" className="text-warning font-semibold">
              Die Anmeldung ist im Moment nicht offen.
            </p>
          ) : full ? (
            <p role="status" className="text-warning font-semibold">
              Dieses Team ist bereits vollständig.
            </p>
          ) : !user ? (
            <>
              <Button render={<Link href={`/register?next=${next}`} />} size="lg" variant="accent">
                Konto erstellen und beitreten
              </Button>
              <Button render={<Link href={`/login?next=${next}`} />} size="lg" variant="outline">
                Ich habe schon ein Konto
              </Button>
            </>
          ) : myTeam ? (
            <>
              <p role="status" className="text-muted-foreground">
                Du bist bereits im Team «{myTeam.name}».
              </p>
              <Button render={<Link href="/team" />} size="lg" variant="outline">
                Zu meinem Team
              </Button>
            </>
          ) : (
            <JoinButton code={code} />
          )}
        </div>
      </section>
    </>
  );
}
