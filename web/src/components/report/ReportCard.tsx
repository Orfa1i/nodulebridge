"use client";

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

export function ReportCard({ data, reading }: { data: ExtractResponse | null; reading: boolean }) {
  const evidence = data ? evidenceSentenceIds(data.result) : new Set<string>();
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
        <div className="nb-report" tabIndex={0} role="region" aria-label="Report text, scrollable">
          {byLine(data.sentences).map((group) => (
            <p key={group[0].id} className="nb-report__line">
              {group.map((s, i) => (
                <span key={s.id}>
                  {i > 0 ? " " : null}
                  <span data-sid={s.id} className={evidence.has(s.id) ? "nb-evidence" : undefined}>
                    {s.text}
                  </span>
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
