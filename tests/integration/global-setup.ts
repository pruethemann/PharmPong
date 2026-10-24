import { execSync } from "node:child_process";

export default function setup() {
  const url =
    process.env.DATABASE_URL_TEST ?? "postgresql://pharmapong:pharmapong@localhost:54329/pharmapong_test";
  execSync("pnpm prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
}
