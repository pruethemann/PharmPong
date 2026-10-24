import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/pp/section";
import { Button } from "@/components/ui/button";
import { AUDIT_ACTION_PREFIXES, auditActionLabel, entityTypeLabel, formatZurich } from "@/lib/admin-labels";
import { cn } from "@/lib/utils";
import type { AuditPage, AuditScope } from "@/server/services/admin-read";

export type AuditFilters = { action: string | null; entity: string | null; scope: AuditScope; page: number };

export function auditHref(f: AuditFilters, patch: Partial<AuditFilters>): string {
  const next = { ...f, page: 1, ...patch };
  const p = new URLSearchParams();
  if (next.action) p.set("action", next.action);
  if (next.entity) p.set("entity", next.entity);
  if (next.scope !== "current") p.set("scope", next.scope);
  if (next.page > 1) p.set("page", String(next.page));
  const qs = p.toString();
  return `/admin/audit${qs ? `?${qs}` : ""}`;
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "true" : undefined}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors",
        on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{label}</p>
      <nav aria-label={label} className="-mx-4 [scrollbar-width:none] overflow-x-auto px-4 md:mx-0 md:px-0">
        <div className="flex w-max gap-2">{children}</div>
      </nav>
    </div>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">{label}</p>
      <pre className="bg-background max-h-72 overflow-auto rounded-xl border p-3 font-mono text-xs leading-relaxed whitespace-pre">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function AuditList({ data, filters }: { data: AuditPage; filters: AuditFilters }) {
  const { rows, page, pageCount, total } = data;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <ChipRow label="Bereich">
          <Chip href={auditHref(filters, { action: null })} on={!filters.action}>
            Alle
          </Chip>
          {AUDIT_ACTION_PREFIXES.map((p) => (
            <Chip
              key={p.value}
              href={auditHref(filters, { action: p.value })}
              on={filters.action === p.value}
            >
              {p.label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Objekt">
          <Chip href={auditHref(filters, { entity: null })} on={!filters.entity}>
            Alle
          </Chip>
          {data.entityTypes.map((t) => (
            <Chip key={t} href={auditHref(filters, { entity: t })} on={filters.entity === t}>
              {entityTypeLabel(t)}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="Zeitraum">
          <Chip href={auditHref(filters, { scope: "current" })} on={filters.scope === "current"}>
            Aktuelles Turnier
          </Chip>
          <Chip href={auditHref(filters, { scope: "all" })} on={filters.scope === "all"}>
            Alle Turniere
          </Chip>
        </ChipRow>
      </div>

      <p className="text-muted-foreground text-sm">
        {total} Einträge · Seite {page} von {pageCount} · neueste zuerst · Zeiten in Zürich
      </p>

      {rows.length === 0 ? (
        <EmptyState title="Keine Einträge">Kein Audit-Eintrag passt zu diesen Filtern.</EmptyState>
      ) : (
        <ol className="bg-card divide-y overflow-hidden rounded-2xl border">
          {rows.map((r) => {
            const expandable = r.before != null || r.after != null;
            const head = (
              <div className="grid w-full min-w-0 gap-1 lg:grid-cols-[11rem_10rem_minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-4">
                <span className="text-muted-foreground tabular text-sm">{formatZurich(r.createdAt)}</span>
                <span className="truncate text-sm font-semibold">
                  {r.actorName ?? (r.actorId ? "Gelöscht" : "System")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold" title={r.action}>
                    {auditActionLabel(r.action)}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {entityTypeLabel(r.entityType)}
                    {r.entityLabel ? ` · ${r.entityLabel}` : ` · ${r.entityId.slice(0, 10)}`}
                  </span>
                </span>
                <span
                  className={cn("min-w-0 truncate text-sm", r.reason ? "italic" : "text-muted-foreground")}
                >
                  {r.reason ? `«${r.reason}»` : "–"}
                </span>
              </div>
            );
            return (
              <li key={r.id}>
                {expandable ? (
                  <details className="group">
                    <summary className="hover:bg-muted/40 flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      {head}
                      <ChevronDown
                        className="text-muted-foreground size-5 shrink-0 transition-transform group-open:rotate-180"
                        aria-hidden="true"
                      />
                      <span className="sr-only">Details vorher/nachher</span>
                    </summary>
                    <div className="grid gap-3 border-t px-4 py-3 md:grid-cols-2">
                      <Json label="Vorher" value={r.before} />
                      <Json label="Nachher" value={r.after} />
                    </div>
                  </details>
                ) : (
                  <div className="flex min-h-12 items-center gap-3 px-4 py-3">
                    {head}
                    <span className="size-5 shrink-0" aria-hidden="true" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {pageCount > 1 && (
        <nav aria-label="Seiten" className="flex items-center justify-between gap-2">
          {page > 1 ? (
            <Button
              variant="outline"
              render={<Link href={auditHref(filters, { page: page - 1 })} />}
              nativeButton={false}
            >
              <ChevronLeft aria-hidden="true" /> Neuere
            </Button>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground tabular text-sm">
            {page} / {pageCount}
          </span>
          {page < pageCount ? (
            <Button
              variant="outline"
              render={<Link href={auditHref(filters, { page: page + 1 })} />}
              nativeButton={false}
            >
              Ältere <ChevronRight aria-hidden="true" />
            </Button>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
