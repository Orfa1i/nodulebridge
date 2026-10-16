"use client";

import { ShieldAlert } from "lucide-react";
import { decideRedaction, type RedactionState } from "@/features/privacy/redaction";

const NOT_COMPLETE = "Pattern matching is not complete. This demo uses example reports only.";

/** Shows what was removed from the report text before it is read by the model, and asks the person to confirm. */
export function RedactionReview({ redaction }: { redaction: RedactionState }) {
  const count = `${redaction.total} item${redaction.total === 1 ? "" : "s"}`;
  if (redaction.status === "none") {
    return (
      <div className="ak-alert ak-alert--info" role="status" data-testid="redaction-none">
        <ShieldAlert size={20} strokeWidth={2} aria-hidden="true" />
        <div className="ak-alert__body">
          <p className="ak-alert__title">No personal details found in the report text by the pattern check.</p>
          <p>{NOT_COMPLETE}</p>
        </div>
      </div>
    );
  }
  if (redaction.status === "confirmed") {
    return (
      <div className="ak-alert ak-alert--info" role="status" data-testid="redaction-done">
        <ShieldAlert size={20} strokeWidth={2} aria-hidden="true" />
        <div className="ak-alert__body">
          <p className="ak-alert__title">{count} redacted from the report text before it was read.</p>
          <p>{NOT_COMPLETE}</p>
        </div>
      </div>
    );
  }
  return (
    <section className="ak-card" aria-labelledby="redaction-title" data-testid="redaction-review">
      <div className="ak-card__head">
        <h2 id="redaction-title" className="ak-card__title">
          Check the report text before it is read
        </h2>
        <span className="ak-badge ak-badge--warning">{count} redacted</span>
      </div>
      <p className="nb-finding__note" data-testid="redaction-count">
        {count} redacted
      </p>
      <ul className="nb-nextstep__questions">
        {redaction.items.map((i) => (
          <li key={i.kind}>
            {i.count} {i.label}
            {i.count === 1 ? "" : "s"}
          </li>
        ))}
      </ul>
      <p className="nb-finding__note">{NOT_COMPLETE}</p>
      <pre className="nb-redaction__preview" data-testid="redaction-preview" tabIndex={0} aria-label="Report text after redaction">
        {redaction.text}
      </pre>
      <div className="nb-passport__actions">
        <button type="button" className="ak-btn ak-btn--primary" onClick={() => decideRedaction(true)} data-testid="redaction-confirm">
          Continue with the redacted text
        </button>
        <button type="button" className="ak-btn ak-btn--secondary" onClick={() => decideRedaction(false)} data-testid="redaction-cancel">
          Cancel
        </button>
      </div>
    </section>
  );
}
