"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Gavel, Home, Settings2, Trophy, Users, type LucideIcon } from "lucide-react";
import type { RoleKey } from "@/lib/i18n/de";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: LucideIcon };

export function navItems(role: RoleKey | null): Item[] {
  const items: Item[] = [
    { href: "/", label: "Start", icon: Home },
    { href: "/tournament", label: "Turnier", icon: Trophy },
  ];
  if (role === "ADMIN") items.push({ href: "/admin", label: "Admin", icon: Settings2 });
  if (role === "REFEREE" || role === "ADMIN") items.push({ href: "/referee", label: "Schiri", icon: Gavel });
  if (role !== "ADMIN") items.push({ href: "/team", label: "Team", icon: Users });
  items.push({ href: "/rules", label: "Regeln", icon: BookOpen });
  return items.slice(0, 5);
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({ role }: { role: RoleKey | null }) {
  const pathname = usePathname();
  const items = navItems(role);
  return (
    <nav
      aria-label="Hauptnavigation"
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
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function TopNav({ role }: { role: RoleKey | null }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Hauptnavigation" className="hidden items-center gap-1 md:flex">
      {navItems(role).map(({ href, label, icon: Icon }) => {
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
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
