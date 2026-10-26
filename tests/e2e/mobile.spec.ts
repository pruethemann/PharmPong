// Phone usability on the key pages: no sideways scrolling, thumb-sized buttons.
// Runs on the "mobile" (Pixel 7) and "iphone" (iPhone 14 on Chromium) projects only.
import { test, type Page } from "@playwright/test";
import { checkPhoneLayout } from "./support/checks";
import { scenario } from "./support/db";
import { storageStateFor, type Role } from "./support/env";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.setTimeout(120_000);
  scenario("groups");
});

async function anyMatchId(page: Page): Promise<string> {
  const json = await (await page.request.get("/api/live")).json();
  const m = json.matches.find((x: { status: string }) => x.status === "IN_PROGRESS") ?? json.matches[0];
  return m.id;
}

const PAGES: { role: Role | null; paths: string[] }[] = [
  { role: null, paths: ["/", "/rules", "/login", "/register"] },
  {
    role: "player",
    paths: [
      "/",
      "/tournament?tab=gruppen",
      "/tournament?tab=ko",
      "/tournament?tab=spielplan",
      "/team",
      "/rules",
    ],
  },
  { role: "referee", paths: ["/referee"] },
];

for (const { role, paths } of PAGES) {
  test.describe(`${role ?? "guest"} @mobile-only`, () => {
    if (role) test.use({ storageState: storageStateFor(role) });
    for (const path of paths) {
      test(`${path} fits the phone`, async ({ page }) => {
        await checkPhoneLayout(page, path);
      });
    }
    if (role === "player") {
      test("/matches/<id> fits the phone", async ({ page }) => {
        await checkPhoneLayout(page, `/matches/${await anyMatchId(page)}`);
      });
    }
  });
}
