import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import pkg from "./package.json";

/** Short git commit of this build, shown in the verification drawer. "unknown" when git is not available (a zip download). */
function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "unknown";
  } catch {
    return "unknown";
  }
}

// STATIC_EXPORT=1 writes the whole web app as plain files (web/out), which the API serves in the Hugging Face Space.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(staticExport ? { output: "export" as const, trailingSlash: true, images: { unoptimized: true } } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIT_COMMIT: gitCommit(),
  },
};

export default nextConfig;
