import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analysisSettled, showTab } from "./helpers";

/** Patient summary (Phase 7). /extract is the mocked-model fixture; /recommend and /explain are the real API; audio is the pre-computed clip. */
const fixture = (l: string) => readFileSync(join(__dirname, "fixtures", `extract-case-${l.toLowerCase()}.json`), "utf8");

async function open(page: Page, letter: string) {
  await page.route("**/extract", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fixture(letter) }));
  await page.goto("/");
  await page.getByRole("button", { name: `Use example patient ${letter}` }).click();
  await expect(page.getByTestId("stepper")).toHaveAttribute("data-phase", "done", { timeout: 60_000 });
  await expect(page.getByTestId("patient-summary")).toHaveAttribute("data-revealed", "true", { timeout: 20_000 });
  await analysisSettled(page);
  await showTab(page, "summary");
}

test("english panel shows the six sections, the draft badge and no leftover placeholders", async ({ page }) => {
  await open(page, "A");
  const panel = page.getByTestId("summary-panel-en");
  await expect(panel).toHaveAttribute("dir", "ltr");
  for (const key of ["found", "todo", "when", "who"]) await expect(page.getByTestId(`summary-${key}`)).toBeVisible();
  await expect(page.getByTestId("summary-found")).toContainText("9 mm");
  await expect(panel).not.toContainText(/[{}]/);
  await expect(page.getByTestId("stage-meta-explain")).toContainText("awaiting review");
});

test("arabic panel is right-to-left, labelled draft, and isolates the measurement", async ({ page }) => {
  await open(page, "A");
  await page.getByTestId("summary-tab-ar").click();
  const panel = page.getByTestId("summary-panel-ar");
  await expect(panel).toHaveAttribute("dir", "rtl");
  await expect(panel).toHaveAttribute("lang", "ar");
  await expect(page.getByTestId("review-badge")).toHaveText("Translation not yet reviewed");
  await expect(panel.locator("bdi").first()).toBeVisible();
  await expect(panel).not.toContainText(/[٠-٩]/);
  await page.getByTestId("summary-tab-en").click();
  await expect(page.getByTestId("summary-panel-en")).toBeVisible();
});

test("voice: the pre-computed clip plays, is labelled, and the transcript is always visible", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await open(page, "B");
  const transcript = page.getByTestId("voice-transcript");
  await expect(transcript).toContainText("7");
  await expect(page.getByTestId("voice-player")).toContainText("AI voice");
  await page.getByTestId("voice-play").click();
  await expect(page.getByTestId("voice-player")).toHaveAttribute("data-voice-origin", "prepared", { timeout: 15_000 });
  await expect(page.getByTestId("voice-precomputed")).toHaveText("Pre-computed for demo");
  await expect(page.getByTestId("voice-time")).toContainText(/\/ 0:1\d/);
  await expect(transcript).toBeVisible();
  await expect(page.getByTestId("voice-player")).toHaveAttribute("data-voice-state", "playing");
  await expect(page.getByTestId("voice-time")).not.toHaveText(/^0:00 \//, { timeout: 8000 }); // the clock advances
  await page.getByTestId("voice-play").click(); // pause
  await expect(page.getByTestId("voice-player")).toHaveAttribute("data-voice-state", "paused");
  expect(pageErrors).toEqual([]);
});

test("a voice failure is shown in plain words and the written summary stays", async ({ page }) => {
  await open(page, "C");
  await page.route("**/case-c/voice.en.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/tts", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "speech_unavailable", message: "The voice summary is not available.", detail: "Speech is not configured." } }) }),
  );
  await page.getByTestId("voice-play").click();
  await expect(page.getByRole("alert").filter({ hasText: "The voice summary is not available." })).toBeVisible();
  await expect(page.getByTestId("voice-transcript")).toBeVisible();
});
