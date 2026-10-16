import { caseIndexUrl } from "@/lib/cases";

/** One study of the worklist, from /cases/index.json (written by `pnpm sync:cases`). Referral details are fictional scenario text. */
export interface WorklistStudy {
  case_id: string;
  label: string;
  lidc_patient_id: string;
  series_instance_uid: string;
  scenario: { age_years: number | null; sex: "female" | "male" | null; exam: string | null; indication: string | null; source: string | null };
  voice: { en: boolean; ar: boolean };
}

export async function fetchWorklist(): Promise<WorklistStudy[]> {
  const res = await fetch(caseIndexUrl());
  if (!res.ok) throw new Error(`The worklist could not be loaded (HTTP ${res.status}).`);
  const body = (await res.json()) as { cases: WorklistStudy[] };
  return [...body.cases].sort((a, b) => a.case_id.localeCompare(b.case_id));
}

export const letterOf = (caseId: string): string => caseId.replace("case-", "").toUpperCase();

export function patientText(s: WorklistStudy): string {
  const { age_years: age, sex } = s.scenario;
  if (age === null || sex === null) return "Not stated";
  return `${age} · ${sex === "female" ? "F" : "M"}`;
}

/** Lower-case text the search box looks in. */
export function searchText(s: WorklistStudy): string {
  const { exam, indication, source } = s.scenario;
  return [s.label, s.lidc_patient_id, exam, indication, source].filter(Boolean).join(" ").toLowerCase();
}

export function filterWorklist(studies: WorklistStudy[], query: string): WorklistStudy[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.length === 0 ? studies : studies.filter((s) => terms.every((t) => searchText(s).includes(t)));
}
