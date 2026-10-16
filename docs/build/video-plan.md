# Demo video plan (2:30 target)

Check the hackathon's length limit first. Record the screen at 1920x1080, browser zoom 100%, bookmarks hidden, notifications off. Record the voice-over separately and lay it over. No title slides, no login screens: open on the live UI. Run `pnpm warm` first and use Case A.

Every number said or shown must match the verification drawer on the day. Re-read the drawer before recording.

| Time | Scene | On screen | Say (draft, team to edit) |
|---|---|---|---|
| 0:00-0:15 | Hook | empty workspace, report visible | TODO-VERIFY: the team's hook. The follow-up statistic goes on screen in small Geist Mono only after it is traced to its paper (see release checklist). |
| 0:15-0:35 | The moment | drop Case A's folder and report; the stepper runs; the viewer jumps to the nodule; the sentence lights; the Next step card appears; the Arabic voice plays (English subtitles) | The scan and the report meet. The nodule is found, shown, and the guideline step follows. |
| 0:35-0:45 | Guardrail | point at the "Guideline rule" badge and citation, then the safety banner; optionally switch the report to the screening case and show "The guideline does not apply here." | A fixed rule decides the interval, not the AI. This supports a decision; it is not a diagnosis. |
| 0:45-1:05 | Bilingual split | English clinician view left, Arabic patient panel right | The patient reads the same finding in Arabic. Say the Arabic is reviewed by {name} only once `pnpm check-content` passes. |
| 1:05-1:25 | Passport | download the PDF (show the Arabic page), the calendar file in a calendar app, the FHIR file in a validator | A passport the patient can take to the doctor. Only show a validator and calendar once you have actually run them (see checklist). |
| 1:25-1:45 | Proof | open "Show verification": case ID, quote ticks, rule row, timings, "Pre-computed for demo" | Nothing is hard-coded: here is where each value came from. Cached steps say so. |
| 1:45-2:10 | How it is built | `docs/architecture.png` | The AI is boxed in: its quotes must be in the report, the rules are code, the explanation is reviewed text. |
| 2:10-2:30 | Impact and close | target metric, who pays, Asklevia end card on white | TODO-VERIFY: the team's impact line. |

Honesty rules for the recording: say "pre-computed for demo" when the drawer says cached; do not call the Arabic reviewed until it is; do not call the nodule outline AI (it is radiologist consensus); say example data.
