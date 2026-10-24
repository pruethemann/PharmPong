"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ScrollText, Swords, Trophy, UserCog, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Übersicht", icon: LayoutDashboard },
  { href: "/admin/tournament", label: "Turnier", icon: Trophy },
  { href: "/admin/matches", label: "Spiele", icon: Swords },
  { href: "/admin/teams", label: "Teams", icon: Users },
  { href: "/admin/users", label: "Benutzer", icon: UserCog },
  { href: "/admin/audit", label: "Audit", icon: ScrollText },
];

function active(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Admin sub-navigation: links styled as tabs, scrolls inside its own container on phones. */
export function AdminSubnav() {
  const pathname = usePathname();
  const scroller = useRef<HTMLDivElement>(null);
  // Keep the active tab visible on narrow screens (scroll the strip, not the page).
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !el) return;
    box.scrollLeft = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
  }, [pathname]);
  return (
    <nav aria-label="Admin-Bereiche" className="-mx-4 md:mx-0">
      <div ref={scroller} className="relative [scrollbar-width:none] overflow-x-auto px-4 md:px-0">
        <ul className="bg-card flex w-max min-w-full gap-1 rounded-2xl border p-1">
          {ITEMS.map(({ href, label, icon: Icon }) => {
            const on = active(pathname, href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold whitespace-nowrap transition-colors sm:text-base",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4.5" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
