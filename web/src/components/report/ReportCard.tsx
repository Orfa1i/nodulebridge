"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { prefersReducedMotion } from "@/lib/viewer/css";
import { evidenceSentenceIds } from "@/lib/extract";
import type { ExtractResponse } from "@/types/generated/extract-response";

type Sentence = ExtractResponse["sentences"][number];

/** Group sentences that sit on the same source line so the report keeps its shape. */
function byLine(sentences: Sentence[]): Sentence[][] {
  const groups: Sentence[][] = [];
  for (const s of sentences) {
    const last = groups[groups.length - 1];
    if (last && last[0].line === s.line) last.push(s);
    else groups.push([s]);
  }
  return groups;
}

const FLASH_MS = 1500;

interface Props {
  data: ExtractResponse | null;
  reading: boolean;
  /** Scroll to the evidence sentence and flash it whenever this number changes (and is above 0). */
  focusNonce?: number;
  /** Called when a highlighted sentence is activated by mouse or keyboard. */
  onSentenceActivate?: (sentenceId: string) => void;
}

export function ReportCard({ data, reading, focusNonce = 0, onSentenceActivate }: Props) {
  const evidence = data ? evidenceSentenceIds(data.result) : new Set<string>();
  const boxRef = useRef<HTMLDivElement>(null);
  // The flash is derived: it lasts until the timer records that this focus request has finished.
  const [flashDone, setFlashDone] = useState(0);
  const flashing = focusNonce > 0 && flashDone !== focusNonce;

  useEffect(() => {
    if (!focusNonce || !data) return;
    const first = boxRef.current?.querySelector<HTMLElement>(".nb-evidence");
    first?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    const t = window.setTimeout(() => setFlashDone(focusNonce), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [focusNonce, data]);

  const activate = (e: KeyboardEvent<HTMLElement>, sid: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSentenceActivate?.(sid);
    }
  };
  return (
    <section className="ak-card" aria-labelledby="report-title">
      <div className="ak-card__head">
        <div>
          <h2 id="report-title" className="ak-card__title">
            Radiology report
          </h2>
          <p className="ak-card__meta">Example report written for this demo</p>
        </div>
      </div>
      {data ? (
        <div ref={boxRef} className="nb-report" tabIndex={0} role="region" aria-label="Report text, scrollable">
          {byLine(data.sentences).map((group) => (
            <p key={group[0].id} className="nb-report__line">
              {group.map((s, i) => (
                <span key={s.id}>
                  {i > 0 ? " " : null}
                  {evidence.has(s.id) ? (
                    <span
                      data-sid={s.id}
                      role="button"
                      tabIndex={0}
                      className={`nb-evidence${flashing ? " is-active" : ""}`}
                      aria-label={`Show in the scan: ${s.text}`}
                      onClick={() => onSentenceActivate?.(s.id)}
                      onKeyDown={(e) => activate(e, s.id)}
                    >
                      {s.text}
                    </span>
                  ) : (
                    <span data-sid={s.id}>{s.text}</span>
                  )}
                </span>
              ))}
            </p>
          ))}
        </div>
      ) : (
        <div className="ak-empty">
          <p className="ak-empty__title">{reading ? "Reading the report" : "No report read yet"}</p>
          <p className="ak-empty__text">
            {reading ? "The text appears here when reading finishes." : "Start the analysis to read the report. Matching sentences are highlighted."}
          </p>
        </div>
      )}
    </section>
  );
}
