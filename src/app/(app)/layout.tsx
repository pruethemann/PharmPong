import Link from "next/link";
import { BottomNav, TopNav } from "@/components/pp/app-nav";
import { Logo } from "@/components/pp/logo";
import { UserMenu } from "@/components/pp/user-menu";
import { getCurrentUser } from "@/server/auth/current";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  const role = user?.role ?? null;
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        Zum Inhalt springen
      </a>
      <header className="bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="rounded-lg" aria-label="PharmaPong Startseite">
            <Logo size="sm" />
          </Link>
          <TopNav role={role} />
          <UserMenu
            user={user ? { displayName: user.displayName, email: user.email, role: user.role } : null}
          />
        </div>
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-4 pb-28 md:pb-12"
      >
        {children}
      </main>
      <BottomNav role={role} />
    </>
  );
}
