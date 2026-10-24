"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AdminField, aria } from "@/components/admin/fields";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import { cn } from "@/lib/utils";
import { updateSettingsAction } from "@/server/actions/tournament";

const schema = z.object({
  name: z.string().trim().min(2, "Mindestens 2 Zeichen.").max(80, "Höchstens 80 Zeichen."),
  durationMin: z
    .number({ error: "Bitte eine Zahl eingeben." })
    .int("Ganze Minuten.")
    .min(5, "Mindestens 5 Minuten.")
    .max(60, "Höchstens 60 Minuten."),
  bombRuleEnabled: z.boolean(),
  publicDisplayEnabled: z.boolean(),
});
type Values = z.infer<typeof schema>;

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="bg-muted/30 flex min-h-14 items-center justify-between gap-4 rounded-xl border px-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} id={`${id}-label`} className="cursor-pointer font-semibold">
          {label}
        </label>
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
      />
    </div>
  );
}

export function SettingsForm({
  initial,
  runner,
  online,
  locked,
  runningMatches,
}: {
  initial: {
    name: string;
    matchDurationSec: number;
    bombRuleEnabled: boolean;
    publicDisplayEnabled: boolean;
  };
  runner: ReturnType<typeof useAdminAction>;
  online: boolean;
  /** Tournament finished: settings are read-only. */
  locked: boolean;
  /** Matches currently running or awaiting confirmation: the duration is frozen meanwhile. */
  runningMatches: number;
}) {
  const defaults: Values = {
    name: initial.name,
    durationMin: Math.round(initial.matchDurationSec / 60),
    bombRuleEnabled: initial.bombRuleEnabled,
    publicDisplayEnabled: initial.publicDisplayEnabled,
  };
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults, values: defaults });

  const onSubmit = handleSubmit(async (v) => {
    await runner.run(
      "settings",
      () =>
        updateSettingsAction({
          name: v.name,
          matchDurationSec: v.durationMin * 60,
          bombRuleEnabled: v.bombRuleEnabled,
          publicDisplayEnabled: v.publicDisplayEnabled,
        }),
      {
        success: "Einstellungen gespeichert.",
        onOk: () => reset(v),
        onError: (f) => {
          const field = (f.details?.field as string | undefined) ?? Object.keys(f.fieldErrors ?? {})[0];
          if (field === "name") setError("name", { message: f.message });
          else if (field === "matchDurationSec") setError("durationMin", { message: f.message });
          else return false;
          return true;
        },
      },
    );
  });

  const disabled = locked || !online;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <AdminField id="set-name" label="Turniername" error={errors.name?.message}>
        <Input
          {...aria("set-name", errors.name?.message)}
          maxLength={80}
          disabled={locked}
          {...register("name")}
        />
      </AdminField>
      <AdminField
        id="set-duration"
        label="Spieldauer in Minuten"
        hint={
          runningMatches > 0
            ? `Gesperrt, solange ein Spiel läuft oder auf Bestätigung wartet (aktuell ${runningMatches}).`
            : "Gilt für neu gestartete Spiele. Nicht änderbar, solange ein Spiel läuft."
        }
        error={errors.durationMin?.message}
      >
        <Input
          {...aria("set-duration", errors.durationMin?.message, true)}
          type="number"
          inputMode="numeric"
          min={5}
          max={60}
          disabled={locked}
          // readOnly (not disabled) keeps the value in the form so other settings can still be saved.
          readOnly={runningMatches > 0}
          aria-readonly={runningMatches > 0 || undefined}
          className={cn(
            "max-w-40",
            runningMatches > 0 && "text-muted-foreground cursor-not-allowed opacity-60",
          )}
          {...register("durationMin", { valueAsNumber: true })}
        />
      </AdminField>
      <Controller
        control={control}
        name="bombRuleEnabled"
        render={({ field }) => (
          <SwitchRow
            id="set-bomb"
            label="Bomb-Regel"
            hint="Zwei Bälle im selben Becher entfernen einen zusätzlichen Becher."
            checked={field.value}
            onChange={field.onChange}
            disabled={locked}
          />
        )}
      />
      <Controller
        control={control}
        name="publicDisplayEnabled"
        render={({ field }) => (
          <SwitchRow
            id="set-public"
            label="Öffentliche Anzeige"
            hint="/display ohne Login sichtbar (nie mit privaten Daten)."
            checked={field.value}
            onChange={field.onChange}
            disabled={locked}
          />
        )}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={disabled || !isDirty || runner.pending !== null}>
          {runner.pending === "settings" ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}
          {runner.pending === "settings" ? "Wird gespeichert …" : "Einstellungen speichern"}
        </Button>
        {isDirty && (
          <Button type="button" variant="ghost" size="lg" onClick={() => reset(defaults)}>
            Verwerfen
          </Button>
        )}
      </div>
    </form>
  );
}
