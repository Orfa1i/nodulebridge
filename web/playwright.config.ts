import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: process.env.WEB_URL ?? "http://localhost:3000" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
