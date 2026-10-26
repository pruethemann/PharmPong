// axe-core scan of the main pages: no "critical" or "serious" violations (WCAG 2.x A/AA).
import { test } from "@playwright/test";
import { axeScan } from "./support/checks";
import { scenario } from "./support/db";
import { storageStateFor, type Role } from "./support/env";

// Not serial: every page is scanned and reported even if another one fails.

type Pages = { role: Role | null; paths: string[] }[];

const GROUP_STAGE: Pages = [
  { role: null, paths: ["/", "/login", "/register", "/tournament", "/rules", "/display"] },
  { role: "player", paths: ["/", "/tournament?tab=ko", "/team"] },
  { role: "referee", paths: ["/referee"] },
  { role: "admin", paths: ["/admin", "/admin/matches", "/admin/tournament"] },
];

// Finished tournament: decided matches (dimmed losers), full bracket, champion screen.
const COMPLETED: Pages = [
  { role: null, paths: ["/", "/tournament?tab=ko", "/tournament?tab=spielplan", "/display"] },
];

function scans(pages: Pages) {
  for (const { role, paths } of pages) {
    test.describe(`as ${role ?? "guest"}`, () => {
      if (role) test.use({ storageState: storageStateFor(role) });
      for (const path of paths) {
        test(`${path} has no serious axe violations`, async ({ page }) => {
          await axeScan(page, path);
        });
      }
    });
  }
}

test.describe("a11y, group stage", () => {
  test.beforeAll(() => {
    test.setTimeout(120_000);
    scenario("groups");
  });
  scans(GROUP_STAGE);
});

test.describe("a11y, completed tournament", () => {
  test.beforeAll(() => {
    test.setTimeout(120_000);
    scenario("completed");
  });
  scans(COMPLETED);
});
