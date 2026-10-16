import { expect, test, type Request } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bytesContain, FAKE, syntheticDicom } from "../helpers/syntheticDicom";

/** Privacy (Phase 9, step 1): a synthetic DICOM series with fake patient details in every identifying tag. */
const fixture = (l: string) => readFileSync(join(__dirname, "fixtures", `extract-case-${l.toLowerCase()}.json`), "utf8");
const pdf = (l: string) => ({
  name: "report.pdf",
  mimeType: "application/pdf",
  buffer: readFileSync(join(__dirname, "..", "..", "public", "cases", `case-${l.toLowerCase()}`, "report.pdf")),
});
/** Values long enough to be searched for (PatientSex is one letter; its removal is checked in the unit test). */
const SEARCHABLE = Object.values(FAKE).filter((v) => v.length >= 8);
const dicomFile = (i: number, burned: "YES" | "NO" | null = "NO") => ({
  name: `PATIENT-DOE-JANE-${i}.dcm`,
  mimeType: "application/dicom",
  buffer: Buffer.from(syntheticDicom({ index: i, burned })),
});

test("no request leaves the browser with a fake patient value, and no scan bytes are sent at all", async ({ page }) => {
  const seen: { url: string; type: string | undefined; body: Buffer | null }[] = [];
  page.on("request", (r: Request) => seen.push({ url: r.url(), type: r.headers()["content-type"], body: r.postDataBuffer() }));
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture("A") }));
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([dicomFile(0), dicomFile(1), dicomFile(2), pdf("A")]);
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });

  // the confirmation row: counts and tag names, never values
  await expect(page.getByTestId("privacy-title")).toHaveText("Patient details removed from 3 files on this device before anything is sent.");
  await page.getByTestId("privacy-details").locator("summary").click();
  const details = await page.getByTestId("privacy-details").innerText();
  expect(details).toContain("PatientName");
  expect(details).toContain("(0010,0010)");
  expect(details).toContain("6 private tags"); // 2 per file, 3 files
  expect(details).toContain("File names replaced with slice numbers");
  const page_text = await page.locator("body").innerText();
  for (const value of SEARCHABLE) expect(page_text, value).not.toContain(value);

  // network: nothing carries a fake value (URL, headers excluded, body) and no DICOM leaves the browser
  expect(seen.length).toBeGreaterThan(0);
  for (const r of seen) {
    for (const value of SEARCHABLE) {
      expect(r.url, `${r.url} URL`).not.toContain(encodeURIComponent(value));
      if (r.body) expect(bytesContain(new Uint8Array(r.body), value), `${r.url} body has ${value}`).toBe(false);
    }
    expect(r.type ?? "").not.toContain("dicom");
    if (r.body) expect(Buffer.from(r.body).includes(Buffer.from("DICM"))).toBe(false);
  }
});

test("a scan that may have burned-in annotation is refused with a plain message and nothing is read", async ({ page }) => {
  let extractCalls = 0;
  await page.route("**/extract", (route) => {
    extractCalls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: fixture("A") });
  });
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([dicomFile(0, "YES"), pdf("A")]);
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "error", { timeout: 30_000 });
  const alert = page.getByRole("alert").filter({ hasText: "This scan may have patient details burned into the images. It was not uploaded." });
  await expect(alert.first()).toBeVisible();
  await expect(page.getByTestId("nextstep")).toHaveCount(0);
  await expect(page.getByTestId("summary-panel-en")).toHaveCount(0); // the summary card stays empty
  expect(extractCalls).toBe(0);
});

test("a DICOM file with no BurnedInAnnotation tag is refused too (not a known LIDC series)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("files-input").setInputFiles([dicomFile(0, null), pdf("A")]);
  await expect(page.getByRole("alert").filter({ hasText: "burned into the images" }).first()).toBeVisible({ timeout: 30_000 });
});
