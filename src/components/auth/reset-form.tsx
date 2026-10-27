"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, KeyRound, Loader2, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { redeemResetAction } from "@/server/actions/auth";
import { PASSWORD_MIN, resetPasswordSchema } from "@/lib/validation/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FormAlert, PasswordInput, applyFieldErrors, fieldAria } from "./form-bits";

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("auth.reset");
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, newPassword: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const res = await redeemResetAction(values);
    if (!res.ok) {
      if (res.code === "NOT_FOUND") {
        setServerError(t("linkUnusable"));
      } else if (!applyFieldErrors(res.fieldErrors, ["newPassword"] as const, setError)) {
        setServerError(res.fieldErrors?.token ? t("linkInvalid") : res.message);
      }
      return;
    }
    setDone(true);
  });

  if (done) {
    return (
      <div className="flex flex-col gap-5" role="status">
        <p className="text-success flex items-start gap-2 text-lg font-semibold">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
          {t("done")}
        </p>
        <Link href="/login" className={buttonVariants({ size: "lg", className: "w-full" })}>
          <LogIn aria-hidden="true" /> {t("toLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <FormAlert message={serverError} />
      <input type="hidden" {...register("token")} />
      <Field
        id="reset-password"
        label={t("newPassword")}
        hint={t("hint", { min: PASSWORD_MIN })}
        error={errors.newPassword?.message}
      >
        <PasswordInput
          {...fieldAria("reset-password", errors.newPassword?.message, true)}
          autoComplete="new-password"
          {...register("newPassword")}
        />
      </Field>
      <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
        {isSubmitting ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound aria-hidden="true" />
        )}
        {isSubmitting ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
