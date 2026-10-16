import { describe, expect, it } from "vitest";
import { filterWorklist, letterOf, patientText, type WorklistStudy } from "@/lib/worklist";

const study = (letter: string, over: Partial<WorklistStudy["scenario"]> = {}): WorklistStudy => ({
  case_id: `case-${letter.toLowerCase()}`,
  label: `Example patient ${letter}`,
  lidc_patient_id: `LIDC-IDRI-0${letter.charCodeAt(0)}`,
  series_instance_uid: "1.2.3",
  scenario: { age_years: 52, sex: "female", exam: "CT chest", indication: "Chest pain.", source: "Emergency department", ...over },
  voice: { en: false, ar: false },
});

const list = [
  study("D"),
  study("E", { age_years: 67, sex: "male", indication: "Chest tightness.", source: "Outpatient chest clinic" }),
  study("F", { exam: "CT pulmonary angiogram", indication: "Shortness of breath." }),
];

describe("worklist helpers", () => {
  it("letterOf turns a case id into its letter", () => {
    expect(letterOf("case-d")).toBe("D");
  });
  it("patientText shows age and sex, or says it is not stated", () => {
    expect(patientText(list[0])).toBe("52 · F");
    expect(patientText(list[1])).toBe("67 · M");
    expect(patientText(study("X", { age_years: null, sex: null }))).toBe("Not stated");
  });
  it("an empty search keeps every study", () => {
    expect(filterWorklist(list, "  ")).toHaveLength(3);
  });
  it("every word must match somewhere, in any order, ignoring case", () => {
    expect(filterWorklist(list, "angiogram").map((s) => s.case_id)).toEqual(["case-f"]);
    expect(filterWorklist(list, "CLINIC chest").map((s) => s.case_id)).toEqual(["case-e"]);
    expect(filterWorklist(list, "emergency pain").map((s) => s.case_id)).toEqual(["case-d"]);
    expect(filterWorklist(list, "nothing like this")).toEqual([]);
  });
  it("the search finds the LIDC id and the study label", () => {
    expect(filterWorklist(list, list[1].lidc_patient_id).map((s) => s.case_id)).toEqual(["case-e"]);
    expect(filterWorklist(list, "Example patient F").map((s) => s.case_id)).toEqual(["case-f"]);
  });
});
