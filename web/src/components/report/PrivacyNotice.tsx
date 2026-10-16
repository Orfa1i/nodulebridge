"use client";

import { ShieldCheck } from "lucide-react";
import type { DeidentifySummary } from "@/features/privacy/deidentify";

/** Confirmation row after browser-side de-identification: counts and tag names, never values. */
export function PrivacyNotice({ summary }: { summary: DeidentifySummary }) {
  const files = `${summary.dicomFiles} file${summary.dicomFiles === 1 ? "" : "s"}`;
  return (
    <div className="ak-alert ak-alert--success" role="status" data-testid="privacy-notice">
      <ShieldCheck size={20} strokeWidth={2} aria-hidden="true" />
      <div className="ak-alert__body">
        <p className="ak-alert__title" data-testid="privacy-title">
          Patient details removed from {files} on this device before anything is sent.
        </p>
        <p>Nothing from the scan leaves your browser in this prototype. Text burned into the pixels is not removed, which is why such scans are refused.</p>
        <details className="nb-ignored" data-testid="privacy-details">
          <summary>See what was removed</summary>
          <ul>
            {summary.removedTags.map((t) => (
              <li key={t.tag}>
                <span className="nb-mono-note">{t.tag}</span> {t.name}
              </li>
            ))}
            <li>{summary.privateTagsRemoved} private tag{summary.privateTagsRemoved === 1 ? "" : "s"}</li>
            <li>Study, series, acquisition and content dates shifted by a random offset</li>
            <li>{summary.knownSeries ? "UIDs kept: this is a known LIDC-IDRI series, already de-identified by TCIA" : "Study, series, instance and frame of reference UIDs replaced"}</li>
            <li>File names replaced with slice numbers</li>
            {summary.skipped > 0 ? <li>{summary.skipped} file{summary.skipped === 1 ? "" : "s"} that were not DICOM left out</li> : null}
          </ul>
        </details>
      </div>
    </div>
  );
}
