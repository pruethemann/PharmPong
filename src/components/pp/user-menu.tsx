"use client";

import Link from "next/link";
import { useTransition } from "react";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { logoutAction } from "@/server/actions/auth";
import { roleLabel, type RoleKey } from "@/lib/i18n/de";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ user }: { user: { displayName: string; email: string; role: RoleKey } | null }) {
  const [pending, start] = useTransition();
  if (!user) {
    return (
      <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>
        <LogIn aria-hidden="true" /> Anmelden
      </Link>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Benutzermenü" />}>
        <UserRound />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="text-foreground block font-semibold">{user.displayName}</span>
            <span className="text-muted-foreground block text-xs">{roleLabel[user.role]}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/profile" />} className="min-h-11">
          <UserRound aria-hidden="true" /> Profil
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await logoutAction();
              window.location.href = "/";
            })
          }
        >
          <LogOut aria-hidden="true" /> Abmelden
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
