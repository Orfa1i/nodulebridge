import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchFinding, pickDrivingNodule, reportStudyRef } from "@/features/analysis/matchFinding";
import type { CaseManifest } from "@/types/generated/case-manifest";
import type { ExtractResponse } from "@/types/generated/extract-response";

/**
 * Every prepared study: the REAL model extraction of its report (tests/fixtures/real, made by api.scripts.export_real_fixtures)
 * must be linked to its own scan outline, and to no other study's outline. This is what keeps a mismatched report and scan
 * from being linked, now that there are many studies that could be confused with one another.
 */
const ROOT = join(__dirname, "..", "..");
const CASES = join(ROOT, "..", "data", "cases");
const letters = readdirSync(join(ROOT, "tests", "fixtures", "real"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace("extract-case-", "").replace(".json", ""))
  .sort();

const manifest = (l: string): CaseManifest => JSON.parse(readFileSync(join(CASES, `case-${l}`, "manifest.json"), "utf8"));
const refs = (l: string, scan: string) => ({ report: reportStudyRef(extraction(l).sentences.map((x) => x.text)), scan: manifest(scan).lidc_patient_id });
const extraction = (l: string): ExtractResponse => JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "real", `extract-case-${l}.json`), "utf8"));

describe("all prepared studies", () => {
  it("there are at least 18 studies, and each has a fixture and a manifest", () => {
    expect(letters.length).toBeGreaterThanOrEqual(18);
    for (const l of letters) expect(manifest(l).case_id).toBe(`case-${l}`);
  });

  it.each(letters)("study %s: the report finding is linked to its own outline", (l) => {
    const driving = pickDrivingNodule(extraction(l).result.nodules);
    expect(driving, "the model found a nodule").not.toBeNull();
    const result = matchFinding(driving, manifest(l).nodules, refs(l, l));
    expect(result.matched, `${l}: ${result.summary} (score ${result.score}/${result.threshold})`).toBe(true);
  });

  it("every report names its own study, and no report finding is linked to a different study's outline", () => {
    const wrong: string[] = [];
    for (const a of letters) {
      expect(refs(a, a).report, `${a} names its study`).toBe(manifest(a).lidc_patient_id);
      const driving = pickDrivingNodule(extraction(a).result.nodules);
      for (const b of letters) {
        if (a === b) continue;
        const r = matchFinding(driving, manifest(b).nodules, refs(a, b));
        if (r.matched) wrong.push(`${a.toUpperCase()} -> ${b.toUpperCase()}`);
        else expect(r.note, `${a}->${b}`).toContain("The report names");
      }
    }
    expect(wrong).toEqual([]);
  });

  it("even without a study reference, a lobe that contradicts the outline stops the link (fewer look-alikes)", () => {
    const withoutRefs: string[] = [];
    for (const a of letters) {
      const driving = pickDrivingNodule(extraction(a).result.nodules);
      for (const b of letters) if (a !== b && matchFinding(driving, manifest(b).nodules).matched) withoutRefs.push(`${a}->${b}`);
    }
    // only genuine look-alikes remain (same side, type and near size, no contradicting lobe): the reference settles those
    expect(withoutRefs.length).toBeLessThan(19);
    expect(withoutRefs).not.toContain("a->p"); // A is right upper, P is right lower
  });

  it("every report states one finding, checked against the report, and the sizes agree with the scan measurement", () => {
    for (const l of letters) {
      const nodules = extraction(l).result.nodules;
      expect(nodules, l).toHaveLength(1);
      expect(nodules[0].confidence, l).toBe("checked");
      expect(Math.abs((nodules[0].mean_diameter_mm ?? 0) - manifest(l).nodules[0].fleischner_size_mm), l).toBeLessThanOrEqual(0.5);
    }
  });
});
