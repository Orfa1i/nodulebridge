import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Accessibility (Phase 9, step 5): axe must report no serious or critical issue, and the main flow must work with the keyboard alone. */
const fixture = readFileSync(join(__dirname, "fixtures", "extract-case-a.json"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = bad.map((v) => `${label}: [${v.impact}] ${v.id}: ${v.help}\n${v.nodes.slice(0, 3).map((n) => `   ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1] ?? ""}`).join("\n")}`).join("\n");
  expect(bad, report).toEqual([]);
}

async function finished(page: Page) {
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture }));
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await expect(page.getByTestId("patient-summary")).toHaveAttribute("data-revealed", "true", { timeout: 20_000 });
}

test("axe: / (empty case workspace)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Drop a chest CT folder and its report, or")).toBeVisible();
  await audit(page, "/");
});

test("axe: /about", async ({ page }) => {
  await page.goto("/about");
  await audit(page, "/about");
});

test("axe: /passport (empty)", async ({ page }) => {
  await page.goto("/passport");
  await expect(page.getByTestId("passport-empty")).toBeVisible();
  await audit(page, "/passport empty");
});

test("axe: a finished case, the Arabic summary, the verification drawer", async ({ page }) => {
  await finished(page);
  await audit(page, "case done");
  await page.getByTestId("summary-tab-ar").click();
  await audit(page, "case done, Arabic summary");
  await page.getByTestId("show-verification").click();
  await expect(page.getByTestId("v-api-version")).toHaveText("0.1.0");
  await page.waitForTimeout(500); // the dialog fades in; contrast is measured on the settled colours
  await audit(page, "verification drawer");
});

test("axe: /passport with a passport, and the print route", async ({ page }) => {
  await finished(page);
  await page.getByTestId("create-passport").click();
  await expect(page.getByTestId("passport")).toBeVisible();
  await expect(page.getByTestId("booking-body")).toBeVisible();
  await audit(page, "/passport");
  await page.getByTestId("booking-lang-ar").click();
  await audit(page, "/passport, Arabic booking request");
  await page.goto("/passport/print");
  await expect(page.getByTestId("print-root")).toHaveAttribute("data-print-ready", "true", { timeout: 20_000 });
  await audit(page, "/passport/print");
});

test("keyboard only: the whole flow from the example buttons to the passport downloads", async ({ page }) => {
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture }));
  await page.goto("/");
  await expect(page.getByText("Drop a chest CT folder and its report, or")).toBeVisible();

  const reachByTab = async (locator: ReturnType<Page["getByTestId"]>, max = 80) => {
    for (let i = 0; i < max; i++) {
      if (await locator.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    throw new Error("could not reach the control with Tab");
  };

  // skip link is the first stop
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

  // an example is started with the keyboard
  const example = page.getByRole("button", { name: "Use example patient A" });
  for (let i = 0; i < 40 && !(await example.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(example).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });

  // the finding label and "Show verification" are real buttons: Tab reaches them, Enter works, Escape returns focus
  await reachByTab(page.getByTestId("show-verification"));
  await expect(page.getByTestId("show-verification")).toHaveCSS("outline-style", /solid|auto/); // visible focus
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("verification-drawer")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true); // focus stays inside the dialog
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("show-verification")).toBeFocused();

  // the Arabic tab is reachable and switches with Enter
  await reachByTab(page.getByTestId("summary-tab-ar"));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("summary-panel-ar")).toBeVisible();
  // Play summary is a button with a text label
  await reachByTab(page.getByTestId("voice-play"));
  await expect(page.getByTestId("voice-play")).toContainText(/\S/);

  // create the passport and download with the keyboard
  await reachByTab(page.getByTestId("create-passport"));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("passport")).toBeVisible();
  await reachByTab(page.getByTestId("dl-fhir"));
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.keyboard.press("Enter")]);
  expect(download.suggestedFilename()).toBe("nodulebridge-fhir-summary.json");
});

test("status is never shown by colour alone: every badge and alert carries text", async ({ page }) => {
  await finished(page);
  const empty = await page.locator(".ak-badge").evaluateAll((els) => els.filter((e) => !(e.textContent ?? "").trim() && !e.getAttribute("aria-label")).length);
  expect(empty).toBe(0);
  const emptyAlerts = await page.locator(".ak-alert").evaluateAll((els) => els.filter((e) => !(e.textContent ?? "").trim()).length);
  expect(emptyAlerts).toBe(0);
});

test("the Arabic panel declares lang=ar and dir=rtl for assistive technology", async ({ page }) => {
  await finished(page);
  await page.getByTestId("summary-tab-ar").click();
  const panel = page.getByTestId("summary-panel-ar");
  await expect(panel).toHaveAttribute("lang", "ar");
  await expect(panel).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("summary-tab-ar")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("tabpanel")).toHaveAttribute("lang", "ar");
});

test("axe self-check: the audit really catches a serious violation (so a clean result means something)", async ({ page }) => {
  await page.goto("/about");
  await page.evaluate(() => {
    const img = document.createElement("img"); // no alt text: critical
    img.src = "/brand/asklevia-symbol.svg";
    const button = document.createElement("button"); // no accessible name: critical
    document.body.append(img, button);
  });
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const ids = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id);
  expect(ids).toEqual(expect.arrayContaining(["image-alt", "button-name"]));
});
