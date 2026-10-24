import { AdminSubnav } from "@/components/admin/admin-subnav";
import { getCurrentUser, hasRole } from "@/server/auth/current";

// Each page guards itself with requirePageUser("ADMIN", <path>) so the login
// redirect returns to the right sub-page. The layout only renders the sub-nav for admins.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const admin = hasRole(user, "ADMIN") && !user?.mustChangePassword;
  return (
    <div className="flex flex-col gap-6">
      {admin && <AdminSubnav />}
      {children}
    </div>
  );
}
