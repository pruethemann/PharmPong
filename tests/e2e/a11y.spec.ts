// axe-core scan of the main pages: no "critical" or "serious" violations (WCAG 2.x A/AA).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { scenario } from "./support/db";
import { storageStateFor, type Role } from "./support/env";

// Not serial: every page is scanned and reported even if another one fails.

async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  // Let entry animations settle so colour contrast is measured on the final state.
  await page.waitForTimeout(800);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // Sonner's toast region is third-party and empty unless a toast is shown.
    .exclude("[data-sonner-toaster]")
    .analyze();
  const bad = results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes
        .slice(0, 5)
        .map((n) => `${n.target.join(" ")} :: ${n.failureSummary?.split("\n")[1] ?? ""}`),
    }));
  expect(bad, `${path}: ${JSON.stringify(bad, null, 2)}`).toEqual([]);
}

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
          await scan(page, path);
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
