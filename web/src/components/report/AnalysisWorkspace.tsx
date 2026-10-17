"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ViewerCard } from "@/components/viewer/ViewerCard";
import type { UploadFiles } from "@/features/privacy/uploadFiles";
import { focusFinding, rerunRecommendation, retryAnalysis, runAnalysis } from "@/features/analysis/runAnalysis";
import { rehydrateAnalysis, resetAnalysis, STAGES, useAnalysisStore, type ResultTab } from "@/features/analysis/store";
import { createPassport } from "@/features/passport/passportStore";
import { caseIdFromParam } from "@/lib/cases";
import { useViewerStore } from "@/lib/viewer/store";
import { fetchWorklist, type WorklistStudy } from "@/lib/worklist";
import { AnalysisStepper } from "./AnalysisStepper";
import { ResultPanel, type ResultTabSpec } from "./ResultPanel";
import { StudyHeader } from "./StudyHeader";
import { FindingsCard, type FindingsState } from "./FindingsCard";
import { NextStepCard, type NextStepState } from "./NextStepCard";
import { PatientSummaryCard } from "./PatientSummaryCard";
import { PrivacyNotice } from "./PrivacyNotice";
import { RedactionReview } from "./RedactionReview";
import { Worklist } from "./Worklist";
import { VerificationDrawer } from "./VerificationDrawer";
import { ReportCard } from "./ReportCard";
import { UploadZone } from "./UploadZone";
import "./report.css";

function setUrlCase(caseId: string | null) {
  const url = caseId ? `/?case=${caseId.replace("case-", "").toUpperCase()}` : "/";
  window.history.replaceState(null, "", url);
}

function TimingsPanel() {
  const stages = useAnalysisStore((s) => s.stages);
  const timings = useAnalysisStore((s) => s.timings);
  const cached = useAnalysisStore((s) => s.cached);
  const rows: [string, number | null][] = [
    ...STAGES.map(({ key, label }): [string, number | null] => [`Stage: ${label}`, stages[key].ms]),
    ["Scan identified (from start)", timings.scanIdentified],
    ["Report read (from start)", timings.reportRead],
    ["Matched (from start)", timings.matched],
    ["Guideline applied (from start)", timings.guideline],
    ["Viewer jumped and sentence highlighted (from start)", timings.highlighted],
    ["Total (from start)", timings.total],
  ];
  return (
    <details className="nb-timings" data-testid="timings">
      <summary>Stage timings{cached.extract ? " (report reading was cached)" : ""}</summary>
      <table>
        <tbody>
          {rows.map(([name, ms]) => (
            <tr key={name}>
              <td>{name}</td>
              <td data-testid={`timing-${name}`}>{ms == null ? "–" : `${ms} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function AnalysisWorkspace({ initialCase }: { initialCase: string | null }) {
  const [hydrated, setHydrated] = useState(false);
  const [showTimings, setShowTimings] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [studies, setStudies] = useState<WorklistStudy[]>([]);
  const [passportBusy, setPassportBusy] = useState(false);
  const [passportError, setPassportError] = useState<string | null>(null);
  const router = useRouter();

  const phase = useAnalysisStore((s) => s.phase);
  const caseId = useAnalysisStore((s) => s.caseId);
  const scan = useAnalysisStore((s) => s.scan);
  const extraction = useAnalysisStore((s) => s.extraction);
  const match = useAnalysisStore((s) => s.match);
  const drivingId = useAnalysisStore((s) => s.drivingNoduleId);
  const recommendation = useAnalysisStore((s) => s.recommendation);
  const recommendationError = useAnalysisStore((s) => s.recommendationError);
  const recommendationLoading = useAnalysisStore((s) => s.recommendationLoading);
  const confirmations = useAnalysisStore((s) => s.confirmations);
  const explanation = useAnalysisStore((s) => s.explanation);
  const explanationError = useAnalysisStore((s) => s.explanationError);
  const privacy = useAnalysisStore((s) => s.privacy);
  const redaction = useAnalysisStore((s) => s.redaction);
  const explainStage = useAnalysisStore((s) => s.stages.explain.status);
  const error = useAnalysisStore((s) => s.error);
  const readingSeconds = useAnalysisStore((s) => s.readingSeconds);
  const focus = useAnalysisStore((s) => s.focus);
  const nextRevealed = useAnalysisStore((s) => s.nextRevealed);
  const resultTab = useAnalysisStore((s) => s.resultTab);
  const sliceIndex = useViewerStore((s) => s.sliceIndex);
  const maskRange = useViewerStore((s) => s.maskRange);

  // restore the last finished analysis after a refresh, then honour ?case=
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await rehydrateAnalysis();
      if (cancelled) return;
      const s = useAnalysisStore.getState();
      const wanted = initialCase ? caseIdFromParam(initialCase) : null;
      if (s.phase === "done" && (!wanted || s.caseId === wanted)) {
        useAnalysisStore.setState({ nextRevealed: true, resultTab: "nextstep" }); // restored: no replay of the sequence
        if (s.caseId) setUrlCase(s.caseId);
      } else if (wanted) {
        resetAnalysis({ caseId: wanted, scan: { kind: "prepared", label: null, via: "example", reason: null } });
      }
      setShowTimings(process.env.NODE_ENV !== "production" || window.location.search.includes("timings"));
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialCase]);

  const startExample = useCallback((letter: string) => {
    const id = caseIdFromParam(letter);
    setUrlCase(id);
    void runAnalysis({ kind: "example", caseId: id, startedByClick: true });
  }, []);
  const startUpload = useCallback((files: UploadFiles) => void runAnalysis({ kind: "upload", files, startedByClick: true }), []);
  const makePassport = useCallback(async () => {
    setPassportBusy(true);
    setPassportError(null);
    try {
      await createPassport();
      router.push("/passport");
    } catch (err) {
      setPassportError(err instanceof Error ? err.message : String(err));
      setPassportBusy(false);
    }
  }, [router]);
  const startFromCase = useCallback(() => {
    if (caseId) void runAnalysis({ kind: "example", caseId, startedByClick: true });
  }, [caseId]);

  // the study bar needs the list of studies (the worklist loads the same file for the home screen)
  useEffect(() => {
    let cancelled = false;
    fetchWorklist().then(
      (s) => !cancelled && setStudies(s),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // an uploaded scan that was recognised moves the URL to its case
  useEffect(() => {
    if (hydrated && caseId) setUrlCase(caseId);
  }, [hydrated, caseId]);

  if (!hydrated) return <h1 className="nb-page__title">Case workspace</h1>;

  const inView = !!(match?.matched && maskRange && sliceIndex >= maskRange[0] && sliceIndex <= maskRange[1]);

  const findings: FindingsState = extraction
    ? { status: "done", data: extraction }
    : phase === "error"
      ? { status: "error", error: Object.assign(new Error(error?.message ?? "The report could not be read."), { detail: error?.detail ?? null }) }
      : phase === "running"
        ? { status: "reading", elapsedSeconds: readingSeconds }
        : { status: "idle" };
  const unverified = !!extraction && extraction.result.nodules.length === 0 && extraction.verification.nodules_removed > 0;
  const next: NextStepState = unverified
    ? { status: "blocked", message: "A finding the model reported could not be checked against the report, so it was not used. Ask your doctor to read the report." }
    : recommendation
    ? { status: "done", rec: recommendation }
    : recommendationError
      ? { status: "error", message: recommendationError }
      : phase === "running" || recommendationLoading
        ? { status: "loading" }
        : { status: "idle" };

  const chosen = caseId !== null || scan !== null;
  if (!chosen && phase === "idle") {
    return (
      <>
        <h1 className="nb-page__title">Case workspace</h1>
        <Worklist onOpen={startExample} />
        <UploadZone onFiles={startUpload} />
      </>
    );
  }

  const unmatched = scan?.kind === "unmatched";
  const study = studies.find((x) => x.case_id === caseId) ?? null;
  const revealed = nextRevealed || phase === "idle" || phase === "error";
  const setTab = (t: ResultTab) => useAnalysisStore.setState({ resultTab: t });
  const nodules = extraction?.result.nodules.length ?? null;

  const tabs: ResultTabSpec[] = [
    {
      key: "nextstep",
      label: "Next step",
      content: <NextStepCard state={next} confirmations={confirmations} onConfirm={(c) => void rerunRecommendation(c)} revealed={revealed} />,
    },
    {
      key: "findings",
      label: "Findings",
      hint: nodules === null ? null : String(nodules),
      content: (
        <FindingsCard
          state={findings}
          onStart={phase === "error" ? retryAnalysis : startFromCase}
          drivingId={drivingId}
          match={match}
          inView={inView}
          onShowInScan={() => void focusFinding({ jump: true, report: true })}
        />
      ),
    },
    {
      key: "report",
      label: "Report",
      content: (
        <ReportCard
          data={extraction}
          reading={phase === "running"}
          focusNonce={focus?.nonce ?? 0}
          onSentenceActivate={() => void focusFinding({ jump: true, report: !match?.matched })}
        />
      ),
    },
    {
      key: "summary",
      label: "Summary",
      content: <PatientSummaryCard explanation={explanation} error={explanationError} loading={explainStage === "running"} caseId={caseId} revealed={revealed} />,
    },
  ];

  const canPassport = phase === "done" && !!recommendation && !!explanation;
  const footer =
    extraction || canPassport ? (
      <div className="nb-result__actions" data-testid={canPassport ? "passport-cta" : undefined}>
        {canPassport ? (
          <button type="button" className="ak-btn ak-btn--primary" onClick={() => void makePassport()} disabled={passportBusy} data-testid="create-passport">
            {passportBusy ? "Creating the passport" : "Create follow-up passport"}
          </button>
        ) : null}
        {extraction ? (
          <button type="button" className="ak-btn ak-btn--ghost" onClick={() => setVerifyOpen(true)} data-testid="show-verification">
            Show verification
          </button>
        ) : null}
        {passportError ? (
          <div className="ak-alert ak-alert--danger nb-result__alert" role="alert">
            <div className="ak-alert__body">
              <p className="ak-alert__title">The passport could not be created.</p>
              <p>{passportError}</p>
            </div>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      <StudyHeader
        study={study}
        studies={studies}
        onAllStudies={() => {
          setUrlCase(null);
          resetAnalysis();
        }}
        onOpen={startExample}
      />

      {privacy ? <PrivacyNotice summary={privacy} /> : null}
      {redaction ? <RedactionReview redaction={redaction} /> : null}
      {phase !== "idle" ? <AnalysisStepper /> : null}

      {unmatched ? (
        <div className="ak-alert ak-alert--info" role="status" data-testid="unmatched-alert">
          <div className="ak-alert__body">
            <p className="ak-alert__title">No prepared outline for this scan. The report finding is shown without an outline.</p>
            {scan?.reason ? <p>{scan.reason}</p> : null}
          </div>
        </div>
      ) : null}
      {match && !match.matched && !unmatched ? (
        <div className="ak-alert ak-alert--info" role="status" data-testid="not-matched-alert">
          <div className="ak-alert__body">
            <p className="ak-alert__title">The report finding could not be matched to an outlined nodule.</p>
            {match.note ? <p data-testid="match-note">{match.note}</p> : null}
            <p>The scan stays open so you can scroll it yourself.</p>
          </div>
        </div>
      ) : null}

      <div className="nb-study">
        <div className="nb-study__viewer">
          {caseId ? (
            <ViewerCard key={caseId} caseId={caseId} onFindingClick={() => void focusFinding({ jump: false, report: true })} />
          ) : (
            <section className="ak-card" aria-labelledby="viewer-title">
              <h2 id="viewer-title" className="ak-card__title">
                Chest CT
              </h2>
              <div className="ak-empty">
                <p className="ak-empty__title">No outline to show for this scan</p>
                <p className="ak-empty__text">Only the prepared example scans have an outline in this prototype.</p>
              </div>
            </section>
          )}
        </div>
        <ResultPanel tabs={tabs} active={resultTab} onChange={setTab} footer={footer} />
      </div>
      {showTimings && phase !== "idle" ? <TimingsPanel /> : null}
      <VerificationDrawer open={verifyOpen} onClose={() => setVerifyOpen(false)} />
    </>
  );
}
