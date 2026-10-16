"use client";

import { FileText, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchWorklist, filterWorklist, letterOf, patientText, type WorklistStudy } from "@/lib/worklist";

interface Props {
  onOpen: (letter: string) => void;
}

/**
 * The inbox of studies waiting for a read, as a radiology or referring doctor would see it. The studies are the prepared
 * LIDC-IDRI CT scans; the referral details (age, exam, indication, who sent it) are fictional scenario text and the
 * heading says so. The list never shows what the report found.
 */
export function Worklist({ onOpen }: Props) {
  const [studies, setStudies] = useState<WorklistStudy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchWorklist().then(
      (s) => !cancelled && setStudies(s),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = studies ? filterWorklist(studies, query) : [];

  return (
    <section className="ak-card" aria-labelledby="worklist-title" data-testid="worklist">
      <div className="ak-card__head">
        <h2 id="worklist-title" className="ak-card__title">
          Worklist
        </h2>
        <span className="ak-badge ak-badge--outline">Example data</span>
      </div>
      <p className="nb-finding__note">
        Chest CT studies with their reports, waiting to be read. Scans are from LIDC-IDRI; ages, indications and referring services are fictional.
      </p>

      {error ? (
        <div className="ak-alert ak-alert--danger" role="alert">
          <div className="ak-alert__body">
            <p className="ak-alert__title">The worklist could not be loaded.</p>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {studies ? (
        <>
          <div className="nb-worklist__bar">
            <label className="nb-worklist__search">
              <Search size={16} strokeWidth={2} aria-hidden="true" />
              <span className="nb-sr-only">Search the worklist</span>
              <input className="ak-input" type="search" placeholder="Search by study, exam, indication or service" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="worklist-search" />
            </label>
            <p className="nb-finding__note" role="status" data-testid="worklist-count">
              {shown.length === studies.length ? `${studies.length} studies` : `${shown.length} of ${studies.length} studies`}
            </p>
          </div>
          <div className="nb-worklist__scroll">
            <table className="ak-table nb-worklist__table">
              <thead>
                <tr>
                  <th scope="col">Study</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Exam</th>
                  <th scope="col">Indication</th>
                  <th scope="col">Referred by</th>
                  <th scope="col">Report</th>
                  <th scope="col">
                    <span className="nb-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.case_id} data-testid="worklist-row" data-case={s.case_id}>
                    <td>
                      {s.label}
                      <span className="ak-table__sub nb-mono">{s.lidc_patient_id}</span>
                    </td>
                    <td>
                      {patientText(s)}
                      <span className="ak-table__sub">Fictional</span>
                    </td>
                    <td>{s.scenario.exam ?? "Chest CT"}</td>
                    <td>{s.scenario.indication ?? "Not stated"}</td>
                    <td>{s.scenario.source ?? "Not stated"}</td>
                    <td>
                      <span className="ak-badge ak-badge--outline">
                        <FileText size={14} strokeWidth={2} aria-hidden="true" />
                        On file
                      </span>
                    </td>
                    <td>
                      <button type="button" className="ak-btn ak-btn--secondary ak-btn--sm" aria-label={`Use example patient ${letterOf(s.case_id)}`} onClick={() => onOpen(letterOf(s.case_id))}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 ? (
              <p className="nb-finding__note" data-testid="worklist-empty">
                No study matches that search.
              </p>
            ) : null}
          </div>
        </>
      ) : error ? null : (
        <p className="nb-finding__note">Loading the worklist.</p>
      )}
    </section>
  );
}
