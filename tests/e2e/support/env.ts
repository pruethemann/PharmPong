// Shared constants for the e2e suite (config, global setup and specs).
import path from "node:path";

export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;
export const E2E_DATABASE_URL =
  process.env.DATABASE_URL_E2E ?? "postgresql://pharmapong:pharmapong@localhost:54329/pharmapong_e2e";

/** Environment for the app server and for scripts that touch the e2e database. */
export const E2E_ENV: Record<string, string> = {
  NEXT_DIST_DIR: ".next-e2e",
  DATABASE_URL: E2E_DATABASE_URL,
  APP_URL: BASE_URL,
  STORAGE_DRIVER: "memory",
  ALLOW_MEMORY_STORAGE: "true",
  ALLOW_DEMO_SEED: "true",
  EVENT_CODE: "",
};

export const DEMO_PASSWORD = "pharmapong-demo";
export const USERS = {
  admin: "dev-admin@pharmapong.test",
  referee: "schiri@pharmapong.test",
  player: "demo01@pharmapong.test",
} as const;
export type Role = keyof typeof USERS;

export const AUTH_DIR = path.join(__dirname, "..", ".auth");
export const storageStateFor = (role: Role) => path.join(AUTH_DIR, `${role}.json`);
