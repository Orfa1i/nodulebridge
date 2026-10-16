import { expect, test } from "@playwright/test";

const ROUTES = ["/", "/passport", "/about", "/dev/kit"];
const BANNER = "Decision and adherence support only — not a diagnosis.";

for (const route of ROUTES) {
  test(`shell on ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("status").filter({ hasText: BANNER })).toBeVisible();
    await expect(page.getByAltText("Asklevia")).toBeVisible();
    await expect(page.getByText("NoduleBridge", { exact: true }).first()).toBeVisible();
    const logoSrc = await page.getByAltText("Asklevia").getAttribute("src");
    expect(logoSrc).toBe("/brand/asklevia-logo-horizontal.svg");
    const box = await page.getByAltText("Asklevia").boundingBox();
    expect(Math.round(box!.height)).toBe(28);
  });
}

test("fonts: heading, body, mono, Arabic", async ({ page }) => {
  await page.goto("/dev/kit");
  await page.evaluate(() => document.fonts.ready);
  const fam = (sel: string) =>
    page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await fam("h3")).toContain("Funnel Display");
  expect(await fam("main p")).toContain("Host Grotesk");
  const mono = page.getByTestId("mono-sample");
  expect(await mono.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Geist Mono");
  expect(await mono.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
  const ar = page.getByTestId("arabic-sample");
  expect(await ar.getAttribute("dir")).toBe("rtl");
  expect(await ar.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("IBM Plex Sans Arabic");
  expect(await ar.evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
  );
  for (const name of ["Funnel Display", "Host Grotesk", "Geist Mono"]) {
    expect(loaded.some((f) => f.includes(name)), `${name} loaded: ${loaded.join(",")}`).toBe(true);
  }
  expect(loaded.some((f) => f.includes("IBM Plex Sans Arabic"))).toBe(true);
});

test("keyboard: Tab reaches every nav item with a 2px focus ring", async ({ page }) => {
  await page.goto("/");
  const seen: string[] = [];
  for (let i = 0; i < 8 && seen.length < 3; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      return {
        text: el.textContent?.trim() ?? "",
        nav: !!el.closest(".ak-nav"),
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        outlineColor: cs.outlineColor,
      };
    });
    if (info.nav) {
      seen.push(info.text);
      expect(info.outlineStyle).toBe("solid");
      expect(info.outlineWidth).toBe("2px");
    }
  }
  expect(seen).toEqual(["Case", "Passport", "About"]);
});

test("spectrum only on progress bar, AI badge and one divider", async ({ page }) => {
  await page.goto("/dev/kit");
  const hits = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("main *, header *")) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg.includes("gradient") && bg.split("(")[0].includes("linear")) {
        const cls = (el as HTMLElement).className.toString();
        if (!/skeleton/.test(cls)) out.push(cls);
      }
    }
    return out;
  });
  for (const cls of hits) {
    expect(cls).toMatch(/ak-progress__bar|ak-badge--ai|ak-divider--spectrum/);
  }
  expect(hits.filter((c) => c.includes("ak-divider--spectrum")).length).toBeLessThanOrEqual(1);
});

test("nav links work", async ({ page }) => {
  await page.goto("/");
  for (const [name, path] of [["Passport", "/passport"], ["About", "/about"], ["Case", "/"]] as const) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : path}`));
  }
});
