# NoduleBridge

NoduleBridge, a product by Asklevia, helps close the follow-up gap for incidental lung nodules found on CT. It reads a chest CT and its radiology report, links the nodule to the report sentence, applies the Fleischner Society 2017 rules in deterministic code, and explains the next step in plain Arabic and English. It supports follow-up decisions and never diagnoses. Hackathon prototype; example data only (TCIA LIDC-IDRI, CC BY 3.0).

Live demo: TODO (public URL after deployment, see `docs/deploy.md`). Video: TODO (link after recording, see `docs/build/video-plan.md`). Architecture: `docs/architecture.png`.

## What you see

The home screen is a worklist of 18 chest CT studies, like an inbox a radiologist or referring doctor would open: study, patient (fictional age and sex), exam, indication, referring service, report on file. Opening a study reads its report, shows the nodule in the CT viewer, applies the guideline and builds the bilingual summary and passport. The scans are LIDC-IDRI; the reports and referral details are team-written examples. Three studies (R, S, T) are written so that the guideline does not apply (age 30, a screening scan, a known cancer) to show the guardrails on real scans.

## Innovation

Most tools in this space classify the image. NoduleBridge closes the follow-up loop instead: it links the nodule in the scan to the sentence in the radiology report that mentions it, applies the Fleischner Society 2017 rules in deterministic code, and gives the patient a bilingual (Arabic and English) passport with the next step, a due window, a message for the doctor, a PDF, a FHIR summary and calendar reminders. The language model only reads the report; every value it returns must quote the report, and a rule engine, not the model, chooses the interval.

## Patient impact

An emergency CT done for another reason can show an incidental lung nodule that gets buried in the report, and many such findings are never followed up. TODO-VERIFY: the exact follow-up figures and their primary source. A search did not find a paper reporting the 61.6% / 38.4% split quoted in the build brief; do not print those numbers until the original paper is found and cited by authors and journal. The target metric is follow-up completion; the people it helps are patients who would otherwise not know a scan is due, and the doctors who see them.

## Technical execution

- **Viewer:** Cornerstone3D CT viewer with the radiologists' consensus outline, jump-to-finding and two-way sync with the report.
- **Evidence-verified extraction:** the model returns structured findings with verbatim quotes; code drops any quote not found in the report. On the 26-case evaluation set (small and written by the team, so not real-world accuracy) every threshold passed (26/26, mean 8.6 s, max 17.2 s) with `gemini-3.5-flash-lite`.
- **Deterministic Fleischner engine:** `api/app/rules/fleischner2017.py`, 100% test coverage, with a checklist for the clinician (`docs/build/fleischner-checklist.md`, not yet ticked).
- **Explanation and voice:** reviewed templates keyed by rule id (no model writes patient text), Arabic with correct right-to-left layout, pre-made voice clips.
- **Outputs:** passport PDF made in headless Chromium (joined Arabic), FHIR R4 Bundle validated with `fhir.resources`, iCalendar files.
- **Safety and quality gates:** guardrail tests, axe accessibility checks, `pnpm check-copy`, `pnpm check-content`, per-IP rate limits.

## Feasibility and scalability

Built on public data and open standards (DICOM, FHIR R4, iCalendar, Fleischner 2017). A hospital pilot would need a PACS or DICOMweb connection, a real report feed, local review of the Arabic text by a clinician, and a security review. Regulatory exposure as adherence support is expected to be low, to be confirmed with the regulator (SFDA in Saudi Arabia).

## Presentation

Video and live demo links are above (to be added). `docs/build/video-plan.md` has the scene plan.

## Safety and limitations

- Not a diagnosis; decision and adherence support only. Follow-up decisions belong to the doctor.
- Nodule outlines are radiologists' consensus masks, pre-computed offline, not AI segmentation.
- Reports are written by the team as examples. The CT images are LIDC-IDRI research data. No real patient data.
- Regex report redaction is incomplete; pixel-level patient data in images is not handled (such scans are refused).
- The Arabic text is a machine draft until a bilingual clinician reviews it: `pnpm check-content` fails until then. Arabic reviewed by: TODO (name). The Arabic voice clips need a listening check by a native speaker.
- The guideline table has not yet been ticked off by the team clinician.
- The FHIR files for Cases A to C pass the official HL7 validator with 0 errors (run offline, terminology checks off); the calendar file was parsed by a library only, not yet opened in a calendar app. The FHIR file carries four standard codes (LOINC 18748-4; SNOMED CT 786838002 and 169069000; DICOM DCM CT) that the project owner confirmed in the official browsers (the assistant checked public references only); nothing else is coded.
- Free-tier model and speech limits apply.

## Data and credits

- CT images: The Cancer Imaging Archive (TCIA), LIDC-IDRI collection, CC BY 3.0. TODO-VERIFY: the exact citation text from the TCIA collection page (the manifests carry the DOI as written by the pipeline).
- Guideline: MacMahon H, Naidich DP, Goo JM, et al. Guidelines for Management of Incidental Pulmonary Nodules Detected on CT Images: From the Fleischner Society 2017. Radiology 2017;284(1):228-243. TODO-VERIFY: DOI link.
- Patient information excerpts: National Cancer Institute, PDQ lung cancer screening summary for patients (verbatim, with source and retrieval date in the app).
- Design system: Asklevia. Libraries: Cornerstone3D, dcmjs, dicom-parser, fhir.resources, icalendar, Playwright, FastAPI, Next.js.

## Run


Requires Node 22, pnpm, Python 3.11+ and uv.

```
cp .env.example .env
pnpm install
pnpm --dir web install
uv sync --project api
pnpm dev        # web :3000 + api :8000 (set API_PORT to change)
pnpm test
pnpm lint
pnpm schemas    # regenerate TS and Python types from /shared/schemas
```

Build plan and rules: `docs/build/`.

## Privacy and safety limits

This is a prototype for example data. Do not use it with real patient data.

- **DICOM de-identification runs in the browser** (`web/src/features/privacy/deidentify.ts`, a documented subset of DICOM PS3.15 Basic Application Level Confidentiality Profile). It removes the identifying tags and every private tag, shifts study dates by a random per-session offset, replaces UIDs (except for known LIDC-IDRI series, which TCIA already de-identified), keeps geometry and pixels, and renames files. Nothing from a scan is sent to the server in this prototype.
- **Pixel scrubbing is out of scope.** Text burned into the image stays. A non-LIDC scan whose `BurnedInAnnotation` is `YES` or missing is refused ("This scan may have patient details burned into the images. It was not uploaded.") instead of being cleaned.
- **Report text is checked by patterns before the model reads it** (`api/app/services/redact.py`, `POST /redact`): names on "Patient:" lines, record and accession numbers, phone numbers, dates of birth, e-mail addresses. The person sees what was redacted and confirms. Pattern matching is not complete: it misses names in running text and unusual formats.
- **Verification:** `pnpm check-content` (fails until a clinician reviews the Arabic and English patient text), `pnpm check-copy` (voice rules, part of `pnpm lint`), guardrail tests in `api/tests/test_guardrails.py` and `web/tests/e2e/guardrails.spec.ts`, accessibility checks in `web/tests/e2e/accessibility.spec.ts`. In the app, "Show verification" lists where each part of a result came from.
