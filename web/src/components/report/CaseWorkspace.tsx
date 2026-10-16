"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ViewerCard } from "@/components/viewer/ViewerCard";
import { caseFileUrl } from "@/lib/cases";
import { extractReport } from "@/lib/extract";
import { FindingsCard, type FindingsState } from "./FindingsCard";
import { ReportCard } from "./ReportCard";
import "./report.css";

const EXAMPLES = [
  { letter: "A", label: "Example patient A" },
  { letter: "B", label: "Example patient B" },
  { letter: "C", label: "Example patient C" },
] as const;

export function CaseWorkspace({ caseId }: { caseId: string }) {
  const [state, setState] = useState<FindingsState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

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
        </div>
      </div>
    </>
  );
}
