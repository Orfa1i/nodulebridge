# Phase 2 — LIDC-IDRI case preparation (offline pipeline)

**Time budget:** 3.5 hours · **Needs:** Phase 1 done · **Produces:** 3 demo cases, each with a CT volume, a radiologist consensus nodule mask, measured nodule facts and a team-written report.

## Goal

Three real LIDC-IDRI CT scans become web-ready bundles in `/data/cases/<case-id>/`, with every number the demo shows (slice index, size, lobe guess, attenuation) computed from the data and saved in `manifest.json`.

## Background the agent must respect

- LIDC-IDRI (TCIA) has 1,018 thoracic CT cases with XML annotations from up to four radiologists per case, licensed CC BY 3.0. Cite it on `/about` with the collection’s official citation from the TCIA page (`TODO-VERIFY:` copy it exactly).
- **There are no radiology reports in LIDC-IDRI.** The team writes one report per case, consistent with the measured nodule, and labels it “Example report written for this demo”.
- The radiologist ratings (malignancy 1–5, spiculation, texture) are research annotations, not diagnoses. Do not show malignancy ratings to the patient.
- Download data with the NBIA Data Retriever or the TCIA REST API. Download only the 3 chosen series, not the collection.

## Steps

1. **Environment.** In `/pipeline`, create a Python project (`uv` or `pip-tools`) with `pylidc`, `pydicom`, `numpy`, `SimpleITK`, `nibabel`, `scikit-image`, `pytest`. Configure pylidc to point at the local DICOM folder (`~/.pylidcrc`).
2. **Pick 3 cases** with `pipeline/select_cases.py`, using pylidc queries. Selection rules:
   - Case A (hero): exactly one nodule cluster annotated by at least 3 radiologists, solid texture (median texture rating ≥ 4), mean diameter 8.5–10 mm, upper lobe if possible. This becomes the “9 mm” story only if the measured value is 9 mm; otherwise the story uses whatever the data says.
   - Case B: a nodule 6–8 mm (tests the 6–12 month branch).
   - Case C: a part-solid or ground-glass nodule (texture rating 1–3) ≥ 6 mm (tests the subsolid branch).
   - Slice thickness ≤ 2.5 mm for all three. Print a table of candidates and pick the first that meets the rules; record why in `progress.md`.
3. **Consensus mask.** For each chosen nodule, use `pylidc.utils.consensus(annotations, clevel=0.5, pad=...)` to get the 50%-agreement mask and its bounding box. Place it into a full-volume label map (same shape and geometry as the CT), label value 1.
4. **Measure** (`pipeline/measure.py`), per Fleischner 2017 measurement rules:
   - Find the axial slice where the mask area is largest.
   - On that slice, long axis = longest in-plane diameter; short axis = longest diameter perpendicular to it. Use the pixel spacing.
   - **Size for Fleischner = mean of long and short axis, rounded to the nearest whole mm.** Also save long and short axis to 0.1 mm.
   - Volume in mm³ from voxel count × voxel volume.
   - Centroid in voxel (i, j, k) and in patient coordinates (mm), using the DICOM geometry.
   - Slice index for the viewer: the index of the max-area slice **in the same ordering the viewer will use** (sorted by ImagePositionPatient z, ascending). Save both the index and the SOPInstanceUID of that slice so Phase 3 can check it.
   - Attenuation class from the median of the radiologists’ texture ratings. The LIDC scale anchors 1 = non-solid (ground-glass), 3 = part-solid (mixed), 5 = solid, with 2 and 4 in between. Map median ≤ 2 → ground-glass, 3 → part-solid, ≥ 4 → solid, in `pipeline/texture_map.py`, and note the rule in the manifest (`attenuation_method`). If the radiologists disagree by more than 2 points, flag the nodule `attenuation_uncertain: true`.
   - Lobe: LIDC-IDRI does not label lobes. Estimate side (left/right) from the centroid x relative to the body midline and upper/lower from z relative to the lung extent. Save it as `lobe_estimate` with `method: "geometric estimate"`. The report you write will state the lobe; they must agree.
5. **Export for the web** (`pipeline/export.py`): pick ONE format and use it for all cases, recording the choice:
   - Option 1 (simplest): CT as `ct.nii.gz` and mask as `mask.nii.gz`, same affine, loaded in the browser with Cornerstone’s NIfTI volume loader.
   - Option 2: the original DICOM series (already de-identified by TCIA) served as static files, plus the mask as a DICOM SEG built with `highdicom`.
   Check file sizes: target under 60 MB per case.
6. **Write the reports.** In `/data/cases/<id>/report.md` (and `report.pdf` made from it), write a realistic ED chest CT report for the scenario “CT for rib pain after a fall”. Requirements:
   - 25–45 lines of prose; the nodule sentence appears late (around line 30–40), after unrelated findings.
   - Include at least one negation near the nodule sentence (for example “No pleural effusion. However, a 9 mm solid nodule…”).
   - The size, lobe and attenuation in the text must equal the manifest values.
   - Case A also includes one distracting non-nodule finding (for example a healing rib fracture) so extraction must ignore it.
   - Header line: “Example report written for this demo. Not a real patient.”
7. **Manifest** `/data/cases/<id>/manifest.json`, validated against `/shared/schemas/case-manifest.schema.json` (define it now): `case_id`, `lidc_patient_id`, `series_instance_uid`, `files {ct, mask, report_pdf, report_md}`, `geometry {spacing, origin, direction, dims}`, `nodules[] {id, slice_index, slice_sop_uid, centroid_voxel, centroid_mm, long_axis_mm, short_axis_mm, mean_diameter_mm, volume_mm3, attenuation, lobe_estimate, radiologist_count}`, `label: "Example patient A"`, `attribution`.
8. **Tests** (`pipeline/tests/`): mask and CT share shape and affine; the max-area slice of the exported mask equals `slice_index`; mean diameter recomputed from the exported mask equals the manifest value; manifest validates against the schema.

## Acceptance checks

- `python -m pipeline.build_all` rebuilds all three cases from the downloaded DICOM in under 10 minutes.
- Each case folder contains CT, mask, report (md + pdf) and a schema-valid manifest.
- Opening `ct.nii.gz` with `mask.nii.gz` in 3D Slicer or ITK-SNAP shows the mask on the nodule at `slice_index`. Take one screenshot per case into `docs/build/evidence/phase-02/`.
- `pytest pipeline` passes.
- Case A’s report states exactly the manifest’s size, lobe and attenuation.

## Do not

- Run the MONAI or LUNA16-trained detector on LIDC-IDRI and present it as validation: LUNA16 is built from LIDC-IDRI, so the model has seen these scans. If you want an AI mask for show, run MedSAM with a box prompt from the consensus bounding box, label it “AI-assisted segmentation”, and report its Dice against the consensus mask honestly.
- Hard-code any value into the report that is not in the manifest.
