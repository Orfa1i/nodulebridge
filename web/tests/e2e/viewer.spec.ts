import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CASES = ["A", "B", "C"] as const;
const manifestOf = (letter: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "cases", `case-${letter.toLowerCase()}`, "manifest.json"), "utf8"));

interface Api {
  jumpToFinding: (id: string) => Promise<void>;
  debugState: () => { centroidCanvas: number[]; canvasSize: number[]; parallelScale: number; baseParallelScale: number; fillAlpha: number };
}

async function open(page: Page, letter: string): Promise<number> {
  const t0 = Date.now();
  await page.goto(`/dev/viewer?case=${letter}`);
  await page.waitForSelector('[data-viewer-status="ready"]', { timeout: 60_000 });
  return Date.now() - t0;
}

const hud = (page: Page) => page.getByTestId("viewer-hud");

for (const letter of CASES) {
  test(`case ${letter}: loads, slice order matches, jumpToFinding lands on the nodule`, async ({ page }) => {
    const m = manifestOf(letter);
    const n = m.nodules[0];
    const count = m.geometry.dims[2];
    await open(page, letter);

    // step 6: no slice-order alert, and the card meta comes from the manifest
    await expect(page.locator(".ak-alert--danger")).toHaveCount(0);
    await expect(page.getByText(`${m.label} · ${m.lidc_patient_id}`)).toBeVisible();
    await expect(hud(page)).toContainText(`/ ${count} · ${+m.geometry.spacing[2].toFixed(2)} mm · W 1500 L -600`);

    // scroll away with the keyboard, the HUD must follow
    const viewport = page.getByRole("group", { name: /CT viewer/ });
    await viewport.focus();
    const before = await hud(page).textContent();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
    await expect(hud(page)).not.toHaveText(before!);
    const afterUp = Number((await hud(page).textContent())!.match(/Slice (\d+)/)![1]);
    const beforeNum = Number(before!.match(/Slice (\d+)/)![1]);
    expect(afterUp).toBe(beforeNum + 5);
    await page.keyboard.press("ArrowDown");
    await expect(hud(page)).toContainText(`Slice ${afterUp - 1} /`);

    // jump
    await page.evaluate(() => (window as unknown as { __nbViewer: Api }).__nbViewer.jumpToFinding("n1"));
    await expect(hud(page)).toContainText(`Slice ${n.slice_index + 1} / ${count}`);

    // nodule centred, zoomed 2x, label shown with manifest values
    const st = await page.evaluate(() => (window as unknown as { __nbViewer: Api }).__nbViewer.debugState());
    expect(Math.abs(st.centroidCanvas[0] - st.canvasSize[0] / 2)).toBeLessThan(3);
    expect(Math.abs(st.centroidCanvas[1] - st.canvasSize[1] / 2)).toBeLessThan(3);
    expect(st.baseParallelScale / st.parallelScale).toBeCloseTo(2, 1);
    await expect(page.getByTestId("finding-label")).toBeVisible();
    await expect(page.getByTestId("finding-label")).toHaveText(`Finding 1 · ${n.fleischner_size_mm} mm`);

    // screen reader mirror announces the slice once it settles
    await expect(page.getByTestId("viewer-announce")).toHaveText(`Slice ${n.slice_index + 1} of ${count}`);
  });
}

test("outline toggle and window presets", async ({ page }) => {
  await open(page, "A");
  const toggle = page.getByRole("button", { name: "Hide outline" });
  await toggle.click();
  await expect(page.getByRole("button", { name: "Show outline" })).toBeVisible();
  await page.getByRole("button", { name: "Show outline" }).click();
  await page.getByRole("button", { name: "Soft tissue" }).click();
  await expect(hud(page)).toContainText("W 400 L 40");
  await page.getByRole("button", { name: "Lung" }).click();
  await expect(hud(page)).toContainText("W 1500 L -600");
});

test("outline pulses after a jump and settles back", async ({ page }) => {
  await open(page, "A");
  const alphas = await page.evaluate(async () => {
    const api = (window as unknown as { __nbViewer: Api }).__nbViewer;
    const seen: number[] = [];
    const done = api.jumpToFinding("n1");
    const end = performance.now() + 1600;
    while (performance.now() < end) {
      seen.push(api.debugState().fillAlpha);
      await new Promise((r) => requestAnimationFrame(r));
    }
    await done;
    return seen;
  });
  expect(Math.max(...alphas)).toBeGreaterThan(0.5);
  expect(alphas[alphas.length - 1]).toBeCloseTo(0.35, 2);
});

test("second load of case A is under 4 s", async ({ page }) => {
  const first = await open(page, "A");
  const second = await open(page, "A");
  console.log(`case A load: first ${first} ms, second ${second} ms`);
  expect(second).toBeLessThan(4000);
});
