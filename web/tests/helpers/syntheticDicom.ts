import dcmjs from "dcmjs";

/** Fake patient details, one per identifying tag. Tests search the output bytes for these exact strings. */
export const FAKE = {
  PatientName: "DOE^JANE^FAKEPHI",
  PatientID: "MRN-FAKEPHI-0042",
  PatientBirthDate: "19610314",
  PatientBirthTime: "031415",
  PatientSex: "F",
  OtherPatientIDs: "OTHERID-FAKEPHI",
  OtherPatientNames: "ROE^OTHERFAKEPHI",
  PatientAddress: "12 FAKEPHI STREET RIYADH",
  PatientTelephoneNumbers: "+966500FAKEPHI",
  AccessionNumber: "ACC-FAKEPHI-7",
  InstitutionName: "FAKEPHI GENERAL HOSPITAL",
  InstitutionAddress: "1 FAKEPHI ROAD",
  InstitutionalDepartmentName: "FAKEPHI RADIOLOGY",
  ReferringPhysicianName: "SMITH^REFERRER^FAKEPHI",
  PhysiciansOfRecord: "JONES^RECORD^FAKEPHI",
  PerformingPhysicianName: "LEE^PERFORMER^FAKEPHI",
  OperatorsName: "KIM^OPERATOR^FAKEPHI",
  StationName: "STATION-FAKEPHI",
  DeviceSerialNumber: "SERIAL-FAKEPHI-99",
  StudyID: "STUDYID-FAKEPHI",
  PrivateTag: "PRIVATE-FAKEPHI-SECRET",
  NestedName: "NESTED^FAKEPHI",
} as const;

export const STUDY_DATE = "20240229";
export const GEOMETRY = {
  pixelSpacing: [0.7, 0.7],
  position: [-120.5, -130.25, 40.75],
  orientation: [1, 0, 0, 0, 1, 0],
  thickness: 2.5,
};

export interface SyntheticOptions {
  index?: number;
  seriesUid?: string;
  burned?: "YES" | "NO" | null;
}

const pn = (v: string) => [{ Alphabetic: v }];

/** A small but valid DICOM file with fake PHI in every tag the de-identifier must remove, plus a private tag and a nested one. */
export function syntheticDicom({ index = 0, seriesUid = "1.2.826.0.1.3680043.8.498.1000", burned = "NO" }: SyntheticOptions = {}): Uint8Array {
  const sop = `1.2.826.0.1.3680043.8.498.2000.${index + 1}`;
  const meta = {
    "00020002": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.2"] },
    "00020003": { vr: "UI", Value: [sop] },
    "00020010": { vr: "UI", Value: ["1.2.840.10008.1.2.1"] },
  };
  const dict: Record<string, { vr: string; Value?: unknown[] }> = {
    "00080016": { vr: "UI", Value: ["1.2.840.10008.5.1.4.1.1.2"] },
    "00080018": { vr: "UI", Value: [sop] },
    "00080020": { vr: "DA", Value: [STUDY_DATE] },
    "00080021": { vr: "DA", Value: [STUDY_DATE] },
    "00080022": { vr: "DA", Value: [STUDY_DATE] },
    "00080023": { vr: "DA", Value: [STUDY_DATE] },
    "00080050": { vr: "SH", Value: [FAKE.AccessionNumber] },
    "00080060": { vr: "CS", Value: ["CT"] },
    "00080080": { vr: "LO", Value: [FAKE.InstitutionName] },
    "00080081": { vr: "ST", Value: [FAKE.InstitutionAddress] },
    "00080090": { vr: "PN", Value: pn(FAKE.ReferringPhysicianName) },
    "00081010": { vr: "SH", Value: [FAKE.StationName] },
    "00081040": { vr: "LO", Value: [FAKE.InstitutionalDepartmentName] },
    "00081048": { vr: "PN", Value: pn(FAKE.PhysiciansOfRecord) },
    "00081050": { vr: "PN", Value: pn(FAKE.PerformingPhysicianName) },
    "00081070": { vr: "PN", Value: pn(FAKE.OperatorsName) },
    "00081140": { vr: "SQ", Value: [{ "00100010": { vr: "PN", Value: pn(FAKE.NestedName) } }] },
    "00090010": { vr: "LO", Value: ["ACME PRIVATE CREATOR"] },
    "00091001": { vr: "LO", Value: [FAKE.PrivateTag] },
    "00100010": { vr: "PN", Value: pn(FAKE.PatientName) },
    "00100020": { vr: "LO", Value: [FAKE.PatientID] },
    "00100030": { vr: "DA", Value: [FAKE.PatientBirthDate] },
    "00100032": { vr: "TM", Value: [FAKE.PatientBirthTime] },
    "00100040": { vr: "CS", Value: [FAKE.PatientSex] },
    "00101000": { vr: "LO", Value: [FAKE.OtherPatientIDs] },
    "00101001": { vr: "PN", Value: pn(FAKE.OtherPatientNames) },
    "00101040": { vr: "LO", Value: [FAKE.PatientAddress] },
    "00102154": { vr: "SH", Value: [FAKE.PatientTelephoneNumbers] },
    "00180050": { vr: "DS", Value: [GEOMETRY.thickness] },
    "00181000": { vr: "LO", Value: [FAKE.DeviceSerialNumber] },
    "0020000D": { vr: "UI", Value: ["1.2.826.0.1.3680043.8.498.3000"] },
    "0020000E": { vr: "UI", Value: [seriesUid] },
    "00200010": { vr: "SH", Value: [FAKE.StudyID] },
    "00200013": { vr: "IS", Value: [index + 1] },
    "00200032": { vr: "DS", Value: GEOMETRY.position },
    "00200037": { vr: "DS", Value: GEOMETRY.orientation },
    "00200052": { vr: "UI", Value: ["1.2.826.0.1.3680043.8.498.4000"] },
    "00280002": { vr: "US", Value: [1] },
    "00280004": { vr: "CS", Value: ["MONOCHROME2"] },
    "00280010": { vr: "US", Value: [2] },
    "00280011": { vr: "US", Value: [2] },
    "00280030": { vr: "DS", Value: GEOMETRY.pixelSpacing },
    "00280100": { vr: "US", Value: [16] },
    "00280101": { vr: "US", Value: [16] },
    "00280102": { vr: "US", Value: [15] },
    "00280103": { vr: "US", Value: [1] },
    "7FE00010": { vr: "OW", Value: [new Int16Array([1, 2, 3, 4]).buffer] },
  };
  if (burned !== null) dict["00280301"] = { vr: "CS", Value: [burned] };
  const dicom = new dcmjs.data.DicomDict(meta);
  dicom.dict = dict;
  return new Uint8Array(dicom.write());
}

export function bytesContain(haystack: Uint8Array, needle: string): boolean {
  return Buffer.from(haystack).includes(Buffer.from(needle, "latin1"));
}
