# Phase 9 — Safety, privacy and the verification drawer

**Time budget:** 3 hours · **Needs:** Phases 1–8 · **Produces:** real browser-side de-identification, guardrail tests, and the drawer that proves the demo is not hard-coded.

## Steps

1. **DICOM de-identification in the browser** (`web/src/features/privacy/deidentify.ts`, replacing the Phase 6 stub), with `dcmjs`:
   - Apply a documented subset of the DICOM PS3.15 Basic Application Level Confidentiality Profile. At least: remove or blank PatientName, PatientID, PatientBirthDate, PatientSex, OtherPatientIDs, PatientAddress, PatientTelephoneNumbers, AccessionNumber, InstitutionName, InstitutionAddress, ReferringPhysicianName, PerformingPhysicianName, OperatorsName, StationName, DeviceSerialNumber, StudyID, and all private tags. Shift StudyDate/SeriesDate/AcquisitionDate by a random per-session offset. Keep geometry tags (spacing, position, orientation) untouched.
   - Keep SeriesInstanceUID for prepared-case matching only when it matches a known LIDC-IDRI case (already de-identified by TCIA); otherwise replace UIDs with new ones.
   - If `BurnedInAnnotation` is `YES` or missing on a non-LIDC file, stop and show `ak-alert--danger`: “This scan may have patient details burned into the images. It was not uploaded.” Pixel scrubbing is out of scope; say so in the README.
   - Show a confirmation row after de-identification: “Patient details removed from 247 files on this device before upload.” with a “See what was removed” link listing tags (not values).
   - Unit tests with a synthetic DICOM that has fake PHI in every listed tag.
2. **Report text redaction before the LLM** (`deidentifyReport.ts`): regex replacement of name lines (“Patient:”, “Name:”), MRN-like IDs, phone numbers, dates of birth, then a preview the user confirms (“3 items redacted”). State plainly in the UI that regex redaction is not complete and the demo uses example reports only.
3. **Guardrail test suite** (`api/tests/test_guardrails.py` + Playwright): each must produce the expected safe outcome end to end:
   - indication “lung cancer screening” → not applicable, mentions that screening uses different rules.
   - “history of metastatic colon cancer” → not applicable.
   - stated age 30 → not applicable.
   - “No pulmonary nodules.” → no finding, explanation `NO_MATCH`-style message, no next step.
   - prompt-injection line in the report → identical recommendation to the clean report.
   - extraction quote mismatch (mocked) → finding dropped, `Needs review` shown.
   - API down → `ak-alert--danger` “The analysis service is not responding. Try again in a minute.” and no partial advice shown.
4. **Verification drawer** (side `ak-dialog` opened from “Show verification” in the Findings card), sections in Geist Mono where values are data:
   - Data: LIDC-IDRI patient ID and series UID with a link to the TCIA collection page, manifest values, “Outline source: radiologist consensus (50% agreement), pre-computed offline”.
   - Extraction: model id, prompt version, cached yes/no, latency, the raw JSON (collapsible), each evidence quote with its sentence id and a “Found in report” tick.
   - Guideline: rule id, the table row in words, the citation, engine version, the inputs it used (size band, count, attenuation, risk tier).
   - Explanation: template ids, review status and reviewer.
   - Timings per stage from Phase 6.
   - App version and git commit.
5. **Accessibility pass:** run `@axe-core/playwright` on `/`, `/passport`, `/about`; fix all serious and critical issues. Check keyboard-only use of the whole flow, focus order, visible focus, status never by colour alone (every badge has text), Arabic panel read correctly by a screen reader (`lang="ar"`).
6. **Copy audit:** script `make check-copy` scans all UI strings and templates for banned words, exclamation marks, emoji and Title Case buttons; fails the build if found.

## Acceptance checks

- Uploading a synthetic DICOM with fake PHI: the network request (check DevTools) contains none of the fake values.
- All guardrail tests pass.
- The verification drawer for Case A shows every listed item with real values.
- axe reports no serious or critical issues; `make check-copy` passes.
