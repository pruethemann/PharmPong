"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { logoutAction } from "@/server/actions/auth";
import type { RoleKey } from "@/lib/i18n/de";
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
  const t = useTranslations("shell");
  const tRoles = useTranslations("roles");
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!user) {
    return (
      <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>
        <LogIn aria-hidden="true" /> {t("signIn")}
      </Link>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("userMenu")} />}>
        <UserRound />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="text-foreground block font-semibold">{user.displayName}</span>
            <span className="text-muted-foreground block text-xs">{tRoles(user.role)}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/profile" />} className="min-h-11">
          <UserRound aria-hidden="true" /> {t("profile")}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="min-h-11"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await logoutAction();
              router.replace("/");
              router.refresh();
            })
          }
        >
          <LogOut aria-hidden="true" /> {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
