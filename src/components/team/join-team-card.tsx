"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ticket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinTeamAction } from "@/server/actions/teams";
import { FormField, describedBy } from "./form-field";

export function JoinTeamCard() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();

  function submit() {
    start(async () => {
      const res = await joinTeamAction({ code });
      if (!res.ok) {
        setError(res.fieldErrors?.code ?? res.message);
        return;
      }
      setError(undefined);
      toast.success("Willkommen im Team!");
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="join-team-title" className="bg-card flex flex-col gap-5 rounded-2xl border p-5">
      <div className="flex items-center gap-3">
        <span className="bg-team-away/15 text-team-away inline-flex size-12 items-center justify-center rounded-2xl">
          <Ticket className="size-6" aria-hidden="true" />
        </span>
        <div>
          <h2 id="join-team-title" className="text-2xl leading-none">
            Team beitreten
          </h2>
          <p className="text-muted-foreground text-sm">Code von deiner Partnerin oder deinem Partner.</p>
        </div>
      </div>
      <form action={submit} className="flex flex-col gap-4" noValidate>
        <FormField id="join-code" label="Einladungscode" error={error} hint="8 Zeichen, z. B. K7Q2-M9XA">
          <Input
            id="join-code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            maxLength={16}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            className="font-display tabular h-14 text-center text-2xl tracking-[0.3em]"
            aria-invalid={!!error}
            aria-describedby={describedBy("join-code", error, true)}
          />
        </FormField>
        <Button type="submit" size="lg" variant="accent" disabled={pending || code.trim().length === 0}>
          {pending ? "Wird geprüft …" : "Team beitreten"}
        </Button>
      </form>
    </section>
  );
}
