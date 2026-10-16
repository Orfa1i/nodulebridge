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
// pre-made voice clips exist only for the cases that were voiced; the others are spoken on demand by the API
const optional = ["voice.en.mp3", "voice.en.json", "voice.ar.mp3", "voice.ar.json"];

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
  for (const f of optional) {
    const from = join(src, c.name, f);
    if (existsSync(from)) cpSync(from, join(dst, c.name, f));
  }
  // identify an uploaded scan: DICOM series UID, or the SHA-256 of a prepared ct.nii.gz
  const manifest = JSON.parse(readFileSync(join(src, c.name, "manifest.json"), "utf8"));
  index.push({
    case_id: manifest.case_id,
    label: manifest.label,
    lidc_patient_id: manifest.lidc_patient_id,
    series_instance_uid: manifest.series_instance_uid,
    // what a referral would say, for the worklist. All of it is fictional scenario text; nothing here reveals the nodule.
    scenario: {
      age_years: manifest.scenario?.age_years ?? null,
      sex: manifest.scenario?.sex ?? null,
      exam: manifest.scenario?.exam ?? null,
      indication: manifest.scenario?.indication ?? null,
      source: manifest.scenario?.source ?? null,
    },
    voice: { en: existsSync(join(src, c.name, "voice.en.mp3")), ar: existsSync(join(src, c.name, "voice.ar.mp3")) },
    ct_sha256: createHash("sha256").update(readFileSync(join(src, c.name, "ct.nii.gz"))).digest("hex"),
  });
  console.log(`synced ${c.name}`);
}
index.sort((a, b) => a.case_id.localeCompare(b.case_id));
writeFileSync(join(dst, "index.json"), JSON.stringify({ cases: index }, null, 2) + "\n");
console.log("wrote index.json");
