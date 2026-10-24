// UI QA helper: screenshot a page (optionally logged in) and report layout problems.
//   pnpm tsx tests/tools/shot.ts --base http://localhost:3101 --path /referee \
//     --login schiri@pharmapong.test --width 390 --height 844 --out .shots/a/referee.png [--full] [--wait 1500]
// Prints JSON: { url, status, horizontalOverflow, smallTargets[], consoleErrors[] }.
import { chromium } from "@playwright/test";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

async function main() {
  const base = arg("base", "http://localhost:3000")!;
  const path = arg("path", "/")!;
  const width = Number(arg("width", "390"));
  const height = Number(arg("height", "844"));
  const out = arg("out", `.shots/shot-${Date.now()}.png`)!;
  const login = arg("login");
  const password = arg("password", "pharmapong-demo")!;
  const wait = Number(arg("wait", "1200"));
  const reducedMotion = arg("reduced-motion") === "true";

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
    locale: "de-CH",
    timezoneId: "Europe/Zurich",
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 300)));

  if (login) {
    await page.goto(`${base}/login`);
    await page.getByLabel(/e-mail/i).fill(login);
    await page
      .getByLabel(/^passwort/i)
      .first()
      .fill(password);
    await page.getByRole("button", { name: /anmelden/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  }
  const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const small: string[] = [];
    document
      .querySelectorAll("a, button, [role=button], input, select, textarea, [role=tab]")
      .forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (r.height < 40 || r.width < 40) {
          const label = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.tagName)
            .trim()
            .slice(0, 40);
          small.push(`${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      });
    return {
      horizontalOverflow: doc.scrollWidth > window.innerWidth + 1,
      scrollWidth: doc.scrollWidth,
      smallTargets: small.slice(0, 30),
    };
  });
  await page.screenshot({ path: out, fullPage: arg("full") === "true" });
  console.log(
    JSON.stringify({ url: page.url(), status: res?.status(), out, ...report, consoleErrors }, null, 2),
  );
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
