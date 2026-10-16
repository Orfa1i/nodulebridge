# Release checklist

Ticked only when true, with the evidence. Last updated 2026-10-16.

## Gates

- [ ] **Every `TODO-VERIFY` resolved or listed as a known limitation.** Open: Arabic safety banner text; TCIA citation text and the DOI as written in the manifests; Fleischner DOI link; team names on `/about`; lobe estimates ("clinician to confirm lobe"); FHIR standard codes (LOINC 18748-4, SNOMED CT 786838002 and 169069000, DICOM DCM CT) were looked up in public references on 2026-10-17 but not yet in the official SNOMED International browser or on loinc.org (both blocked automated lookups): see `shared/content/fhir-codes.json`; Arabic button labels in the voice player; Arabic banned-word list. The README lists the main ones under Safety and limitations.
- [ ] **Every Fleischner rule ticked in `fleischner-checklist.md` by the team clinician.** Not done: the file is unticked.
- [ ] **Arabic templates for Cases A to C reviewed (`pnpm check-content`).** Not done: it fails on purpose (every template, term, engine sentence, PDQ excerpt and passport string used by Cases A to C is still `draft`). The three Arabic voice clips also need a listening check by a native speaker, and `pnpm voices` must be re-run after any wording change.
- [x] **Lint, tests, copy check, eval and Playwright pass** (2026-10-16): `pnpm lint` (eslint, stylelint, hex check, ruff, check-copy) clean; API 295, pipeline 38, web unit 82, Playwright 79+ pass / 1 skipped; `tsc` and `next build --webpack` clean. Live eval: 26/26 thresholds on `extract_v4` with `gemini-3.5-flash-lite` (Phase 4; the set is small and written by the team, so this is not real-world accuracy).
- [x] **No real patient data in the repo or deployment.** Reports are team-written examples; CT images are LIDC-IDRI (TCIA, already de-identified); the only DICOM with fake patient details is synthetic, in tests. Nothing is deployed yet. Secrets are only in the git-ignored `.env` (scanned for in every commit).
- [ ] **LIDC-IDRI attribution on `/about` and in the README, copied exactly from TCIA.** Not done: both still say TODO-VERIFY for the exact citation text.
- [ ] **The 61.6% / 38.4% follow-up figures traced to the original paper.** Not done: a web search did not find them in a primary source. Do not print them until found; the README and video plan carry a TODO-VERIFY.

## Deployment (needs accounts and credentials, so not done by the assistant)

- [x] API container builds, starts healthy, seeds the example cache, and makes the PDF (with Chromium) when pointed at a production build of the web app. Tested locally with Docker.
- [x] Rate limits on `/extract` (model calls only), `/tts`, `/passport/pdf`; `pnpm warm` written and run against the local stack.
- [ ] Web deployed (Vercel) with `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_DATA_BASE_URL`.
- [ ] API deployed with the secrets, `WEB_ORIGIN`, `WEB_BASE_URL`, `TRUST_PROXY=true`.
- [ ] Case files uploaded to object storage with CORS and long cache headers.
- [ ] `pnpm warm` run against the public URLs; Case A runs from a fresh browser in under 8 s.
- [ ] `/health` monitored.

## Submission

- [ ] FHIR file run through the HL7 or HAPI validator, and the .ics opened in a calendar app (both would be shown in the video).
- [ ] Video recorded to `docs/build/video-plan.md`, under the limit, every number matching the verification drawer.
- [ ] README: live URL and video link filled in; Arabic reviewer named.
- [ ] Google AI Studio key rotated after the hackathon (it was pasted in chat).
