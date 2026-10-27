import type { Metadata } from "next";
import Link from "next/link";
import { Hourglass, SearchX, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState, PageTitle } from "@/components/pp/section";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { Button } from "@/components/ui/button";
import { formatInviteCode } from "@/components/team/format";
import { JoinButton } from "@/components/team/join-button";
import { clientIp, getCurrentUser } from "@/server/auth/current";
import { normalizeInviteCode } from "@/server/auth/tokens";
import { getMyTeam, lookupTeamPreview } from "@/server/services/teams";

const TEAM_SIZE = 2;
const RATE_LIMIT_MINUTES = 15;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("joinPage"))("metaTitle"), robots: { index: false } };
}

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const t = await getTranslations("joinPage");
  const { code: raw } = await params;
  const code = normalizeInviteCode(decodeURIComponent(raw)).slice(0, 16);
  const [lookup, user] = await Promise.all([lookupTeamPreview(code, await clientIp()), getCurrentUser()]);

  if (lookup.status === "rate_limited") {
    return (
      <>
        <PageTitle kicker={t("kicker")} title={t("title")} />
        <EmptyState icon={<Hourglass />} title={t("rateLimitedTitle")}>
          <p>{t("rateLimitedBody", { minutes: RATE_LIMIT_MINUTES })}</p>
        </EmptyState>
      </>
    );
  }

  if (lookup.status === "not_found") {
    return (
      <>
        <PageTitle kicker={t("kicker")} title={t("title")} />
        <EmptyState icon={<SearchX />} title={t("notFoundTitle")}>
          <p>{t("notFoundBody")}</p>
          <Button render={<Link href="/team" />} variant="outline" className="mt-4">
            {t("toMyTeam")}
          </Button>
        </EmptyState>
      </>
    );
  }

  const { preview } = lookup;
  const next = encodeURIComponent(`/join/${code}`);
  const full = preview.memberCount >= TEAM_SIZE;
  const myTeam = user ? await getMyTeam(user.id) : null;

  return (
    <>
      <PageTitle kicker={t("kicker")} title={t("title")} />
      <section
        aria-label={t("previewAria")}
        className="bg-card mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border p-6 text-center"
      >
        <TeamAvatar name={preview.name} logoUrl={preview.logoUrl} size="xl" />
        <p className="font-display text-4xl leading-none break-words">{preview.name}</p>
        {preview.motto && <p className="text-muted-foreground text-lg italic">«{preview.motto}»</p>}
        <p className="inline-flex items-center gap-2 font-semibold">
          <Users className="size-5" aria-hidden="true" />
          <span className="tabular">{t("members", { n: preview.memberCount })}</span>
        </p>
        <p className="text-muted-foreground text-sm">
          {t.rich("code", {
            code: formatInviteCode(code),
            c: (chunks) => <span className="font-display tabular text-foreground">{chunks}</span>,
          })}
        </p>

        <div className="flex w-full flex-col gap-3 pt-2">
          {!preview.registrationOpen ? (
            <p role="status" className="text-warning font-semibold">
              {t("registrationClosed")}
            </p>
          ) : full ? (
            <p role="status" className="text-warning font-semibold">
              {t("teamFull")}
            </p>
          ) : !user ? (
            <>
              <Button render={<Link href={`/register?next=${next}`} />} size="lg" variant="accent">
                {t("createAccount")}
              </Button>
              <Button render={<Link href={`/login?next=${next}`} />} size="lg" variant="outline">
                {t("haveAccount")}
              </Button>
            </>
          ) : myTeam ? (
            <>
              <p role="status" className="text-muted-foreground">
                {t("alreadyInTeam", { name: myTeam.name })}
              </p>
              <Button render={<Link href="/team" />} size="lg" variant="outline">
                {t("toMyTeam")}
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
