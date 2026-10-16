import dcmjs from "dcmjs";
import { describe, expect, it } from "vitest";
import { BurnedInAnnotationError, deidentify, newUid, REMOVED_TAGS, shiftDate } from "@/features/privacy/deidentify";
import { bytesContain, FAKE, GEOMETRY, STUDY_DATE, syntheticDicom } from "../helpers/syntheticDicom";

const fileOf = (bytes: Uint8Array, name = "IM-0001.dcm") => new File([bytes as BlobPart], name);
const read = async (f: File) => dcmjs.data.DicomMessage.readFile(await f.arrayBuffer());
const seeded = (seed = 7) => {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
};

describe("deidentify (DICOM PS3.15 basic profile subset)", () => {
  it("removes every listed tag, every private tag and the nested copy, and leaves no fake value in the bytes", async () => {
    const { files, summary } = await deidentify({ ct: [fileOf(syntheticDicom())], report: null }, { random: seeded() });
    const out = new Uint8Array(await files.ct[0].arrayBuffer());
    const dicom = await read(files.ct[0]);
    for (const tag of Object.keys(REMOVED_TAGS)) expect(dicom.dict[tag], REMOVED_TAGS[tag]).toBeUndefined();
    expect(Object.keys(dicom.dict).filter((t) => parseInt(t.slice(0, 4), 16) % 2 === 1)).toEqual([]);
    expect(JSON.stringify(dicom.dict["00081140"].Value)).not.toContain("NESTED"); // the nested PatientName is gone
    for (const [name, value] of Object.entries(FAKE)) expect(bytesContain(out, value), name).toBe(false);
    expect(summary?.removedTags.map((t) => t.name).sort()).toEqual(Object.values(REMOVED_TAGS).sort());
    expect(summary?.privateTagsRemoved).toBe(2);
  });

  it("shifts the dates by one offset, keeps geometry and pixels, and renames the file", async () => {
    const { files } = await deidentify({ ct: [fileOf(syntheticDicom(), "PATIENT-DOE-JANE.dcm")], report: null }, { dayOffset: -100 });
    const dicom = await read(files.ct[0]);
    const expected = shiftDate(STUDY_DATE, -100);
    expect(expected).toBe("20231121");
    for (const tag of ["00080020", "00080021", "00080022", "00080023"]) expect(dicom.dict[tag].Value).toEqual([expected]);
    expect(dicom.dict["00280030"].Value).toEqual(GEOMETRY.pixelSpacing);
    expect(dicom.dict["00200032"].Value).toEqual(GEOMETRY.position);
    expect(dicom.dict["00200037"].Value).toEqual(GEOMETRY.orientation);
    expect(dicom.dict["00180050"].Value).toEqual([GEOMETRY.thickness]);
    expect(new Int16Array(dicom.dict["7FE00010"].Value![0] as ArrayBuffer)[3]).toBe(4);
    expect(files.ct[0].name).toBe("slice-0001.dcm");
  });

  it("replaces UIDs consistently across a series, and the meta SOP UID equals the dataset SOP UID", async () => {
    const input = [0, 1, 2].map((i) => fileOf(syntheticDicom({ index: i }), `f${i}.dcm`));
    const { files, summary } = await deidentify({ ct: input, report: null }, { random: seeded(3) });
    const parsed = await Promise.all(files.ct.map(read));
    const series = new Set(parsed.map((d) => d.dict["0020000E"].Value![0]));
    const sops = new Set(parsed.map((d) => d.dict["00080018"].Value![0]));
    expect(series.size).toBe(1);
    expect(sops.size).toBe(3);
    expect([...series][0]).not.toBe("1.2.826.0.1.3680043.8.498.1000");
    expect(String([...series][0])).toMatch(/^2\.25\.\d+$/);
    for (const d of parsed) expect(d.meta["00020003"].Value).toEqual(d.dict["00080018"].Value);
    expect(summary?.uidsReplaced).toBe(true);
  });

  it("keeps the UIDs of a known LIDC-IDRI series (already de-identified by TCIA) but still removes the tags", async () => {
    const uid = "1.3.6.1.4.1.14519.5.2.1.6279.6001.200841000324240313648595016964";
    const { files, summary } = await deidentify(
      { ct: [fileOf(syntheticDicom({ seriesUid: uid, burned: null }))], report: null },
      { knownSeriesUids: new Set([uid]) },
    );
    const dicom = await read(files.ct[0]);
    expect(dicom.dict["0020000E"].Value).toEqual([uid]);
    expect(dicom.dict["00100010"]).toBeUndefined();
    expect(summary?.knownSeries).toBe(true);
    expect(summary?.uidsReplaced).toBe(false);
  });

  it("stops a non-LIDC scan whose BurnedInAnnotation is YES or missing, with the plain message", async () => {
    for (const burned of ["YES", null] as const) {
      await expect(deidentify({ ct: [fileOf(syntheticDicom({ burned }))], report: null })).rejects.toThrow(
        "This scan may have patient details burned into the images. It was not uploaded.",
      );
    }
    await expect(deidentify({ ct: [fileOf(syntheticDicom({ burned: "YES" }))], report: null })).rejects.toBeInstanceOf(BurnedInAnnotationError);
  });

  it("skips files that are not DICOM and counts them; passes NIfTI and empty uploads through", async () => {
    const junk = new File(["not dicom"], "LICENSE");
    const { summary } = await deidentify({ ct: [fileOf(syntheticDicom()), junk], report: null });
    expect(summary?.dicomFiles).toBe(1);
    expect(summary?.skipped).toBe(1);
    const nii = new File([new Uint8Array(8)], "scan.nii.gz");
    expect((await deidentify({ ct: [nii], report: null })).summary).toBeNull();
    expect((await deidentify({ ct: [], report: null })).summary).toBeNull();
  });

  it("helpers: shiftDate rejects bad dates, newUid is a valid 2.25 UID", () => {
    expect(shiftDate("nonsense", 5)).toBeNull();
    expect(shiftDate("20240301", -1)).toBe("20240229");
    for (let i = 0; i < 20; i++) expect(newUid(Math.random)).toMatch(/^2\.25\.\d{1,39}$/);
  });
});
