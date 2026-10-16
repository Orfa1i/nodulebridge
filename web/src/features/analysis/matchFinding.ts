import type { CaseManifest } from "@/types/generated/case-manifest";
import type { ExtractResponse } from "@/types/generated/extract-response";

export type ReportNodule = ExtractResponse["result"]["nodules"][number];
export type ManifestNodule = CaseManifest["nodules"][number];

/**
 * Scoring (max 6). The phase file asked for size within 2 mm = +2 and within 4 mm = +1 with a threshold of 4.
 * That matches case B's report (7 mm, solid, right) to case A's scan (8.8 mm, solid, right upper), which the
 * acceptance check says must NOT match. So the size bands are tighter and the threshold is higher:
 *   size within 1 mm +2, within 2 mm +1; side +2; lobe +1; attenuation +1; matched at 5 or more.
 * A true pair loses at most the lobe point (the manifest lobe is a geometric estimate and reports often give none).
 */
export const MATCH_THRESHOLD = 5;
export const SIZE_BANDS: readonly [number, number][] = [
  [1, 2],
  [2, 1],
];

export interface MatchResult {
  matched: boolean;
  /** Manifest nodule id of the best candidate, set only when matched. */
  noduleId: string | null;
  /** Best candidate even when below the threshold, for the explanation. */
  bestId: string | null;
  score: number;
  threshold: number;
  reasons: string[];
  /** Why it was not matched, in plain words. */
  summary: string;
}

const MANIFEST_ATTENUATION: Record<string, ReportNodule["attenuation"]> = {
  solid: "solid",
  "part-solid": "part_solid",
  "ground-glass": "ground_glass",
};
const TYPE_RANK: Record<string, number> = { solid: 0, ground_glass: 1, part_solid: 2 };

export function isBenign(n: ReportNodule): boolean {
  return n.benign_features.length > 0 || n.attenuation === "calcified";
}

/** Same selection as the guideline engine: present before hedged, benign last, largest first, then most suspicious. */
export function pickDrivingNodule(nodules: ReportNodule[]): ReportNodule | null {
  const present = nodules.filter((n) => n.assertion === "present");
  const hedged = nodules.filter((n) => n.assertion === "hedged");
  const pool = present.length > 0 ? (present.filter((n) => !isBenign(n)).length > 0 ? present.filter((n) => !isBenign(n)) : present) : hedged;
  if (pool.length === 0) return null;
  const sized = pool.filter((n) => n.mean_diameter_mm != null);
  const candidates = sized.length > 0 ? sized : pool;
  return candidates.reduce((best, n) => {
    const a = [n.mean_diameter_mm ?? -1, TYPE_RANK[n.attenuation] ?? 0];
    const b = [best.mean_diameter_mm ?? -1, TYPE_RANK[best.attenuation] ?? 0];
    return a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) ? n : best;
  });
}

function fmt(x: number): string {
  return `${+x.toFixed(1)}`;
}

function scoreOne(report: ReportNodule, m: ManifestNodule): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (report.mean_diameter_mm != null) {
    const diff = Math.abs(report.mean_diameter_mm - m.mean_diameter_mm);
    const band = SIZE_BANDS.find(([mm]) => diff <= mm + 1e-9); // tolerance: 8.8 - 7.8 is 1.0000000000000009
    if (band) {
      score += band[1];
      reasons.push(`size ${fmt(report.mean_diameter_mm)} vs ${fmt(m.mean_diameter_mm)} mm`);
    }
  }
  if (report.side && report.side === m.lobe_estimate.side) {
    score += 2;
    reasons.push(`${report.side} side`);
  }
  const region = m.lobe_estimate.region;
  const lobeMatches = report.lobe != null && (report.lobe === region || (report.lobe === "middle" && region === "mid"));
  if (lobeMatches) {
    score += 1;
    reasons.push(`${report.lobe} lobe (estimate)`);
  }
  if (report.attenuation !== "unknown" && MANIFEST_ATTENUATION[m.attenuation] === report.attenuation) {
    score += 1;
    reasons.push(report.attenuation.replace("_", "-"));
  }
  return { score, reasons };
}

/** Match the report's driving nodule to one outlined nodule of the prepared scan. Pure and deterministic. */
export function matchFinding(report: ReportNodule | null, manifestNodules: ManifestNodule[]): MatchResult {
  const base = { threshold: MATCH_THRESHOLD, noduleId: null, bestId: null, score: 0, reasons: [] as string[] };
  if (!report) return { ...base, matched: false, summary: "The report does not describe a nodule to match." };
  if (manifestNodules.length === 0) return { ...base, matched: false, summary: "This scan has no outlined nodule." };

  let best: { id: string; score: number; reasons: string[] } | null = null;
  for (const m of manifestNodules) {
    const s = scoreOne(report, m);
    if (!best || s.score > best.score) best = { id: m.id, ...s };
  }
  const result = best as { id: string; score: number; reasons: string[] };
  if (result.score >= MATCH_THRESHOLD) {
    return {
      matched: true,
      noduleId: result.id,
      bestId: result.id,
      score: result.score,
      threshold: MATCH_THRESHOLD,
      reasons: result.reasons,
      summary: `Matched to outline: ${result.reasons.join(", ")}`,
    };
  }
  return {
    matched: false,
    noduleId: null,
    bestId: result.id,
    score: result.score,
    threshold: MATCH_THRESHOLD,
    reasons: result.reasons,
    summary: "The report finding could not be matched to an outlined nodule",
  };
}
