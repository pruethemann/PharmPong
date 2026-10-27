"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, LogOut, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { changePasswordAction, logoutAction, updateProfileAction } from "@/server/actions/auth";
import { PASSWORD_MIN, changePasswordSchema, profileSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, PasswordInput, applyFieldErrors, fieldAria } from "./form-bits";

export function DisplayNameForm({ displayName }: { displayName: string }) {
  const t = useTranslations("auth.profile");
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
      <FormAlert tone="success" message={saved ? t("nameSaved") : null} />
      <Field id="profile-name" label={t("displayNameLabel")} error={errors.displayName?.message}>
        <Input
          {...fieldAria("profile-name", errors.displayName?.message)}
          autoComplete="nickname"
          maxLength={40}
          {...register("displayName")}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={isSubmitting || !isDirty} className="self-start">
        {isSubmitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
        {isSubmitting ? t("saving") : t("saveName")}
      </Button>
    </form>
  );
}

export function ChangePasswordForm({ primary }: { primary: boolean }) {
  const t = useTranslations("auth.profile");
  const tErr = useTranslations("errors.specific");
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
        setError("currentPassword", { type: "server", message: tErr("currentPasswordWrong") });
      } else if (!applyFieldErrors(res.fieldErrors, ["currentPassword", "newPassword"] as const, setError)) {
        setServerError(res.message);
      }
      return;
    }
    reset();
    setSaved(true);
    toast.success(t("passwordChanged"));
    if (primary) {
      // The forced-change gate is lifted now: reload so the shell and guards see it.
      router.replace("/");
      router.refresh();
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert message={serverError} />
      <FormAlert tone="success" message={saved ? t("passwordChanged") : null} />
      <Field id="pw-current" label={t("currentPassword")} error={errors.currentPassword?.message}>
        <PasswordInput
          {...fieldAria("pw-current", errors.currentPassword?.message)}
          autoComplete="current-password"
          {...register("currentPassword")}
        />
      </Field>
      <Field
        id="pw-new"
        label={t("newPassword")}
        hint={t("passwordHint", { min: PASSWORD_MIN })}
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
        {isSubmitting ? t("saving") : t("changePasswordSubmit")}
      </Button>
    </form>
  );
}

export function LogoutButton() {
  const t = useTranslations("auth.profile");
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
      {t("logout")}
    </Button>
  );
}
