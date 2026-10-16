import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:3000",
    // Software WebGL so Cornerstone renders in headless Chromium
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
