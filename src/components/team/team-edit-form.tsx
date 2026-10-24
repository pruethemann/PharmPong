"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { updateTeamAction } from "@/server/actions/teams";
import { MOTTO_MAX, TEAM_NAME_MAX } from "@/lib/validation/team";
import { FormField, describedBy } from "./form-field";

export function TeamEditForm({
  teamId,
  version,
  name,
  motto,
  nameEditable,
}: {
  teamId: string;
  version: number;
  name: string;
  motto: string | null;
  nameEditable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(form: FormData) {
    start(async () => {
      const res = await updateTeamAction({
        teamId,
        expectedVersion: version,
        ...(nameEditable ? { name: String(form.get("name") ?? "") } : {}),
        motto: String(form.get("motto") ?? ""),
      });
      if (!res.ok) {
        if (res.code === "STALE_VERSION") {
          toast.warning(res.message);
          router.refresh();
          return;
        }
        setErrors(
          res.fieldErrors ?? (res.code === "NAME_TAKEN" ? { name: res.message } : { _: res.message }),
        );
        return;
      }
      setErrors({});
      toast.success("Gespeichert");
      router.refresh();
    });
  }

  return (
    // key on version resets the uncontrolled fields after a refresh
    <form key={version} action={submit} className="flex flex-col gap-4" noValidate>
      <FormField
        id="edit-name"
        label="Teamname"
        error={errors.name}
        hint={nameEditable ? undefined : "Nach der Teamsperre nur via Turnierleitung änderbar."}
      >
        <Input
          id="edit-name"
          name="name"
          defaultValue={name}
          disabled={!nameEditable}
          required
          maxLength={TEAM_NAME_MAX}
          autoComplete="off"
          aria-invalid={!!errors.name}
          aria-describedby={describedBy("edit-name", errors.name, !nameEditable)}
        />
      </FormField>
      <FormField id="edit-motto" label="Motto" error={errors.motto}>
        <Textarea
          id="edit-motto"
          name="motto"
          rows={2}
          defaultValue={motto ?? ""}
          maxLength={MOTTO_MAX}
          autoComplete="off"
          aria-invalid={!!errors.motto}
          aria-describedby={describedBy("edit-motto", errors.motto)}
        />
      </FormField>
      {errors._ && (
        <p role="alert" className="text-destructive text-sm font-medium">
          {errors._}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending} className="self-start">
        {pending ? "Wird gespeichert …" : "Änderungen speichern"}
      </Button>
    </form>
  );
}
