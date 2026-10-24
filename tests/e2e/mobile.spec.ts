// Phone usability on the key pages: no sideways scrolling, thumb-sized buttons.
// Runs on the "mobile" (Pixel 7) and "iphone" (iPhone 14 on Chromium) projects only.
import { expect, test, type Page } from "@playwright/test";
import { scenario } from "./support/db";
import { storageStateFor, type Role } from "./support/env";

test.describe.configure({ mode: "serial" });

const MIN_TARGET = 44;

test.beforeAll(() => {
  test.setTimeout(120_000);
  scenario("groups");
});

async function layoutProblems(page: Page) {
  return page.evaluate((min) => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth > window.innerWidth;
    const small: string[] = [];
    document
      .querySelectorAll<HTMLElement>(
        "button, [role=button], [role=tab], a[data-slot=button], [data-slot=button]",
      )
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || style.visibility === "hidden") return;
        if (el.closest("[aria-hidden=true], section[aria-label^='Notifications'], [data-sonner-toaster]"))
          return;
        if (r.height < min) {
          const label = (el.getAttribute("aria-label") || el.innerText || el.tagName)
            .trim()
            .replace(/\s+/g, " ");
          small.push(`${label.slice(0, 50)} (${Math.round(r.height)}px)`);
        }
      });
    return { overflow, scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, small };
  }, MIN_TARGET);
}

async function check(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), `${path} status`).toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main")).toBeVisible();
  const p = await layoutProblems(page);
  expect(p.overflow, `${path}: scrollWidth ${p.scrollWidth} > innerWidth ${p.innerWidth}`).toBe(false);
  expect(p.small, `${path}: buttons under ${MIN_TARGET}px`).toEqual([]);
}

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
        await check(page, path);
      });
    }
    if (role === "player") {
      test("/matches/<id> fits the phone", async ({ page }) => {
        await check(page, `/matches/${await anyMatchId(page)}`);
      });
    }
  });
}
