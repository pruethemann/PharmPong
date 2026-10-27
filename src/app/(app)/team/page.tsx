import type { Metadata } from "next";
import { CalendarClock, Lock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState, PageTitle, Section } from "@/components/pp/section";
import { TeamAvatar } from "@/components/pp/team-avatar";
import { CreateTeamCard } from "@/components/team/create-team-card";
import { InvitePanel } from "@/components/team/invite-panel";
import { JoinTeamCard } from "@/components/team/join-team-card";
import { LeaveTeam } from "@/components/team/leave-team";
import { LogoUploader } from "@/components/team/logo-uploader";
import { MemberList } from "@/components/team/member-list";
import { ReadyToggle } from "@/components/team/ready-toggle";
import { TeamEditForm } from "@/components/team/team-edit-form";
import { TeamStatusBadge } from "@/components/team/team-status-badge";
import { requirePageUser } from "@/server/auth/current";
import { env } from "@/server/env";
import {
  canEditName,
  canEditProfile,
  getMyTeam,
  getTournamentStatus,
  isRosterLocked,
} from "@/server/services/teams";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("team"))("metaTitle") };
}

async function LockedBanner() {
  const t = await getTranslations("team");
  return (
    <div
      role="status"
      className="border-warning/50 bg-warning/10 text-warning flex items-start gap-3 rounded-2xl border p-4"
    >
      <Lock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <p className="font-semibold">{t("lockedBanner")}</p>
    </div>
  );
}

export default async function TeamPage() {
  const t = await getTranslations("team");
  const user = await requirePageUser("PLAYER", "/team");
  const tournament = await getTournamentStatus();
  const team = tournament ? await getMyTeam(user.id, { tournamentId: tournament.id }) : null;

  if (!tournament || (tournament.status === "DRAFT" && !team)) {
    return (
      <>
        <PageTitle kicker={t("kicker")} title={t("title")} />
        <EmptyState icon={<CalendarClock />} title={t("signupSoonTitle")}>
          {t("signupSoonBody")}
        </EmptyState>
      </>
    );
  }

  const status = tournament.status;
  const locked = isRosterLocked(status);
  const open = status === "REGISTRATION_OPEN";

  if (!team) {
    return (
      <>
        <PageTitle kicker={t("kicker")} title={t("title")} />
        {locked ? (
          <>
            <LockedBanner />
            <EmptyState title={t("noTeamTitle")}>{t("noTeamBody")}</EmptyState>
          </>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <CreateTeamCard />
            <JoinTeamCard />
          </div>
        )}
      </>
    );
  }

  const me = team.members.find((m) => m.userId === user.id);
  const appUrl = env().APP_URL;

  return (
    <>
      <PageTitle kicker={t("title")} title={team.name} />
      {locked && <LockedBanner />}

      <section
        aria-label={t("profileAria")}
        className="bg-card flex flex-col items-center gap-4 rounded-2xl border p-5 text-center sm:flex-row sm:text-left"
      >
        <TeamAvatar name={team.name} logoUrl={team.logoUrl} size="xl" />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:items-start">
          <p className="font-display text-3xl leading-none break-words">{team.name}</p>
          {team.motto && <p className="text-muted-foreground text-lg italic">«{team.motto}»</p>}
          <TeamStatusBadge complete={team.complete} />
        </div>
      </section>

      <Section title={t("membersTitle")}>
        <MemberList members={team.members} meId={user.id} />
        {(open || status === "REGISTRATION_LOCKED") && me && <ReadyToggle ready={me.isReady} />}
      </Section>

      {open && <InvitePanel code={team.inviteCode} appUrl={appUrl} canRotate />}

      {canEditProfile(status) && (
        <Section title={t("editTitle")}>
          <div className="bg-card flex flex-col gap-6 rounded-2xl border p-5">
            <TeamEditForm
              teamId={team.id}
              version={team.version}
              name={team.name}
              motto={team.motto}
              nameEditable={canEditName(status)}
            />
            <LogoUploader teamId={team.id} teamName={team.name} logoUrl={team.logoUrl} />
          </div>
        </Section>
      )}

      {open && (
        <Section title={t("leaveTitle")}>
          <LeaveTeam lastMember={team.members.length === 1} />
        </Section>
      )}
    </>
  );
}
