import type { CaseManifest } from "@/types/generated/case-manifest";

export type Nodule = CaseManifest["nodules"][number];

// Local dev serves /web/public/cases (copied by `pnpm sync:cases`). Production sets
// NEXT_PUBLIC_DATA_BASE_URL (the DATA_BASE_URL host, with CORS and immutable caching).
const BASE = (process.env.NEXT_PUBLIC_DATA_BASE_URL ?? "/cases").replace(/\/$/, "");

export function caseIdFromParam(param: string | null | undefined): string {
  const letter = (param ?? "A").trim().toLowerCase();
  return letter.startsWith("case-") ? letter : `case-${letter}`;
}

/** Absolute URL of the index of prepared cases (series UIDs and CT hashes). */
export function caseIndexUrl(): string {
  const path = `${BASE}/index.json`;
  return typeof window !== "undefined" ? new URL(path, window.location.origin).href : path;
}

export function caseFileUrl(caseId: string, file: string): string {
  const path = `${BASE}/${caseId}/${file}`;
  // The NIfTI loader calls new URL(url) without a base, so it needs an absolute URL.
  return typeof window !== "undefined" ? new URL(path, window.location.origin).href : path;
}

export interface CaseUrls {
  manifest: string;
  ct: string;
  mask: string;
}

export function caseUrls(caseId: string, manifest?: CaseManifest): CaseUrls {
  return {
    manifest: caseFileUrl(caseId, "manifest.json"),
    ct: caseFileUrl(caseId, manifest?.files.ct ?? "ct.nii.gz"),
    mask: caseFileUrl(caseId, manifest?.files.mask ?? "mask.nii.gz"),
  };
}

export async function fetchManifest(caseId: string): Promise<CaseManifest> {
  const url = caseFileUrl(caseId, "manifest.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return (await res.json()) as CaseManifest;
}

/** Unit vector of the slice axis in LPS (third column of the manifest direction matrix). */
export function sliceAxis(m: CaseManifest): [number, number, number] {
  const d = m.geometry.direction;
  return [d[0][2], d[1][2], d[2][2]];
}

export function sliceSpacing(m: CaseManifest): number {
  return m.geometry.spacing[2];
}

/** Display (0-based) slice index for a world point, from the manifest geometry only. */
export function worldToSliceIndex(m: CaseManifest, world: ArrayLike<number>): number {
  const o = m.geometry.origin;
  const a = sliceAxis(m);
  const t = (world[0] - o[0]) * a[0] + (world[1] - o[1]) * a[1] + (world[2] - o[2]) * a[2];
  const n = m.geometry.dims[2];
  return Math.min(n - 1, Math.max(0, Math.round(t / sliceSpacing(m))));
}

/** World point on the plane of slice `index`, keeping the in-plane position of `world`. */
export function worldOnSlice(m: CaseManifest, world: ArrayLike<number>, index: number): [number, number, number] {
  const o = m.geometry.origin;
  const a = sliceAxis(m);
  const t = (world[0] - o[0]) * a[0] + (world[1] - o[1]) * a[1] + (world[2] - o[2]) * a[2];
  const shift = index * sliceSpacing(m) - t;
  return [world[0] + shift * a[0], world[1] + shift * a[1], world[2] + shift * a[2]];
}
