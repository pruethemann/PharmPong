import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getAppLocale } from "@/i18n/server";
import { LanguageSwitcher } from "@/components/pp/language-switcher";
import { BottomNav, TopNav } from "@/components/pp/app-nav";
import { Logo } from "@/components/pp/logo";
import { ModeWatch } from "@/components/pp/mode-watch";
import { UserMenu } from "@/components/pp/user-menu";
import { getCurrentUser } from "@/server/auth/current";
import { getActiveGameMode } from "@/server/services/current-mode";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, mode, locale, t] = await Promise.all([
    getCurrentUser(),
    getActiveGameMode(),
    getAppLocale(),
    getTranslations("shell"),
  ]);
  const role = user?.role ?? null;
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {t("skipToContent")}
      </a>
      <header className="bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="rounded-lg" aria-label={t("homeAria")}>
            <Logo size="sm" />
          </Link>
          <TopNav role={role} mode={mode} />
          <div className="flex items-center gap-1">
            <LanguageSwitcher current={locale} />
            <UserMenu
              user={user ? { displayName: user.displayName, email: user.email, role: user.role } : null}
            />
          </div>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-4 pb-28 md:pb-12"
      >
        {children}
      </main>
      <BottomNav role={role} mode={mode} />
      <ModeWatch mode={mode} />
    </>
  );
}
