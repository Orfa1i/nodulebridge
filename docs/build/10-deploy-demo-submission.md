# Phase 10 — Deploy, record the demo, submit

**Time budget:** 4 hours · **Needs:** everything · **Produces:** a public demo URL, the 2–3 minute video plan, and the written submission.

## Steps

1. **Deploy.**
   - Web on Vercel (production build, env vars set). API on Modal (CPU is enough when masks are pre-computed; GPU only if live MedSAM is on) or Render/Fly: Dockerfile including Chromium for the PDF endpoint.
   - Case files on object storage (Vercel Blob, Cloudflare R2 or S3) with CORS for the web origin and long cache headers; set `DATA_BASE_URL`.
   - `/health` monitored; a `make warm` script calls `/health`, `/extract` for Cases A–C (cache hits) and fetches each case volume once, so the first recorded run is warm.
   - Rate-limit `/extract` (for example 20 requests per hour per IP) so a public link cannot run up the API bill.
2. **Final checklist** (create `docs/build/release-checklist.md` and tick only when true):
   - [ ] Every `TODO-VERIFY` resolved or listed as a known limitation.
   - [ ] Every Fleischner rule ticked in `fleischner-checklist.md` by the team clinician.
   - [ ] Arabic templates for Cases A–C reviewed (`make check-content`).
   - [ ] `make lint`, `make test`, `make check-copy`, eval thresholds, Playwright suite all pass.
   - [ ] No real patient data anywhere in the repo or the deployment.
   - [ ] LIDC-IDRI attribution on `/about` and in the README, copied exactly from TCIA.
   - [ ] The 61.6% / 38.4% follow-up figures traced to the original paper and cited by authors and journal, not only a news site.
3. **Video plan (2:30 target; check the hackathon’s limit).** No title slides or login screens; open on the live UI.
   - **0:00–0:15 Hook** (voice-over over the empty workspace with the report visible): the team’s reviewed version of the hook, with the follow-up statistic cited on screen in small Geist Mono.
   - **0:15–0:35 The moment**: drop Case A’s folder and report; the stepper runs; the viewer jumps to the nodule, the sentence lights up, the Next step card appears; the Arabic voice plays (subtitled in English).
   - **0:35–0:45 Guardrail**: point at the “Guideline rule” badge and citation, then the banner “not a diagnosis”. Optionally switch to the “lung cancer screening” guardrail case and show “Guideline does not apply”.
   - **0:45–1:05 Bilingual split**: clinician view in English on the left, the Arabic patient panel on the right.
   - **1:05–1:25 Passport**: download the PDF (show the Arabic page), the calendar reminder appearing in a calendar app, the FHIR file in a validator.
   - **1:25–1:45 Proof**: open the verification drawer: LIDC-IDRI case ID, evidence quote ticks, rule row, timings, “pre-computed” labels.
   - **1:45–2:10 How it is built**: one architecture diagram (step 4) showing the LLM boxed in by deterministic verification and rules.
   - **2:10–2:30 Impact and close**: the follow-up target, who pays (hospitals and payers under value-based care), the Asklevia logo end card on White.
   Record screen at 1920×1080, browser zoom 100%, bookmarks hidden, notifications off; record voice separately and lay it over.
4. **Architecture diagram** (`docs/architecture.mmd`, Mermaid, rendered to PNG in Asklevia colours: Ink text, hairline boxes, the spectrum only on the AI boxes):
   browser (upload, de-identification, Cornerstone3D viewer) → API: text intake → **LLM extraction (AI)** → deterministic verification → **Fleischner engine (rules)** → reviewed templates → TTS **(AI voice)** → passport (PDF, FHIR, ICS). Side store: prepared LIDC-IDRI cases with consensus masks.
5. **Written submission / README**, with the judging criteria as top-level headings:
   - **Innovation**: follow-up loop closure rather than another classifier; bilingual patient passport.
   - **Patient impact**: the follow-up gap with its cited source; the target metric; who it helps.
   - **Technical execution**: Cornerstone3D viewer, evidence-verified LLM extraction with the eval scores from Phase 4, deterministic Fleischner engine with full test coverage, FHIR R4 output.
   - **Feasibility & scalability**: public data and standards; what a hospital pilot needs (PACS or DICOMweb connection, real report feed, local Arabic review). Say “low regulatory exposure as adherence support, to be confirmed with the regulator (SFDA in Saudi Arabia)”, not “no regulatory roadblocks”.
   - **Presentation**: link to the video and the live demo.
   - **Safety and limitations** (its own section): not a diagnosis; consensus masks pre-computed; reports written by the team; LIDC-IDRI is research data; regex report redaction is incomplete; pixel PHI not handled; Arabic reviewed by {name}.
   - **Data and credits**: LIDC-IDRI (TCIA, CC BY 3.0) citation, Fleischner 2017 citation, NCI PDQ excerpts, Asklevia design system.
   - Links to every public dataset and API used.

## Acceptance checks

- The public URL runs Case A end to end from a fresh browser in under 8 s after `make warm`.
- The release checklist is fully ticked or each open item is listed under Limitations.
- The video is under the limit and every number in it matches the verification drawer.
