import { expect, type Page } from "@playwright/test";

export type ResultTab = "nextstep" | "findings" | "report" | "summary";

/** Open a tab of the result panel the way a person would: click it (nothing happens if it is already open). */
export async function showTab(page: Page, tab: ResultTab): Promise<void> {
  const button = page.getByTestId(`result-tab-${tab}`);
  if ((await button.getAttribute("aria-selected")) !== "true") await button.click();
  await expect(page.getByTestId("result-panel")).toHaveAttribute("data-active-tab", tab);
}

/** Wait until the analysis has finished its automatic sequence (the report is highlighted, then the Next step tab opens). */
export async function analysisSettled(page: Page, tab: ResultTab = "nextstep"): Promise<void> {
  await expect(page.getByTestId("result-panel")).toHaveAttribute("data-active-tab", tab, { timeout: 60_000 });
}
