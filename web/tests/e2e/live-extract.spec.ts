import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * LIVE: no mocks. The real model reads the real Phase 2 report PDF and the real engine applies the guideline.
 * Runs only when the API has a model key: NB_API_HAS_KEY=1 pnpm exec playwright test live-extract
 * A first run calls the model (about 10 s per case) and fills the extraction cache; later runs are cached.
 */
test.skip(!process.env.NB_API_HAS_KEY, "needs an API with a model key");
test.setTimeout(120_000);

const manifestOf = (letter: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "cases", `case-${letter.toLowerCase()}`, "manifest.json"), "utf8"));

const EXPECTED_RULE: Record<string, string> = { A: "FL17-S1-GT8", B: "FL17-S1-6TO8", C: "FL17-GGN1-GE6" };

for (const letter of ["A", "B", "C"]) {
  test(`case ${letter}: the real model's findings equal the manifest and the guideline step follows`, async ({ page }) => {
    const n = manifestOf(letter).nodules[0];
    await page.goto(`/?case=${letter}`);
    await page.getByRole("button", { name: "Start analysis" }).click();
    const row = page.getByTestId("finding-values");
    await expect(row).toBeVisible({ timeout: 60_000 });

    const word = n.lobe_estimate.label.split(" ")[1];
    const where = ["upper", "middle", "lower"].includes(word) ? n.lobe_estimate.label : `${n.lobe_estimate.side} lung`;
    const att = { solid: "solid", "part-solid": "part-solid", "ground-glass": "ground-glass" }[n.attenuation as string];
    await expect(row).toHaveText(`${n.fleischner_size_mm} mm · ${att} · ${where}`);
    await expect(page.getByText("Checked against report")).toBeVisible();

    // the evidence sentence is highlighted and is the nodule sentence
    const highlighted = page.locator(".nb-evidence");
    await expect(highlighted.first()).toContainText(`${n.fleischner_size_mm} mm`);
    await expect(highlighted.first()).toContainText("nodule");

    // the deterministic guideline step runs on the real extraction
    await expect(page.getByTestId("nextstep")).toHaveAttribute("data-rule", EXPECTED_RULE[letter]);

    // the findings card names the model that read the report, and a rule is never labelled as AI
    await expect(page.getByText(/gemini:|anthropic:|claude/).first()).toBeVisible();
    await expect(page.locator("section", { has: page.locator("#nextstep-title") }).locator(".ak-badge--ai")).toHaveCount(0);
  });
}

test("case A, second run is served from the cache and says so", async ({ page }) => {
  await page.goto("/?case=A");
  await page.getByRole("button", { name: "Start analysis" }).click();
  await expect(page.getByTestId("finding-values")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTitle("This result was saved from an earlier run on the same report and model.")).toBeVisible();
});
