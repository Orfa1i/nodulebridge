import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { showTab } from "./helpers";

/**
 * "Guideline next step" card. /extract is the mocked-model fixture (see extract-ui.spec.ts);
 * /recommend is the REAL deterministic engine on the running API.
 */
const fixtureJson = (letter: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", `extract-case-${letter.toLowerCase()}.json`), "utf8"));

async function openAndAnalyse(page: Page, letter: string, patch?: (body: ReturnType<typeof fixtureJson>) => void) {
  const body = fixtureJson(letter);
  patch?.(body);
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
  await page.goto(`/?case=${letter}`);
  await showTab(page, "nextstep");
  await expect(page.getByText("No next step yet")).toBeVisible();
  await showTab(page, "findings"); // the Start analysis button lives with the findings
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByTestId("result-panel")).toHaveAttribute("data-active-tab", "nextstep", { timeout: 60_000 }); // the analysis opens it when done
  await expect(page.getByTestId("nextstep")).toBeVisible();
}

/** Same calendar arithmetic as the API: add months, clamp to the end of a short month. */
function addMonths(d: Date, months: number): Date {
  const out = new Date(Date.UTC(d.getFullYear(), d.getMonth() + months, 1));
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(d.getDate(), lastDay));
  return out;
}
const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);

test("case A: headline, due window, why and citation come from the rule; the answer is conditional", async ({ page }) => {
  await openAndAnalyse(page, "A");
  const card = page.locator("section[aria-labelledby=\"nextstep-title\"]");
  await expect(card.locator(".ak-badge--brand")).toHaveText("Guideline rule");
  await expect(card.locator(".ak-badge--ai")).toHaveCount(0); // a rule is never labelled as AI

  await expect(page.getByTestId("nextstep-headline")).toHaveText("Consider a CT in about 3 months, a PET-CT, or a biopsy.");
  expect(await page.getByTestId("nextstep-headline").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Funnel Display");
  await expect(page.getByTestId("nextstep-window")).toHaveText(`CT window opens ${fmt(addMonths(new Date(), 3))}`);
  expect(await page.getByTestId("nextstep-window").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Geist Mono");

  await expect(page.getByTestId("nextstep-why")).toHaveText(
    "Single solid nodule, 9 mm (the report gives one dimension), Fleischner 2017, rule FL17-S1-GT8.",
  );
  const link = card.getByRole("link", { name: /Fleischner Society 2017 guideline/ });
  await expect(link).toHaveAttribute("href", /doi\.org/);
  await expect(link).toHaveAttribute("rel", /noopener/);

  const warning = card.locator(".ak-alert--warning");
  await expect(warning).toContainText("This depends on your answers");
  await expect(warning).toContainText("Is your immune system weakened?");
  await expect(card.getByRole("button", { name: "My immune system is not weakened" })).toHaveAttribute("aria-pressed", "false");
  await expect(card.getByText("Upper lobe location (stated in the report)")).toBeVisible();
  await expect(card.getByText("Former smoking (stated in the report)")).toBeVisible();
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-S1-GT8");
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-applies", "conditional");
});

test("case A: confirming an answer re-runs the engine and clears the conditional", async ({ page }) => {
  await openAndAnalyse(page, "A");
  const chip = page.getByRole("button", { name: "My immune system is not weakened" });
  await chip.click();
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-applies", "true");
  await expect(page.locator(".ak-alert--warning")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "My immune system is not weakened" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("nextstep-headline")).toHaveText("Consider a CT in about 3 months, a PET-CT, or a biopsy.");
  // the answer can be taken back
  await page.getByRole("button", { name: "My immune system is not weakened" }).click();
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-applies", "conditional");
});

test("case B: both risk options are shown with their labels", async ({ page }) => {
  await openAndAnalyse(page, "B");
  const options = page.getByTestId("nextstep-option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("If your doctor considers your risk low");
  await expect(options.nth(0)).toContainText("Consider a CT in 6 to 12 months, then possibly another in 18 to 24 months.");
  await expect(options.nth(1)).toContainText("If your doctor considers your risk higher");
  await expect(options.nth(1)).toContainText("A CT in 6 to 12 months, then another in 18 to 24 months.");
  await expect(options.nth(0).getByTestId("nextstep-window")).toHaveText(
    `CT window ${fmt(addMonths(new Date(), 6))} to ${fmt(addMonths(new Date(), 12))}`,
  );
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-S1-6TO8");
});

test("case C: the subsolid rule applies with no questions", async ({ page }) => {
  await openAndAnalyse(page, "C");
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-GGN1-GE6");
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-applies", "true");
  await expect(page.locator(".nb-nextstep .ak-alert")).toHaveCount(0);
  await expect(page.getByTestId("nextstep-headline")).toContainText("A CT in 6 to 12 months");
  await expect(page.getByTestId("nextstep-why")).toContainText("Single ground-glass nodule, 16 mm");
});

test("known cancer: the guideline does not apply, with the reason and the doctor line", async ({ page }) => {
  await openAndAnalyse(page, "A", (b) => {
    b.result.patient_context.known_cancer.value = true;
  });
  const info = page.locator(".nb-nextstep .ak-alert--info");
  await expect(info).toContainText("The guideline does not apply here.");
  await expect(info).toContainText("known cancer");
  await expect(info).toContainText("Ask your doctor about follow-up.");
  await expect(page.getByTestId("nextstep-headline")).toHaveCount(0);
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-applies", "false");
});

test("benign calcification: not applicable, never a made-up interval", async ({ page }) => {
  await openAndAnalyse(page, "A", (b) => {
    b.result.nodules[0].benign_features = ["benign_calcification"];
  });
  await expect(page.locator(".nb-nextstep .ak-alert--info")).toContainText("usually seen in benign nodules");
  await expect(page.getByTestId("nextstep-window")).toHaveCount(0);
});

test("the next step shows nothing before the report is read, and nothing when the engine is unreachable", async ({ page }) => {
  await page.route("**/recommend", (route) => route.abort());
  await openAndAnalyse(page, "C").catch(() => undefined);
  await expect(page.locator(".nb-nextstep, .ak-alert--danger").first()).toBeVisible();
  await expect(page.getByTestId("nextstep-headline")).toHaveCount(0);
  await expect(page.locator(".ak-alert--danger")).toContainText("The guideline step could not be worked out.");
});
