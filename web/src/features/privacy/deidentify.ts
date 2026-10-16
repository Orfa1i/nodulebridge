import dcmjs, { type DicomDataset, type DicomDict } from "dcmjs";
import type { UploadFiles } from "./uploadFiles";

export type { UploadFiles } from "./uploadFiles";

/**
 * Browser-side DICOM de-identification, a documented SUBSET of the DICOM PS3.15 Basic Application Level
 * Confidentiality Profile. It runs on this device before anything else touches the files; nothing from a scan is sent
 * to the server in this prototype, and the de-identified copy never leaves the browser.
 *
 * What it does
 * - removes the identifying tags in REMOVED_TAGS (at the top level and inside sequences) and every private tag
 *   (odd group number);
 * - shifts StudyDate, SeriesDate, AcquisitionDate and ContentDate by one random per-session offset (days);
 * - replaces the Study, Series, SOP and Frame of Reference UIDs with new ones, consistently across the series,
 *   EXCEPT for a series that is a known LIDC-IDRI case (TCIA already de-identified it and the UID is how the app
 *   recognises it);
 * - keeps geometry (spacing, position, orientation) and pixel data exactly as they were;
 * - renames the files to slice-0001.dcm and so on, because file names can carry names or IDs;
 * - refuses a non-LIDC scan whose BurnedInAnnotation is YES or missing.
 *
 * What it does NOT do (stated in the README): scrub pixels. Text burned into the image stays. That is why a scan that
 * may have burned-in annotation is stopped instead of cleaned. NIfTI files have no patient tags here and are kept as
 * they are (they are recognised by their hash).
 */

export interface RemovedTag {
  tag: string; // "(0010,0010)"
  name: string;
}

/** Tags blanked or removed. Values are never shown or logged, only these names. */
export const REMOVED_TAGS: Record<string, string> = {
  "00100010": "PatientName",
  "00100020": "PatientID",
  "00100030": "PatientBirthDate",
  "00100032": "PatientBirthTime",
  "00100040": "PatientSex",
  "00101000": "OtherPatientIDs",
  "00101001": "OtherPatientNames",
  "00101040": "PatientAddress",
  "00102154": "PatientTelephoneNumbers",
  "00080050": "AccessionNumber",
  "00080080": "InstitutionName",
  "00080081": "InstitutionAddress",
  "00081040": "InstitutionalDepartmentName",
  "00080090": "ReferringPhysicianName",
  "00081048": "PhysiciansOfRecord",
  "00081050": "PerformingPhysicianName",
  "00081070": "OperatorsName",
  "00081010": "StationName",
  "00181000": "DeviceSerialNumber",
  "00200010": "StudyID",
};

const DATE_TAGS: Record<string, string> = {
  "00080020": "StudyDate",
  "00080021": "SeriesDate",
  "00080022": "AcquisitionDate",
  "00080023": "ContentDate",
};

const UID_TAGS: Record<string, string> = {
  "0020000D": "StudyInstanceUID",
  "0020000E": "SeriesInstanceUID",
  "00080018": "SOPInstanceUID",
  "00200052": "FrameOfReferenceUID",
};
const META_UID_TAGS = ["00020003"]; // MediaStorageSOPInstanceUID

const SERIES_UID = "0020000E";
const BURNED_IN = "00280301";

export class BurnedInAnnotationError extends Error {
  constructor() {
    super("This scan may have patient details burned into the images. It was not uploaded.");
    this.name = "BurnedInAnnotationError";
  }
}

export interface DeidentifySummary {
  dicomFiles: number;
  removedTags: RemovedTag[];
  privateTagsRemoved: number;
  datesShifted: boolean;
  uidsReplaced: boolean;
  knownSeries: boolean;
  /** Files that were not DICOM and were left out of the scan. */
  skipped: number;
}

export interface DeidentifyResult {
  files: UploadFiles;
  /** null when the scan is not DICOM (NIfTI) or nothing was provided. */
  summary: DeidentifySummary | null;
}

export interface DeidentifyOptions {
  /** SeriesInstanceUIDs of the prepared LIDC-IDRI cases. */
  knownSeriesUids?: ReadonlySet<string>;
  /** Fixed day offset for tests; otherwise random per call. */
  dayOffset?: number;
  /** Fixed random source for tests. */
  random?: () => number;
}

const hex = (tag: string) => `(${tag.slice(0, 4)},${tag.slice(4)})`;
const first = (el?: { Value?: unknown[] }): string | null => {
  const v = el?.Value?.[0];
  return typeof v === "string" ? v.trim() : null;
};

function randomOffsetDays(random: () => number): number {
  return -(30 + Math.floor(random() * 700)); // 30 to 730 days into the past
}

/** Shift a DICOM date (YYYYMMDD) by whole days, in UTC so the result does not depend on the time zone. */
export function shiftDate(value: string, days: number): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** A new UID under the 2.25 root (UUID derived). */
export function newUid(random: () => number): string {
  let n = 0n;
  for (let i = 0; i < 4; i++) n = (n << 32n) | BigInt(Math.floor(random() * 0x100000000));
  return `2.25.${n.toString()}`;
}

interface Pass {
  removed: Set<string>;
  privateRemoved: number;
}

/** Remove identifying and private tags from a dataset and, recursively, from its sequences. */
function scrub(ds: DicomDataset, pass: Pass): void {
  for (const tag of Object.keys(ds)) {
    const group = parseInt(tag.slice(0, 4), 16);
    if (group % 2 === 1) {
      delete ds[tag];
      pass.privateRemoved += 1;
      continue;
    }
    if (REMOVED_TAGS[tag]) {
      delete ds[tag];
      pass.removed.add(tag);
      continue;
    }
    const el = ds[tag];
    if (el.vr === "SQ" && Array.isArray(el.Value)) {
      for (const item of el.Value as DicomDataset[]) scrub(item, pass);
    }
  }
}

function deidentifyOne(
  buffer: ArrayBuffer,
  ctx: { known: ReadonlySet<string>; offset: number; uids: Map<string, string>; random: () => number; removed: Set<string> },
): { out: ArrayBuffer; privateRemoved: number; known: boolean } {
  const dicom: DicomDict = dcmjs.data.DicomMessage.readFile(buffer, { ignoreErrors: true });
  const series = first(dicom.dict[SERIES_UID]);
  const known = !!series && ctx.known.has(series);
  if (!known) {
    const burned = first(dicom.dict[BURNED_IN]);
    if (burned === null || burned.toUpperCase() === "YES") throw new BurnedInAnnotationError();
  }
  const pass: Pass = { removed: ctx.removed, privateRemoved: 0 };
  scrub(dicom.dict, pass);
  for (const tag of Object.keys(DATE_TAGS)) {
    const el = dicom.dict[tag];
    if (!el?.Value?.length) continue;
    const shifted = typeof el.Value[0] === "string" ? shiftDate(el.Value[0], ctx.offset) : null;
    if (shifted) el.Value = [shifted];
    else delete dicom.dict[tag];
  }
  if (!known) {
    const swap = (el: { Value?: unknown[] } | undefined) => {
      const old = first(el);
      if (!el || !old) return;
      if (!ctx.uids.has(old)) ctx.uids.set(old, newUid(ctx.random));
      el.Value = [ctx.uids.get(old)];
    };
    for (const tag of Object.keys(UID_TAGS)) swap(dicom.dict[tag]);
    for (const tag of META_UID_TAGS) swap(dicom.meta[tag]);
    // the meta SOP instance UID must equal the dataset SOP instance UID
    const sop = first(dicom.dict["00080018"]);
    if (sop && dicom.meta["00020003"]) dicom.meta["00020003"].Value = [sop];
  }
  return { out: dicom.write(), privateRemoved: pass.privateRemoved, known };
}

/**
 * Privacy step of every upload. Call it BEFORE anything else reads or sends the files.
 * Throws BurnedInAnnotationError for a non-LIDC scan that may carry text in the pixels.
 */
export async function deidentify(files: UploadFiles, opts: DeidentifyOptions = {}): Promise<DeidentifyResult> {
  const nifti = files.ct.some((f) => /\.nii(\.gz)?$/i.test(f.name));
  if (files.ct.length === 0 || nifti) return { files, summary: null };

  const random = opts.random ?? Math.random;
  const ctx = {
    known: opts.knownSeriesUids ?? new Set<string>(),
    offset: opts.dayOffset ?? randomOffsetDays(random),
    uids: new Map<string, string>(),
    random,
    removed: new Set<string>(),
  };
  const ordered = [...files.ct].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const out: File[] = [];
  let privateRemoved = 0;
  let skipped = 0;
  let knownSeries = false;
  for (const file of ordered) {
    let result: ReturnType<typeof deidentifyOne>;
    try {
      result = deidentifyOne(await file.arrayBuffer(), ctx);
    } catch (err) {
      if (err instanceof BurnedInAnnotationError) throw err;
      skipped += 1; // not a DICOM file (a LICENSE, a .DS_Store): it is not part of the scan
      continue;
    }
    privateRemoved += result.privateRemoved;
    knownSeries ||= result.known;
    out.push(new File([result.out], `slice-${String(out.length + 1).padStart(4, "0")}.dcm`, { type: "application/dicom" }));
    if (out.length % 25 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive on large series
  }
  return {
    files: { ...files, ct: out },
    summary: {
      dicomFiles: out.length,
      removedTags: [...ctx.removed].sort().map((t) => ({ tag: hex(t), name: REMOVED_TAGS[t] })),
      privateTagsRemoved: privateRemoved,
      datesShifted: true,
      uidsReplaced: !knownSeries,
      knownSeries,
      skipped,
    },
  };
}
