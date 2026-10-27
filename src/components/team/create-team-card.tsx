"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createTeamAction } from "@/server/actions/teams";
import { MOTTO_MAX, TEAM_NAME_MAX, TEAM_NAME_MIN } from "@/lib/validation/team";
import { FormField, describedBy } from "./form-field";

export function CreateTeamCard() {
  const t = useTranslations("team.create");
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
      toast.success(t("created"));
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
            {t("title")}
          </h2>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
      </div>
      <form action={submit} className="flex flex-col gap-4" noValidate>
        <FormField
          id="team-name"
          label={t("nameLabel")}
          error={errors.name}
          hint={t("nameHint", { min: TEAM_NAME_MIN, max: TEAM_NAME_MAX })}
        >
          <Input
            id="team-name"
            name="name"
            required
            minLength={TEAM_NAME_MIN}
            maxLength={TEAM_NAME_MAX}
            autoComplete="off"
            placeholder={t("namePlaceholder")}
            aria-invalid={!!errors.name}
            aria-describedby={describedBy("team-name", errors.name, true)}
          />
        </FormField>
        <FormField id="team-motto" label={t("mottoLabel")} error={errors.motto}>
          <Textarea
            id="team-motto"
            name="motto"
            rows={2}
            maxLength={MOTTO_MAX}
            autoComplete="off"
            placeholder={t("mottoPlaceholder")}
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
          {pending ? t("submitting") : t("submit")}
        </Button>
      </form>
    </section>
  );
}
