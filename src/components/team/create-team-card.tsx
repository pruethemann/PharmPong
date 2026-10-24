"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createTeamAction } from "@/server/actions/teams";
import { MOTTO_MAX, TEAM_NAME_MAX } from "@/lib/validation/team";
import { FormField, describedBy } from "./form-field";

export function CreateTeamCard() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(form: FormData) {
    start(async () => {
      const res = await createTeamAction({
        name: String(form.get("name") ?? ""),
        motto: String(form.get("motto") ?? ""),
      });
      if (!res.ok) {
        setErrors(
          res.fieldErrors ?? (res.code === "NAME_TAKEN" ? { name: res.message } : { _: res.message }),
        );
        return;
      }
      setErrors({});
      toast.success("Team gegründet! Jetzt Partner:in einladen.");
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="create-team-title"
      className="bg-card flex flex-col gap-5 rounded-2xl border p-5"
    >
      <div className="flex items-center gap-3">
        <span className="bg-primary/15 text-primary inline-flex size-12 items-center justify-center rounded-2xl">
          <FlaskConical className="size-6" aria-hidden="true" />
        </span>
        <div>
          <h2 id="create-team-title" className="text-2xl leading-none">
            Team gründen
          </h2>
          <p className="text-muted-foreground text-sm">Du bekommst einen Einladungscode für dein Duo.</p>
        </div>
      </div>
      <form action={submit} className="flex flex-col gap-4" noValidate>
        <FormField id="team-name" label="Teamname" error={errors.name} hint="2 bis 32 Zeichen">
          <Input
            id="team-name"
            name="name"
            required
            minLength={2}
            maxLength={TEAM_NAME_MAX}
            autoComplete="off"
            placeholder="z. B. Die Pipettenprofis"
            aria-invalid={!!errors.name}
            aria-describedby={describedBy("team-name", errors.name, true)}
          />
        </FormField>
        <FormField id="team-motto" label="Motto (optional)" error={errors.motto}>
          <Textarea
            id="team-motto"
            name="motto"
            rows={2}
            maxLength={MOTTO_MAX}
            autoComplete="off"
            placeholder="Präzise bis zum letzten Becher"
            aria-invalid={!!errors.motto}
            aria-describedby={describedBy("team-motto", errors.motto)}
          />
        </FormField>
        {errors._ && (
          <p role="alert" className="text-destructive text-sm font-medium">
            {errors._}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Wird gegründet …" : "Team gründen"}
        </Button>
      </form>
    </section>
  );
}
