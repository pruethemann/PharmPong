"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { loginAction } from "@/server/actions/auth";
import { loginSchema } from "@/lib/validation/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormAlert, PasswordInput, applyFieldErrors, fieldAria } from "./form-bits";
import { safeNext } from "./safe-next";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("auth.login");
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const res = await loginAction(values);
    if (!res.ok) {
      applyFieldErrors(res.fieldErrors, ["email", "password"] as const, setError);
      setServerError(res.message);
      throw new Error(res.code); // keeps isSubmitSuccessful false
    }
    const target = res.data.mustChangePassword ? "/profile?mustChange=1" : safeNext(next, "/");
    // Full navigation so the server-rendered shell picks up the new session.
    window.location.assign(target);
  });

  const busy = isSubmitting || isSubmitSuccessful;

  return (
    <form
      onSubmit={(e) => void onSubmit(e).catch(() => undefined)}
      noValidate
      className="flex flex-col gap-5"
    >
      <FormAlert message={serverError} />
      <Field id="login-email" label={t("email")} error={errors.email?.message}>
        <Input
          {...fieldAria("login-email", errors.email?.message)}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          {...register("email")}
        />
      </Field>
      <Field id="login-password" label={t("password")} error={errors.password?.message}>
        <PasswordInput
          {...fieldAria("login-password", errors.password?.message)}
          autoComplete="current-password"
          {...register("password")}
        />
      </Field>
      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" /> {t("submitting")}
          </>
        ) : (
          <>
            <LogIn aria-hidden="true" /> {t("submit")}
          </>
        )}
      </Button>
      <p className="text-muted-foreground text-center">
        {t("noAccount")}{" "}
        <Link
          href={next ? `/register?next=${encodeURIComponent(safeNext(next))}` : "/register"}
          className="text-primary inline-flex min-h-12 items-center font-semibold underline-offset-4 hover:underline"
        >
          {t("registerLink")}
        </Link>
      </p>
      <p className="text-muted-foreground text-center text-sm">{t("forgot")}</p>
    </form>
  );
}
