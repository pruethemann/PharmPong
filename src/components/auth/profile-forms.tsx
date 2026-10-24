"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, LogOut, Save } from "lucide-react";
import { toast } from "sonner";
import { changePasswordAction, logoutAction, updateProfileAction } from "@/server/actions/auth";
import { PASSWORD_MIN, changePasswordSchema, profileSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, PasswordInput, applyFieldErrors, fieldAria } from "./form-bits";

export function DisplayNameForm({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ resolver: zodResolver(profileSchema), defaultValues: { displayName } });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSaved(false);
    const res = await updateProfileAction(values);
    if (!res.ok) {
      if (!applyFieldErrors(res.fieldErrors, ["displayName"] as const, setError)) setServerError(res.message);
      return;
    }
    reset(values);
    setSaved(true);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert message={serverError} />
      <FormAlert tone="success" message={saved ? "Name gespeichert." : null} />
      <Field id="profile-name" label="Anzeigename" error={errors.displayName?.message}>
        <Input
          {...fieldAria("profile-name", errors.displayName?.message)}
          autoComplete="nickname"
          maxLength={40}
          {...register("displayName")}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={isSubmitting || !isDirty} className="self-start">
        {isSubmitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
        {isSubmitting ? "Wird gespeichert …" : "Name speichern"}
      </Button>
    </form>
  );
}

export function ChangePasswordForm({ primary }: { primary: boolean }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSaved(false);
    const res = await changePasswordAction(values);
    if (!res.ok) {
      if (res.code === "INVALID_CREDENTIALS") {
        setError("currentPassword", { type: "server", message: "Das aktuelle Passwort ist falsch." });
      } else if (!applyFieldErrors(res.fieldErrors, ["currentPassword", "newPassword"] as const, setError)) {
        setServerError(res.message);
      }
      return;
    }
    reset();
    setSaved(true);
    toast.success("Passwort geändert. Andere Geräte wurden abgemeldet.");
    if (primary) {
      // The forced-change gate is lifted now: reload so the shell and guards see it.
      router.replace("/");
      router.refresh();
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert message={serverError} />
      <FormAlert
        tone="success"
        message={saved ? "Passwort geändert. Andere Geräte wurden abgemeldet." : null}
      />
      <Field id="pw-current" label="Aktuelles Passwort" error={errors.currentPassword?.message}>
        <PasswordInput
          {...fieldAria("pw-current", errors.currentPassword?.message)}
          autoComplete="current-password"
          {...register("currentPassword")}
        />
      </Field>
      <Field
        id="pw-new"
        label="Neues Passwort"
        hint={`Mindestens ${PASSWORD_MIN} Zeichen.`}
        error={errors.newPassword?.message}
      >
        <PasswordInput
          {...fieldAria("pw-new", errors.newPassword?.message, true)}
          autoComplete="new-password"
          {...register("newPassword")}
        />
      </Field>
      <Button
        type="submit"
        variant={primary ? "default" : "outline"}
        size={primary ? "lg" : "default"}
        disabled={isSubmitting}
        className={primary ? "w-full" : "self-start"}
      >
        {isSubmitting ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound aria-hidden="true" />
        )}
        {isSubmitting ? "Wird gespeichert …" : "Passwort ändern"}
      </Button>
    </form>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="destructive"
      disabled={pending}
      className="w-full sm:w-auto"
      onClick={() =>
        start(async () => {
          await logoutAction();
          router.replace("/");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
      Abmelden
    </Button>
  );
}
