import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guardrails (Phase 9, step 3), end to end in the browser. /extract returns the case A fixture changed the way a model
 * reading a different report would change it; /recommend and /explain are the real API.
 */
type Fixture = {
  result: {
    study: Record<string, unknown>;
    patient_context: Record<string, { value: unknown; evidence_sentence_ids: string[] }>;
    nodules: unknown[];
  };
  verification: { issues: string[]; quotes_checked: number; quotes_dropped: number; nodules_removed: number };
};
const base = (): Fixture => JSON.parse(readFileSync(join(__dirname, "fixtures", "extract-case-a.json"), "utf8"));

async function analyse(page: Page, change: (f: Fixture) => void) {
  const body = base();
  change(body);
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await expect(page.locator("section.nb-reveal").first()).toHaveAttribute("data-revealed", "true", { timeout: 20_000 });
}

async function expectNoNextStep(page: Page) {
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-applies", "false");
  await expect(page.getByTestId("nextstep-option")).toHaveCount(0);
  await expect(page.getByText("The guideline does not apply here.")).toBeVisible();
  await expect(page.getByTestId("passport-cta")).toBeVisible(); // a summary exists, but it holds no next step
  const summary = await page.getByTestId("summary-panel-en").innerText();
  expect(summary).not.toMatch(/repeat CT|PET-CT|biopsy/i);
}

test("lung cancer screening: not applicable, and it says a different guideline applies", async ({ page }) => {
  await analyse(page, (f) => {
    f.result.study.is_screening_exam = true;
    f.result.study.indication_text = "Lung cancer screening.";
  });
  await expectNoNextStep(page);
  await expect(page.getByTestId("nextstep")).toContainText("A different guideline applies.");
  await expect(page.getByTestId("summary-panel-en")).toContainText("A different guideline applies.");
});

test("a known cancer: not applicable", async ({ page }) => {
  await analyse(page, (f) => {
    f.result.patient_context.known_cancer = { value: true, evidence_sentence_ids: ["s011"] };
  });
  await expectNoNextStep(page);
  await expect(page.getByTestId("nextstep")).toContainText("The guideline does not cover people with a known cancer.");
});

test("a stated age of 30: not applicable", async ({ page }) => {
  await analyse(page, (f) => {
    f.result.patient_context.age_years = { value: 30, evidence_sentence_ids: ["s007"] };
  });
  await expectNoNextStep(page);
  await expect(page.getByTestId("nextstep")).toContainText("The guideline is for adults aged 35 or older.");
});

test("no pulmonary nodules: no finding, a plain explanation, no next step, no reassurance quote", async ({ page }) => {
  await analyse(page, (f) => {
    f.result.nodules = [];
  });
  await expect(page.getByText("No nodules found in the report.")).toBeVisible();
  await expect(page.getByTestId("stage-meta-find")).toHaveText("No nodule in the report");
  await expect(page.getByTestId("nextstep-option")).toHaveCount(0);
  const found = page.getByTestId("summary-found");
  await expect(found).toContainText("The report does not describe a nodule in the lungs.");
  await expect(page.getByTestId("summary-panel-en")).not.toContainText("NCI");
  await expect(page.getByTestId("summary-panel-en")).not.toContainText(/repeat CT|PET-CT|biopsy/i);
});

test("a quote that is not in the report: the finding is dropped, Needs review is shown, and no advice follows", async ({ page }) => {
  await analyse(page, (f) => {
    f.result.nodules = [];
    f.verification = { issues: ["quote_not_found:n1:s036"], quotes_checked: 1, quotes_dropped: 1, nodules_removed: 1 };
  });
  const row = page.getByTestId("unverified-finding");
  await expect(row).toBeVisible();
  await expect(row).toContainText("Needs review");
  await expect(row).toContainText("could not be checked against the report");
  await expect(page.getByTestId("nextstep-blocked")).toContainText("No next step is shown.");
  await expect(page.getByTestId("nextstep-option")).toHaveCount(0);
  await expect(page.getByTestId("summary-panel-en")).toHaveCount(0);
  await expect(page.getByTestId("passport-cta")).toHaveCount(0);
  await expect(page.getByTestId("stage-meta-guideline")).toHaveText("No checked finding");
});

test("the analysis service is down: a plain danger alert, nothing partial is shown", async ({ page }) => {
  await page.route("**/extract", (route) => route.abort("connectionrefused"));
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "error", { timeout: 30_000 });
  const alert = page.getByRole("alert").filter({ hasText: "The analysis service is not responding. Try again in a minute." });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveClass(/ak-alert--danger/);
  await expect(page.getByTestId("nextstep")).toHaveCount(0);
  await expect(page.getByTestId("nextstep-option")).toHaveCount(0);
  await expect(page.getByTestId("summary-panel-en")).toHaveCount(0);
  await expect(page.getByTestId("passport-cta")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("the guideline service is down after the report was read: the report stays, no advice is invented", async ({ page }) => {
  await page.route("**/recommend", (route) => route.abort("connectionrefused"));
  await analyse(page, () => undefined);
  await expect(page.getByText("The analysis service is not responding. Try again in a minute.")).toBeVisible();
  await expect(page.getByTestId("nextstep-option")).toHaveCount(0);
  await expect(page.getByTestId("summary-panel-en")).toHaveCount(0);
});
