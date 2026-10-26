// Page-level checks shared by the specs: axe scan (WCAG 2.x A/AA) and phone layout.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** No "critical" or "serious" axe violations on `path`. */
export async function axeScan(page: Page, path: string): Promise<void> {
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

export const MIN_TARGET = 44;

/** Sideways scrolling and buttons below the minimum touch height. */
export async function layoutProblems(page: Page) {
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

/** The page loads, fits the phone width and has thumb-sized buttons. */
export async function checkPhoneLayout(page: Page, path: string): Promise<void> {
  const res = await page.goto(path);
  expect(res?.status(), `${path} status`).toBeLessThan(400);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("main")).toBeVisible();
  const p = await layoutProblems(page);
  expect(p.overflow, `${path}: scrollWidth ${p.scrollWidth} > innerWidth ${p.innerWidth}`).toBe(false);
  expect(p.small, `${path}: buttons under ${MIN_TARGET}px`).toEqual([]);
}
