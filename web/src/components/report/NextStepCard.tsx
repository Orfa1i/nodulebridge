"use client";

import {
  CONFIRM_CHIPS,
  formatDate,
  laterSteps,
  windowText,
  type Confirmations,
  type Recommendation,
} from "@/lib/recommend";

export type NextStepState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; rec: Recommendation };

interface Props {
  state: NextStepState;
  confirmations: Confirmations;
  onConfirm: (next: Confirmations) => void;
}

function Options({ rec }: { rec: Recommendation }) {
  return (
    <div className="nb-nextstep__options">
      {rec.options.map((opt, i) => {
        const windows = opt.actions.map(windowText).filter((t): t is string => t !== null);
        const later = laterSteps(opt.actions);
        return (
          <div key={opt.label ?? i} className="nb-nextstep__option" data-testid="nextstep-option">
            {opt.label ? <p className="nb-nextstep__label">{opt.label}</p> : null}
            <h3 className="nb-nextstep__headline" data-testid="nextstep-headline">
              {opt.headline}
            </h3>
            {windows.map((w) => (
              <p key={w} className="nb-nextstep__window" data-testid="nextstep-window">
                {w}
              </p>
            ))}
            {later.length > 0 ? (
              <ul className="nb-nextstep__later">
                {later.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function NextStepCard({ state, confirmations, onConfirm }: Props) {
  const rec = state.status === "done" ? state.rec : null;
  const chips = rec ? CONFIRM_CHIPS.filter((c) => rec.questions_for_doctor.includes(c.question)) : [];
  const answered = CONFIRM_CHIPS.filter((c) => Object.entries(c.apply).every(([k, v]) => confirmations[k as keyof Confirmations] === v));
  const visibleChips = [...chips, ...answered.filter((c) => !chips.includes(c))];
  const otherQuestions = rec ? rec.questions_for_doctor.filter((q) => !CONFIRM_CHIPS.some((c) => c.question === q)) : [];

  return (
    <section className="ak-card" aria-labelledby="nextstep-title">
      <div className="ak-card__head">
        <h2 id="nextstep-title" className="ak-card__title">
          Guideline next step
        </h2>
        <span className="ak-badge ak-badge--brand">Guideline rule</span>
      </div>

      {state.status === "idle" ? (
        <div className="ak-empty">
          <p className="ak-empty__title">No next step yet</p>
          <p className="ak-empty__text">The guideline step appears after the report is read.</p>
        </div>
      ) : null}
      {state.status === "loading" ? <p className="nb-finding__note">Applying the guideline.</p> : null}
      {state.status === "error" ? (
        <div className="ak-alert ak-alert--danger" role="alert">
          <div className="ak-alert__body">
            <p className="ak-alert__title">The guideline step could not be worked out.</p>
            <p>{state.message}</p>
          </div>
        </div>
      ) : null}

      {rec ? (
        <div className="nb-nextstep" data-testid="nextstep" data-rule={rec.rule_id ?? "none"} data-applies={String(rec.applies)}>
          {rec.options.length > 0 ? <Options rec={rec} /> : null}

          {rec.applies === false ? (
            <div className="ak-alert ak-alert--info" role="status">
              <div className="ak-alert__body">
                <p className="ak-alert__title">The guideline does not apply here.</p>
                {rec.not_applicable_reasons.map((r) => (
                  <p key={r}>{r}</p>
                ))}
                <p>Ask your doctor about follow-up.</p>
              </div>
            </div>
          ) : null}

          {rec.applies === "conditional" ? (
            <div className="ak-alert ak-alert--warning" role="status">
              <div className="ak-alert__body">
                <p className="ak-alert__title">This depends on your answers. Confirm them with your doctor.</p>
                {rec.rule_id === null ? rec.not_applicable_reasons.map((r) => <p key={r}>{r}</p>) : null}
                {rec.questions_for_doctor.length > 0 ? (
                  <ul className="nb-nextstep__questions">
                    {rec.questions_for_doctor.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {visibleChips.length > 0 ? (
            <div className="nb-nextstep__chips" role="group" aria-label="Confirm your answers">
              {visibleChips.map((c) => {
                const on = answered.includes(c);
                return (
                  <button
                    key={c.label}
                    type="button"
                    className={`ak-chip${on ? " is-selected" : ""}`}
                    aria-pressed={on}
                    onClick={() => {
                      const next = { ...confirmations };
                      for (const k of Object.keys(c.apply) as (keyof Confirmations)[]) {
                        if (on) delete next[k];
                        else Object.assign(next, { [k]: c.apply[k] });
                      }
                      onConfirm(next);
                    }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          ) : null}
          {otherQuestions.length > 0 && rec.applies !== "conditional" ? (
            <ul className="nb-nextstep__questions">
              {otherQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          ) : null}

          {rec.why ? (
            <div className="nb-nextstep__why">
              <h3 className="nb-nextstep__sub">Why</h3>
              <p data-testid="nextstep-why">{rec.why}</p>
              <p className="nb-finding__note">
                Source:{" "}
                {rec.citation.url ? (
                  <a className="ak-link" href={rec.citation.url} target="_blank" rel="noopener noreferrer">
                    Fleischner Society 2017 guideline, Radiology 2017;284(1):228–243
                  </a>
                ) : (
                  rec.citation.text
                )}
              </p>
            </div>
          ) : null}
          {rec.notes.length > 0 ? (
            <ul className="nb-nextstep__notes">
              {rec.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {rec.factors_to_consider.length > 0 ? (
            <div>
              <h3 className="nb-nextstep__sub">Factors your doctor may consider</h3>
              <ul className="nb-nextstep__notes">
                {rec.factors_to_consider.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="nb-finding__note nb-mono-note">
            {rec.engine_version} · counted from the {rec.date_basis === "study_date" ? "study date" : "analysis date"}{" "}
            {formatDate(rec.index_date)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
