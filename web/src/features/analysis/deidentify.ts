export interface UploadFiles {
  /** DICOM files of one series, or one NIfTI file. */
  ct: File[];
  /** The report as PDF or plain text. */
  report: File | null;
}

let warned = false;

/**
 * Privacy hook. Called on every upload BEFORE anything leaves the browser (the report is sent to the API,
 * the CT may be sent later). Phase 9 implements real de-identification (DICOM PS3.15 basic profile and PDF text).
 * Until then it returns the files unchanged and says so. Do not remove the call.
 */
export async function deidentify(files: UploadFiles): Promise<UploadFiles> {
  if (!warned) {
    warned = true;
    console.warn("[deidentify] stub: files are NOT de-identified yet. Use example data only.");
  }
  return files;
}
