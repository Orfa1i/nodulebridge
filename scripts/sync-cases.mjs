// Copy prepared cases from /data/cases into /web/public/cases (git-ignored) for local serving.
// Production serves the same files from DATA_BASE_URL. Windows symlinks need admin, so we copy.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "data", "cases");
const dst = join(root, "web", "public", "cases");
const files = ["manifest.json", "ct.nii.gz", "mask.nii.gz", "report.md", "report.pdf"];

mkdirSync(dst, { recursive: true });
const cases = readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("case-"));
if (cases.length === 0) throw new Error("no cases in data/cases; run pnpm build:cases first");
for (const c of cases) {
  mkdirSync(join(dst, c.name), { recursive: true });
  for (const f of files) {
    const from = join(src, c.name, f);
    if (!existsSync(from)) throw new Error(`missing ${from}`);
    cpSync(from, join(dst, c.name, f));
  }
  console.log(`synced ${c.name}`);
}
