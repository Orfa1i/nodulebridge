"use client";

import { ChevronLeft, ChevronRight, LayoutList } from "lucide-react";
import { letterOf, patientText, type WorklistStudy } from "@/lib/worklist";

interface Props {
  /** The open study from the worklist, or null for an uploaded scan. */
  study: WorklistStudy | null;
  studies: WorklistStudy[];
  onAllStudies: () => void;
  onOpen: (letter: string) => void;
  /** Shown when the open scan is not one of the prepared studies. */
  fallbackTitle?: string;
}

/** Who and what this study is (the referral), and the way to the neighbouring studies. One line of facts, one row of controls. */
export function StudyHeader({ study, studies, onAllStudies, onOpen, fallbackTitle = "Uploaded study" }: Props) {
  const index = study ? studies.findIndex((s) => s.case_id === study.case_id) : -1;
  const step = (delta: number) => onOpen(letterOf(studies[(index + delta + studies.length) % studies.length].case_id));
  const facts = study
    ? [
        { label: "Study", value: study.lidc_patient_id, mono: true },
        { label: "Patient", value: `${patientText(study)} (fictional)` },
        { label: "Exam", value: study.scenario.exam ?? "Chest CT" },
        { label: "Indication", value: study.scenario.indication ?? "Not stated" },
        { label: "Referred by", value: study.scenario.source ?? "Not stated" },
      ]
    : [];

  return (
    <header className="nb-studyhead" data-testid="study-header">
      <div className="nb-studyhead__row">
        <h1 className="nb-studyhead__title">{study ? study.label : fallbackTitle}</h1>
        <nav className="nb-studyhead__nav" aria-label="Studies">
          <button type="button" className="ak-btn ak-btn--ghost ak-btn--sm" onClick={onAllStudies} data-testid="all-studies">
            <LayoutList aria-hidden="true" />
            All studies
          </button>
          {studies.length > 0 && study ? (
            <>
              <button type="button" className="ak-btn ak-btn--secondary ak-btn--sm" onClick={() => step(-1)} data-testid="prev-study">
                <ChevronLeft aria-hidden="true" />
                Previous study
              </button>
              <button type="button" className="ak-btn ak-btn--secondary ak-btn--sm" onClick={() => step(1)} data-testid="next-study">
                Next study
                <ChevronRight aria-hidden="true" />
              </button>
              <label className="nb-studybar__select">
                <span className="nb-sr-only">Switch study</span>
                <select className="ak-select" value={letterOf(study.case_id)} onChange={(e) => onOpen(e.target.value)} data-testid="study-select">
                  {studies.map((s) => (
                    <option key={s.case_id} value={letterOf(s.case_id)}>
                      {s.label} · {s.scenario.indication ?? s.scenario.exam ?? "Chest CT"}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </nav>
      </div>
      {facts.length > 0 ? (
        <dl className="nb-studyhead__facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd className={f.mono ? "nb-mono" : undefined}>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="nb-finding__note">This scan is not one of the prepared studies, so there is no referral information.</p>
      )}
    </header>
  );
}
