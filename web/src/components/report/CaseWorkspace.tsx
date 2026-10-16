"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ViewerCard } from "@/components/viewer/ViewerCard";
import { caseFileUrl } from "@/lib/cases";
import { extractReport } from "@/lib/extract";
import { fetchRecommendation, type Confirmations } from "@/lib/recommend";
import { FindingsCard, type FindingsState } from "./FindingsCard";
import { NextStepCard, type NextStepState } from "./NextStepCard";
import { ReportCard } from "./ReportCard";
import "./report.css";

const EXAMPLES = [
  { letter: "A", label: "Example patient A" },
  { letter: "B", label: "Example patient B" },
  { letter: "C", label: "Example patient C" },
] as const;

export function CaseWorkspace({ caseId }: { caseId: string }) {
  const [state, setState] = useState<FindingsState>({ status: "idle" });
  const [confirmations, setConfirmations] = useState<Confirmations>({});
  const [next, setNext] = useState<{ extraction: object; confirmations: Confirmations; result: NextStepState } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const extraction = state.status === "done" ? state.data : null;

  // The guideline step is deterministic and cheap, so it re-runs whenever the report is read or an answer changes.
  // Results are stored with the inputs they belong to, so "loading" is derived instead of set inside the effect.
  useEffect(() => {
    if (!extraction) return;
    const controller = new AbortController();
    const done = (result: NextStepState) => setNext({ extraction, confirmations, result });
    fetchRecommendation(extraction.result, confirmations, controller.signal)
      .then((rec) => done({ status: "done", rec }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        done({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [extraction, confirmations]);
  const nextView: NextStepState = !extraction
    ? { status: "idle" }
    : next && next.extraction === extraction && next.confirmations === confirmations
      ? next.result
      : { status: "loading" };

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const start = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const t0 = performance.now();
    setState({ status: "reading", elapsedSeconds: 0 });
    const timer = window.setInterval(() => {
      setState((s) => (s.status === "reading" ? { status: "reading", elapsedSeconds: Math.floor((performance.now() - t0) / 1000) } : s));
    }, 500);
    try {
      const pdf = await fetch(caseFileUrl(caseId, "report.pdf"), { signal: controller.signal });
      if (!pdf.ok) throw new Error(`Could not load the example report (${pdf.status}).`);
      const data = await extractReport({ file: await pdf.blob() }, controller.signal);
      setState({ status: "done", data });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setState({ status: "error", error: err instanceof Error ? err : new Error(String(err)) });
    } finally {
      window.clearInterval(timer);
    }
  }, [caseId]);

  const letter = caseId.replace("case-", "").toUpperCase();
  return (
    <>
      <div className="nb-case-picker" role="navigation" aria-label="Example cases">
        {EXAMPLES.map((e) => (
          <Link
            key={e.letter}
            href={`/?case=${e.letter}`}
            className={`ak-chip${e.letter === letter ? " is-selected" : ""}`}
            aria-current={e.letter === letter ? "page" : undefined}
          >
            {e.label}
          </Link>
        ))}
      </div>
      <div className="nb-workspace">
        <div className="nb-workspace__viewer">
          <ViewerCard key={caseId} caseId={caseId} />
        </div>
        <div className="nb-workspace__side">
          <ReportCard data={state.status === "done" ? state.data : null} reading={state.status === "reading"} />
          <FindingsCard state={state} onStart={start} />
          <NextStepCard state={nextView} confirmations={confirmations} onConfirm={setConfirmations} />
        </div>
      </div>
    </>
  );
}
