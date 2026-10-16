import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MATCH_THRESHOLD, matchFinding, pickDrivingNodule, type ManifestNodule, type ReportNodule } from "@/features/analysis/matchFinding";

const ROOT = join(__dirname, "..", "..");
const manifest = (letter: string) => JSON.parse(readFileSync(join(ROOT, "public", "cases", `case-${letter}`, "manifest.json"), "utf8"));
const extraction = (letter: string) => JSON.parse(readFileSync(join(ROOT, "tests", "e2e", "fixtures", `extract-case-${letter}.json`), "utf8"));

function reportNodule(over: Partial<ReportNodule> = {}): ReportNodule {
  return {
    id: "n1", count_context: "single", size_text: null, dimensions_mm: [], size_basis: "stated_single", attenuation: "solid",
    solid_component_mm: null, side: "right", lobe: "upper", morphology: [], benign_features: [], stability_text: null,
    assertion: "present", evidence: [], mean_diameter_mm: 9, ...over,
  } as ReportNodule;
}

function manifestNodule(over: Partial<ManifestNodule> = {}): ManifestNodule {
  const base = manifest("a").nodules[0] as ManifestNodule;
  return { ...base, ...over, lobe_estimate: { ...base.lobe_estimate, ...(over.lobe_estimate ?? {}) } } as ManifestNodule;
}

describe("matchFinding", () => {
  it("matches a report finding that agrees on size, side, lobe and attenuation", () => {
    const r = matchFinding(reportNodule(), [manifestNodule()]);
    expect(r.matched).toBe(true);
    expect(r.score).toBe(6);
    expect(r.noduleId).toBe("n1");
    expect(r.reasons).toEqual(["size 9 vs 8.8 mm", "right side", "upper lobe (estimate)", "solid"]);
    expect(r.summary).toBe("Matched to outline: size 9 vs 8.8 mm, right side, upper lobe (estimate), solid");
  });

  it("the lobe is only worth one point: a true pair with no lobe in the report still matches", () => {
    expect(matchFinding(reportNodule({ lobe: null }), [manifestNodule()])).toMatchObject({ matched: true, score: 5 });
  });

  it("size bands: within 1 mm +2, within 2 mm +1, beyond 2 mm +0", () => {
    const score = (mm: number) => matchFinding(reportNodule({ mean_diameter_mm: mm, side: null, lobe: null, attenuation: "unknown" }), [manifestNodule()]).score;
    expect([score(8.8), score(9.8), score(7.8), score(10.8), score(6.8), score(12)]).toEqual([2, 2, 2, 1, 1, 0]);
  });

  it("side, lobe and attenuation each score on their own and a wrong side scores nothing", () => {
    const only = (over: Partial<ReportNodule>) => matchFinding(reportNodule({ mean_diameter_mm: null, side: null, lobe: null, attenuation: "unknown", ...over }), [manifestNodule()]).score;
    expect(only({ side: "right" })).toBe(2);
    expect(only({ side: "left" })).toBe(0);
    expect(only({ lobe: "upper" })).toBe(1);
    expect(only({ lobe: "lower" })).toBe(0);
    expect(only({ attenuation: "solid" })).toBe(1);
    expect(only({ attenuation: "ground_glass" })).toBe(0);
  });

  it("a middle lobe in the report agrees with a mid-lung estimate; manifest attenuation names are mapped", () => {
    const mid = manifestNodule({ attenuation: "ground-glass", lobe_estimate: { region: "mid", side: "right", label: "right mid-lung zone" } as ManifestNodule["lobe_estimate"] });
    const r = matchFinding(reportNodule({ lobe: "middle", attenuation: "ground_glass", mean_diameter_mm: 8.8 }), [mid]);
    expect(r.reasons).toContain("middle lobe (estimate)");
    expect(r.reasons).toContain("ground-glass");
    expect(r.score).toBe(6);
  });

  it("an unknown attenuation or a missing size is never counted as agreement", () => {
    const r = matchFinding(reportNodule({ attenuation: "unknown", mean_diameter_mm: null }), [manifestNodule()]);
    expect(r.score).toBe(3);
    expect(r.matched).toBe(false);
  });

  it("not matched: explains in plain words and still names the best candidate", () => {
    const r = matchFinding(reportNodule({ side: "left", mean_diameter_mm: 20 }), [manifestNodule()]);
    expect(r).toMatchObject({ matched: false, noduleId: null, bestId: "n1", summary: "The report finding could not be matched to an outlined nodule", threshold: MATCH_THRESHOLD });
  });

  it("picks the best of several outlined nodules", () => {
    const a = manifestNodule({ id: "n1", mean_diameter_mm: 20 });
    const b = manifestNodule({ id: "n2", mean_diameter_mm: 9 });
    expect(matchFinding(reportNodule(), [a, b]).noduleId).toBe("n2");
  });

  it("no report nodule or no outlined nodule is not a match", () => {
    expect(matchFinding(null, [manifestNodule()])).toMatchObject({ matched: false, summary: "The report does not describe a nodule to match." });
    expect(matchFinding(reportNodule(), [])).toMatchObject({ matched: false, summary: "This scan has no outlined nodule." });
  });

  it("is deterministic and does not modify its inputs", () => {
    const rn = reportNodule();
    const mn = [manifestNodule()];
    const snapshot = JSON.stringify([rn, mn]);
    expect(matchFinding(rn, mn)).toEqual(matchFinding(rn, mn));
    expect(JSON.stringify([rn, mn])).toBe(snapshot);
  });
});

describe("report x scan matrix: only the true pairs match", () => {
  const letters = ["a", "b", "c"];
  for (const reportLetter of letters) {
    for (const scanLetter of letters) {
      it(`report ${reportLetter.toUpperCase()} with scan ${scanLetter.toUpperCase()}`, () => {
        const driving = pickDrivingNodule(extraction(reportLetter).result.nodules);
        const result = matchFinding(driving, manifest(scanLetter).nodules);
        expect(result.matched, `${result.summary} (score ${result.score})`).toBe(reportLetter === scanLetter);
        if (reportLetter === scanLetter) expect(result.noduleId).toBe("n1");
      });
    }
  }
});

describe("pickDrivingNodule", () => {
  it("takes the largest present nodule and ignores benign ones when another exists", () => {
    const nodules = [
      reportNodule({ id: "n1", mean_diameter_mm: 4 }),
      reportNodule({ id: "n2", mean_diameter_mm: 12, attenuation: "calcified" }),
      reportNodule({ id: "n3", mean_diameter_mm: 7 }),
    ];
    expect(pickDrivingNodule(nodules)?.id).toBe("n3");
  });

  it("falls back to a benign nodule when all are benign, and to hedged when none is present", () => {
    expect(pickDrivingNodule([reportNodule({ benign_features: ["fat"] })])?.id).toBe("n1");
    expect(pickDrivingNodule([reportNodule({ assertion: "hedged", id: "h1" }), reportNodule({ assertion: "negated", id: "x" })])?.id).toBe("h1");
  });

  it("breaks size ties by suspicion: part-solid, then ground-glass, then solid", () => {
    const kinds = ["solid", "ground_glass", "part_solid"] as const;
    const nodules = kinds.map((k, i) => reportNodule({ id: `n${i + 1}`, attenuation: k, mean_diameter_mm: 8 }));
    expect(pickDrivingNodule(nodules)?.id).toBe("n3");
  });

  it("prefers sized nodules, and returns null when nothing is present or hedged", () => {
    expect(pickDrivingNodule([reportNodule({ id: "n1", mean_diameter_mm: null }), reportNodule({ id: "n2", mean_diameter_mm: 5 })])?.id).toBe("n2");
    expect(pickDrivingNodule([reportNodule({ assertion: "negated" })])).toBeNull();
    expect(pickDrivingNodule([])).toBeNull();
  });
});
