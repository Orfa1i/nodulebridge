export interface UploadFiles {
  /** DICOM files of one series, or one NIfTI file. */
  ct: File[];
  /** The report as PDF or plain text. */
  report: File | null;
}
