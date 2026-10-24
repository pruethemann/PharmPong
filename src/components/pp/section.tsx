import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageTitle({ title, kicker, action }: { title: string; kicker?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 pt-2 pb-4">
      <div>
        {kicker && <p className="font-display text-primary text-sm tracking-widest">{kicker}</p>}
        <h1 className="text-4xl leading-none sm:text-5xl">{title}</h1>
      </div>
      {action}
    </div>
  );
}

export function Section({
  title,
  children,
  className,
  action,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2">
          {title && <h2 className="text-2xl leading-none">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
      {icon && <div className="text-primary [&_svg]:size-10">{icon}</div>}
      <p className="font-display text-xl">{title}</p>
      {children && <div className="text-muted-foreground">{children}</div>}
    </div>
  );
}
