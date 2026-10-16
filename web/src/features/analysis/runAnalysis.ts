import { caseFileUrl, fetchManifest } from "@/lib/cases";
import { extractReport, ExtractError } from "@/lib/extract";
import { fetchExplanation, type Explanation, type Locale } from "@/lib/explain";
import { fetchRecommendation, type Confirmations, type Recommendation } from "@/lib/recommend";
import { useViewerStore } from "@/lib/viewer/store";
import { prefersReducedMotion } from "@/lib/viewer/css";
import type { ExtractResponse } from "@/types/generated/extract-response";
import { deidentify, type UploadFiles } from "@/features/privacy/deidentify";
import { identifyScan, loadCaseIndex, type ScanIdentity } from "./identifyScan";
import { matchFinding, pickDrivingNodule, type MatchResult } from "./matchFinding";
import { patchStage, resetAnalysis, STAGES, useAnalysisStore, type Timings } from "./store";

export type AnalysisInput =
  | { kind: "example"; caseId: string; startedByClick: boolean }
  | { kind: "upload"; files: UploadFiles; startedByClick: boolean };

let runId = 0;
let controller: AbortController | null = null;
let lastInput: AnalysisInput | null = null;

const now = () => performance.now();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const state = () => useAnalysisStore.getState();
const set = useAnalysisStore.setState;

/** Wait until the viewer for the current case is ready (it loads in parallel with extraction). */
async function viewerReady(timeoutMs: number, id: number): Promise<boolean> {
  const start = now();
  while (now() - start < timeoutMs) {
    if (id !== runId) return false;
    if (useViewerStore.getState().api) return true;
    await sleep(50);
  }
  return false;
}

/** The viewer jumps to the finding, then the report scrolls to and flashes the sentence. Used after the run and on click. */
export async function focusFinding(opts: { jump: boolean; report: boolean }): Promise<void> {
  const { match } = state();
  if (opts.jump && match?.matched && match.noduleId) {
    await useViewerStore.getState().api?.jumpToFinding(match.noduleId);
  }
  if (opts.report) set((s) => ({ focus: { nonce: (s.focus?.nonce ?? 0) + 1 } }));
}

function describeMatchStage(driving: { mean_diameter_mm?: number | null; side?: string | null; lobe?: string | null }): string {
  const size = driving.mean_diameter_mm != null ? `${driving.mean_diameter_mm} mm` : "size not stated";
  const where = driving.side ? `${driving.side}${driving.lobe ? ` ${driving.lobe}` : ""}` : "side not stated";
  return `Matched: ${size}, ${where}`;
}

function guidelineMeta(rec: { rule_id: string | null; applies: boolean | "conditional" }): string {
  if (rec.rule_id) return `Rule ${rec.rule_id}${rec.applies === "conditional" ? " (conditional)" : ""}`;
  return rec.applies === false ? "Guideline does not apply" : "No rule applied";
}

/** Both languages, so switching the tab is instant. Reviewed templates filled with data; no model is called. */
async function loadExplanation(rec: Recommendation, signal?: AbortSignal): Promise<Record<Locale, Explanation>> {
  const { extraction, drivingNoduleId, match } = state();
  const finding = extraction?.result.nodules.find((n) => n.id === drivingNoduleId) ?? null;
  const matched = match?.matched ?? false;
  const [en, ar] = await Promise.all([
    fetchExplanation(rec, finding, "en", matched, signal),
    fetchExplanation(rec, finding, "ar", matched, signal),
  ]);
  return { en, ar };
}

export async function rerunRecommendation(confirmations: Confirmations): Promise<void> {
  const { extraction } = state();
  if (!extraction) return;
  set({ confirmations, recommendationLoading: true });
  try {
    const rec = await fetchRecommendation(extraction.result, confirmations);
    set({ recommendation: rec, recommendationError: null, recommendationLoading: false });
    patchStage("guideline", { meta: guidelineMeta(rec) });
    try {
      set({ explanation: await loadExplanation(rec), explanationError: null });
    } catch (err) {
      set({ explanation: null, explanationError: err instanceof Error ? err.message : String(err) });
    }
  } catch (err) {
    set({ recommendationError: err instanceof Error ? err.message : String(err), recommendationLoading: false });
  }
}

/**
 * The whole flow: privacy hook -> identify the scan -> (viewer starts loading the CT) -> read the report ->
 * find the nodule -> match it to the outline -> apply the guideline -> explain -> automatic sequence.
 * Nothing is faked: every stage runs the real step and records how long it took.
 */
export async function runAnalysis(input: AnalysisInput): Promise<void> {
  lastInput = input;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const id = ++runId;
  const alive = () => id === runId;
  const t0 = now();
  const timings: Timings = { scanIdentified: null, reportRead: null, matched: null, guideline: null, highlighted: null, total: null };
  const mark = (key: keyof Timings) => {
    timings[key] = Math.round(now() - t0);
    set({ timings: { ...timings } });
  };

  resetAnalysis({ phase: "running", source: input.kind, startedByClick: input.startedByClick });
  const reading = window.setInterval(() => set({ readingSeconds: Math.floor((now() - t0) / 1000) }), 500);

  try {
    // 1. privacy hook, then identify the scan; the viewer starts loading as soon as the case is known
    let caseId: string | null = null;
    let reportInput: { file: Blob } | { text: string };
    if (input.kind === "example") {
      caseId = input.caseId;
      set({ caseId, scan: { kind: "prepared", label: null, via: "example", reason: null } });
      const pdf = await fetch(caseFileUrl(caseId, "report.pdf"), { signal });
      if (!pdf.ok) throw new ExtractError("Could not load the example report.", `HTTP ${pdf.status}`);
      reportInput = { file: await pdf.blob() };
      mark("scanIdentified");
    } else {
      // privacy first: patient details are removed on this device before anything else reads the scan
      const index = await loadCaseIndex();
      const { files, summary } = await deidentify(input.files, { knownSeriesUids: new Set(index.map((c) => c.series_instance_uid)) });
      set({ privacy: summary });
      if (!files.report) throw new ExtractError("No report was provided.", "Add the report as a PDF or a text file.");
      const identity: ScanIdentity = await identifyScan(files.ct, index);
      if (identity.kind === "prepared") {
        caseId = identity.caseId;
        set({ caseId, scan: { kind: "prepared", label: identity.label, via: identity.via, reason: null } });
      } else {
        set({ caseId: null, scan: { kind: "unmatched", label: null, via: identity.format, reason: identity.reason } });
      }
      const isPdf = files.report.type === "application/pdf" || /\.pdf$/i.test(files.report.name);
      reportInput = isPdf ? { file: files.report } : { text: await files.report.text() };
      mark("scanIdentified");
    }
    if (!alive()) return;

    // 2. read the report (the CT volume is already loading in the viewer)
    const tRead = now();
    patchStage("read", { status: "running" });
    const extraction: ExtractResponse = await extractReport(reportInput, signal);
    if (!alive()) return;
    patchStage("read", {
      status: "done",
      ms: Math.round(now() - tRead),
      meta: `${extraction.sentences.length} sentences${extraction.cached ? " · cached" : ""}`,
    });
    set({ extraction, cached: { extract: extraction.cached } });
    mark("reportRead");

    // 3. find the nodule
    const tFind = now();
    const driving = pickDrivingNodule(extraction.result.nodules);
    const listed = extraction.result.nodules.filter((n) => n.assertion !== "negated").length;
    patchStage("find", {
      status: "done",
      ms: Math.round(now() - tFind),
      meta: driving ? `${listed} nodule${listed === 1 ? "" : "s"} found` : "No nodule in the report",
    });
    set({ drivingNoduleId: driving?.id ?? null });

    // 4. match it to the outline of the prepared scan
    const tMatch = now();
    let match: MatchResult | null = null;
    if (caseId) {
      const manifest = await fetchManifest(caseId);
      match = matchFinding(driving, manifest.nodules);
      patchStage("match", {
        status: "done",
        ms: Math.round(now() - tMatch),
        meta: match.matched && driving ? describeMatchStage(driving) : "Not matched",
      });
    } else {
      patchStage("match", { status: "skipped", ms: 0, meta: "No prepared outline" });
    }
    set({ match });
    mark("matched");
    if (!alive()) return;

    // 5. apply the guideline (deterministic, no model)
    const tRec = now();
    patchStage("guideline", { status: "running" });
    set({ recommendationLoading: true });
    const confirmations = state().confirmations;
    let rec = null;
    try {
      rec = await fetchRecommendation(extraction.result, confirmations, signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // the report was read, so this is not fatal: the Next step card shows the error itself
      set({ recommendationError: err instanceof Error ? err.message : String(err), recommendationLoading: false });
      patchStage("guideline", { status: "error", ms: Math.round(now() - tRec), meta: "Guideline step failed" });
    }
    if (!alive()) return;
    if (rec) {
      set({ recommendation: rec, recommendationError: null, recommendationLoading: false });
      patchStage("guideline", { status: "done", ms: Math.round(now() - tRec), meta: guidelineMeta(rec) });
    }
    mark("guideline");

    // 6. explain: reviewed bilingual templates filled from the guideline result (the voice is made on demand or pre-computed)
    if (rec) {
      const tExplain = now();
      patchStage("explain", { status: "running" });
      try {
        const explanation = await loadExplanation(rec, signal);
        if (!alive()) return;
        set({ explanation, explanationError: null });
        const draft = explanation.en.review_status.status === "draft" || explanation.ar.review_status.status === "draft";
        patchStage("explain", { status: "done", ms: Math.round(now() - tExplain), meta: draft ? "Templates · awaiting review" : "Reviewed templates" });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!alive()) return;
        set({ explanationError: err instanceof Error ? err.message : String(err) });
        patchStage("explain", { status: "error", ms: Math.round(now() - tExplain), meta: "Summary failed" });
      }
    } else {
      patchStage("explain", { status: "skipped", ms: 0, meta: "No guideline result to explain" });
    }

    // 7. automatic sequence, paced so it reads on video: jump -> pulse -> report highlight -> next step -> summary button
    set({ phase: "done" });
    const reduced = prefersReducedMotion();
    if (match?.matched && (await viewerReady(20000, id))) {
      await focusFinding({ jump: true, report: false });
      if (!reduced) await sleep(150);
    }
    if (!alive()) return;
    await focusFinding({ jump: false, report: true });
    mark("highlighted");
    if (!reduced) await sleep(300);
    set({ nextRevealed: true });
    mark("total");
    console.table({ ...timings, extractCached: extraction.cached });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (!alive()) return;
    const e = err instanceof ExtractError ? err : null;
    set({
      phase: "error",
      error: { message: e?.message ?? (err instanceof Error ? err.message : String(err)), detail: e?.detail ?? null },
    });
    const running = STAGES.find(({ key }) => state().stages[key].status === "running")?.key ?? "read";
    patchStage(running, { status: "error" });
  } finally {
    window.clearInterval(reading);
  }
}

/** Run the same input again (the "Try again" button). */
export function retryAnalysis(): void {
  if (lastInput) void runAnalysis(lastInput);
}

export function cancelAnalysis(): void {
  runId++;
  controller?.abort();
}
