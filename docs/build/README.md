# NoduleBridge build plan — an Asklevia product

Ten phase prompts for your coding agent (Claude Code, Cursor or similar), plus the Asklevia kit it builds with.

## How to use

1. Put this whole folder at the root of an empty repository as `docs/build/`.
2. Give the agent **`00-master-brief.md` first**, every session. It holds the rules that apply to every phase.
3. Then give it **one phase file at a time**, in order. Each ends with acceptance checks; do not start the next phase until they pass.
4. At the end of each phase the agent writes a short hand-off note to `docs/build/progress.md`. Read it before the next phase.

## Phases and time budget

Budget assumes a 48-hour build; scale each phase in proportion if yours is shorter or longer.

| # | File | Hours | Share |
|---|------|------:|------|
| 1 | `01-foundation-and-asklevia-shell.md` | 3 | First 20% |
| 2 | `02-lidc-case-preparation.md` | 3.5 | |
| 3 | `03-dicom-viewer.md` | 3 | |
| 4 | `04-report-extraction.md` | 8 | Middle 50% |
| 5 | `05-fleischner-engine.md` | 6 | |
| 6 | `06-report-to-voxel-linking.md` | 10 | |
| 7 | `07-bilingual-explainer-and-voice.md` | 4 | Final 30% |
| 8 | `08-referral-passport.md` | 3.5 | |
| 9 | `09-safety-privacy-verification.md` | 3 | |
| 10 | `10-deploy-demo-submission.md` | 4 | |

## What is in `asklevia-kit/`

- `tokens.json`: the Asklevia design tokens (source of truth).
- `tokens.css`: CSS variables and `@font-face` rules generated from `tokens.json`.
- `bundle.css`: the Asklevia component classes (`ak-` prefix). Needs `tokens.css` first.
- `nodulebridge-extensions.css`: five product additions the core system lacks (Arabic font, CT viewport surface, finding overlay colour, report highlight, safety banner). Each is marked PROPOSED.
- `fonts/`: Funnel Display, Host Grotesk, Geist Mono (variable woff2).
- `logos/`: horizontal lockup (colour and Ink), symbol, app icon, favicon.
- `ASKLEVIA-README.md`: the system’s voice, colour, type, layout and logo rules.

## Corrections already built into these prompts

- Fleischner 2017 for a single solid nodule over 8 mm is “consider CT at 3 months, PET/CT or tissue sampling”, not “repeat scan in 3 to 6 months”.
- LIDC-IDRI has no radiology reports. The demo reports are written by the team and labelled as such.
- The MONAI lung nodule detector is trained on LUNA16, which comes from LIDC-IDRI. Running it on LIDC-IDRI cases shows nothing about accuracy, so the overlay is the radiologists’ consensus mask, labelled as such.
- De-identification follows the DICOM PS3.15 basic profile, not only PatientName and PatientID.
- The guideline step is deterministic code with unit tests. The LLM only extracts.
- Arabic patient text is AI-assisted and must be reviewed by a bilingual clinician before the video.
