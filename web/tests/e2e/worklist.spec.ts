import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";
import { analysisSettled, showTab } from "./helpers";

/**
 * The worklist (18 prepared studies). /extract is the REAL API: the model's answers for every report are pre-computed in
 * the cache, so these tests read real extractions without calling a model.
 */
const CASES = join(__dirname, "..", "..", "public", "cases");
const nifti = (l: string) => join(CASES, `case-${l.toLowerCase()}`, "ct.nii.gz");
const pdf = (l: string) => join(CASES, `case-${l.toLowerCase()}`, "report.pdf");

async function open(page: Page, letter: string) {
  await page.goto("/");
  // a finished analysis is restored after a reload; go back to the worklist the way a person would
  await page.locator('[data-testid="worklist"], [data-testid="all-studies"]').first().waitFor(); // the page has settled
  const back = page.getByTestId("all-studies");
  if (await back.isVisible()) await back.click();
  await page.getByRole("button", { name: `Use example patient ${letter}` }).click();
  await analysisSettled(page);
}

test("the home screen is a worklist of 18 studies with referral details and no findings", async ({ page }) => {
  await page.goto("/");
  const worklist = page.getByTestId("worklist");
  await expect(worklist).toContainText("Chest CT studies with their reports, waiting to be read.");
  await expect(worklist).toContainText("ages, indications and referring services are fictional");
  await expect(page.getByTestId("worklist-row")).toHaveCount(18);
  await expect(page.getByTestId("worklist-count")).toHaveText("18 studies");
  for (const heading of ["Study", "Patient", "Exam", "Indication", "Referred by", "Report"]) await expect(worklist.getByRole("columnheader", { name: heading })).toBeVisible();
  const row = page.locator('[data-case="case-a"]');
  await expect(row).toContainText("Example patient A");
  await expect(row).toContainText("LIDC-IDRI-0213");
  await expect(row).toContainText("58 · M");
  await expect(row).toContainText("Fictional");
  await expect(row).toContainText("Right rib pain after a fall.");
  await expect(row).toContainText("Emergency department");
  // the list never shows what the report found
  const text = await worklist.innerText();
  expect(text).not.toMatch(/\d+\s?mm/);
  expect(text).not.toMatch(/nodule size|solid|ground-glass/i);
  await expect(page.getByText("Drop a chest CT folder and its report, or")).toBeVisible(); // own files stay available below
});

test("searching narrows the list and says how many studies match", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("worklist-search").fill("angiogram");
  await expect(page.getByTestId("worklist-row")).toHaveCount(3);
  await expect(page.getByTestId("worklist-count")).toHaveText("3 of 18 studies");
  await page.getByTestId("worklist-search").fill("screening programme");
  await expect(page.getByTestId("worklist-row")).toHaveCount(1);
  await page.getByTestId("worklist-search").fill("no such thing");
  await expect(page.getByTestId("worklist-empty")).toHaveText("No study matches that search.");
  await page.getByTestId("worklist-search").fill("");
  await expect(page.getByTestId("worklist-row")).toHaveCount(18);
});

test("a new study opens end to end: report read, finding linked to the outline, guideline, summary", async ({ page }) => {
  await open(page, "F"); // 8 mm solid, left upper lobe, CT pulmonary angiogram
  await expect(page).toHaveURL(/case=F/);
  await expect(page.getByTestId("study-select")).toHaveValue("F");
  await expect(page.getByTestId("stage-meta-match")).toContainText("Matched: 8 mm, left upper");
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-S1-6TO8");
  await showTab(page, "summary");
  await expect(page.getByTestId("summary-panel-en")).toBeVisible();
  await expect(page.getByTestId("voice-play")).toBeVisible(); // spoken on demand: this study has no pre-made clip
});

test("a ground-glass study and a small solid study get their own rows of the guideline", async ({ page }) => {
  await open(page, "K");
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-GGN1-GE6");
  await open(page, "D");
  await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", "FL17-S1-LT6");
});

test("the three studies written as 'the guideline does not apply' show the guardrail on a real scan", async ({ page }) => {
  const reasons: Record<string, string> = {
    R: "The guideline is for adults aged 35 or older.",
    S: "The guideline does not cover lung cancer screening scans. A different guideline applies.",
    T: "The guideline does not cover people with a known cancer.",
  };
  for (const [letter, reason] of Object.entries(reasons)) {
    await open(page, letter);
    await expect(page.getByTestId("nextstep")).toHaveAttribute("data-applies", "false");
    await expect(page.getByTestId("nextstep-option")).toHaveCount(0);
    await expect(page.getByTestId("nextstep")).toContainText(reason);
    await expect(page.getByTestId("stage-meta-match")).toContainText("Matched"); // the finding is still linked to its outline
  }
});

test("Previous study and Next study walk the list and wrap around; All studies goes back", async ({ page }) => {
  await open(page, "A");
  await page.getByTestId("next-study").click();
  await expect(page.getByTestId("study-select")).toHaveValue("B");
  await page.getByTestId("prev-study").click();
  await expect(page.getByTestId("study-select")).toHaveValue("A");
  await page.getByTestId("prev-study").click();
  await expect(page.getByTestId("study-select")).toHaveValue("T");
  await page.getByTestId("study-select").selectOption("H");
  await expect(page).toHaveURL(/case=H/);
  await page.getByTestId("all-studies").click();
  await expect(page.getByTestId("worklist-row")).toHaveCount(18);
});

test("a report that names a different study is not linked to the scan, and says why", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([nifti("A"), pdf("T")]);
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 90_000 });
  await expect(page.getByTestId("not-matched-alert")).toContainText("The report finding could not be matched to an outlined nodule.");
  await expect(page.getByTestId("match-note")).toHaveText("The report names LIDC-IDRI-0196, but this scan is LIDC-IDRI-0213.");
});
