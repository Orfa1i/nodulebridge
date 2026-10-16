import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Confirmations, Recommendation } from "@/lib/recommend";
import type { ExtractResponse } from "@/types/generated/extract-response";
import type { MatchResult } from "./matchFinding";

export type StageKey = "read" | "find" | "match" | "guideline" | "explain";
export type StageStatus = "pending" | "running" | "done" | "error" | "skipped";

export const STAGES: { key: StageKey; label: string }[] = [
  { key: "read", label: "Read report" },
  { key: "find", label: "Find nodule" },
  { key: "match", label: "Match to scan" },
  { key: "guideline", label: "Apply guideline" },
  { key: "explain", label: "Explain" },
];

export interface Stage {
  status: StageStatus;
  meta: string | null;
  /** Wall time of the stage in milliseconds, measured with performance.now(). */
  ms: number | null;
}

export interface ScanInfo {
  kind: "prepared" | "unmatched";
  label: string | null;
  via: string | null;
  /** Plain-language reason for an unmatched scan. */
  reason: string | null;
}

export interface Timings {
  /** Milliseconds from the start of the run (the drop or the click) to each moment. */
  scanIdentified: number | null;
  reportRead: number | null;
  matched: number | null;
  guideline: number | null;
  /** Viewer jumped and the report sentence is highlighted. */
  highlighted: number | null;
  total: number | null;
}

export interface AnalysisState {
  phase: "idle" | "running" | "done" | "error";
  caseId: string | null;
  source: "example" | "upload" | null;
  startedByClick: boolean;
  scan: ScanInfo | null;
  stages: Record<StageKey, Stage>;
  extraction: ExtractResponse | null;
  drivingNoduleId: string | null;
  match: MatchResult | null;
  recommendation: Recommendation | null;
  recommendationError: string | null;
  recommendationLoading: boolean;
  confirmations: Confirmations;
  error: { message: string; detail: string | null } | null;
  readingSeconds: number;
  timings: Timings;
  cached: { extract: boolean | null };
  /** Report focus request: ReportCard scrolls to the evidence and flashes it whenever `nonce` changes. */
  focus: { nonce: number } | null;
  /** Next-step card fades in at the end of the automatic sequence. */
  nextRevealed: boolean;
}

const emptyStage = (): Stage => ({ status: "pending", meta: null, ms: null });
export const emptyStages = (): Record<StageKey, Stage> => ({
  read: emptyStage(),
  find: emptyStage(),
  match: emptyStage(),
  guideline: emptyStage(),
  explain: emptyStage(),
});
export const emptyTimings = (): Timings => ({ scanIdentified: null, reportRead: null, matched: null, guideline: null, highlighted: null, total: null });

export const initialAnalysis = (): AnalysisState => ({
  phase: "idle",
  caseId: null,
  source: null,
  startedByClick: false,
  scan: null,
  stages: emptyStages(),
  extraction: null,
  drivingNoduleId: null,
  match: null,
  recommendation: null,
  recommendationError: null,
  recommendationLoading: false,
  confirmations: {},
  error: null,
  readingSeconds: 0,
  timings: emptyTimings(),
  cached: { extract: null },
  focus: null,
  nextRevealed: false,
});

function safeSessionStorage(): Storage {
  // sessionStorage can throw (private windows, blocked site data): fall back to a no-op store
  try {
    const probe = "__nb_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    };
  }
}

/**
 * One store for the whole analysis. The Passport screen (Phase 8) reads it. The last finished analysis is kept in
 * sessionStorage so a refresh during the demo does not lose it. Hydration is manual (see `rehydrateAnalysis`) so the
 * server render and the first client render agree.
 */
export const useAnalysisStore = create<AnalysisState>()(
  persist(() => initialAnalysis(), {
    name: "nb-analysis",
    version: 1,
    skipHydration: true,
    storage: createJSONStorage(() => safeSessionStorage()),
    partialize: (s) =>
      s.phase === "done"
        ? {
            phase: s.phase, caseId: s.caseId, source: s.source, scan: s.scan, stages: s.stages, extraction: s.extraction,
            drivingNoduleId: s.drivingNoduleId, match: s.match, recommendation: s.recommendation,
            confirmations: s.confirmations, timings: s.timings, cached: s.cached,
          }
        : {},
  }),
);

export async function rehydrateAnalysis(): Promise<void> {
  await useAnalysisStore.persist.rehydrate();
}

export function resetAnalysis(patch: Partial<AnalysisState> = {}): void {
  useAnalysisStore.setState({ ...initialAnalysis(), ...patch }, true);
}

export function patchStage(key: StageKey, patch: Partial<Stage>): void {
  useAnalysisStore.setState((s) => ({ stages: { ...s.stages, [key]: { ...s.stages[key], ...patch } } }));
}
