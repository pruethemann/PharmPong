import type { Metadata } from "next";
import { AdminUsers } from "@/components/admin/users/admin-users";
import { PageTitle } from "@/components/pp/section";
import { requirePageUser } from "@/server/auth/current";
import { getUserCounts, listUsers } from "@/server/services/users";

export const metadata: Metadata = { title: "Admin · Benutzer" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await requirePageUser("ADMIN", "/admin/users");
  const [users, counts] = await Promise.all([listUsers(user), getUserCounts(user)]);
  return (
    <>
      <PageTitle kicker="Turnierleitung" title="Benutzer" />
      <AdminUsers
        meId={user.id}
        initialCounts={counts}
        initial={users.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          role: u.role,
          isActive: u.isActive,
          mustChangePassword: u.mustChangePassword,
          team: u.team,
        }))}
      />
    </>
  );
}
