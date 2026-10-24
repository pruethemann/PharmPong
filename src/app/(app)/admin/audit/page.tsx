import type { Metadata } from "next";
import { AuditList, type AuditFilters } from "@/components/admin/audit/audit-list";
import { PageTitle } from "@/components/pp/section";
import { requirePageUser } from "@/server/auth/current";
import { listAuditLog } from "@/server/services/admin-read";
import { getCurrentTournamentId } from "@/server/services/tx";

export const metadata: Metadata = { title: "Admin · Audit" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : null;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser("ADMIN", "/admin/audit");
  const sp = await searchParams;
  const filters: AuditFilters = {
    action: one(sp.action),
    entity: one(sp.entity),
    scope: one(sp.scope) === "all" ? "all" : "current",
    page: Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1),
  };
  const tournamentId = await getCurrentTournamentId();
  const data = await listAuditLog(user, {
    page: filters.page,
    actionPrefix: filters.action,
    entityType: filters.entity,
    scope: filters.scope,
    tournamentId,
  });
  return (
    <>
      <PageTitle kicker="Turnierleitung" title="Audit-Log" />
      <AuditList data={data} filters={{ ...filters, page: data.page }} />
    </>
  );
}
