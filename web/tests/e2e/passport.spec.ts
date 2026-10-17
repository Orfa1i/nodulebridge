import { expect, test, type Page } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Referral passport (Phase 8). /extract is the mocked-model fixture; /recommend, /explain and every /passport/* endpoint are the real API (the PDF is made by real Chromium). */
const fixture = (l: string) => readFileSync(join(__dirname, "fixtures", `extract-case-${l.toLowerCase()}.json`), "utf8");

async function createPassport(page: Page, letter: string) {
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture(letter) }));
  await page.goto("/");
  await page.getByRole("button", { name: `Use example patient ${letter}` }).click();
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await expect(page.getByTestId("patient-summary")).toHaveAttribute("data-revealed", "true", { timeout: 20_000 });
  await page.getByTestId("create-passport").click();
  await expect(page).toHaveURL(/\/passport\/?$/); // the static export serves /passport/ with a trailing slash
  await expect(page.getByTestId("passport")).toBeVisible();
}

test("empty state: no passport before a case is analysed", async ({ page }) => {
  await page.goto("/passport");
  await expect(page.getByTestId("passport-empty")).toContainText("No passport yet. Analyse a case first.");
});

test("case A: the passport screen shows the finding, the next step, both summaries and the booking request", async ({ page }) => {
  await createPassport(page, "A");
  await expect(page.getByTestId("passport-meta")).toContainText("Example patient A · created");
  await expect(page.getByTestId("passport-quote")).toHaveText("“a 9 mm solid nodule is seen in the right upper lobe”");
  await expect(page.getByTestId("passport-size")).toHaveText("9 mm");
  await expect(page.getByTestId("passport-headline")).toHaveText("Consider a CT in about 3 months, a PET-CT, or a biopsy.");
  await expect(page.getByTestId("passport-rule")).toContainText("FL17-S1-GT8");
  await expect(page.getByTestId("passport-rule")).toContainText("Fleischner Society 2017");
  // the picture of the slice was taken from the viewer, with the outline
  const image = page.getByTestId("passport-image");
  await expect(image).toBeVisible();
  const src = await image.getAttribute("src");
  expect(src?.startsWith("data:image/png;base64,")).toBe(true);
  expect((src ?? "").length).toBeGreaterThan(20_000);
  await expect(image.locator("xpath=following-sibling::figcaption")).toHaveText("Radiologist consensus outline · LIDC-IDRI-0213 · example data");
  // Phase 7 panel, both languages
  await page.getByTestId("summary-tab-ar").click();
  await expect(page.getByTestId("summary-panel-ar")).toHaveAttribute("dir", "rtl");
  // booking request
  await expect(page.getByTestId("booking-body")).toContainText("Dear Doctor,");
  await expect(page.getByTestId("booking-body")).toContainText("Prepared with NoduleBridge (decision support, not a diagnosis)");
  await expect(page.getByTestId("booking-draft")).toHaveText("Text not yet reviewed");
  await page.getByTestId("booking-lang-ar").click();
  await expect(page.getByTestId("booking-body")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("booking-draft")).toHaveText("Translation not yet reviewed");
});

test("case A: all four downloads work and have the right content", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await createPassport(page, "A");

  const grab = async (testId: string) => {
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByTestId(testId).click()]);
    const path = await download.path();
    return { name: download.suggestedFilename(), path, size: statSync(path).size };
  };

  const pdf = await grab("dl-pdf");
  expect(pdf.name).toBe("nodulebridge-passport.pdf");
  expect(readFileSync(pdf.path).subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.size).toBeGreaterThan(30_000);
  await expect(page.getByTestId("passport-notice")).toContainText("Downloaded the passport PDF.");

  const fhir = await grab("dl-fhir");
  const bundle = JSON.parse(readFileSync(fhir.path, "utf8"));
  expect(bundle.resourceType).toBe("Bundle");
  const requests = bundle.entry.filter((e: { resource: { resourceType: string } }) => e.resource.resourceType === "ServiceRequest");
  expect(requests).toHaveLength(1);
  expect(requests[0].resource.occurrencePeriod.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const ics = await grab("dl-ics");
  const icsText = readFileSync(ics.path, "utf8");
  expect(icsText).toContain("BEGIN:VCALENDAR");
  expect(icsText.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  expect(icsText).toContain("SUMMARY:Book your follow-up CT");

  const family = readFileSync((await grab("dl-ics-caregiver")).path, "utf8");
  expect(family).toContain("Help Example patient A book the follow-up CT");

  // copy message
  await page.getByTestId("copy-message").click();
  await expect(page.getByTestId("passport-notice")).toContainText("Message copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Dear Doctor,");
});

test("WhatsApp is a mock: the toast says nothing was sent", async ({ page }) => {
  await createPassport(page, "B");
  await expect(page.getByTestId("booking-body")).toBeVisible(); // the button stays disabled until the message exists
  await page.getByTestId("whatsapp-mock").click();
  await expect(page.getByTestId("passport-notice")).toHaveText("Reminder scheduled (mock — nothing was sent)");
});

test("a refresh keeps the passport; the print route shows the same document without app chrome", async ({ page }) => {
  await createPassport(page, "A");
  await page.reload();
  await expect(page.getByTestId("passport-meta")).toContainText("Example patient A");
  await page.goto("/passport/print");
  await expect(page.getByTestId("print-root")).toHaveAttribute("data-print-ready", "true", { timeout: 20_000 });
  await expect(page.locator(".ak-appbar")).toBeHidden();
  await expect(page.getByTestId("print-summary-ar")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("print-booking-en")).toContainText("Dear Doctor,");
  await expect(page.locator(".nb-print__head img")).toBeVisible(); // colour logo, on a white page
});

test("a PDF failure is shown in plain words with the print fallback", async ({ page }) => {
  await createPassport(page, "A");
  await page.route("**/passport/pdf", (route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "pdf_unavailable", message: "The PDF could not be made on the server. Use Print and choose Save as PDF instead.", detail: "RuntimeError: Chromium is not installed" } }) }),
  );
  await page.getByTestId("dl-pdf").click();
  await expect(page.getByTestId("passport-notice")).toContainText("Use Print and choose Save as PDF instead.");
  await expect(page.getByTestId("open-print")).toBeVisible();
});
