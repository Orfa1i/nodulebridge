"use client";

import { Check, X } from "lucide-react";
import { STAGES, useAnalysisStore, type StageKey } from "@/features/analysis/store";

const marker = (status: string, index: number) => {
  if (status === "done") return <Check size={14} strokeWidth={2} aria-hidden="true" />;
  if (status === "error") return <X size={14} strokeWidth={2} aria-hidden="true" />;
  if (status === "skipped") return <span aria-hidden="true">–</span>;
  return index + 1;
};

const statusWord: Record<string, string> = {
  pending: "waiting",
  running: "running",
  done: "done",
  skipped: "skipped",
  error: "failed",
};

/** The five stages of the analysis. Each shows what it found, from the real step, never a placeholder. */
export function AnalysisStepper() {
  const stages = useAnalysisStore((s) => s.stages);
  const phase = useAnalysisStore((s) => s.phase);
  return (
    <ol className="ak-steps nb-stepper" aria-label="Analysis steps" data-testid="stepper" data-phase={phase}>
      {STAGES.map(({ key, label }, i) => {
        const st = stages[key as StageKey];
        const cls = st.status === "done" || st.status === "skipped" ? " is-complete" : st.status === "running" ? " is-current" : st.status === "error" ? " is-error" : "";
        return (
          <li key={key} className={`ak-step${cls}`} data-stage={key} data-status={st.status} aria-current={st.status === "running" ? "step" : undefined}>
            <span className="ak-step__marker">{marker(st.status, i)}</span>
            <span className="ak-step__title">
              {label}
              <span className="ak-visually-hidden"> ({statusWord[st.status]})</span>
            </span>
            {st.meta ? (
              <span className="ak-step__meta" data-testid={`stage-meta-${key}`}>
                {st.meta}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
