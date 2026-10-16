# Phase 8 — The referral passport

**Time budget:** 3.5 hours · **Needs:** Phases 5–7 · **Produces:** the `/passport` screen and four downloads: a bilingual PDF, a FHIR summary, calendar reminders and a pre-written booking request.

## Goal

With one click the patient (or a family member) gets everything needed to book and keep the follow-up: what was found, what the guideline says, by when, and a message to send to the doctor.

## Steps

1. **Passport screen** `/passport`, reading `analysisStore`. Layout (Asklevia cards on Paper):
   - Header card: “Follow-up passport” (Funnel Display), meta “Example patient A · created {date}”, the safety banner text repeated inside the card (it will be printed).
   - “Finding” card: the evidence quote from the report (verbatim, in quotes) and the measured values in Geist Mono.
   - “Next step” card: the recommendation, the due window, rule id and citation.
   - “Explanation” card: the Phase 7 patient panel (both languages).
   - “Booking request” card: step 3’s message, with a “Copy message” secondary button.
   - Actions row: `ak-btn--primary` “Download passport (PDF)”, secondary “Download FHIR summary”, “Add reminders to calendar”, ghost “Send reminder by WhatsApp (mock)”.
2. **PDF** — must render Arabic correctly (shaping and right-to-left), so do not use ReportLab or jsPDF text APIs:
   - Add a print route `/passport/print` with a print stylesheet: A4, 16 mm margins, Asklevia colour lockup at the top (colour logo on White only), no viewer, page numbers, the safety statement in the footer of every page.
   - `POST /passport/pdf` in the API renders that route with Playwright (Chromium) to PDF and returns it. Fallback if the API cannot run Chromium: a client-side “Print or save as PDF” button using the same print stylesheet.
   - Include one static image of the nodule slice: export the current viewport to PNG (Cornerstone canvas `toDataURL`) with the outline, and caption it “Radiologist consensus outline · LIDC-IDRI-XXXX · example data”.
3. **Booking request** (templated, both languages): addressed “Dear Doctor”, states the finding in the report’s own words, the guideline recommendation with its citation, and asks for a follow-up appointment within the window. Signed “Prepared with NoduleBridge (decision support, not a diagnosis)”. Never says the patient has cancer or needs a specific test; it says what the guideline suggests and asks the doctor to decide.
4. **FHIR summary** `POST /passport/fhir` → a FHIR R4 `Bundle` (type `collection`), built with the `fhir.resources` library and validated before returning:
   - `Patient`: example patient, no identifiers, `meta.tag` “example”.
   - `ImagingStudy`: series UID from the manifest.
   - `DiagnosticReport`: status `final`, `conclusion` = the evidence quote, `presentedForm` = the report text.
   - `Observation`: the nodule, with components for size (UCUM `mm`), side/lobe and attenuation as text.
   - `ServiceRequest`: follow-up CT, `occurrencePeriod` = the due window, `reasonReference` → the Observation, `note` = rule id and citation.
   - `CarePlan`: one activity referencing the ServiceRequest.
   - Codes: use `code.text` everywhere. Add standard codes (SNOMED CT, LOINC) **only** where you have verified the code from the official browser; otherwise leave a `TODO-VERIFY` comment in code, not a guessed code.
5. **Calendar** `POST /passport/ics` → an `.ics` file (`icalendar` library), two events, both with the patient’s time zone (default `Asia/Riyadh`, configurable):
   - “Book your follow-up CT” 3 days from now, with an alarm.
   - “Follow-up CT window opens” on `window_start`, with alarms 14 days and 1 day before.
   - A second file for a family caregiver with the same events and the summary “Help {name} book the follow-up CT”.
   - Event descriptions in the chosen language, with the safety statement.
6. **WhatsApp (mock).** `POST /mock/whatsapp` logs the payload to `/data/mock-outbox.jsonl` and returns `{status: "mocked"}`. The UI shows a toast “Reminder scheduled (mock — nothing was sent)”. Never call a real messaging API in this build.
7. **Tests:** PDF endpoint returns a valid PDF whose extracted text contains the rule id and an Arabic string from the template; FHIR bundle validates and contains exactly one ServiceRequest with the correct period; ICS parses and has the right dates; the booking request contains no banned words.

## Acceptance checks

- For Case A, all four downloads work and open in standard apps (a PDF viewer, a calendar app, a FHIR validator such as the HL7 online validator or HAPI).
- The PDF shows correct, joined, right-to-left Arabic text (check visually; add a screenshot to `docs/build/evidence/phase-08/`).
- Printing never puts the colour logo on a dark area.
