"use client";

import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Label + control + hint + inline error, wired via aria-describedby. */
export function AdminField({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
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

export function aria(id: string, error?: string | null, hasHint = false) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hasHint ? `${id}-hint` : undefined,
  } as const;
}

/** Reason textarea with a live character count (audited admin actions). */
export function ReasonField({
  id,
  value,
  onChange,
  min = 3,
  max = 500,
  label = "Begründung (fürs Audit-Log)",
  error,
  placeholder = "z. B. Team nicht erschienen",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  label?: string;
  error?: string | null;
  placeholder?: string;
}) {
  const len = value.trim().length;
  const hint = len < min ? `Mindestens ${min} Zeichen (noch ${min - len}).` : `${len}/${max} Zeichen`;
  return (
    <AdminField id={id} label={label} hint={hint} error={error}>
      <Textarea
        {...aria(id, error, true)}
        value={value}
        maxLength={max}
        rows={2}
        placeholder={placeholder}
        className="bg-input/30 min-h-20 rounded-xl px-3.5 text-base md:text-base"
        onChange={(e) => onChange(e.target.value)}
      />
    </AdminField>
  );
}

export const reasonOk = (v: string, min = 3) => v.trim().length >= min;

/** Typed confirmation: the user must type `expected` exactly. */
export function TypedConfirmField({
  id,
  expected,
  value,
  onChange,
}: {
  id: string;
  expected: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const ok = value.trim() === expected;
  return (
    <AdminField
      id={id}
      label={`Zur Bestätigung «${expected}» eintippen`}
      hint={ok ? "Bestätigung korrekt." : "Gross-/Kleinschreibung beachten."}
    >
      <Input
        {...aria(id, null, true)}
        value={value}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className={cn("font-mono tracking-wide", ok && "border-success")}
        onChange={(e) => onChange(e.target.value)}
      />
    </AdminField>
  );
}

/** Small "Inline" select styled like the Input (native select: robust on phones). */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "border-input bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full min-w-0 rounded-xl border px-3 text-base outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-[var(--popover)]",
        className,
      )}
    />
  );
}
