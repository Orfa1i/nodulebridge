"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import type { MatchResult } from "@/features/analysis/matchFinding";
import { describeNodule, type ExtractError } from "@/lib/extract";
import type { ExtractResponse } from "@/types/generated/extract-response";

export type FindingsState =
  | { status: "idle" }
  | { status: "reading"; elapsedSeconds: number }
  | { status: "error"; error: ExtractError | Error }
  | { status: "done"; data: ExtractResponse };

interface Props {
  state: FindingsState;
  onStart: () => void;
  /** The report nodule that drives the guideline and the outline match. */
  drivingId?: string | null;
  match?: MatchResult | null;
  /** True while the viewer is scrolled onto the slices of the outline. */
  inView?: boolean;
  /** Jump the viewer to the outline and show the sentence. */
  onShowInScan?: () => void;
}

function NoduleRow({
  n,
  match,
  inView,
  onShowInScan,
}: {
  n: ExtractResponse["result"]["nodules"][number];
  match: MatchResult | null;
  inView: boolean;
  onShowInScan?: () => void;
}) {
  if (n.assertion === "negated") {
    return (
      <li className="nb-finding">
        <p className="nb-finding__values">No nodules reported</p>
        <p className="nb-finding__note">The report says there are no pulmonary nodules.</p>
      </li>
    );
  }
  const checked = n.confidence === "checked";
  return (
    <li className={`nb-finding${inView ? " is-in-view" : ""}`} data-testid="finding-row" data-in-view={inView}>
      <div className="nb-finding__head">
        <p className="nb-finding__values" data-testid="finding-values">
          {describeNodule(n)}
        </p>
        {checked ? (
          <span className="ak-badge ak-badge--success">
            <CircleCheck size={14} strokeWidth={2} aria-hidden="true" />
            Checked against report
          </span>
        ) : (
          <span className="ak-badge ak-badge--warning">
            <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
            Needs review
          </span>
        )}
      </div>
      {match ? (
        <p className="nb-finding__note" data-testid="match-line" data-matched={match.matched}>
          {match.summary}
        </p>
      ) : null}
      {match?.matched && onShowInScan ? (
        <button type="button" className="ak-btn ak-btn--secondary ak-btn--sm nb-finding__action" onClick={onShowInScan}>
          Show in scan
        </button>
      ) : null}
      {n.assertion === "hedged" ? <p className="nb-finding__note">The report words this as uncertain.</p> : null}
      {n.size_note ? <p className="nb-finding__note">{n.size_note}</p> : null}
      {!checked && (n.confidence_reasons ?? []).length > 0 ? (
        <p className="nb-finding__note">Reason: {(n.confidence_reasons ?? []).join("; ")}</p>
      ) : null}
    </li>
  );
}

export function FindingsCard({ state, onStart, drivingId = null, match = null, inView = false, onShowInScan }: Props) {
  return (
    <section className="ak-card" aria-labelledby="findings-title">
      <div className="ak-card__head">
        <h2 id="findings-title" className="ak-card__title">
          Findings from the report
        </h2>
        <span className="ak-badge ak-badge--ai">AI-assisted</span>
      </div>

      {state.status === "idle" ? (
        <div className="ak-empty">
          <p className="ak-empty__title">No findings yet</p>
          <p className="ak-empty__text">An AI model reads the report. Each value is checked against the report text.</p>
          <button type="button" className="ak-btn ak-btn--primary" onClick={onStart}>
            Start analysis
          </button>
        </div>
      ) : null}

      {state.status === "reading" ? (
        <div className="ak-progress-field" data-testid="reading-progress">
          <div className="ak-progress-field__row">
            <span className="ak-progress-field__label">Reading the report</span>
            <span className="ak-progress-field__value">{state.elapsedSeconds} s</span>
          </div>
          <div className="ak-progress ak-progress--spectrum is-indeterminate" role="progressbar" aria-label="Reading the report">
            <div className="ak-progress__bar" />
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="ak-alert ak-alert--danger" role="alert">
          <div className="ak-alert__body">
            <p className="ak-alert__title">{state.error.message}</p>
            {"detail" in state.error && state.error.detail ? <p>{state.error.detail}</p> : null}
          </div>
          <div className="ak-alert__actions">
            <button type="button" className="ak-btn ak-btn--secondary ak-btn--sm" onClick={onStart}>
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {state.status === "done" ? (
        <>
          {state.data.cached ? (
            <p className="nb-finding__note">
              <span className="ak-badge ak-badge--outline" title="This result was saved from an earlier run on the same report and model.">
                Pre-computed for demo
              </span>{" "}
              Same report, model and prompt as an earlier run.
            </p>
          ) : null}
          {state.data.result.nodules.length === 0 && state.data.verification.nodules_removed > 0 ? (
            <div className="ak-alert ak-alert--warning" role="status" data-testid="unverified-finding">
              <TriangleAlert size={20} strokeWidth={2} aria-hidden="true" />
              <div className="ak-alert__body">
                <p className="ak-alert__title">
                  <span className="ak-badge ak-badge--warning">Needs review</span> A finding could not be checked against the report.
                </p>
                <p>The model named a finding, but its quote was not found in the report text, so the finding was dropped. Please read the report yourself or ask your doctor.</p>
              </div>
            </div>
          ) : state.data.result.nodules.length === 0 ? (
            <p className="nb-finding__values">No nodules found in the report.</p>
          ) : (
            <ul className="nb-findings" aria-label="Nodules found in the report">
              {state.data.result.nodules.map((n) => (
                <NoduleRow key={n.id} n={n} match={n.id === drivingId ? match : null} inView={n.id === drivingId && inView} onShowInScan={n.id === drivingId ? onShowInScan : undefined} />
              ))}
            </ul>
          )}
          <details className="nb-ignored">
            <summary>Ignored findings ({state.data.result.other_findings.length})</summary>
            {state.data.result.other_findings.length === 0 ? (
              <p className="nb-finding__note">Nothing else was flagged.</p>
            ) : (
              <ul>
                {state.data.result.other_findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </details>
          <p className="nb-finding__note nb-mono-note">
            {state.data.model} · {state.data.prompt_version} · {Math.round(state.data.timings.total_ms)} ms
          </p>
        </>
      ) : null}
    </section>
  );
}
