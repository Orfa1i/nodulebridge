import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Privacy (Phase 9, step 2): the report text is checked for identifying patterns before the model reads it. /redact is the real API; /extract is the mocked-model fixture. */
const fixture = (l: string) => readFileSync(join(__dirname, "fixtures", `extract-case-${l.toLowerCase()}.json`), "utf8");
const nifti = (l: string) => ({
  name: "ct.nii.gz",
  mimeType: "application/gzip",
  buffer: readFileSync(join(__dirname, "..", "..", "public", "cases", `case-${l.toLowerCase()}`, "ct.nii.gz")),
});

const REPORT_WITH_PHI = [
  "Patient: Jane Q. Fakephi",
  "MRN: 00482913",
  "DOB: 14/03/1961",
  "Phone: +966 50 123 4567",
  "Email: jane.fakephi@example.org",
  "Indication: Right rib pain after a fall.",
  "A 9 mm solid nodule is seen in the right upper lobe.",
].join("\n");
const SECRETS = ["Jane Q. Fakephi", "00482913", "14/03/1961", "123 4567", "jane.fakephi@example.org"];
const upload = (text: string) => ({ name: "report.txt", mimeType: "text/plain", buffer: Buffer.from(text, "utf8") });

test("a report with personal details: the review card lists what was removed, and the model only ever receives the redacted text", async ({ page }) => {
  const sent: string[] = [];
  await page.route("**/extract", async (route) => {
    sent.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: fixture("A") });
  });
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([nifti("A"), upload(REPORT_WITH_PHI)]);

  const review = page.getByTestId("redaction-review");
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("redaction-count")).toHaveText("5 items redacted");
  await expect(review).toContainText("Pattern matching is not complete. This demo uses example reports only.");
  const preview = await page.getByTestId("redaction-preview").innerText();
  for (const secret of SECRETS) expect(preview).not.toContain(secret);
  expect(preview).toContain("A 9 mm solid nodule is seen in the right upper lobe.");
  expect(preview).toContain("MRN: [redacted]");
  expect(sent).toHaveLength(0); // nothing reached the model before the person confirmed

  await page.getByTestId("redaction-confirm").click();
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await expect(page.getByTestId("redaction-done")).toContainText("5 items redacted from the report text before it was read.");
  expect(sent).toHaveLength(1);
  for (const secret of SECRETS) expect(sent[0]).not.toContain(secret);
  expect(sent[0]).toContain("[redacted]");
});

test("cancelling the review stops the run: no request to the model, back to the start", async ({ page }) => {
  let extractCalls = 0;
  await page.route("**/extract", (route) => {
    extractCalls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: fixture("A") });
  });
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([nifti("A"), upload(REPORT_WITH_PHI)]);
  await page.getByTestId("redaction-cancel").click();
  await expect(page.getByTestId("redaction-review")).toHaveCount(0);
  await expect(page.getByTestId("stepper")).toHaveCount(0);
  expect(extractCalls).toBe(0);
});

test("a clean report goes straight through, with a note that the check is not complete", async ({ page }) => {
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture("A") }));
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([nifti("A"), upload("Indication: Right rib pain after a fall.\nA 9 mm solid nodule is seen in the right upper lobe.")]);
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await expect(page.getByTestId("redaction-none")).toContainText("No personal details found in the report text by the pattern check.");
  await expect(page.getByTestId("redaction-none")).toContainText("This demo uses example reports only.");
  await expect(page.getByTestId("redaction-review")).toHaveCount(0);
});
