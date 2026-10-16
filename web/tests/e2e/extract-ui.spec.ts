import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * UI tests for the report and findings cards.
 * The /extract response is a FIXTURE: real PDF intake and real verification, but the model step is mocked
 * (see api/eval/make_ui_fixture.py). These tests prove the UI, not the model. The model is judged by
 * `python -m api.eval.run`.
 */
const fixture = (letter: string) =>
  readFileSync(join(__dirname, "fixtures", `extract-case-${letter.toLowerCase()}.json`), "utf8");
const manifestOf = (letter: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "cases", `case-${letter.toLowerCase()}`, "manifest.json"), "utf8"));

/** What the findings card must say for a case, from the Phase 2 manifest. */
function expectedValues(letter: string): string {
  const n = manifestOf(letter).nodules[0];
  const att = { solid: "solid", "part-solid": "part-solid", "ground-glass": "ground-glass" }[n.attenuation as string];
  const word = n.lobe_estimate.label.split(" ")[1];
  const where = ["upper", "middle", "lower"].includes(word) ? n.lobe_estimate.label.replace("lobe", "lobe") : `${n.lobe_estimate.side} lung`;
  return `${n.fleischner_size_mm} mm · ${att} · ${where}`;
}

async function mockExtract(page: Page, letter: string, delayMs = 0) {
  await page.route("**/extract", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body: fixture(letter) });
  });
}

for (const letter of ["A", "B", "C"]) {
  test(`case ${letter}: findings card shows the manifest values and the evidence is highlighted`, async ({ page }) => {
    await mockExtract(page, letter);
    await page.goto(`/?case=${letter}`);
    await expect(page.getByText("Example report written for this demo")).toBeVisible();
    await expect(page.getByText("No findings yet")).toBeVisible();
    await page.getByRole("button", { name: "Start analysis" }).click();

    const row = page.getByTestId("finding-values");
    await expect(row).toHaveText(expectedValues(letter));
    await expect(page.getByText("Checked against report")).toBeVisible();
    await expect(page.getByText("Findings from the report")).toBeVisible();
    await expect(page.locator("#findings-title ~ .ak-badge--ai")).toHaveText("AI-assisted");

    // the evidence sentence is highlighted in the report and is the nodule sentence
    const highlighted = page.locator(".nb-evidence");
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toContainText(`${manifestOf(letter).nodules[0].fleischner_size_mm} mm`);
    await expect(highlighted).toContainText("nodule is seen");
    await expect(page.locator("[data-sid]").first()).toBeVisible();
    // the report is shown sentence by sentence
    expect(await page.locator("[data-sid]").count()).toBeGreaterThan(25);
    // the single-dimension note from verification is shown
    await expect(page.getByText("Report gives one dimension; Fleischner uses the mean of long and short axis.")).toBeVisible();
  });
}

test("case A: ignored findings are listed and collapsed by default", async ({ page }) => {
  await mockExtract(page, "A");
  await page.goto("/?case=A");
  await page.getByRole("button", { name: "Start analysis" }).click();
  const details = page.locator("details.nb-ignored");
  await expect(details.locator("summary")).toContainText("Ignored findings (1)");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  await expect(details.getByText("healing rib fracture")).toBeVisible();
});

test("reading shows the indeterminate spectrum bar with elapsed seconds, and the spectrum stays within its three places", async ({ page }) => {
  await mockExtract(page, "A", 1500);
  await page.goto("/?case=A");
  await page.getByRole("button", { name: "Start analysis" }).click();
  const progress = page.getByTestId("reading-progress");
  await expect(progress).toBeVisible();
  await expect(progress).toContainText("Reading the report");
  await expect(progress).toContainText(/\d+ s/);
  await expect(progress.locator(".ak-progress--spectrum.is-indeterminate")).toHaveCount(1);
  const spectrum = await page.evaluate(() => {
    const hits: string[] = [];
    for (const el of document.querySelectorAll("main *, header *")) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg.includes("linear-gradient") && !/skeleton/.test(el.className.toString())) hits.push(el.className.toString());
    }
    return hits;
  });
  for (const cls of spectrum) expect(cls).toMatch(/ak-progress__bar|ak-badge--ai|ak-divider--spectrum/);
  await expect(page.getByTestId("finding-values")).toBeVisible();
  await expect(progress).toHaveCount(0);
});

test("a failed extraction shows the plain message and the provider detail, and Try again works", async ({ page }) => {
  let calls = 0;
  await page.route("**/extract", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "extraction_failed", message: "The report could not be read. Paste the text instead.", detail: "The Anthropic API rejected the key (401): invalid x-api-key" } }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: fixture("A") });
    }
  });
  await page.goto("/?case=A");
  await page.getByRole("button", { name: "Start analysis" }).click();
  const alert = page.locator(".ak-alert--danger");
  await expect(alert).toContainText("The report could not be read. Paste the text instead.");
  await expect(alert).toContainText("The Anthropic API rejected the key (401)");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("finding-values")).toHaveText(expectedValues("A"));
});

test("with no API key the real API says so in plain English (nothing is faked)", async ({ page, request }) => {
  const health = await request.get(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8001"}/health`);
  test.skip((await health.json()).provider !== null, "the API has a model key; this test covers the unconfigured case");
  await page.goto("/?case=A");
  await page.getByRole("button", { name: "Start analysis" }).click();
  const alert = page.locator(".ak-alert--danger");
  await expect(alert).toContainText("The AI service is not available.");
  await expect(alert).toContainText("is not set");
  await expect(page.getByTestId("finding-values")).toHaveCount(0);
});

test("home without a case offers the worklist and the upload zone", async ({ page }) => {
  await mockExtract(page, "B");
  await page.goto("/");
  await expect(page.getByText("Drop a chest CT folder and its report, or")).toBeVisible();
  await expect(page.getByText("DICOM folder or .nii.gz, plus the report as PDF or text. Example data only.")).toBeVisible();
  await page.getByRole("button", { name: "Use example patient B" }).click();
  await expect(page).toHaveURL(/case=B/);
  await expect(page.getByTestId("study-select")).toHaveValue("B");
});
