import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FlaskConical, LogIn, ShieldAlert, UserPlus } from "lucide-react";
import { Logo } from "@/components/pp/logo";
import { EmptyState } from "@/components/pp/section";
import { buttonVariants } from "@/components/ui/button";
import { Dashboard } from "@/components/live/dashboard";
import { loadLiveInitial, viewerOf } from "@/components/live/load-live";
import { EloHome } from "@/components/elo/elo-home";
import { loadEloInitial } from "@/components/elo/load-elo";
import { getActiveGameMode } from "@/server/services/current-mode";

export const dynamic = "force-dynamic";

async function ForbiddenNotice() {
  const t = await getTranslations("home");
  return (
    <div
      role="alert"
      className="border-destructive/50 bg-destructive/10 flex items-start gap-3 rounded-2xl border p-4 text-base"
    >
      <ShieldAlert className="text-destructive mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <p>{t("forbidden")}</p>
    </div>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ forbidden?: string }> }) {
  const forbidden = (await searchParams).forbidden === "1";
  if ((await getActiveGameMode()) === "ELO") {
    const elo = await loadEloInitial();
    if (elo.mode !== "none") {
      return (
        <>
          {forbidden && <ForbiddenNotice />}
          <EloHome
            mode={elo.mode}
            initial={elo.snapshot}
            viewer={elo.mode === "authed" ? "member" : elo.loggedIn ? "mustChangePassword" : "guest"}
          />
        </>
      );
    }
  }
  const live = await loadLiveInitial();
  if (live.mode === "none") {
    const t = await getTranslations("home");
    return (
      <>
        {forbidden && <ForbiddenNotice />}
        <div className="flex justify-center pt-6">
          <Logo size="xl" />
        </div>
        <EmptyState icon={<FlaskConical />} title={t("preparingTitle")}>
          <p>{t("preparingBody")}</p>
          {!live.loggedIn && (
            <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
              <Link href="/register" className={buttonVariants({ size: "lg" })}>
                <UserPlus aria-hidden="true" /> {t("register")}
              </Link>
              <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
                <LogIn aria-hidden="true" /> {t("login")}
              </Link>
            </div>
          )}
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {forbidden && <ForbiddenNotice />}
      <Dashboard mode={live.mode} initial={live.snapshot} viewer={viewerOf(live)} />
    </>
  );
}
