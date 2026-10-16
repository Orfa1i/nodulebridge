"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { STAGES, useAnalysisStore } from "@/features/analysis/store";
import { fetchManifest } from "@/lib/cases";
import { API_BASE } from "@/lib/extract";
import type { CaseManifest } from "@/types/generated/case-manifest";

/** The manifest says "DOI 10.7937/..." inside its attribution text. The link is built from that DOI exactly as written. */
function doiOf(attribution: string | undefined): string | null {
  const m = /DOI\s+(10\.\d{4,9}\/[^\s,;]+)/.exec(attribution ?? "");
  return m ? m[1].replace(/\.$/, "") : null;
}

const ms = (v: number | null | undefined) => (v == null ? "–" : `${v} ms`);

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="nb-verify__row">
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Proves the demo is not hard-coded: where the data came from, what the model returned and how it was checked, which
 * rule the guideline used, which templates wrote the summary and how long each step took. Values are real, read from the
 * stores and the API; nothing here is typed in by hand.
 */
export function VerificationDrawer({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const extraction = useAnalysisStore((s) => s.extraction);
  const recommendation = useAnalysisStore((s) => s.recommendation);
  const explanation = useAnalysisStore((s) => s.explanation);
  const caseId = useAnalysisStore((s) => s.caseId);
  const match = useAnalysisStore((s) => s.match);
  const stages = useAnalysisStore((s) => s.stages);
  const timings = useAnalysisStore((s) => s.timings);
  const [manifest, setManifest] = useState<CaseManifest | null>(null);
  const [apiVersion, setApiVersion] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const [m, h] = await Promise.all([
        caseId ? fetchManifest(caseId).catch(() => null) : Promise.resolve(null),
        fetch(`${API_BASE}/health`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (cancelled) return;
      setManifest(m);
      setApiVersion(h?.version ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, caseId]);

  const sentences = new Map((extraction?.sentences ?? []).map((s) => [s.id, s.text]));
  const nodules = extraction?.result.nodules ?? [];
  const truth = manifest?.nodules.find((n) => n.id === match?.noduleId) ?? manifest?.nodules[0] ?? null;
  const doi = doiOf(manifest?.attribution);

  return (
    <dialog ref={ref} className="ak-dialog nb-drawer" aria-labelledby="verify-title" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} data-testid="verification-drawer">
      {open ? (
        <>
          <div className="nb-drawer__head">
            <h2 id="verify-title" className="ak-dialog__title">
              Verification
            </h2>
            <button type="button" className="ak-btn ak-btn--ghost ak-btn--icon" onClick={onClose} aria-label="Close verification" data-testid="verify-close">
              <X aria-hidden="true" />
            </button>
          </div>
          <p className="ak-dialog__body">Where each part of this result came from, and how it was checked. Values are read from the running app and the API.</p>

          <section className="nb-verify" aria-labelledby="v-data">
            <h3 id="v-data">Data</h3>
            {manifest ? (
              <dl>
                <Row label="LIDC-IDRI patient" testId="v-patient">
                  <span className="nb-mono">{manifest.lidc_patient_id}</span>
                </Row>
                <Row label="Series UID">
                  <span className="nb-mono nb-wrap" data-testid="v-series">
                    {manifest.series_instance_uid}
                  </span>
                </Row>
                <Row label="TCIA collection">
                  {doi ? (
                    <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer" className="ak-link nb-mono">
                      doi:{doi}
                    </a>
                  ) : (
                    "–"
                  )}{" "}
                  <span className="nb-verify__note">DOI as written in the case manifest; the exact citation text is still to be verified.</span>
                </Row>
                <Row label="Volume">
                  <span className="nb-mono">
                    {manifest.geometry.dims.join(" × ")} voxels · spacing {manifest.geometry.spacing.map((v) => v.toFixed(2)).join(" × ")} mm · {manifest.geometry.slice_count} slices
                  </span>
                </Row>
                {truth ? (
                  <Row label="Outlined nodule" testId="v-truth">
                    <span className="nb-mono">
                      slice {truth.slice_index + 1} · {truth.long_axis_mm} × {truth.short_axis_mm} mm · mean {truth.mean_diameter_mm} mm · {truth.attenuation} · {truth.lobe_estimate.label} (estimate) · {truth.radiologist_count} radiologists
                    </span>
                  </Row>
                ) : null}
                <Row label="Outline source">Radiologist consensus (50% agreement), pre-computed offline. Not an AI segmentation.</Row>
              </dl>
            ) : (
              <p className="nb-verify__note" data-testid="v-no-manifest">
                {caseId ? "Loading the case manifest." : "This scan is not one of the prepared cases, so there is no manifest or outline."}
              </p>
            )}
          </section>

          <section className="nb-verify" aria-labelledby="v-extract">
            <h3 id="v-extract">Extraction (AI-assisted)</h3>
            {extraction ? (
              <>
                <dl>
                  <Row label="Model" testId="v-model">
                    <span className="nb-mono">{extraction.model}</span>
                  </Row>
                  <Row label="Prompt version">
                    <span className="nb-mono">{extraction.prompt_version}</span>
                  </Row>
                  <Row label="Served from cache" testId="v-cached">
                    {extraction.cached ? "Yes (an earlier run on the same report, model and prompt)" : "No (the model was called)"}
                  </Row>
                  <Row label="Latency">
                    <span className="nb-mono">
                      total {ms(extraction.timings.total_ms)} · model {ms(extraction.timings.llm_ms)} · checks {ms(extraction.timings.verify_ms)}
                    </span>
                  </Row>
                  <Row label="Quote checks">
                    <span className="nb-mono">
                      {extraction.verification.quotes_checked} checked · {extraction.verification.quotes_dropped} dropped · {extraction.verification.nodules_removed} nodules removed
                    </span>
                  </Row>
                </dl>
                <h4>Evidence quotes</h4>
                {nodules.length === 0 ? <p className="nb-verify__note">No finding with evidence.</p> : null}
                <ul className="nb-verify__quotes" data-testid="v-quotes">
                  {nodules.flatMap((n) =>
                    n.evidence.map((e) => {
                      const found = (sentences.get(e.sentence_id) ?? "").includes(e.quote);
                      return (
                        <li key={`${n.id}-${e.sentence_id}-${e.quote}`}>
                          <q>{e.quote}</q>
                          <span className="nb-mono nb-verify__note"> {e.sentence_id}</span>{" "}
                          <span className={`ak-badge ${found ? "ak-badge--success" : "ak-badge--danger"}`} data-testid="v-quote-found">
                            {found ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
                            {found ? "Found in report" : "Not found in report"}
                          </span>
                        </li>
                      );
                    }),
                  )}
                </ul>
                <details className="nb-ignored">
                  <summary>Raw JSON from the extraction</summary>
                  <pre className="nb-redaction__preview" tabIndex={0} aria-label="Raw extraction JSON" data-testid="v-raw">
                    {JSON.stringify(extraction.result, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <p className="nb-verify__note">No report has been read yet.</p>
            )}
          </section>

          <section className="nb-verify" aria-labelledby="v-guideline">
            <h3 id="v-guideline">Guideline (rule engine, no model)</h3>
            {recommendation ? (
              <dl>
                <Row label="Rule" testId="v-rule">
                  <span className="nb-mono">{recommendation.rule_id ?? "none"}</span>
                </Row>
                <Row label="The table row in words">{recommendation.why ?? "No guideline row applies."}</Row>
                <Row label="Citation">{recommendation.citation.text}</Row>
                <Row label="Engine version" testId="v-engine">
                  <span className="nb-mono">{recommendation.engine_version}</span>
                </Row>
                <Row label="Inputs used" testId="v-inputs">
                  <span className="nb-mono">
                    size {recommendation.size_mm ?? "–"} mm · band {recommendation.size_band ?? "–"} · count {recommendation.count ?? "–"} · type {recommendation.nodule_type ?? "–"} · risk tier {recommendation.risk_tier_used} · date basis {recommendation.date_basis}
                  </span>
                </Row>
              </dl>
            ) : (
              <p className="nb-verify__note">No guideline step yet.</p>
            )}
          </section>

          <section className="nb-verify" aria-labelledby="v-explain">
            <h3 id="v-explain">Explanation (reviewed templates, no model)</h3>
            {explanation ? (
              <dl>
                {(["en", "ar"] as const).map((l) => (
                  <Row key={l} label={l === "en" ? "English" : "Arabic"} testId={`v-explain-${l}`}>
                    <span className="nb-mono">{explanation[l].template_ids.join(" + ")}</span> ·{" "}
                    {explanation[l].review_status.status === "reviewed"
                      ? `reviewed by ${explanation[l].review_status.reviewers.join(", ") || "a reviewer"}`
                      : `not yet reviewed (${explanation[l].review_status.draft_items.length} draft items)`}
                  </Row>
                ))}
              </dl>
            ) : (
              <p className="nb-verify__note">No summary yet.</p>
            )}
          </section>

          <section className="nb-verify" aria-labelledby="v-timings">
            <h3 id="v-timings">Timings</h3>
            <dl data-testid="v-timings">
              {STAGES.map(({ key, label }) => (
                <Row key={key} label={label}>
                  <span className="nb-mono">{ms(stages[key].ms)}</span> <span className="nb-verify__note">{stages[key].meta ?? ""}</span>
                </Row>
              ))}
              <Row label="Click to highlight">
                <span className="nb-mono">{ms(timings.highlighted)}</span>
              </Row>
            </dl>
          </section>

          <section className="nb-verify" aria-labelledby="v-app">
            <h3 id="v-app">App</h3>
            <dl>
              <Row label="Web app" testId="v-app-version">
                <span className="nb-mono">
                  {process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown"} · commit {process.env.NEXT_PUBLIC_GIT_COMMIT ?? "unknown"}
                </span>
              </Row>
              <Row label="API" testId="v-api-version">
                <span className="nb-mono">{apiVersion ?? "not reachable"}</span>
              </Row>
            </dl>
          </section>
        </>
      ) : null}
    </dialog>
  );
}
