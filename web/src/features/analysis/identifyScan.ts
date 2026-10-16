import dicomParser from "dicom-parser";
import { caseIndexUrl } from "@/lib/cases";

export interface CaseIndexEntry {
  case_id: string;
  label: string;
  lidc_patient_id: string;
  series_instance_uid: string;
  ct_sha256: string;
}

export type ScanIdentity =
  | { kind: "prepared"; caseId: string; label: string; via: "dicom-series-uid" | "nifti-sha256" }
  | { kind: "unmatched"; format: "dicom" | "nifti" | "unknown"; seriesInstanceUid: string | null; reason: string };

const SERIES_INSTANCE_UID = "x0020000e";
const HEADER_BYTES = 256 * 1024; // the series UID sits near the start of the header

let indexPromise: Promise<CaseIndexEntry[]> | null = null;

/** Prepared cases and how to recognise their scans (written by `pnpm sync:cases`). */
export function loadCaseIndex(): Promise<CaseIndexEntry[]> {
  indexPromise ??= fetch(caseIndexUrl())
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load the case index (${r.status}).`);
      return r.json();
    })
    .then((j: { cases: CaseIndexEntry[] }) => j.cases)
    .catch((err) => {
      indexPromise = null;
      throw err;
    });
  return indexPromise;
}

/** Read the SeriesInstanceUID of one DICOM file in the browser. Returns null if the file is not DICOM. */
export async function readSeriesUid(file: File): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
    const dataSet = dicomParser.parseDicom(bytes, { untilTag: SERIES_INSTANCE_UID });
    const uid = dataSet.string(SERIES_INSTANCE_UID);
    return uid ? uid.trim() : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const isNifti = (f: File) => /\.nii(\.gz)?$/i.test(f.name);

/**
 * Recognise an uploaded CT. A DICOM series is matched by its SeriesInstanceUID, a NIfTI file by its SHA-256 against the
 * prepared cases. Anything else is "unmatched": the report is still read, but there is no outline to link to.
 */
export async function identifyScan(ct: File[], index: CaseIndexEntry[]): Promise<ScanIdentity> {
  if (ct.length === 0) return { kind: "unmatched", format: "unknown", seriesInstanceUid: null, reason: "No scan was provided." };

  const nifti = ct.find(isNifti);
  if (nifti) {
    const hash = await sha256Hex(nifti);
    const hit = index.find((c) => c.ct_sha256 === hash);
    if (hit) return { kind: "prepared", caseId: hit.case_id, label: hit.label, via: "nifti-sha256" };
    return { kind: "unmatched", format: "nifti", seriesInstanceUid: null, reason: "This NIfTI file is not one of the prepared cases." };
  }

  // DICOM: try files in name order until one parses (folders may hold a LICENSE or a .DS_Store)
  const ordered = [...ct].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const file of ordered.slice(0, 20)) {
    const uid = await readSeriesUid(file);
    if (!uid) continue;
    const hit = index.find((c) => c.series_instance_uid === uid);
    if (hit) return { kind: "prepared", caseId: hit.case_id, label: hit.label, via: "dicom-series-uid" };
    return { kind: "unmatched", format: "dicom", seriesInstanceUid: uid, reason: "This series is not one of the prepared cases." };
  }
  return { kind: "unmatched", format: "unknown", seriesInstanceUid: null, reason: "The files are neither DICOM nor NIfTI." };
}
