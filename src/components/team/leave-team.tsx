"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HoldToConfirm } from "@/components/pp/hold-to-confirm";
import { leaveTeamAction } from "@/server/actions/teams";

export function LeaveTeam({ lastMember }: { lastMember: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function leave() {
    start(async () => {
      const res = await leaveTeamAction();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(res.data.dissolved ? "Team aufgelöst" : "Du hast das Team verlassen");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">
        {lastMember
          ? "Du bist das letzte Mitglied: Wenn du gehst, wird das Team aufgelöst und der Name wieder frei."
          : "Deine Partnerin oder dein Partner bleibt im Team und kann jemand Neues einladen."}
      </p>
      <HoldToConfirm onConfirm={leave} disabled={pending}>
        {pending ? "Wird verlassen …" : "Gedrückt halten: Team verlassen"}
      </HoldToConfirm>
    </div>
  );
}
