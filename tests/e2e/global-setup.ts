// Runs once before all projects (after the web server is up):
// migrate the e2e database, put it into a known state and log in each role via the real UI.
import fs from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";
import { loginViaUi } from "./support/auth";
import { clearThrottles, migrate, scenario } from "./support/db";
import { AUTH_DIR, BASE_URL, USERS, storageStateFor, type Role } from "./support/env";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  migrate();
  await clearThrottles();
  scenario("registration"); // creates dev-admin, schiri and demo01..24 (password "pharmapong-demo")

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const role of Object.keys(USERS) as Role[]) {
      const context = await browser.newContext({ baseURL: BASE_URL, locale: "de-CH" });
      const page = await context.newPage();
      await loginViaUi(page, USERS[role]);
      await context.storageState({ path: storageStateFor(role) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
