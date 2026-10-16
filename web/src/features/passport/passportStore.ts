import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { fetchManifest } from "@/lib/cases";
import type { PassportData } from "@/lib/passport";
import { useViewerStore } from "@/lib/viewer/store";
import { useAnalysisStore } from "@/features/analysis/store";

interface PassportState {
  passport: PassportData | null;
}

function storage(): Storage {
  try {
    const probe = "__nb_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k), clear: () => mem.clear(), key: (i) => Array.from(mem.keys())[i] ?? null, get length() { return mem.size; } };
  }
}

/** The passport the person created. Kept in sessionStorage so /passport survives a refresh and the print route can read it. */
export const usePassportStore = create<PassportState>()(
  persist(() => ({ passport: null }) as PassportState, { name: "nb-passport", version: 1, skipHydration: true, storage: createJSONStorage(() => storage()) }),
);

export async function rehydratePassport(): Promise<void> {
  await usePassportStore.persist.rehydrate();
}

export class PassportNotReady extends Error {}

/** Build the passport from the finished analysis. The viewer picture is taken here, so call it while the case page is open. */
export async function createPassport(): Promise<PassportData> {
  const a = useAnalysisStore.getState();
  if (a.phase !== "done" || !a.extraction || !a.recommendation || !a.explanation) {
    throw new PassportNotReady("Analyse a case first. The passport needs the report, the guideline step and the summary.");
  }
  const driving = a.extraction.result.nodules.find((n) => n.id === a.drivingNoduleId) ?? null;
  const manifest = a.caseId ? await fetchManifest(a.caseId).catch(() => null) : null;
  let image: string | null = null;
  if (a.match?.matched && a.match.noduleId) image = (await useViewerStore.getState().api?.snapshot(a.match.noduleId)) ?? null;
  const passport: PassportData = {
    label: manifest?.label ?? "Uploaded scan",
    case_id: a.caseId,
    patient_ref: manifest?.lidc_patient_id ?? null,
    study_instance_uid: manifest?.study_instance_uid ?? null,
    series_instance_uid: manifest?.series_instance_uid ?? null,
    created_on: new Date().toLocaleDateString("en-CA"), // YYYY-MM-DD in the viewer's own time zone
    report_text: a.extraction.sentences.map((s) => s.text).join("\n"),
    evidence_quote: driving?.evidence[0]?.quote ?? null,
    finding: driving as unknown as Record<string, unknown> | null,
    recommendation: a.recommendation,
    explanation: a.explanation,
    image_data_url: image,
    attribution: manifest?.attribution ?? null,
    timezone: "Asia/Riyadh",
  };
  usePassportStore.setState({ passport });
  return passport;
}
