import type { Metadata } from "next";
import { Crown, Gavel, ShieldAlert, UserRound, type LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requirePageUser } from "@/server/auth/current";
import type { RoleKey } from "@/lib/i18n/de";
import { PageTitle, Section } from "@/components/pp/section";
import { ChangePasswordForm, DisplayNameForm, LogoutButton } from "@/components/auth/profile-forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("auth.profile"))("metaTitle") };
}

const ROLE_ICON: Record<RoleKey, LucideIcon> = { PLAYER: UserRound, REFEREE: Gavel, ADMIN: Crown };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("auth.profile");
  const tRoles = await getTranslations("roles");
  const user = await requirePageUser("PLAYER", "/profile");
  const sp = await searchParams;
  const forced = user.mustChangePassword;
  const showBanner = forced || sp.mustChange === "1";
  const RoleIcon = ROLE_ICON[user.role];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <PageTitle kicker={t("kicker")} title={t("title")} />

      {showBanner && (
        <div
          role="alert"
          className="border-warning/50 bg-warning/10 flex items-start gap-3 rounded-2xl border p-4"
        >
          <ShieldAlert className="text-warning mt-0.5 size-6 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">{t("mustChangeTitle")}</p>
            <p className="text-muted-foreground text-sm">{t("mustChangeBody")}</p>
          </div>
        </div>
      )}

      <div className="bg-card flex flex-wrap items-center gap-4 rounded-2xl border p-4">
        <div className="bg-primary/15 text-primary flex size-14 items-center justify-center rounded-2xl">
          <RoleIcon className="size-7" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display truncate text-2xl">{user.displayName}</p>
          <p className="text-muted-foreground truncate text-sm">{user.email}</p>
        </div>
        <span className="border-primary/40 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold">
          <RoleIcon className="size-4" aria-hidden="true" />
          {tRoles(user.role)}
        </span>
      </div>

      {forced ? (
        <Section title={t("setPasswordTitle")}>
          <div className="bg-card rounded-2xl border p-5">
            <ChangePasswordForm primary />
          </div>
        </Section>
      ) : (
        <>
          <Section title={t("displayNameTitle")}>
            <div className="bg-card rounded-2xl border p-5">
              <DisplayNameForm displayName={user.displayName} />
            </div>
          </Section>
          <Section title={t("changePasswordTitle")}>
            <div className="bg-card rounded-2xl border p-5">
              <p className="text-muted-foreground mb-4 text-sm">{t("changePasswordNote")}</p>
              <ChangePasswordForm primary={false} />
            </div>
          </Section>
        </>
      )}

      <Section title={t("sessionTitle")}>
        <LogoutButton />
      </Section>
    </div>
  );
}
