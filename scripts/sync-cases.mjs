// Copy prepared cases from /data/cases into /web/public/cases (git-ignored) for local serving.
// Production serves the same files from DATA_BASE_URL. Windows symlinks need admin, so we copy.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "data", "cases");
const dst = join(root, "web", "public", "cases");
const files = ["manifest.json", "ct.nii.gz", "mask.nii.gz", "report.md", "report.pdf"];

mkdirSync(dst, { recursive: true });
const cases = readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("case-"));
if (cases.length === 0) throw new Error("no cases in data/cases; run pnpm build:cases first");
const index = [];
for (const c of cases) {
  mkdirSync(join(dst, c.name), { recursive: true });
  for (const f of files) {
    const from = join(src, c.name, f);
    if (!existsSync(from)) throw new Error(`missing ${from}`);
    cpSync(from, join(dst, c.name, f));
  }
  // identify an uploaded scan: DICOM series UID, or the SHA-256 of a prepared ct.nii.gz
  const manifest = JSON.parse(readFileSync(join(src, c.name, "manifest.json"), "utf8"));
  index.push({
    case_id: manifest.case_id,
    label: manifest.label,
    lidc_patient_id: manifest.lidc_patient_id,
    series_instance_uid: manifest.series_instance_uid,
    ct_sha256: createHash("sha256").update(readFileSync(join(src, c.name, "ct.nii.gz"))).digest("hex"),
  });
  console.log(`synced ${c.name}`);
}
writeFileSync(join(dst, "index.json"), JSON.stringify({ cases: index }, null, 2) + "\n");
console.log("wrote index.json");
