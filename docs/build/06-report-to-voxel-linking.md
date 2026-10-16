# Phase 6 — Linking the report to the scan (the demo moment)

**Time budget:** 10 hours · **Needs:** Phases 3–5 · **Produces:** the full drop-in flow: files in, viewer jumps to the nodule, sentence highlighted, guideline next step shown, in about 4 seconds.

## Goal

One upload of a CT folder and a report runs the pipeline end to end. The report finding is matched to an outlined nodule in the scan, and the two stay in sync both ways.

## Steps

1. **Upload zone** (Case workspace empty state) using `ak-dropzone`: title “Drop a chest CT folder and its report, or **choose files**”, meta “DICOM folder or .nii.gz, plus the report as PDF or text. Example data only.” Accept a folder (`webkitdirectory`) and a PDF together, or a case picker “Use example patient A / B / C”. Add `.is-dragover` on drag.
2. **Pre-upload privacy hook.** Call `deidentify(files)` before anything leaves the browser. In this phase it is a stub that returns the files unchanged and logs a warning; Phase 9 implements it. Do not skip the call.
3. **Identify the scan.** Read the SeriesInstanceUID from the first DICOM file (client-side with `dicom-parser` or `dcmjs`), or from the NIfTI sidecar for prepared cases. If it matches a prepared case manifest, load that case (CT + pre-computed mask). If not, load the CT alone and show `ak-alert--info`: “No prepared outline for this scan. The report finding is shown without an outline.” (Do not run live segmentation unless you finished the optional MedSAM path in Phase 2.)
4. **Orchestrate** in `web/src/features/analysis/runAnalysis.ts` with these stages, shown in an `ak-steps` stepper above the workspace: “Read report” → “Find nodule” → “Match to scan” → “Apply guideline” → “Explain”. Each step shows its meta (“1 nodule found”, “Matched: 9 mm, right upper”, “Rule FL17-S1-GT8”).
   - Read report: `POST /extract` (spectrum progress bar while it runs).
   - Find nodule: pick the driving nodule (same logic as Phase 5).
   - Match to scan: step 5.
   - Apply guideline: `POST /recommend`.
   - Explain: hand off to Phase 7 (stub text for now).
   - Start loading the CT volume **in parallel** with extraction, not after it.
5. **Matching** (`web/src/features/analysis/matchFinding.ts`, pure function with tests): score each manifest nodule against the report nodule:
   - size: |report mean − manifest mean| ≤ 2 mm → +2, ≤ 4 mm → +1
   - side matches → +2; lobe matches the geometric estimate → +1 (estimates can be wrong, so lower weight)
   - attenuation matches → +1
   Best score ≥ 4 → matched, show reasons. Otherwise “The report finding could not be matched to an outlined nodule” and keep the viewer free to scroll. Show the match and its reasons in the Findings card (“Matched to outline: size 9 vs 9 mm, right side, solid”).
6. **Two-way sync:**
   - Clicking a highlighted sentence, or the finding row → `jumpToFinding(id)` and pulse.
   - Clicking the nodule label in the viewer → scroll the report card to the sentence (`scrollIntoView({block: "center"})`), add `.is-active` to `.nb-evidence` for 1.5 s.
   - When the user scrolls the viewer onto the finding’s slice range, the finding row gets a subtle `bg-brand-subtle` state.
   - All of this keyboard-reachable: the sentence spans are buttons (`role="button"`, `tabindex=0`, Enter/Space).
7. **The auto-sequence** after analysis finishes, timed so it reads on video: viewer jumps to the finding (320 ms) → outline pulses → report scrolls and highlights → the Next step card fades in → the voice summary becomes available (“Play summary”). Auto-play audio only if the user started the analysis with a click (browser autoplay rules) and never when `prefers-reduced-motion` is set; otherwise show the button.
8. **Timings.** Measure each stage with `performance.now()` and keep them in the analysis state for the Phase 9 verification drawer. Target: under 4 s from drop to highlight for Case A with a warm cache, under 8 s live. Record real numbers in `progress.md`.
9. **State.** One store (`analysisStore`) holding: case manifest, sentences, extraction result, verification, match, recommendation, timings, cached flags. The Passport screen (Phase 8) reads from it. Persist the last analysis in `sessionStorage` so a page refresh during the demo does not lose it.
10. **End-to-end test** (Playwright): choose example patient A → wait for the stepper to complete → assert the viewer HUD shows the manifest slice, the evidence sentence has `.nb-evidence`, and the Next step card shows rule `FL17-S1-GT8`.

## Acceptance checks

- Dropping Case A’s folder + PDF completes all five steps; the four synced behaviours in step 6 work with mouse and keyboard.
- An unrelated report (for example Case B’s report with Case A’s scan) produces “could not be matched” rather than a wrong link.
- Stage timings visible in dev tools or a dev overlay; numbers recorded.
- The Playwright test passes three runs in a row.

## Do not

- Fake speed with timers or hard-coded results. If something is cached, the step meta says “cached”.
- Block the UI on the CT download; extraction and loading run together.
