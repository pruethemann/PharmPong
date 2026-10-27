"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useValidationText } from "@/i18n/use-validation-text";

/** Label + control + hint + inline error, wired with aria-describedby. */
export function Field({
  id,
  label,
  hint,
  error: rawError,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  const error = useValidationText()(rawError);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-base">
        {label}
      </Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-destructive flex items-start gap-1.5 text-sm font-medium">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/** aria props for an input rendered inside <Field>. */
export function fieldAria(id: string, error?: string, hasHint = false) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
  } as const;
}

/** Password input with a 48px show/hide toggle. Paste stays allowed. */
export function PasswordInput({ className, ...props }: ComponentProps<"input">) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn("pr-14", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0 rounded-l-none"
        aria-label={visible ? t("hidePassword") : t("showPassword")}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}

/** Server-side error or success message, announced to screen readers. */
export function FormAlert({
  message,
  tone = "error",
}: {
  message?: string | null;
  tone?: "error" | "success";
}) {
  return (
    <div role={tone === "error" ? "alert" : "status"} aria-live="polite">
      {message && (
        <p
          className={cn(
            "flex items-start gap-2 rounded-xl border p-3 text-sm font-medium",
            tone === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-success/40 bg-success/10 text-success",
          )}
        >
          {tone === "error" ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          {message}
        </p>
      )}
    </div>
  );
}

/** Copy server-side field errors from an ActionResult into react-hook-form. */
export function applyFieldErrors<K extends string>(
  fieldErrors: Record<string, string> | undefined,
  known: readonly K[],
  setError: (name: K, error: { type: string; message: string }) => void,
): boolean {
  if (!fieldErrors) return false;
  let applied = false;
  for (const [k, message] of Object.entries(fieldErrors)) {
    if ((known as readonly string[]).includes(k)) {
      setError(k as K, { type: "server", message });
      applied = true;
    }
  }
  return applied;
}
