import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The drop-in flow (Phase 6). /extract is the mocked-model fixture (real PDF intake and verification, mocked model;
 * see extract-ui.spec.ts) except in the one LIVE test at the end. /recommend, matching, the viewer and the store are real.
 */
const WEB = join(__dirname, "..", "..");
const FIXTURES = join(__dirname, "fixtures");
const REPO = join(WEB, "..");
const fixture = (l: string) => readFileSync(join(FIXTURES, `extract-case-${l.toLowerCase()}.json`), "utf8");
const manifest = (l: string) => JSON.parse(readFileSync(join(WEB, "public", "cases", `case-${l.toLowerCase()}`, "manifest.json"), "utf8"));
const pdf = (l: string) => join(WEB, "public", "cases", `case-${l.toLowerCase()}`, "report.pdf");
const nifti = (l: string) => join(WEB, "public", "cases", `case-${l.toLowerCase()}`, "ct.nii.gz");

/** data/raw/LIDC-IDRI/<patient>/<study>/<series>/ : the real DICOM folder of a case, if it was downloaded. */
function dicomDir(letter: string): string | null {
  const patient = manifest(letter).lidc_patient_id;
  const base = join(REPO, "data", "raw", "LIDC-IDRI", patient);
  if (!existsSync(base)) return null;
  const study = readdirSync(base)[0];
  const series = readdirSync(join(base, study))[0];
  return join(base, study, series);
}

async function mockExtract(page: Page, letter: string, counter?: { n: number }) {
  await page.route("**/extract", async (route) => {
    if (counter) counter.n += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: fixture(letter) });
  });
}

const stepper = (page: Page) => page.getByTestId("stepper");
const hud = (page: Page) => page.getByTestId("viewer-hud");
async function waitDone(page: Page) {
  await expect(stepper(page)).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await expect(page.locator("section.nb-reveal").first()).toHaveAttribute("data-revealed", "true", { timeout: 20_000 });
}
async function scrollViewerAway(page: Page, presses = 15) {
  await page.getByRole("group", { name: /CT viewer/ }).focus();
  for (let i = 0; i < presses; i++) await page.keyboard.press("ArrowUp");
}
const sliceText = (letter: string) => `Slice ${manifest(letter).nodules[0].slice_index + 1} / ${manifest(letter).geometry.dims[2]}`;

test("example patient A: all five steps, the viewer jumps, the sentence is highlighted, the guideline step appears", async ({ page }) => {
  await mockExtract(page, "A");
  await page.goto("/");
  await expect(page.getByText("Drop a chest CT folder and its report, or")).toBeVisible();
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await waitDone(page);

  const stages = ["read", "find", "match", "guideline", "explain"];
  await expect(stepper(page).locator("li")).toHaveCount(5);
  for (const key of stages.slice(0, 4)) await expect(stepper(page).locator(`[data-stage="${key}"]`)).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("stage-meta-read")).toContainText("sentences");
  await expect(page.getByTestId("stage-meta-find")).toHaveText("1 nodule found");
  await expect(page.getByTestId("stage-meta-match")).toHaveText("Matched: 9 mm, right upper");
  await expect(page.getByTestId("stage-meta-guideline")).toContainText("Rule FL17-S1-GT8");

  await expect(hud(page)).toContainText(sliceText("A"));
  await expect(page.locator(".nb-evidence")).toHaveCount(1);
  await expect(page.getByTestId("match-line")).toHaveText("Matched to outline: size 9 vs 8.8 mm, right side, upper lobe (estimate), solid");
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-S1-GT8");
  await expect(page.getByTestId("finding-label")).toHaveText("Finding 1 · 9 mm");
});

test("the sentence flashes after the viewer jumps, and the stage timings are recorded", async ({ page }) => {
  await mockExtract(page, "A");
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await expect(page.locator(".nb-evidence.is-active")).toHaveCount(1, { timeout: 30_000 });
  await waitDone(page);
  await page.getByTestId("timings").locator("summary").click();
  const read = async (name: string) => Number((await page.getByTestId(`timing-${name}`).textContent())!.replace(/[^\d]/g, ""));
  const highlighted = await read("Viewer jumped and sentence highlighted (from start)");
  const total = await read("Total (from start)");
  const reportRead = await read("Report read (from start)");
  console.log(`timings: report read ${reportRead} ms, highlighted ${highlighted} ms, total ${total} ms (mocked model, warm viewer assets)`);
  expect(reportRead).toBeGreaterThan(0);
  expect(highlighted).toBeGreaterThanOrEqual(reportRead);
  expect(total).toBeGreaterThanOrEqual(highlighted);
  expect(highlighted).toBeLessThan(8000);
  await expect(page.getByTestId("timing-Stage: Read report")).not.toHaveText("–");
});

test("two-way sync with the mouse: sentence, finding row and viewer label", async ({ page }) => {
  await mockExtract(page, "A");
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await waitDone(page);
  await expect(hud(page)).toContainText(sliceText("A"));
  const row = page.getByTestId("finding-row");
  await expect(row).toHaveAttribute("data-in-view", "true"); // the viewer sits on the outline

  // scroll the viewer off the outline: the row loses its highlight
  await scrollViewerAway(page);
  await expect(hud(page)).not.toContainText(sliceText("A"));
  await expect(row).toHaveAttribute("data-in-view", "false");

  // click the highlighted sentence: viewer returns to the finding
  await page.locator(".nb-evidence").click();
  await expect(hud(page)).toContainText(sliceText("A"));
  await expect(row).toHaveAttribute("data-in-view", "true");

  // away again, then the finding row button
  await scrollViewerAway(page);
  await expect(row).toHaveAttribute("data-in-view", "false");
  await page.getByRole("button", { name: "Show in scan" }).click();
  await expect(hud(page)).toContainText(sliceText("A"));

  // label in the viewer: the report scrolls to the sentence and flashes it
  await page.locator(".nb-report").evaluate((el) => (el.scrollTop = 0));
  await page.getByTestId("finding-label").click();
  await expect(page.locator(".nb-evidence.is-active")).toHaveCount(1);
  // smooth scrolling takes a moment: wait until the sentence is fully inside the report box
  await expect
    .poll(() =>
      page.evaluate(() => {
        const box = document.querySelector(".nb-report")!.getBoundingClientRect();
        const el = document.querySelector(".nb-evidence")!.getBoundingClientRect();
        return el.top >= box.top - 1 && el.bottom <= box.bottom + 1;
      }),
    )
    .toBe(true);
  // the flash ends after about 1.5 s
  await expect(page.locator(".nb-evidence.is-active")).toHaveCount(0, { timeout: 5000 });
});

test("two-way sync with the keyboard only", async ({ page }) => {
  await mockExtract(page, "A");
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await waitDone(page);
  await scrollViewerAway(page);
  await expect(hud(page)).not.toContainText(sliceText("A"));

  const sentence = page.locator(".nb-evidence");
  await expect(sentence).toHaveAttribute("role", "button");
  await expect(sentence).toHaveAttribute("tabindex", "0");
  await sentence.focus();
  await page.keyboard.press("Enter");
  await expect(hud(page)).toContainText(sliceText("A"));

  await scrollViewerAway(page);
  await sentence.focus();
  await page.keyboard.press("Space");
  await expect(hud(page)).toContainText(sliceText("A"));

  // the finding label is a real button, reachable with Tab and activated with Enter
  await page.locator(".nb-report").evaluate((el) => (el.scrollTop = 0));
  await page.getByTestId("finding-label").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".nb-evidence.is-active")).toHaveCount(1);
});

test("unrelated report: case B's report with case A's scan is NOT matched, and the scan stays free to scroll", async ({ page }) => {
  const dir = dicomDir("A");
  test.skip(!dir, "case A DICOM folder not downloaded");
  await mockExtract(page, "B");
  await page.goto("/");
  await page.getByTestId("folder-input").setInputFiles(dir!);
  await expect(page.getByText("Now add the report as a PDF or a text file.")).toBeVisible();
  await page.getByTestId("files-input").setInputFiles(pdf("B"));
  await expect(stepper(page)).toHaveAttribute("data-phase", "done", { timeout: 60_000 });

  await expect(page.getByTestId("not-matched-alert")).toContainText("The report finding could not be matched to an outlined nodule.");
  await expect(page.getByTestId("match-line")).toHaveText("The report finding could not be matched to an outlined nodule");
  await expect(page.getByTestId("stage-meta-match")).toHaveText("Not matched");
  await expect(page.getByRole("button", { name: "Show in scan" })).toHaveCount(0);
  // the scan of case A is loaded and scrollable; no jump happened
  await expect(page.locator('[data-viewer-status="ready"]')).toBeVisible({ timeout: 30_000 });
  await expect(hud(page)).not.toContainText(sliceText("A"));
  await scrollViewerAway(page, 3);
  await expect(hud(page)).toContainText("Slice");
  // the guideline step still follows the report (case B's rule), not the scan
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-S1-6TO8");
});

test("dropping case A's DICOM folder and report: the scan is recognised by its series UID", async ({ page }) => {
  const dir = dicomDir("A");
  test.skip(!dir, "case A DICOM folder not downloaded");
  await mockExtract(page, "A");
  await page.goto("/");
  await page.getByTestId("folder-input").setInputFiles(dir!);
  await page.getByTestId("files-input").setInputFiles(pdf("A"));
  await waitDone(page);
  await expect(page).toHaveURL(/case=A/);
  await expect(page.locator(".ak-card__meta", { hasText: "Example patient A · LIDC-IDRI-0213" })).toBeVisible();
  await expect(page.getByTestId("stage-meta-match")).toHaveText("Matched: 9 mm, right upper");
  await expect(hud(page)).toContainText(sliceText("A"));
});

test("a NIfTI scan and the report chosen together are recognised by the file hash", async ({ page }) => {
  await mockExtract(page, "C");
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([nifti("C"), pdf("C")]);
  await waitDone(page);
  await expect(page).toHaveURL(/case=C/);
  await expect(page.getByTestId("stage-meta-match")).toContainText("Matched: 16 mm");
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-GGN1-GE6");
});

test("an unknown scan: the report is still read, with a clear note and no outline", async ({ page }) => {
  await mockExtract(page, "A");
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([join(FIXTURES, "unknown-series.dcm"), pdf("A")]);
  await expect(stepper(page)).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  const alert = page.getByTestId("unmatched-alert");
  await expect(alert).toContainText("No prepared outline for this scan. The report finding is shown without an outline.");
  await expect(alert).toContainText("This series is not one of the prepared cases.");
  await expect(page.getByTestId("stage-meta-match")).toHaveText("No prepared outline");
  await expect(stepper(page).locator('[data-stage="match"]')).toHaveAttribute("data-status", "skipped");
  await expect(page.getByText("No outline to show for this scan")).toBeVisible();
  await expect(page.getByTestId("finding-values")).toBeVisible(); // the report finding is shown
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-S1-GT8");
});

test("the privacy hook runs before anything is sent, and warns that it is a stub", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (m) => m.type() === "warning" && warnings.push(m.text()));
  let sentBeforeHook = false;
  await page.route("**/extract", async (route) => {
    sentBeforeHook = warnings.some((w) => w.includes("[deidentify]")) === false;
    await route.fulfill({ status: 200, contentType: "application/json", body: fixture("C") });
  });
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([nifti("C"), pdf("C")]);
  await waitDone(page);
  expect(warnings.some((w) => w.includes("[deidentify] stub"))).toBe(true);
  expect(sentBeforeHook).toBe(false);
});

test("a refresh keeps the finished analysis (sessionStorage) and does not call the model again", async ({ page }) => {
  const calls = { n: 0 };
  await mockExtract(page, "A", calls);
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await waitDone(page);
  expect(calls.n).toBe(1);
  await page.reload();
  await expect(stepper(page)).toHaveAttribute("data-phase", "done");
  await expect(page.getByTestId("finding-values")).toHaveText("9 mm · solid · right upper lobe");
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-S1-GT8");
  await expect(page.locator("section.nb-reveal").first()).toHaveAttribute("data-revealed", "true");
  expect(calls.n).toBe(1);
  // and it also restores when the URL has no case
  await page.goto("/");
  await expect(stepper(page)).toHaveAttribute("data-phase", "done");
});

test("the drop zone shows its drag-over state, and one file alone does not start anything", async ({ page }) => {
  const calls = { n: 0 };
  await mockExtract(page, "A", calls);
  await page.goto("/");
  const zone = page.getByTestId("dropzone");
  await zone.dispatchEvent("dragover");
  await expect(zone).toHaveClass(/is-dragover/);
  await zone.dispatchEvent("dragleave");
  await expect(zone).not.toHaveClass(/is-dragover/);
  await page.getByTestId("files-input").setInputFiles(nifti("A"));
  await expect(page.getByText("Now add the report as a PDF or a text file.")).toBeVisible();
  await expect(page.getByTestId("picked")).toContainText("Report: none yet");
  expect(calls.n).toBe(0);
});

test("a failed read shows the error in the stepper and the findings card, and Try again recovers", async ({ page }) => {
  let n = 0;
  await page.route("**/extract", async (route) => {
    n += 1;
    if (n === 1) {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "extraction_failed", message: "The report could not be read. Paste the text instead.", detail: "The Google API returned an error (503): high demand" } }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: fixture("A") });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await expect(stepper(page)).toHaveAttribute("data-phase", "error");
  await expect(stepper(page).locator('[data-stage="read"]')).toHaveAttribute("data-status", "error");
  await expect(page.locator(".ak-alert--danger")).toContainText("The Google API returned an error (503)");
  await page.getByRole("button", { name: "Try again" }).click();
  await waitDone(page);
  await expect(page.getByTestId("stage-meta-guideline")).toContainText("FL17-S1-GT8");
});

test("LIVE: example patient A with the real model, warm cache, target 4 s from click to highlight, guard 8 s", async ({ page }) => {
  test.skip(!process.env.NB_API_HAS_KEY, "needs an API with a model key");
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Use example patient A" }).click();
  await waitDone(page);
  await expect(page.getByTestId("stage-meta-read")).toContainText("cached");
  await expect(page.getByTestId("finding-values")).toHaveText("9 mm · solid · right upper lobe");
  await expect(hud(page)).toContainText(sliceText("A"));
  await page.getByTestId("timings").locator("summary").click();
  const ms = Number((await page.getByTestId("timing-Viewer jumped and sentence highlighted (from start)").textContent())!.replace(/[^\d]/g, ""));
  console.log(`LIVE case A, cached extraction: click to highlight ${ms} ms`);
  // the target is 4 s; on this machine (software WebGL) it measured 2.2 to 3.9 s, so the guard is looser to avoid timing flakes
  expect(ms).toBeLessThan(8000);
});
