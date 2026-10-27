"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  Gavel,
  Home,
  Medal,
  Settings2,
  Swords,
  Trophy,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { RoleKey } from "@/lib/i18n/de";
import { cn } from "@/lib/utils";

type NavKey =
  "home" | "play" | "rankings" | "profile" | "admin" | "referee" | "rules" | "tournament" | "team";
type Item = { href: string; label: NavKey; icon: LucideIcon };

export type GameModeKey = "COMPETITIVE" | "ELO";

/** Elo Mode: Home, Play, Rankings, Profile and one role-specific item (max. 5). */
function eloNavItems(role: RoleKey | null): Item[] {
  const items: Item[] = [
    { href: "/", label: "home", icon: Home },
    { href: "/elo/play", label: "play", icon: Swords },
    { href: "/elo/rankings", label: "rankings", icon: Medal },
    { href: "/elo/players/me", label: "profile", icon: UserRound },
  ];
  if (role === "ADMIN") items.push({ href: "/admin", label: "admin", icon: Settings2 });
  else if (role === "REFEREE") items.push({ href: "/elo/referee", label: "referee", icon: Gavel });
  else items.push({ href: "/rules", label: "rules", icon: BookOpen });
  return items;
}

export function navItems(role: RoleKey | null, mode: GameModeKey = "COMPETITIVE"): Item[] {
  if (mode === "ELO") return eloNavItems(role);
  const items: Item[] = [
    { href: "/", label: "home", icon: Home },
    { href: "/tournament", label: "tournament", icon: Trophy },
  ];
  if (role === "ADMIN") items.push({ href: "/admin", label: "admin", icon: Settings2 });
  if (role === "REFEREE" || role === "ADMIN") items.push({ href: "/referee", label: "referee", icon: Gavel });
  if (role !== "ADMIN") items.push({ href: "/team", label: "team", icon: Users });
  items.push({ href: "/rules", label: "rules", icon: BookOpen });
  return items.slice(0, 5);
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({ role, mode }: { role: RoleKey | null; mode?: GameModeKey }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  const items = navItems(role, mode);
  return (
    <nav
      aria-label={tShell("mainNav")}
      className="bg-background/95 safe-bottom fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur md:hidden"
    >
      <ul
        className="mx-auto grid max-w-lg"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 pt-2 text-xs font-semibold",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-6" aria-hidden="true" />
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function TopNav({ role, mode }: { role: RoleKey | null; mode?: GameModeKey }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  return (
    <nav aria-label={tShell("mainNav")} className="hidden items-center gap-1 md:flex">
      {navItems(role, mode).map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-12 items-center gap-2 rounded-xl px-3 font-semibold",
              active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}
