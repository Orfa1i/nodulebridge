import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Verification drawer (Phase 9, step 4): every item shows a real value. /extract is the mocked-model fixture; everything else is the real app and API. */
const fixtureText = readFileSync(join(__dirname, "fixtures", "extract-case-a.json"), "utf8");
const fixture = JSON.parse(fixtureText);
const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "cases", "case-a", "manifest.json"), "utf8"));

test("case A: the drawer lists the data, extraction, guideline, explanation, timings and versions with real values", async ({ page }) => {
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixtureText }));
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await expect(page.getByTestId("patient-summary")).toHaveAttribute("data-revealed", "true", { timeout: 20_000 });

  const opener = page.getByTestId("show-verification");
  await opener.click();
  const drawer = page.getByTestId("verification-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Verification" })).toBeVisible();

  // Data
  await expect(page.getByTestId("v-patient")).toHaveText(manifest.lidc_patient_id);
  await expect(page.getByTestId("v-series")).toHaveText(manifest.series_instance_uid);
  await expect(drawer.getByRole("link", { name: /doi:10\.7937/ })).toHaveAttribute("href", /^https:\/\/doi\.org\/10\.7937\//);
  await expect(page.getByTestId("v-truth")).toContainText(`slice ${manifest.nodules[0].slice_index + 1}`);
  await expect(page.getByTestId("v-truth")).toContainText(`mean ${manifest.nodules[0].mean_diameter_mm} mm`);
  await expect(drawer).toContainText("Radiologist consensus (50% agreement), pre-computed offline.");

  // Extraction
  await expect(page.getByTestId("v-model")).toHaveText(fixture.model);
  await expect(drawer).toContainText(fixture.prompt_version);
  await expect(page.getByTestId("v-cached")).toContainText(fixture.cached ? "Yes" : "No");
  const quotes = page.getByTestId("v-quotes").locator("li");
  await expect(quotes).toHaveCount(1);
  await expect(quotes.first()).toContainText("a 9 mm solid nodule is seen in the right upper lobe");
  await expect(page.getByTestId("v-quote-found")).toHaveText("✓ Found in report");
  await drawer.getByText("Raw JSON from the extraction").click();
  const raw = JSON.parse(await page.getByTestId("v-raw").innerText());
  expect(raw.nodules[0].mean_diameter_mm).toBe(fixture.result.nodules[0].mean_diameter_mm);

  // Guideline
  await expect(page.getByTestId("v-rule")).toHaveText("FL17-S1-GT8");
  await expect(drawer).toContainText("Single solid nodule, 9 mm");
  await expect(drawer).toContainText("Fleischner Society 2017");
  await expect(page.getByTestId("v-engine")).toContainText("fleischner2017");
  await expect(page.getByTestId("v-inputs")).toContainText("size 9 mm");
  await expect(page.getByTestId("v-inputs")).toContainText("count single");
  await expect(page.getByTestId("v-inputs")).toContainText("type solid");
  await expect(page.getByTestId("v-inputs")).toContainText("risk tier unknown");

  // Explanation
  await expect(page.getByTestId("v-explain-en")).toContainText("FL17-S1-GT8 + CONDITIONAL");
  await expect(page.getByTestId("v-explain-ar")).toContainText("not yet reviewed");

  // Timings: five stages, each with a measured number
  const timings = page.getByTestId("v-timings");
  for (const label of ["Read report", "Find nodule", "Match to scan", "Apply guideline", "Explain"]) await expect(timings).toContainText(label);
  expect(await timings.innerText()).toMatch(/\d+ ms/);

  // App version and commit, and the API version from /health
  await expect(page.getByTestId("v-app-version")).toContainText("0.1.0");
  await expect(page.getByTestId("v-app-version")).toContainText(/commit [0-9a-f]{7,}/);
  await expect(page.getByTestId("v-api-version")).toHaveText("0.1.0");

  // keyboard: Escape closes it and focus goes back to the button that opened it
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
});

test("a quote that no longer matches the report is shown as not found, not ticked", async ({ page }) => {
  const altered = JSON.parse(fixtureText);
  altered.result.nodules[0].evidence[0].quote = "a 9 mm solid nodule is seen in the left lower lobe";
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(altered) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await page.getByTestId("show-verification").click();
  await expect(page.getByTestId("v-quote-found")).toHaveText("Not found in report");
});

test("an unmatched scan: the drawer says there is no manifest instead of inventing one", async ({ page }) => {
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixtureText }));
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([
    { name: "x.nii.gz", mimeType: "application/gzip", buffer: Buffer.from("not a prepared scan") },
    { name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("Findings: a 9 mm solid nodule is seen in the right upper lobe.") },
  ]);
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await page.getByTestId("show-verification").click();
  await expect(page.getByTestId("v-no-manifest")).toContainText("not one of the prepared cases");
});
