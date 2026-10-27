"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { registerAction } from "@/server/actions/auth";
import { PASSWORD_MIN, registerSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, PasswordInput, applyFieldErrors, fieldAria } from "./form-bits";
import { safeNext } from "./safe-next";

const FIELDS = ["displayName", "email", "password", "eventCode"] as const;

export function RegisterForm({ next, eventCodeRequired }: { next?: string; eventCodeRequired: boolean }) {
  const t = useTranslations("auth.register");
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: "", email: "", password: "", eventCode: "" },
  });
  const password = useWatch({ control, name: "password" }) ?? "";

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const res = await registerAction(values);
    if (!res.ok) {
      const applied = applyFieldErrors(res.fieldErrors, FIELDS, setError);
      if (res.code === "EMAIL_TAKEN") {
        setError("email", { type: "server", message: res.message });
      } else if (res.details?.field === "eventCode") {
        if (eventCodeRequired) {
          setError("eventCode", { type: "server", message: t("eventCodeWrong") });
        } else {
          // Field is hidden (page and server disagree): never fail silently.
          setServerError(res.message || t("eventCodeWrong"));
        }
      } else if (!applied) {
        setServerError(res.message);
      }
      throw new Error(res.code);
    }
    window.location.assign(safeNext(next, "/team"));
  });

  const busy = isSubmitting || isSubmitSuccessful;
  const remaining = Math.max(0, PASSWORD_MIN - password.length);

  return (
    <form
      onSubmit={(e) => void onSubmit(e).catch(() => undefined)}
      noValidate
      className="flex flex-col gap-5"
    >
      <FormAlert message={serverError} />
      <Field
        id="reg-name"
        label={t("displayName")}
        hint={t("displayNameHint")}
        error={errors.displayName?.message}
      >
        <Input
          {...fieldAria("reg-name", errors.displayName?.message, true)}
          autoComplete="nickname"
          maxLength={40}
          {...register("displayName")}
        />
      </Field>
      <Field id="reg-email" label={t("email")} hint={t("emailHint")} error={errors.email?.message}>
        <Input
          {...fieldAria("reg-email", errors.email?.message, true)}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          {...register("email")}
        />
      </Field>
      <Field
        id="reg-password"
        label={t("password")}
        hint={
          remaining > 0 ? t("passwordHintRemaining", { min: PASSWORD_MIN, remaining }) : t("passwordHintOk")
        }
        error={errors.password?.message}
      >
        <PasswordInput
          {...fieldAria("reg-password", errors.password?.message, true)}
          autoComplete="new-password"
          {...register("password")}
        />
      </Field>
      {eventCodeRequired && (
        <Field
          id="reg-event-code"
          label={t("eventCode")}
          hint={t("eventCodeHint")}
          error={errors.eventCode?.message}
        >
          <Input
            {...fieldAria("reg-event-code", errors.eventCode?.message, true)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            {...register("eventCode")}
          />
        </Field>
      )}
      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" /> {t("submitting")}
          </>
        ) : (
          <>
            <UserPlus aria-hidden="true" /> {t("submit")}
          </>
        )}
      </Button>
      <p className="text-muted-foreground text-center">
        {t("haveAccount")}{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(safeNext(next))}` : "/login"}
          className="text-primary inline-flex min-h-12 items-center font-semibold underline-offset-4 hover:underline"
        >
          {t("loginLink")}
        </Link>
      </p>
    </form>
  );
}
