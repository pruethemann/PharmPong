import type { ReactNode } from "react";
import { LogoMark } from "@/components/pp/logo";

/** Centered single-column card for login / register / reset. */
export function AuthCard({
  kicker,
  title,
  subtitle,
  children,
  footer,
}: {
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 pt-2 sm:pt-8">
      <div className="flex items-center gap-4">
        <LogoMark className="size-14 shrink-0" title="" />
        <div>
          {kicker && <p className="font-display text-primary text-sm tracking-widest">{kicker}</p>}
          <h1 className="text-4xl leading-none">{title}</h1>
        </div>
      </div>
      {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      <div className="bg-card rounded-2xl border p-5 sm:p-6">{children}</div>
      {footer}
    </div>
  );
}
