"use client";

import { Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import type { UploadFiles } from "@/features/privacy/uploadFiles";

const REPORT_EXT = /\.(pdf|txt|md)$/i;

/** Split a flat file list into the report (PDF or text) and the CT (DICOM files or one NIfTI). */
export function classifyFiles(files: File[]): UploadFiles {
  const reports = files.filter((f) => REPORT_EXT.test(f.name));
  const ct = files.filter((f) => !REPORT_EXT.test(f.name));
  // prefer a PDF if several candidates were dropped
  const report = reports.find((f) => /\.pdf$/i.test(f.name)) ?? reports[0] ?? null;
  return { ct, report };
}

/** Read every file from a drop, walking dropped folders (webkitGetAsEntry). */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  const entries = Array.from(dt.items ?? [])
    .map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length > 0) {
    for (const e of entries) await walk(e);
  } else {
    out.push(...Array.from(dt.files));
  }
  return out;
}

interface Props {
  onFiles: (files: UploadFiles) => void;
}

export function UploadZone({ onFiles }: Props) {
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<UploadFiles>({ ct: [], report: null });
  const [message, setMessage] = useState<string | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const accept = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const next = classifyFiles(incoming);
    const merged: UploadFiles = { ct: next.ct.length ? next.ct : picked.ct, report: next.report ?? picked.report };
    setPicked(merged);
    if (merged.ct.length > 0 && merged.report) {
      setMessage(null);
      onFiles(merged); // both are here: start (the drop or choice was the click)
    } else {
      setMessage(merged.ct.length ? "Now add the report as a PDF or a text file." : "Now add the CT: a DICOM folder or a .nii.gz file.");
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    accept(await filesFromDrop(e.dataTransfer));
  };

  return (
    <section className="ak-card" aria-labelledby="upload-title">
      <h2 id="upload-title" className="ak-card__title">
        Use your own files
      </h2>
      <div
        className={`ak-dropzone${dragging ? " is-dragover" : ""}`}
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="ak-dropzone__icon">
          <Upload size={22} strokeWidth={2} aria-hidden="true" />
        </span>
        <p className="ak-dropzone__title">
          Drop a chest CT folder and its report, or{" "}
          <b>
            <button type="button" className="ak-link nb-link-button" onClick={() => filesInput.current?.click()}>
              choose files
            </button>
          </b>
        </p>
        <p className="ak-dropzone__meta">DICOM folder or .nii.gz, plus the report as PDF or text. Example data only.</p>
        <div className="nb-case-picker">
          <button type="button" className="ak-btn ak-btn--secondary ak-btn--sm" onClick={() => folderInput.current?.click()}>
            Choose a CT folder
          </button>
        </div>
        {picked.ct.length > 0 || picked.report ? (
          <p className="nb-finding__note" data-testid="picked">
            {picked.ct.length > 0 ? `CT: ${picked.ct.length} file${picked.ct.length === 1 ? "" : "s"}` : "CT: none yet"} ·{" "}
            {picked.report ? `Report: ${picked.report.name}` : "Report: none yet"}
          </p>
        ) : null}
        {message ? (
          <p className="nb-finding__note" role="status">
            {message}
          </p>
        ) : null}
      </div>
      {/* hidden inputs: several files at once (NIfTI + PDF), or one folder */}
      <input ref={filesInput} type="file" multiple hidden data-testid="files-input" onChange={(e) => accept(Array.from(e.target.files ?? []))} />
      <input
        ref={folderInput}
        type="file"
        hidden
        data-testid="folder-input"
        // @ts-expect-error webkitdirectory is not in the DOM typings
        webkitdirectory=""
        directory=""
        multiple
        onChange={(e) => accept(Array.from(e.target.files ?? []))}
      />
    </section>
  );
}
