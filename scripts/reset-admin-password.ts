// Break-glass: set a new password for an existing admin.
// Usage: railway run pnpm tsx scripts/reset-admin-password.ts <email>   (reads NEW_PASSWORD from env)
import "dotenv/config";
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { revokeUserSessions } from "../src/server/auth/sessions";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.env.NEW_PASSWORD;
  if (!email || !password || password.length < 10) {
    throw new Error("Usage: NEW_PASSWORD=... tsx scripts/reset-admin-password.ts <email> (min 10 chars)");
  }
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error("No such user");
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true, isActive: true },
  });
  await revokeUserSessions(user.id);
  await db.authThrottle.deleteMany({ where: { key: { contains: email } } });
  await db.auditLog.create({
    data: { action: "user.break_glass_reset", entityType: "User", entityId: user.id, reason: "CLI" },
  });
  console.log("[reset-admin-password] done; user must change the password at next login");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
