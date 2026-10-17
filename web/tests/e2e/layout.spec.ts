import { expect, test, type Page } from "@playwright/test";
import { analysisSettled, showTab } from "./helpers";

/**
 * The study view layout: a referral header, the CT viewer on the left, one tabbed result panel on the right with the
 * main actions in a footer. The long text lives inside the panel, so the page does not grow with it.
 * /extract is the REAL API (pre-computed extraction in the cache).
 */
async function open(page: Page, letter = "F") {
  await page.goto("/");
  await page.getByRole("button", { name: `Use example patient ${letter}` }).click();
}

test("the study view fits a laptop window: the study area ends inside the viewport and the panel scrolls itself", async ({ page }) => {
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await open(page);
    await analysisSettled(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator(".nb-study").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(box.bottom, `${width}x${height}: the viewer and the panel end inside the window`).toBeLessThanOrEqual(height);
    expect(box.top).toBeGreaterThan(150); // header and steps sit above
    // the long text scrolls inside the panel: the Report tab is much taller than the panel body, the page is not
    await showTab(page, "report");
    const m = await page.locator(".nb-result__body").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(m.scroll).toBeGreaterThan(m.client);
    await page.goto("/"); // back to a fresh state for the next size
    await page.getByTestId("all-studies").click().catch(() => undefined);
  }
});

test("the panel is beside the viewer on a wide screen and below it on a narrow one", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await analysisSettled(page);
  const wide = await page.evaluate(() => {
    const v = document.querySelector(".nb-study__viewer")!.getBoundingClientRect();
    const p = document.querySelector('[data-testid="result-panel"]')!.getBoundingClientRect();
    return { sideBySide: p.left >= v.right - 1 && Math.abs(p.top - v.top) < 4 };
  });
  expect(wide.sideBySide).toBe(true);
  await page.setViewportSize({ width: 820, height: 1000 });
  const narrow = await page.evaluate(() => {
    const v = document.querySelector(".nb-study__viewer")!.getBoundingClientRect();
    const p = document.querySelector('[data-testid="result-panel"]')!.getBoundingClientRect();
    return { stacked: p.top >= v.bottom - 1, noSideScroll: document.documentElement.scrollWidth <= window.innerWidth + 1 };
  });
  expect(narrow.stacked).toBe(true);
  expect(narrow.noSideScroll).toBe(true);
});

test("the study header shows the referral and the studies can be walked from it", async ({ page }) => {
  await open(page, "A");
  await analysisSettled(page);
  const head = page.getByTestId("study-header");
  await expect(head.getByRole("heading", { level: 1 })).toHaveText("Example patient A");
  for (const text of ["LIDC-IDRI-0213", "58 · M (fictional)", "CT chest, emergency department", "Right rib pain after a fall.", "Emergency department"]) await expect(head).toContainText(text);
  await expect(page.getByTestId("study-select")).toHaveValue("A");
});

test("tabs: reading shows the report, then the Next step tab opens; the person can open any tab and the footer stays", async ({ page }) => {
  await page.route("**/extract", async (route) => {
    await new Promise((r) => setTimeout(r, 900)); // a visible reading phase
    await route.continue();
  });
  await open(page);
  await expect(page.getByTestId("result-panel")).toHaveAttribute("data-active-tab", "report"); // the report is on screen while it is read
  await analysisSettled(page);
  await expect(page.getByTestId("nextstep")).toBeVisible();
  await expect(page.getByTestId("result-tab-nextstep")).toHaveAttribute("aria-selected", "true");
  for (const tab of ["findings", "report", "summary", "nextstep"] as const) {
    await showTab(page, tab);
    await expect(page.getByTestId("create-passport")).toBeVisible(); // the main actions never scroll away
    await expect(page.getByTestId("show-verification")).toBeVisible();
  }
});

test("each tab opens at its top, even after the report was scrolled", async ({ page }) => {
  await open(page);
  await analysisSettled(page);
  await showTab(page, "report");
  await page.locator(".nb-result__body").evaluate((el) => (el.scrollTop = el.scrollHeight));
  expect(await page.locator(".nb-result__body").evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
  await showTab(page, "summary");
  expect(await page.locator(".nb-result__body").evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByTestId("summary-found")).toBeInViewport();
});

test("before an analysis the Findings tab is open, with the Start analysis button", async ({ page }) => {
  await page.goto("/?case=A");
  await expect(page.getByTestId("result-panel")).toHaveAttribute("data-active-tab", "findings");
  await expect(page.getByRole("button", { name: "Start analysis" })).toBeVisible();
  await expect(page.getByTestId("create-passport")).toHaveCount(0); // nothing to take away yet
  await expect(page.getByTestId("show-verification")).toHaveCount(0);
});

test("a refresh keeps the finished study and opens on the Next step tab without replaying the sequence", async ({ page }) => {
  await open(page);
  await analysisSettled(page);
  await showTab(page, "report");
  await page.reload();
  await expect(page.getByTestId("result-panel")).toHaveAttribute("data-active-tab", "nextstep");
  await expect(page.getByTestId("nextstep")).toBeVisible();
});

test("the tab list is a proper tablist: roles, one tab stop, panels labelled by their tabs", async ({ page }) => {
  await open(page);
  await analysisSettled(page);
  const list = page.getByRole("tablist", { name: "Results" });
  await expect(list.getByRole("tab")).toHaveCount(4);
  await expect(list.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  for (const tab of ["nextstep", "findings", "report", "summary"]) {
    const controls = await page.getByTestId(`result-tab-${tab}`).getAttribute("aria-controls");
    const panel = page.locator(`#${controls}`);
    await expect(panel).toHaveAttribute("role", "tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", `result-tab-${tab}`);
  }
  await expect(page.locator('[role="tabpanel"].nb-result__panel:not([hidden])')).toHaveCount(1); // only the open tab is shown
});
