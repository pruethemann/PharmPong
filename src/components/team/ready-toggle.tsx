"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleDashed } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setReadyAction } from "@/server/actions/teams";

export function ReadyToggle({ ready, disabled }: { ready: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggle() {
    start(async () => {
      const res = await setReadyAction({ ready: !ready });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(ready ? "Check-in zurückgenommen" : "Ihr seid eingecheckt!");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      size="lg"
      variant={ready ? "success" : "outline"}
      aria-pressed={ready}
      onClick={toggle}
      disabled={pending || disabled}
      className="w-full"
    >
      {ready ? <CircleCheck aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
      {ready ? "Ich bin bereit" : "Wir sind bereit"}
    </Button>
  );
}
